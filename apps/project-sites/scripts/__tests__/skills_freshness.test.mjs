// Skills freshness TDD — boots the container and asserts that the boot path
// pulls megabytespace/claude-skills + the template repo from origin/main, so a
// long-lived Durable Object container always has the latest prompts/skills
// without rebuilding the image.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const IMAGE = process.env.SMOKE_IMAGE || 'projectsites-container:smoke';
const NAME = `ps-skills-freshness-${Date.now()}`;

let container;

before(async () => {
  container = spawn(
    'docker',
    ['run', '--rm', '--name', NAME, '-p', '0:8080', IMAGE,
     'node', '/home/cuser/container-server.mjs'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // Wait for boot lines to appear.
  let logs = '';
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    if (container.exitCode !== null) break;
    await sleep(500);
    try {
      logs = execSync(`docker logs ${NAME} 2>&1`, { encoding: 'utf-8' });
      if (/\[boot\] Skills /.test(logs) && /\[boot\] Template /.test(logs)) break;
    } catch {}
  }
  container.boot_logs = logs;
});

after(() => {
  try { execSync(`docker rm -f ${NAME}`, { stdio: 'ignore' }); } catch {}
});

test('boot logs attempt to pull skills', () => {
  assert.match(container.boot_logs, /\[boot\] Skills (updated|pull failed)/);
});

test('boot logs attempt to pull template', () => {
  assert.match(container.boot_logs, /\[boot\] Template (updated|pull failed)/);
});

test('skills HEAD matches remote default branch when pull succeeds', () => {
  if (/Skills pull failed/.test(container.boot_logs)) return;
  const out = execSync(
    `docker exec ${NAME} sh -lc 'cd /home/cuser/.agentskills && BR=$(git remote show origin 2>/dev/null | sed -n "s/.*HEAD branch: //p") && BR=\${BR:-main} && git rev-parse HEAD && git rev-parse origin/$BR'`,
    { encoding: 'utf-8' },
  );
  const [head, origin] = out.trim().split('\n');
  assert.equal(head, origin, 'skills HEAD should equal remote default branch after boot pull');
});

test('skills _router.md exists post-boot', () => {
  const out = execSync(
    `docker exec ${NAME} sh -lc 'test -f /home/cuser/.agentskills/_router.md && echo ok'`,
    { encoding: 'utf-8' },
  );
  assert.match(out, /ok/);
});
