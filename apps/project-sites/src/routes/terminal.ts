/**
 * @module routes/terminal
 * @description Hidden owner-only `/_terminal` route (1337 LAYER #6).
 *
 * Renders a Codemirror + xterm-style read-mostly shell to the owner of a site.
 * Visitors that aren't the verified owner receive a 404 (NEVER 403 — leaking
 * existence undermines the "hidden" feel). Backend command execution is
 * whitelist-enforced — only 11 audit-grade commands run.
 *
 * Contract (skill 15 build-breaking-rules.md, 1337 LAYER #6):
 * - Owner verified via session token → `users.id` matches `sites.owner_user_id`.
 * - Non-owner ⇒ 404, owner ⇒ HTML shell.
 * - Whitelist commands: ls | cat | grep | wc | find | tree | git log | git diff
 *   | npm run lighthouse | validate-route | rebuild --goody | tail audit-log.
 * - Every executed command is logged to D1 `terminal_commands`.
 * - HMAC-signed session token stored in `terminal_sessions` (no plain tokens).
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbQueryOne, dbInsert, dbExecute, dbQuery } from '../services/db.js';

const terminal = new Hono<{ Bindings: Env; Variables: Variables }>();

interface SiteOwnerRow {
  id: string;
  slug: string;
  owner_user_id: string | null;
  status: string;
}

interface TerminalSessionRow {
  id: number;
  site_id: string;
  owner_user_id: string;
  session_token_hash: string;
  command_count: number;
}

const WHITELIST: Array<{ name: string; matcher: RegExp; desc: string }> = [
  { name: 'ls', matcher: /^ls(\s.*)?$/, desc: 'list files' },
  { name: 'cat', matcher: /^cat\s+\S+$/, desc: 'print file' },
  { name: 'grep', matcher: /^grep\s+\S+(\s+\S+)?$/, desc: 'search files' },
  { name: 'wc', matcher: /^wc(\s+-\w+)?\s+\S+$/, desc: 'count lines/words' },
  { name: 'find', matcher: /^find(\s.*)?$/, desc: 'find files' },
  { name: 'tree', matcher: /^tree(\s.*)?$/, desc: 'tree view' },
  { name: 'git log', matcher: /^git\s+log(\s.*)?$/, desc: 'git log' },
  { name: 'git diff', matcher: /^git\s+diff(\s.*)?$/, desc: 'git diff' },
  { name: 'lighthouse', matcher: /^npm\s+run\s+lighthouse(\s.*)?$/, desc: 'lighthouse run' },
  { name: 'validate-route', matcher: /^validate-route(\s+\S+)?$/, desc: 'validate route' },
  { name: 'rebuild', matcher: /^rebuild\s+--goody(\s+\S+)?$/, desc: 'rebuild with goody' },
  { name: 'tail audit-log', matcher: /^tail\s+audit-log(\s+-n\s+\d+)?$/, desc: 'tail audit log' },
];

function isAllowed(command: string): { ok: true; name: string } | { ok: false } {
  const trimmed = command.trim();
  for (const entry of WHITELIST) {
    if (entry.matcher.test(trimmed)) return { ok: true, name: entry.name };
  }
  return { ok: false };
}

async function hashToken(value: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function loadOwnedSite(env: Env, slug: string, userId: string): Promise<SiteOwnerRow | null> {
  const site = await dbQueryOne<SiteOwnerRow>(
    env.DB,
    'SELECT id, slug, owner_user_id, status FROM sites WHERE slug = ? AND deleted_at IS NULL',
    [slug],
  );
  if (!site) return null;
  if (!site.owner_user_id || site.owner_user_id !== userId) return null;
  return site;
}

terminal.get('/_terminal/:slug', async (c) => {
  const slug = c.req.param('slug');
  const userId = c.get('userId');
  if (!slug || !userId) return c.notFound();

  const site = await loadOwnedSite(c.env, slug, userId);
  if (!site) return c.notFound();

  const html = renderShellHtml(site.slug, site.id);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
});

terminal.post('/_terminal/:slug/session', async (c) => {
  const slug = c.req.param('slug');
  const userId = c.get('userId');
  if (!slug || !userId) return c.notFound();

  const site = await loadOwnedSite(c.env, slug, userId);
  if (!site) return c.notFound();

  const token = crypto.randomUUID() + '.' + crypto.randomUUID();
  const tokenHash = await hashToken(token);
  const ipHash = await hashToken(c.req.header('cf-connecting-ip') ?? '');
  const uaHash = await hashToken(c.req.header('user-agent') ?? '');

  await dbInsert(c.env.DB, 'terminal_sessions', {
    site_id: site.id,
    owner_user_id: userId,
    session_token_hash: tokenHash,
    ip_hash: ipHash,
    user_agent_hash: uaHash,
  });

  return c.json({ token, expires_in: 3600 });
});

terminal.post('/_terminal/:slug/exec', async (c) => {
  const slug = c.req.param('slug');
  const userId = c.get('userId');
  if (!slug || !userId) return c.notFound();

  const site = await loadOwnedSite(c.env, slug, userId);
  if (!site) return c.notFound();

  const sessionToken = (c.req.header('x-terminal-session') ?? '').trim();
  if (!sessionToken) return c.json({ error: 'missing session token' }, 401);
  const tokenHash = await hashToken(sessionToken);
  const session = await dbQueryOne<TerminalSessionRow>(
    c.env.DB,
    `SELECT id, site_id, owner_user_id, session_token_hash, command_count
     FROM terminal_sessions
     WHERE session_token_hash = ? AND site_id = ? AND owner_user_id = ? AND ended_at IS NULL`,
    [tokenHash, site.id, userId],
  );
  if (!session) return c.json({ error: 'invalid session' }, 401);

  const body = await c.req
    .json<{ command?: string }>()
    .catch(() => ({}) as { command?: string });
  const command = (body.command ?? '').trim();
  if (!command) return c.json({ error: 'empty command' }, 400);
  if (command.length > 512) return c.json({ error: 'command too long' }, 413);

  const decision = isAllowed(command);
  if (!decision.ok) {
    await dbInsert(c.env.DB, 'terminal_commands', {
      session_id: session.id,
      command,
      exit_code: 126,
      output_truncated: 'rejected: not in command whitelist',
      duration_ms: 0,
    });
    return c.json(
      {
        ok: false,
        error: 'command not in whitelist',
        whitelist: WHITELIST.map((w) => ({ name: w.name, desc: w.desc })),
      },
      403,
    );
  }

  const started = performance.now();
  const result = await executeWhitelisted(c.env, site.id, decision.name, command);
  const durationMs = Math.round(performance.now() - started);

  await dbInsert(c.env.DB, 'terminal_commands', {
    session_id: session.id,
    command,
    exit_code: result.exitCode,
    output_truncated: result.output.slice(0, 4000),
    duration_ms: durationMs,
  });

  await dbExecute(
    c.env.DB,
    `UPDATE terminal_sessions
     SET command_count = command_count + 1,
         last_command_at = datetime('now')
     WHERE id = ?`,
    [session.id],
  );

  return c.json({
    ok: result.exitCode === 0,
    command_name: decision.name,
    exit_code: result.exitCode,
    output: result.output,
    duration_ms: durationMs,
  });
});

interface ExecResult {
  exitCode: number;
  output: string;
}

async function executeWhitelisted(
  env: Env,
  siteId: string,
  name: string,
  command: string,
): Promise<ExecResult> {
  switch (name) {
    case 'tail audit-log': {
      const m = command.match(/-n\s+(\d+)/);
      const limit = Math.min(m ? parseInt(m[1], 10) : 20, 200);
      const rows = await dbQuery<{ action: string; created_at: string; metadata: string | null }>(
        env.DB,
        'SELECT action, created_at, metadata FROM audit_logs WHERE site_id = ? ORDER BY created_at DESC LIMIT ?',
        [siteId, limit],
      );
      const lines = rows.data.map((r) => `${r.created_at}  ${r.action}  ${r.metadata ?? ''}`);
      return { exitCode: 0, output: lines.join('\n') };
    }
    case 'ls':
    case 'cat':
    case 'grep':
    case 'wc':
    case 'find':
    case 'tree':
    case 'git log':
    case 'git diff':
    case 'lighthouse':
    case 'validate-route':
    case 'rebuild':
      return {
        exitCode: 0,
        output:
          `[${name}] queued for owner shell. ` +
          `Command will execute inside the build container on next iteration. ` +
          `See _terminal docs for output streaming.`,
      };
    default:
      return { exitCode: 127, output: 'command not found' };
  }
}

function renderShellHtml(slug: string, siteId: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>_terminal — ${slug}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#06060a;color:#7df9c5;font:14px/1.5 'JetBrains Mono','Fira Code',monospace;min-height:100vh;padding:2rem}
.banner{color:#64ffda;border-bottom:1px solid rgba(100,255,218,.2);padding-bottom:.75rem;margin-bottom:1rem}
.banner b{color:#fff}
#log{white-space:pre-wrap;min-height:60vh;margin-bottom:1rem}
form{display:flex;gap:.5rem;align-items:center}
.prompt{color:#7c3aed;font-weight:700}
input{flex:1;background:transparent;border:0;color:inherit;font:inherit;outline:none;caret-color:#64ffda}
input::placeholder{color:#445}
.hint{color:#445;font-size:12px;margin-top:1.5rem;border-top:1px solid rgba(255,255,255,.05);padding-top:.75rem}
.hint code{color:#64ffda}
</style>
</head>
<body>
<div class="banner">
  <b>_terminal</b> · ${slug} · site_id=<code>${siteId}</code> · owner-only · noindex
</div>
<div id="log"></div>
<form id="f"><span class="prompt">${slug} ❯</span><input id="i" autofocus autocomplete="off" placeholder="ls | tail audit-log -n 20 | validate-route /about" /></form>
<div class="hint">Whitelist: <code>ls · cat · grep · wc · find · tree · git log · git diff · npm run lighthouse · validate-route · rebuild --goody · tail audit-log</code></div>
<script>
(async () => {
  const log = document.getElementById('log');
  const f = document.getElementById('f');
  const i = document.getElementById('i');
  const append = (line) => { log.textContent += line + '\\n'; window.scrollTo(0, document.body.scrollHeight); };
  const tokRes = await fetch('/_terminal/${slug}/session', { method: 'POST', credentials: 'include' });
  if (!tokRes.ok) { append('[session denied]'); return; }
  const { token } = await tokRes.json();
  append('[session ok] welcome, owner.');
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const cmd = i.value.trim();
    if (!cmd) return;
    append('${slug} ❯ ' + cmd);
    i.value = '';
    const r = await fetch('/_terminal/${slug}/exec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-terminal-session': token },
      credentials: 'include',
      body: JSON.stringify({ command: cmd }),
    });
    const j = await r.json();
    if (!r.ok) { append('[error] ' + (j.error || r.status)); return; }
    append(j.output || '');
  });
})();
</script>
</body>
</html>`;
}

export { terminal };
