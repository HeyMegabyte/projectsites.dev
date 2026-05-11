/**
 * Guard tests for the workflow ↔ container contextFiles naming contract.
 *
 * Two artifacts in the build pipeline must stay distinct:
 *   - `_assets.json`           — scraped source-site media (extract-source-brand step)
 *   - `_uploaded_assets.json`  — user uploads from /create (move-uploaded-assets step)
 *
 * Until 2026-05-09 the workflow shipped the upload manifest as `assets.json`, which
 * the container then prefixed to `_assets.json` — overwriting the brand extractor
 * output and starving the orchestrator of source images. These tests lock the fix.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..');
const workflowSrc = readFileSync(join(repoRoot, 'src/workflows/site-generation.ts'), 'utf8');
const containerSrc = readFileSync(join(repoRoot, 'scripts/container-server.mjs'), 'utf8');

describe('contextFiles naming contract', () => {
  it('workflow ships user uploads as _uploaded_assets.json (not assets.json)', () => {
    expect(workflowSrc).toContain("contextFiles['_uploaded_assets.json']");
    expect(workflowSrc).not.toContain("contextFiles['assets.json']");
  });

  it('workflow ships brand-extractor artifacts under their canonical underscore names', () => {
    expect(workflowSrc).toContain("contextFiles['_brand.json']");
    expect(workflowSrc).toContain("contextFiles['_assets.json']");
    expect(workflowSrc).toContain("contextFiles['_scraped_content.json']");
  });

  it('orchestrator prompt advertises _uploaded_assets.json so subagents pick it up', () => {
    expect(workflowSrc).toMatch(/_uploaded_assets\.json[^]*user uploads/);
  });

  it('container-server preserves underscore-prefixed keys verbatim (no double-prefix)', () => {
    // The fix: ` const fileName = k.startsWith('_') ? k : `_${k}`; `
    expect(containerSrc).toMatch(/k\.startsWith\(['"]_['"]\)\s*\?\s*k\s*:\s*`_\$\{k\}`/);
  });

  it('replicates the container naming logic on a representative payload', () => {
    const payload = {
      _brand: '{"x":1}',
      '_brand.json': '{"x":1}',
      '_assets.json': '{"x":1}',
      '_scraped_content.json': '{"x":1}',
      '_uploaded_assets.json': '{"x":1}',
      'assets.json': '{"x":1}', // legacy non-underscore key
    };
    const writes: string[] = [];
    for (const k in payload) {
      const fileName = k.startsWith('_') ? k : `_${k}`;
      writes.push(fileName);
    }
    // Underscore keys land verbatim, legacy key still gets prefixed (no clash with
    // _assets.json because workflow no longer emits it).
    expect(writes).toEqual([
      '_brand',
      '_brand.json',
      '_assets.json',
      '_scraped_content.json',
      '_uploaded_assets.json',
      '_assets.json', // from legacy 'assets.json' — would have collided pre-fix
    ]);
    // After the workflow rename, the actual production payload no longer carries
    // the legacy key, so duplicate names cannot occur:
    const productionPayload = Object.fromEntries(
      Object.entries(payload).filter(([k]) => k !== 'assets.json'),
    );
    const prodWrites: string[] = [];
    for (const k in productionPayload) {
      const fileName = k.startsWith('_') ? k : `_${k}`;
      prodWrites.push(fileName);
    }
    expect(new Set(prodWrites).size).toBe(prodWrites.length);
  });
});
