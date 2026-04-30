/**
 * Verifies the orchestrator's referenced subagents exist on disk and have the
 * frontmatter required by Claude Code's Task tool. Runs against the source
 * tree, not the built container — but the Dockerfile COPY mirrors this layout
 * so a passing test here means the container will boot with all agents.
 *
 * @see Dockerfile (lines that COPY .claude/agents/ + cp from ~/.agentskills/agents)
 * @see scripts/container-server.mjs syncAgents()
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const PROJECT_AGENTS_DIR = path.resolve(__dirname, '..', '..', '.claude', 'agents');
const UNIVERSAL_AGENTS_DIR = path.join(os.homedir(), '.agentskills', 'agents');

const PROJECT_AGENTS = ['domain-builder', 'validator-fixer'] as const;
const UNIVERSAL_AGENTS_REFERENCED = [
  'visual-qa',
  'seo-auditor',
  'accessibility-auditor',
  'performance-profiler',
  'completeness-checker',
  'content-writer',
  'security-reviewer',
] as const;

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

describe('orchestrator agents', () => {
  describe('project-specific (.claude/agents/)', () => {
    for (const name of PROJECT_AGENTS) {
      it(`${name}.md exists with required frontmatter`, () => {
        const file = path.join(PROJECT_AGENTS_DIR, `${name}.md`);
        expect(fs.existsSync(file)).toBe(true);

        const fm = parseFrontmatter(fs.readFileSync(file, 'utf-8'));
        expect(fm.name).toBe(name);
        expect(fm.description).toBeTruthy();
        expect(fm.tools).toBeTruthy();
        // Project agents must be Edit-capable (otherwise they belong upstream)
        expect(fm.tools).toMatch(/Write|Edit/);
      });
    }
  });

  describe('universal agents referenced by orchestrator (~/.agentskills/agents/)', () => {
    // Skip in CI where ~/.agentskills isn't checked out — only run locally where
    // the dev has the megabytespace/claude-skills repo cloned (the Dockerfile
    // git-clones it inside the container so the runtime check is on the image).
    const universalAvailable = fs.existsSync(UNIVERSAL_AGENTS_DIR);

    for (const name of UNIVERSAL_AGENTS_REFERENCED) {
      const test = universalAvailable ? it : it.skip;
      test(`${name}.md exists in universal agent set`, () => {
        const file = path.join(UNIVERSAL_AGENTS_DIR, `${name}.md`);
        expect(fs.existsSync(file)).toBe(true);
      });
    }
  });
});
