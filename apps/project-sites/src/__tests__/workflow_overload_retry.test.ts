/**
 * Contract test for SITE_BUILDER overloaded-error self-healing.
 *
 * When max_instances=10 is reached, Cloudflare Container DO throws
 * `Error: There is no container instance that can be provided to this Durable
 * Object, try again later` with `.overloaded=true`. We rely on Workflow's
 * `step.do(... { retries: { limit: 2, ... } })` to retry transparently.
 *
 * This test pins two contracts:
 *   1. The retry math: with limit=2, an overloaded error on attempt 1 +
 *      success on attempt 2 returns clean (no surfaced error).
 *   2. The source contains the expected retry config on `start-build`,
 *      `stub-start-build`, and `minimal-build` — preventing a regression
 *      that drops retries to 0 from silently breaking overload self-healing.
 *
 * Cannot instantiate SiteGenerationWorkflow directly because it extends
 * `WorkflowEntrypoint` from the `cloudflare:workers` virtual module (only
 * resolvable inside the Workers runtime). Hence the contract approach.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKFLOW_SRC = resolve(__dirname, '../workflows/site-generation.ts');

/** Mirrors Cloudflare Workflows' documented step.do retry semantics. */
async function simulateStepDo<T>(
  _name: string,
  options: { retries?: { limit?: number } },
  fn: () => Promise<T>,
): Promise<T> {
  const limit = options.retries?.limit ?? 0;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= limit; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function makeOverloadedError(): Error & { overloaded: true } {
  const err = new Error(
    'There is no container instance that can be provided to this Durable Object, try again later',
  ) as Error & { overloaded: true };
  err.overloaded = true;
  return err;
}

describe('SITE_BUILDER overloaded retry contract', () => {
  it('production retry config (limit=2) self-heals one overloaded error', async () => {
    let calls = 0;

    const result = await simulateStepDo(
      'start-build',
      { retries: { limit: 2 } },
      async () => {
        calls++;
        if (calls === 1) throw makeOverloadedError();
        return { jobId: 'job-abc-123' };
      },
    );

    expect(calls).toBe(2);
    expect(result).toEqual({ jobId: 'job-abc-123' });
  });

  it('production retry config (limit=2) self-heals two consecutive overloaded errors', async () => {
    let calls = 0;

    const result = await simulateStepDo(
      'start-build',
      { retries: { limit: 2 } },
      async () => {
        calls++;
        if (calls <= 2) throw makeOverloadedError();
        return { jobId: 'job-after-2-failures' };
      },
    );

    expect(calls).toBe(3);
    expect(result).toEqual({ jobId: 'job-after-2-failures' });
  });

  it('three consecutive overloaded errors exhaust retries and surface the original error', async () => {
    let calls = 0;
    const overloadedErr = makeOverloadedError();

    await expect(
      simulateStepDo('start-build', { retries: { limit: 2 } }, async () => {
        calls++;
        throw overloadedErr;
      }),
    ).rejects.toMatchObject({ overloaded: true });

    expect(calls).toBe(3);
  });

  it('retry config of limit=0 would NOT self-heal — proves the limit matters', async () => {
    let calls = 0;

    await expect(
      simulateStepDo('start-build', { retries: { limit: 0 } }, async () => {
        calls++;
        if (calls === 1) throw makeOverloadedError();
        return { jobId: 'never-reached' };
      }),
    ).rejects.toMatchObject({ overloaded: true });

    expect(calls).toBe(1);
  });
});

describe('SITE_BUILDER source regression guards', () => {
  let src: string;
  beforeAll(() => {
    src = readFileSync(WORKFLOW_SRC, 'utf-8');
  });

  it('start-build step declares retries.limit >= 2', () => {
    // The block reads:
    //   step.do('start-build', {
    //     retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' },
    //     timeout: '5 minutes',
    //   }, async () => { ... })
    const match = src.match(/'start-build'[\s\S]{0,300}?retries:\s*\{\s*limit:\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(2);
  });

  it('minimal-build step declares retries.limit >= 2', () => {
    const match = src.match(/'minimal-build'[\s\S]{0,300}?retries:\s*\{\s*limit:\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(2);
  });

  it('stub-start-build step declares retries.limit >= 2', () => {
    const match = src.match(/'stub-start-build'[\s\S]{0,300}?retries:\s*\{\s*limit:\s*(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(2);
  });

  it('all container-fetch steps use exponential backoff (not constant)', () => {
    const stepBlocks = src.match(
      /step\.do\(\s*'(start-build|minimal-build|stub-start-build)'[\s\S]{0,400}?backoff:\s*'(\w+)'/g,
    );
    expect(stepBlocks).not.toBeNull();
    expect(stepBlocks!.length).toBeGreaterThanOrEqual(3);
    for (const block of stepBlocks!) {
      expect(block).toMatch(/backoff:\s*'exponential'/);
    }
  });

  it('finalize-build re-reads KV when in-memory uploadResult is missing', () => {
    // Regression guard: Vito's build (job-1777560513919-pqtgjd) reported
    // file_count=116 but uploadResult=null because the heartbeat poll dropped
    // uploadResult from container /status responses. The fix must:
    //  1. Capture uploadResult from terminal status regardless of source.
    //  2. In finalize-build, fall back to a fresh KV read if kvFinalRecord
    //     is missing or empty — KV is the canonical store written by the
    //     container's HMAC callback.
    const finalizeBlock = src.match(/finalize-build[\s\S]{0,2500}?return JSON\.stringify/);
    expect(finalizeBlock).not.toBeNull();
    expect(finalizeBlock![0]).toMatch(/CACHE_KV\.get\(`build:\$\{jobId\}`\)/);
    expect(finalizeBlock![0]).toMatch(/uploadResult\s*=\s*fresh\.uploadResult/);
  });

  it('heartbeat ignores DO-restart `unknown job` response (not a terminal state)', () => {
    // Regression guard: container /status returns {error:'unknown job'} with no
    // `status` field after the Durable Object restarts. The previous bug:
    // `if (parsed.status !== 'running')` evaluated true (undefined!=='running'),
    // breaking out of the heartbeat loop with finalStatus.status=undefined and
    // uploadResult=null. Fix: only ['complete','error'] count as terminal.
    const heartbeatBlock = src.match(/let kvFinalRecord[\s\S]+?finalize-build/);
    expect(heartbeatBlock).not.toBeNull();
    expect(heartbeatBlock![0]).toMatch(/TERMINAL\s*=\s*new Set\(\['complete',\s*'error'\]\)/);
    expect(heartbeatBlock![0]).toMatch(/TERMINAL\.has\(String\(parsed\.status\)\)/);
    // Must NOT use the old `parsed.status !== 'running'` check (it falsely fires on undefined).
    expect(heartbeatBlock![0]).not.toMatch(/parsed\.status\s*!==\s*'running'/);
  });

  it('version is minted inside step.do so workflow replays return the cached value', () => {
    // Regression guard: prior to this fix, `version` was generated outside step.do.
    // CF Workflow replay re-executed `new Date().toISOString()` producing a fresh
    // timestamp. finalize-build then wrote the WRONG R2 prefix to D1, so the live
    // site 404'd while files existed under the original version path. Vito's
    // 2026-04-30 build: container uploaded 22 files at 2026-04-30T15-34-00-718Z;
    // D1 was set to 2026-04-30T15-50-54-783Z (replay-time). Site served 404.
    const mintBlock = src.match(/step\.do\(\s*'mint-version'[\s\S]{0,300}/);
    expect(mintBlock).not.toBeNull();
    expect(mintBlock![0]).toMatch(/new Date\(\)\.toISOString\(\)\.replace/);
    // The bare line must not exist anywhere — version MUST come from the step.
    const bareVersionLines = src.match(/^\s*const version = new Date\(\)\.toISOString\(\)\.replace/m);
    expect(bareVersionLines).toBeNull();
  });

  it('heartbeat captures uploadResult from container /status (not just KV)', () => {
    // The previous bug: `if (!isFromContainer) kvFinalRecord = parsed`.
    // After the fix, kvFinalRecord must be assigned unconditionally when
    // status terminates, because both KV records and container /status
    // responses include the uploadResult field. The production heartbeat
    // block lives between `let kvFinalRecord` and the finalize-build step.
    const productionBlock = src.match(/let kvFinalRecord[\s\S]+?finalize-build/);
    expect(productionBlock).not.toBeNull();
    expect(productionBlock![0]).not.toMatch(/if\s*\(\s*!isFromContainer\s*\)\s*kvFinalRecord\s*=/);
    expect(productionBlock![0]).toMatch(/kvFinalRecord\s*=\s*parsed/);
  });
});
