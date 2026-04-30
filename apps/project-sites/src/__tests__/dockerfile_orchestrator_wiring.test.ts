/**
 * Dockerfile static analysis — confirms the orchestrator wiring stays intact.
 *
 * @remarks
 * Catches drift like "someone removed the COPY .claude/agents/ line and now the
 * container boots without domain-builder/validator-fixer." Cheaper than spinning
 * up a real Docker build in CI but still asserts the load-bearing commands.
 */

import * as fs from 'fs';
import * as path from 'path';

const DOCKERFILE = path.resolve(__dirname, '..', '..', 'Dockerfile');
const dockerfile = fs.readFileSync(DOCKERFILE, 'utf-8');

describe('Dockerfile orchestrator wiring', () => {
  it('clones megabytespace/claude-skills into /home/cuser/.agentskills', () => {
    expect(dockerfile).toMatch(/git clone[^\n]*megabytespace\/claude-skills[^\n]*\/home\/cuser\/\.agentskills/);
  });

  it('installs tsx for run-validators.mjs', () => {
    expect(dockerfile).toMatch(/\btsx\b/);
  });

  it('copies build_validators.ts so run-validators.mjs can import it', () => {
    expect(dockerfile).toMatch(/COPY\s+src\/services\/build_validators\.ts\s+\/home\/cuser\/build_validators\.ts/);
  });

  it('copies run-validators.mjs into the container', () => {
    expect(dockerfile).toMatch(/COPY\s+scripts\/run-validators\.mjs\s+\/home\/cuser\/run-validators\.mjs/);
  });

  it('syncs universal agents from ~/.agentskills/agents/ to ~/.claude/agents/', () => {
    expect(dockerfile).toMatch(/cp\s+\/home\/cuser\/\.agentskills\/agents\/\*\.md\s+\/home\/cuser\/\.claude\/agents\//);
  });

  it('overlays project-specific agents on top of the universal sync', () => {
    expect(dockerfile).toMatch(/COPY\s+\.claude\/agents\/\s+\/home\/cuser\/\.claude\/agents\//);
  });

  it('container CLAUDE.md @-imports the upstream meta files', () => {
    expect(dockerfile).toMatch(/@~\/\.agentskills\/CLAUDE\.md/);
    expect(dockerfile).toMatch(/@~\/\.agentskills\/AGENTS\.md/);
    expect(dockerfile).toMatch(/@~\/\.agentskills\/_router\.md/);
  });

  it('symlinks AGENTS.md + _router.md into /home/cuser for non-Claude tools', () => {
    expect(dockerfile).toMatch(/ln -sf\s+\/home\/cuser\/\.agentskills\/AGENTS\.md\s+\/home\/cuser\/AGENTS\.md/);
    expect(dockerfile).toMatch(/ln -sf\s+\/home\/cuser\/\.agentskills\/_router\.md\s+\/home\/cuser\/_router\.md/);
  });

  it('configures git safe.directory so root can pull cuser-owned repos', () => {
    expect(dockerfile).toMatch(/git config[^\n]*safe\.directory[^\n]*\.agentskills/);
    expect(dockerfile).toMatch(/git config[^\n]*safe\.directory[^\n]*template/);
  });
});

describe('container-server.mjs syncs agents on every refresh', () => {
  const SERVER = path.resolve(__dirname, '..', '..', 'scripts', 'container-server.mjs');
  const src = fs.readFileSync(SERVER, 'utf-8');

  it('exports a syncAgents helper', () => {
    expect(src).toMatch(/function syncAgents\(/);
  });

  it('calls syncAgents at boot', () => {
    expect(src).toMatch(/syncAgents\('boot'\)/);
  });

  it('calls syncAgents inside maybeRefreshSkills (10-min cadence)', () => {
    const fn = src.match(/function maybeRefreshSkills\(\)\s*\{[\s\S]*?\n\}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/syncAgents\('refresh'\)/);
  });

  it('preserves project-specific agents from being clobbered', () => {
    expect(src).toMatch(/PROJECT_AGENTS[^\n]*domain-builder\.md/);
    expect(src).toMatch(/PROJECT_AGENTS[^\n]*validator-fixer\.md/);
  });
});
