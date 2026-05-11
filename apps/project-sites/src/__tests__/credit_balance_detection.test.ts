/**
 * Guard tests for the audit-trail hardening + pre-build Anthropic credit gate.
 *
 * Two failure modes this suite locks down:
 *   1. Container `claude -p` exits silently when the Anthropic API rejects with
 *      "credit balance is too low". Pre-fix: we proceeded to npm install/build,
 *      uploaded a template-only dist, and marked the site `published`. The
 *      regression cost three misleading LMG builds in 2026-05-09.
 *   2. The workflow had no preflight check, so the only signal that credits
 *      had run out was a successful build of a wrong-looking site.
 *
 * Both fixes (container kill-switch + workflow probe) must survive future edits.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..');
const workflowSrc = readFileSync(join(repoRoot, 'src/workflows/site-generation.ts'), 'utf8');
const containerSrc = readFileSync(join(repoRoot, 'scripts/container-server.mjs'), 'utf8');

describe('container audit-trail hardening', () => {
  it('detects the Anthropic credit-low signature in stdout/stderr', () => {
    expect(containerSrc).toContain('CREDIT_LOW_RE');
    expect(containerSrc).toMatch(/credit balance is too low/);
  });

  it('persists stdoutTail/stderrTail/claudeExitCode/claudeRanSeconds/errorClass on the job record', () => {
    expect(containerSrc).toContain('stdoutTail');
    expect(containerSrc).toContain('stderrTail');
    expect(containerSrc).toContain('claudeExitCode');
    expect(containerSrc).toContain('claudeRanSeconds');
    expect(containerSrc).toContain('errorClass');
  });

  it('kills the claude child immediately when credit-low is detected', () => {
    // Look for the SIGTERM kill in the captureChunk handler.
    expect(containerSrc).toMatch(/child\.kill\(['"]SIGTERM['"]\)/);
    expect(containerSrc).toMatch(/anthropic_credit_balance_too_low/);
  });

  it('short-circuits npm install/build when errorClass is set (skips wasteful work)', () => {
    expect(containerSrc).toMatch(/if \(jobs\[jobId\]\.errorClass\)/);
  });

  it('detects the silent-exit pattern (claude exits <60s with no .build-phase markers)', () => {
    expect(containerSrc).toContain('claude_silent_exit');
    expect(containerSrc).toMatch(/ranSeconds\s*<\s*60/);
  });

  it('surfaces the audit-trail extras in the pushStatus heartbeat payload', () => {
    expect(containerSrc).toMatch(/stdoutTail:\s*j\.stdoutTail/);
    expect(containerSrc).toMatch(/stderrTail:\s*j\.stderrTail/);
    expect(containerSrc).toMatch(/claudeExitCode:\s*j\.claudeExitCode/);
    expect(containerSrc).toMatch(/errorClass:\s*j\.errorClass/);
  });
});

describe('workflow pre-build Anthropic credit gate', () => {
  it('runs an anthropic-credit-probe step before kicking off the container build', () => {
    expect(workflowSrc).toContain("'anthropic-credit-probe'");
    expect(workflowSrc).toContain('https://api.anthropic.com/v1/messages');
    expect(workflowSrc).toContain('claude-haiku-4-5');
  });

  it('keeps the probe cheap (max_tokens: 1)', () => {
    expect(workflowSrc).toMatch(/max_tokens:\s*1\b/);
  });

  it('treats HTTP 400 + "credit balance is too low" as a hard preflight failure', () => {
    expect(workflowSrc).toMatch(/credit balance is too low/i);
    expect(workflowSrc).toContain('anthropic_credit_balance_too_low');
    expect(workflowSrc).toContain('workflow.preflight_error');
  });

  it('skips the probe in stubMode (no real claude call happens there)', () => {
    expect(workflowSrc).toMatch(/!params\.stubMode/);
  });

  it('treats network errors on the probe as non-blocking (do not gate on transient DNS)', () => {
    expect(workflowSrc).toMatch(/probe network error/);
  });
});

describe('workflow audit-trail propagation through KvBuildRecord', () => {
  it('extends ContainerStatus with the ContainerAuditTrail fields', () => {
    expect(workflowSrc).toContain('interface ContainerAuditTrail');
    expect(workflowSrc).toContain('interface ContainerStatus extends ContainerAuditTrail');
    expect(workflowSrc).toContain('interface KvBuildRecord extends ContainerAuditTrail');
  });

  it('logs claude exit code + tails + errorClass on terminal build error', () => {
    expect(workflowSrc).toMatch(/claude_exit_code/);
    expect(workflowSrc).toMatch(/stdout_tail/);
    expect(workflowSrc).toMatch(/stderr_tail/);
    expect(workflowSrc).toMatch(/error_class/);
  });

  it('uses workflow.preflight_error (not workflow.build_error) when errorClass is credit-low', () => {
    expect(workflowSrc).toMatch(
      /errorClass === ['"]anthropic_credit_balance_too_low['"]\s*\?\s*['"]workflow\.preflight_error['"]/,
    );
  });
});
