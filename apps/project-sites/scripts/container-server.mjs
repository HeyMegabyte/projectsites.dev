#!/usr/bin/env node
/**
 * container-server.mjs — HTTP server inside SiteBuilderContainer
 *
 * Runs as root (needed for `su cuser`). Exposes:
 *   POST /build   → start async Claude Code job, return { jobId }
 *   GET  /status  → heartbeat polling for a job
 *   GET  /result  → fetch files + status when complete
 *   GET  /health  → liveness probe
 *
 * Job state is persisted to /var/jobs/{jobId}.json so the workflow's
 * heartbeat polling survives container hibernation/restart. Jobs that
 * were running when the container restarted are marked errored on boot
 * (the spawned Claude Code child died with the container).
 */
import { execSync as x, spawn as sp } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';
import crypto from 'crypto';

const JOBS_DIR = '/var/jobs';
const SKILLS_DIR = '/home/cuser/.agentskills';
const TEMPLATE_DIR = '/home/cuser/template';

// Anthropic quota-exhausted signatures land on stdout/stderr when claude -p
// either (a) hits the API-key path and gets HTTP 400 "Your credit balance is
// too low...", or (b) hits the subscription-auth path and exceeds the Max 20x
// monthly usage cap, which writes "You've hit your org's monthly usage limit"
// to stdout before exiting code=1. Both signatures route to the same short-
// circuit so we kill the child + skip wasteful npm install/build/R2 upload.
// Reference incident (2026-05-11): LMG build job-1778511630344-q33i3h exited
// code=1 in 3s with stdout="You've hit your org's monthly usage limit" — the
// prior CREDIT_LOW_RE only matched credit-balance phrasing, so errorClass
// stayed null and the container proceeded to ship a template-stub site.
const CREDIT_LOW_RE = /credit balance is too low|invalid_request_error[^}]*credit|hit your org's monthly usage limit|monthly usage limit|usage limit (?:reached|exceeded|hit)/i;
const STREAM_TAIL_BYTES = 2048;

try { fs.mkdirSync(JOBS_DIR, { recursive: true }); } catch {}

let CP = '/usr/local/bin/claude';
try { CP = x('which claude', { encoding: 'utf-8' }).trim(); } catch {}
console.warn('[boot] Claude at:', CP);

function refreshRepo(prefix, label, dir) {
  try {
    // claude-skills uses master, template uses main — detect the remote HEAD
    // ref instead of hardcoding either one.
    x(
      `cd ${dir} && BR=$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p') && BR=\${BR:-main} && ` +
      `git fetch --depth=1 origin "$BR" 2>&1 && git reset --hard "origin/$BR" 2>&1`,
      { timeout: 30000, shell: true, encoding: 'utf-8' },
    );
    console.warn(`[${prefix}] ${label} updated`);
    return true;
  } catch (e) {
    console.warn(`[${prefix}] ${label} pull failed:`, e.message.slice(0, 100));
    return false;
  }
}

// Sync universal agents from heymegabyte/claude-skills into ~/.claude/agents/
// without clobbering project-specific agents (which were COPY'd in the
// Dockerfile after the cp). Runs after every claude-skills git-pull so
// upstream agent edits land in the orchestrator within 10 minutes.
const AGENTS_DST = '/home/cuser/.claude/agents';
const AGENTS_SRC = `${SKILLS_DIR}/agents`;
const PROJECT_AGENTS = new Set(['domain-builder.md', 'validator-fixer.md']);

function syncAgents(prefix) {
  try {
    fs.mkdirSync(AGENTS_DST, { recursive: true });
    if (!fs.existsSync(AGENTS_SRC)) return;
    let copied = 0;
    for (const f of fs.readdirSync(AGENTS_SRC)) {
      if (!f.endsWith('.md')) continue;
      if (PROJECT_AGENTS.has(f)) continue; // never overwrite project overrides
      try {
        fs.copyFileSync(path.join(AGENTS_SRC, f), path.join(AGENTS_DST, f));
        copied++;
      } catch {}
    }
    console.warn(`[${prefix}] Synced ${copied} universal agents`);
  } catch (e) {
    console.warn(`[${prefix}] agent sync failed:`, e.message.slice(0, 100));
  }
}

refreshRepo('boot', 'Skills', SKILLS_DIR);
refreshRepo('boot', 'Template', TEMPLATE_DIR);
syncAgents('boot');

// Long-lived Durable Object containers don't reboot for days — refresh every 10min
// (background heartbeat) so heymegabyte/claude-skills updates land even if no
// build comes in. Per-build refresh below is the canonical hook.
let lastRefresh = Date.now();
function maybeRefreshSkills() {
  if (Date.now() - lastRefresh < 10 * 60 * 1000) return;
  lastRefresh = Date.now();
  refreshRepo('refresh', 'Skills', SKILLS_DIR);
  refreshRepo('refresh', 'Template', TEMPLATE_DIR);
  syncAgents('refresh');
}

// MUST run before EVERY claude-code invocation (per Brian's directive). Forces a
// `git pull` on heymegabyte/claude-skills + the template repo so the build draws
// from the latest published instructions, agents, and component templates with
// no 10-minute throttle window. Cheap (~200ms shallow fetch); skipping it
// shipped a stale build window of up to 10 minutes after every skills release.
function refreshSkillsForBuild(jobId) {
  const t0 = Date.now();
  const okSkills = refreshRepo(`${jobId}:prebuild`, 'Skills', SKILLS_DIR);
  const okTemplate = refreshRepo(`${jobId}:prebuild`, 'Template', TEMPLATE_DIR);
  if (okSkills) syncAgents(`${jobId}:prebuild`);
  lastRefresh = Date.now();
  console.warn(`[${jobId}] pre-build refresh: skills=${okSkills} template=${okTemplate} (${Date.now() - t0}ms)`);
  return { skills: okSkills, template: okTemplate, ms: Date.now() - t0 };
}

const jobs = {};

function jobPath(jobId) { return path.join(JOBS_DIR, `${jobId}.json`); }

function saveJob(jobId) {
  if (!jobs[jobId]) return;
  try { fs.writeFileSync(jobPath(jobId), JSON.stringify(jobs[jobId])); } catch {}
}

function deleteJob(jobId) {
  delete jobs[jobId];
  try { fs.unlinkSync(jobPath(jobId)); } catch {}
}

function loadJobs() {
  try {
    for (const f of fs.readdirSync(JOBS_DIR)) {
      if (!f.endsWith('.json')) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, f), 'utf-8'));
        if (j && j.jobId) jobs[j.jobId] = j;
      } catch {}
    }
    console.warn(`[boot] Loaded ${Object.keys(jobs).length} jobs from disk`);
  } catch {}
}

loadJobs();

for (const id of Object.keys(jobs)) {
  if (jobs[id].status === 'running') {
    jobs[id].status = 'error';
    jobs[id].error = 'container restarted mid-build — process lost';
    jobs[id].step = 'done';
    saveJob(id);
    console.warn(`[boot] Marked orphaned job ${id} as error`);
  }
}

// Self-keepalive: while any job is running, hit /health every 60s. This keeps the Node
// event loop active and signals "activity" to CF Container infrastructure to prevent
// idle DO hibernation. Without this, the workflow's KV-based heartbeat froze at the
// 2-min mark when the DO went idle after the initial /build POST returned.
setInterval(() => {
  const hasRunning = Object.values(jobs).some(j => j && j.status === 'running');
  if (!hasRunning) return;
  fetch('http://localhost:8080/health').catch(() => {});
}, 60_000);

function liveFileCount(dir) {
  if (!dir) return 0;
  let n = 0;
  const walk = (d) => {
    try {
      for (const f of fs.readdirSync(d)) {
        if (f.startsWith('_') || f === 'node_modules' || f === '.git' || f === '.claude') continue;
        const fp = path.join(d, f);
        const st = fs.statSync(fp);
        if (st.isDirectory()) walk(fp);
        else if (st.isFile() && st.size > 0) n++;
      }
    } catch {}
  };
  walk(dir);
  return n;
}

function readPhase(dir) {
  if (!dir) return '';
  try {
    const raw = fs.readFileSync(path.join(dir, '.build-phase'), 'utf-8').trim();
    return raw.replace(/[^a-z0-9._-]/gi, '').slice(0, 40);
  } catch { return ''; }
}

function pushStatus(jobId) {
  const j = jobs[jobId];
  if (!j || !j.callbackUrl || !j.callbackSecret) return;
  const liveCount = j.status === 'running' && j.dir ? liveFileCount(j.dir) : 0;
  const finalCount = j.files ? j.files.length : 0;
  const phase = j.status === 'running' ? readPhase(j.dir) : '';
  const stepName = phase ? `${j.step}:${phase}` : j.step;
  const payload = {
    jobId,
    status: j.status,
    step: stepName,
    elapsed: ((Date.now() - j.startTime) / 1000) | 0,
    fileCount: finalCount || liveCount,
    error: j.error ? String(j.error).slice(0, 500) : null,
    uploadResult: j.uploadResult || null,
    stdoutTail: j.stdoutTail || null,
    stderrTail: j.stderrTail || null,
    claudeExitCode: j.claudeExitCode ?? null,
    claudeRanSeconds: j.claudeRanSeconds ?? null,
    errorClass: j.errorClass || null,
  };
  const body = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', j.callbackSecret).update(body).digest('hex');
  fetch(j.callbackUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Build-Sig': sig },
    body,
  }).then(res => {
    if (!res.ok) console.warn(`[${jobId}] callback HTTP ${res.status}`);
  }).catch(e => console.warn(`[${jobId}] callback err: ${e.message}`));
}

function setStatus(jobId, patch) {
  if (!jobs[jobId]) return;
  Object.assign(jobs[jobId], patch);
  saveJob(jobId);
  pushStatus(jobId);
}

// Boot-time push: surface any orphan errors marked above to KV via callback NOW so
// the workflow's next heartbeat sees status=error instead of waiting 8 minutes for
// stale threshold to expire.
for (const id of Object.keys(jobs)) {
  if (jobs[id].status === 'error') {
    try { pushStatus(id); } catch {}
  }
}

function collectFiles(dir, base = '') {
  const files = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith('_') || f === 'node_modules' || f === '.git' || f === '.claude') continue;
      const fp = path.join(dir, f);
      const rel = base ? `${base}/${f}` : f;
      const st = fs.statSync(fp);
      if (st.isDirectory()) files.push(...collectFiles(fp, rel));
      else if (st.isFile() && st.size > 0 && st.size < 500000) {
        try { files.push({ name: rel, content: fs.readFileSync(fp, 'utf-8') }); } catch {}
      }
    }
  } catch {}
  return files;
}

function runJob(jobId, dir, prompt, envVars, timeoutMin, callbackUrl, callbackSecret, skipBuild, claudeOauth) {
  jobs[jobId] = {
    jobId,
    status: 'running',
    dir,
    startTime: Date.now(),
    step: 'claude-code',
    error: null,
    files: null,
    uploadResult: null,
    callbackUrl: callbackUrl || null,
    callbackSecret: callbackSecret || null,
    skipBuild: Boolean(skipBuild),
    authMode: claudeOauth ? 'subscription' : 'api_key',
  };
  saveJob(jobId);
  pushStatus(jobId);

  const pf = path.join(dir, '_prompt.txt');
  fs.writeFileSync(pf, prompt);

  // Subscription auth: write the keychain-shaped blob to cuser's
  // ~/.claude/.credentials.json so `claude -p` finds it on startup. CLI
  // refreshes its own token mid-run if the access token expires (writes
  // back into the same file — fine, container is ephemeral). Per
  // ~/.claude/rules/auth-spawned-claude.md, ANTHROPIC_API_KEY MUST be
  // absent from the spawned shell so the CLI prefers the credentials file.
  if (claudeOauth && claudeOauth.accessToken && claudeOauth.refreshToken && claudeOauth.expiresAt) {
    try {
      const credsDir = '/home/cuser/.claude';
      fs.mkdirSync(credsDir, { recursive: true });
      const credsPath = path.join(credsDir, '.credentials.json');
      fs.writeFileSync(credsPath, JSON.stringify({
        claudeAiOauth: {
          accessToken: claudeOauth.accessToken,
          refreshToken: claudeOauth.refreshToken,
          expiresAt: Number(claudeOauth.expiresAt),
          scopes: ['user:inference', 'user:profile'],
          subscriptionType: 'max',
        },
      }), { mode: 0o600 });
      try { x(`chown -R cuser:cuser ${credsDir}`, { stdio: 'pipe', shell: true }); } catch {}
      try { x(`chmod 600 ${credsPath}`, { stdio: 'pipe', shell: true }); } catch {}
      console.warn(`[${jobId}] Subscription auth: wrote ${credsPath} (mode 600)`);
      // Drop API-key env vars from the job's env before the shell script
      // emits exports — leaks would defeat the subscription path.
      delete envVars.ANTHROPIC_API_KEY;
      delete envVars.ANTHROPIC_AUTH_TOKEN;
    } catch (e) {
      console.warn(`[${jobId}] Failed to write credentials.json: ${e.message} — falling back to API key`);
    }
  }

  const envLines = ['#!/bin/sh'];
  // Always unset Anthropic API-key vars + parent CLAUDE_CODE_* vars per
  // ~/.claude/rules/auth-spawned-claude.md so subscription auth resolves
  // cleanly. Harmless when API-key path is active (envVars exports below
  // re-set ANTHROPIC_API_KEY when present).
  envLines.push('unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN');
  envLines.push('unset CLAUDE_CODE_ENTRYPOINT CLAUDECODE CLAUDE_CODE_EXECPATH');
  // Cost-discipline: default orchestrator + inherit-model subagents (domain-builder,
  // validator-fixer) to Sonnet 4.6. Opus 4.7 stays opt-in via explicit subagent
  // frontmatter (source-fidelity-fixer.md sets `model: opus`). Per
  // ~/.claude/rules/model-routing.md — implementation/audit work is Sonnet's lane;
  // architecture/security/visual-QA stay on Opus by agent-level override.
  // Target: $2-4 per build vs $15-22 baseline (Opus ~5x more expensive than Sonnet).
  // envVars below can override by setting ANTHROPIC_MODEL explicitly.
  envLines.push('export ANTHROPIC_MODEL=claude-sonnet-4-6');
  envLines.push('export ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-4-5-20251001');
  for (const k in envVars) if (envVars[k]) envLines.push(`export ${k}=${JSON.stringify(envVars[k])}`);
  envLines.push('export HOME=/home/cuser');
  envLines.push(`export SKILLS_DIR=${SKILLS_DIR}`);
  envLines.push(`export TEMPLATE_DIR=${TEMPLATE_DIR}`);
  envLines.push(`cd ${dir}`);
  envLines.push(`${CP} --dangerously-skip-permissions -p < ${pf}`);
  const sf = `/tmp/run_${jobId}.sh`;
  fs.writeFileSync(sf, envLines.join('\n'));
  try { x(`chmod +x ${sf}`, { stdio: 'pipe' }); } catch {}

  const to = (timeoutMin || 45) * 60000;
  console.warn(`[${jobId}] Starting Claude Code (${Math.round(prompt.length / 1024)}KB prompt, ${timeoutMin}min timeout)`);

  // Heartbeat every 30s for the ENTIRE job (claude -p + npm install + npm build + R2 upload).
  // Workflow staleness threshold is 8min — npm install alone can be 5min, so heartbeat must
  // outlive child process. Cleared only when status terminal (complete/error).
  const hb = setInterval(() => {
    const j = jobs[jobId];
    if (!j) { clearInterval(hb); return; }
    if (j.status === 'complete' || j.status === 'error') { clearInterval(hb); return; }
    pushStatus(jobId);
  }, 30_000);

  // shell:false is critical — with shell:true Node wraps the args in `/bin/sh -c "su cuser -s /bin/sh -c sh /tmp/...sh"`,
  // and the outer shell tokenizes that so su's -c receives only "sh" (no script path), leaving an idle inner shell
  // that never invokes claude. Pass argv directly so su gets `-c "sh ${sf}"` as one argument.
  const child = sp('su', ['cuser', '-s', '/bin/sh', '-c', `sh ${sf}`], {
    timeout: to, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 100 * 1024 * 1024,
  });
  let stdout = '', stderr = '';
  // Mirror last 2KB of each stream onto the job record so pushStatus surfaces them
  // every heartbeat — turns post-mortem-only data into live diagnostics.
  // Also scan each chunk for the Anthropic credit-low signature so we kill the
  // child IMMEDIATELY rather than waiting for it to silently produce a
  // template-only dist that masquerades as workflow.complete.
  const captureChunk = (chunk, isStderr) => {
    const s = chunk.toString();
    if (isStderr) stderr += s; else stdout += s;
    const tailKey = isStderr ? 'stderrTail' : 'stdoutTail';
    jobs[jobId][tailKey] = ((jobs[jobId][tailKey] || '') + s).slice(-STREAM_TAIL_BYTES);
    if (!jobs[jobId].errorClass && CREDIT_LOW_RE.test(s)) {
      jobs[jobId].errorClass = 'anthropic_credit_balance_too_low';
      console.warn(`[${jobId}] credit-low signature detected — killing claude child`);
      try { child.kill('SIGTERM'); } catch {}
    }
  };
  child.stdout.on('data', d => captureChunk(d, false));
  child.stderr.on('data', d => captureChunk(d, true));

  // Run a shell command async via spawn so the Node event loop stays free for setInterval heartbeats.
  // Returns { code, stdout } or throws on timeout/spawn error.
  // Build-job env vars (CF creds, R2 bucket, etc.) are merged in so npm + the R2 upload script see them.
  const runEnv = { ...process.env, ...envVars, HOME: '/home/cuser' };
  function runAsync(cmd, timeoutMs, maxOutBytes) {
    return new Promise((resolve, reject) => {
      const c = sp('sh', ['-c', cmd], { timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: maxOutBytes || 50 * 1024 * 1024, env: runEnv });
      let out = '', err = '';
      c.stdout.on('data', d => { out += d.toString(); });
      c.stderr.on('data', d => { err += d.toString(); });
      c.on('close', code => resolve({ code, stdout: out, stderr: err }));
      c.on('error', e => reject(e));
    });
  }

  child.on('close', async code => {
    const ranSeconds = ((Date.now() - jobs[jobId].startTime) / 1000) | 0;
    console.warn(`[${jobId}] Claude Code exited code=${code} stdout=${stdout.length}b stderr=${stderr.length}b elapsed=${ranSeconds}s`);

    // Persist exit metadata for the next pushStatus heartbeat + audit trail.
    jobs[jobId].claudeExitCode = code;
    jobs[jobId].claudeRanSeconds = ranSeconds;

    // Post-hoc scan in case the credit-low message landed at end of stream
    // and the live captureChunk didn't fire (chunk boundary, etc.).
    if (!jobs[jobId].errorClass && (CREDIT_LOW_RE.test(stderr) || CREDIT_LOW_RE.test(stdout))) {
      jobs[jobId].errorClass = 'anthropic_credit_balance_too_low';
    }

    // Detect "claude exited fast with no .build-phase progress" — the silent
    // failure mode where credits were exhausted but stderr was empty/redirected.
    // ranSeconds<60 + no phase markers = the orchestrator never started real work.
    const phaseRecorded = readPhase(dir);
    if (!jobs[jobId].errorClass && code === 0 && ranSeconds < 60 && !phaseRecorded) {
      jobs[jobId].errorClass = 'claude_silent_exit';
    }

    // Short-circuit: skip npm install/build/R2 upload entirely when claude
    // never produced real output. Prevents 5+ minutes of wasted container time
    // and a misleading "published" status on a template-only dist.
    if (jobs[jobId].errorClass) {
      setStatus(jobId, {
        status: 'error',
        error: jobs[jobId].errorClass,
        step: 'done',
        files: [],
      });
      return;
    }

    setStatus(jobId, { step: 'npm-build' });

    let buildOk = false;
    if (jobs[jobId] && jobs[jobId].skipBuild) {
      // Smoke-test path: skip npm install/build, treat any non-underscore files as the upload set.
      buildOk = liveFileCount(dir) > 0;
      console.warn(`[${jobId}] skipBuild=true, file count=${liveFileCount(dir)}, buildOk=${buildOk}`);
    } else if (fs.existsSync(path.join(dir, 'package.json'))) {
      try {
        const inst = await runAsync(`cd ${dir} && npm install --legacy-peer-deps 2>&1`, 300000, 50 * 1024 * 1024);
        if (inst.code !== 0) {
          console.warn(`[${jobId}] npm install exit=${inst.code} tail=`, inst.stdout.slice(-500));
          throw new Error(`npm install failed code=${inst.code}`);
        }
        const bld = await runAsync(`cd ${dir} && npm run build 2>&1`, 300000, 50 * 1024 * 1024);
        if (bld.code !== 0) {
          console.warn(`[${jobId}] npm build exit=${bld.code} tail=`, bld.stdout.slice(-500));
          throw new Error(`npm build failed code=${bld.code}`);
        }
        const distDir = path.join(dir, 'dist');
        if (fs.existsSync(distDir)) {
          const distFiles = collectFiles(distDir);
          if (distFiles.length > 0) {
            // Template-stub guard: literal {BUSINESS_*} / {BRAND_*} placeholders
            // surviving into dist HTML mean Claude never customized the template.
            // Fail-close BEFORE R2 upload so the workflow flips to error, not published.
            const stubMarkers = /\{(BUSINESS_NAME|BUSINESS_SHORT_NAME|BUSINESS_DESCRIPTION|BUSINESS_ADDRESS|BUSINESS_PHONE|BUSINESS_EMAIL|BUSINESS_TAGLINE|BUSINESS_HOURS|BRAND_PRIMARY|BRAND_SECONDARY|BRAND_ACCENT|HERO_HEADLINE|HERO_SUBHEAD|CTA_PRIMARY|CTA_SECONDARY)\}/;
            const stubFile = distFiles.find(
              f => /\.(html|webmanifest|json|xml|txt)$/i.test(f.name) && stubMarkers.test(f.content || ''),
            );
            if (stubFile) {
              const sample = (stubFile.content || '').match(stubMarkers)?.[0] || '?';
              console.warn(`[${jobId}] template-stub detected: ${stubFile.name} contains ${sample}`);
              if (jobs[jobId]) {
                jobs[jobId].errorClass = 'claude_template_stub';
              }
              throw new Error(
                `template-stub: unsubstituted placeholder ${sample} in ${stubFile.name} — Claude orchestrator never customized the template`,
              );
            }
            buildOk = true;
            console.warn(`[${jobId}] npm build ok: ${distFiles.length} dist files`);
          } else {
            console.warn(`[${jobId}] dist/ empty after build`);
          }
        } else {
          console.warn(`[${jobId}] dist/ missing after build`);
        }
      } catch (be) {
        console.warn(`[${jobId}] Build error:`, be.message.slice(0, 500));
        if (jobs[jobId] && !jobs[jobId].buildErrorMessage) {
          jobs[jobId].buildErrorMessage = be.message.slice(0, 500);
        }
      }
    } else {
      console.warn(`[${jobId}] No package.json — skipping build`);
    }

    if (!buildOk) {
      const errClass = (jobs[jobId] && jobs[jobId].errorClass) || 'build_failed';
      const errMsg = (jobs[jobId] && jobs[jobId].buildErrorMessage) || 'npm build failed or produced no dist/ files';
      setStatus(jobId, {
        status: 'error',
        errorClass: errClass,
        error: errMsg,
        step: 'done',
        files: [],
      });
      return;
    }

    setStatus(jobId, { step: 'r2-upload' });
    let uploadOk = false;
    let uploadResult = null;
    try {
      const up = await runAsync(`cd ${dir} && node /home/cuser/upload-to-r2.mjs 2>&1`, 300000, 10 * 1024 * 1024);
      console.warn(`[${jobId}] R2 upload exit=${up.code} tail:`, up.stdout.slice(-500));
      try {
        uploadResult = JSON.parse(fs.readFileSync(path.join(dir, '_upload_result.json'), 'utf-8'));
        if (uploadResult && typeof uploadResult.uploaded === 'number' && uploadResult.uploaded > 0) {
          uploadOk = true;
        } else {
          console.warn(`[${jobId}] Upload result has uploaded=${uploadResult && uploadResult.uploaded}`);
        }
      } catch (pe) {
        console.warn(`[${jobId}] Could not parse _upload_result.json:`, pe.message.slice(0, 200));
      }
    } catch (ue) {
      console.warn(`[${jobId}] R2 upload error:`, ue.message.slice(0, 500));
    }

    if (!uploadOk) {
      setStatus(jobId, {
        status: 'error',
        error: `R2 upload failed or uploaded 0 files. claude_exit=${code} upload_result=${JSON.stringify(uploadResult)}`,
        step: 'done',
        files: collectFiles(dir),
        uploadResult,
      });
      return;
    }

    setStatus(jobId, { step: 'collecting' });
    const files = collectFiles(dir);
    console.warn(`[${jobId}] Collected ${files.length} source files`);
    setStatus(jobId, {
      files,
      uploadResult,
      status: 'complete',
      step: 'done',
    });
  });

  child.on('error', e => {
    console.warn(`[${jobId}] Process error:`, e.message);
    const files = collectFiles(dir);
    setStatus(jobId, {
      files,
      status: files.length > 0 ? 'complete' : 'error',
      error: e.message,
      step: 'done',
    });
  });
}

http.createServer((q, r) => {
  r.setHeader('Content-Type', 'application/json');
  const url = new URL(q.url, 'http://localhost');

  if (q.method === 'GET' && url.pathname === '/health') {
    return r.end(JSON.stringify({ ok: true, jobs: Object.keys(jobs).length }));
  }

  if (q.method === 'GET' && url.pathname === '/status') {
    const jid = url.searchParams.get('jobId');
    if (!jid || !jobs[jid]) return r.end(JSON.stringify({ error: 'unknown job' }));
    const waitMs = Math.min(parseInt(url.searchParams.get('wait') || '0', 10) || 0, 60_000);
    const sinceStep = url.searchParams.get('sinceStep') || null;
    const sinceStatus = url.searchParams.get('sinceStatus') || null;

    const snapshot = () => {
      const j = jobs[jid];
      const phase = j.status === 'running' ? readPhase(j.dir) : '';
      return {
        status: j.status,
        step: phase ? `${j.step}:${phase}` : j.step,
        elapsed: ((Date.now() - j.startTime) / 1000) | 0,
        fileCount: j.files ? j.files.length : 0,
        error: j.error ? j.error.slice(0, 500) : null,
        uploadResult: j.uploadResult || null,
      };
    };

    const immediate = snapshot();
    const changed = (s) => s.status !== sinceStatus || s.step !== sinceStep;
    if (waitMs <= 0 || changed(immediate) || immediate.status !== 'running') {
      return r.end(JSON.stringify(immediate));
    }

    // Long-poll: hold the request open until status/step changes or wait expires.
    // This keeps inbound traffic flowing to the DO, preventing hibernation, AND
    // delivers state changes to the workflow with sub-second latency instead of 30s.
    const start = Date.now();
    const poll = setInterval(() => {
      if (!jobs[jid]) { clearInterval(poll); try { r.end(JSON.stringify({ error: 'job lost' })); } catch {} return; }
      const s = snapshot();
      if (changed(s) || s.status !== 'running' || Date.now() - start >= waitMs) {
        clearInterval(poll);
        try { r.end(JSON.stringify(s)); } catch {}
      }
    }, 1000);
    q.on('close', () => { clearInterval(poll); });
    return;
  }

  if (q.method === 'GET' && url.pathname === '/result') {
    const jid = url.searchParams.get('jobId');
    if (!jid || !jobs[jid]) return r.end(JSON.stringify({ error: 'unknown job' }));
    const j = jobs[jid];
    if (j.status === 'running') {
      return r.end(JSON.stringify({ error: 'still running', status: j.status, step: j.step }));
    }
    try { if (j.dir) fs.rmSync(j.dir, { recursive: true, force: true }); } catch {}
    const result = { status: j.status, files: j.files || [], error: j.error, uploadResult: j.uploadResult || null };
    deleteJob(jid);
    return r.end(JSON.stringify(result));
  }

  if (q.method === 'POST' && url.pathname === '/build-minimal') {
    let b = '';
    q.on('data', c => { b += c; });
    q.on('end', () => {
      const t0 = Date.now();
      try {
        const P = JSON.parse(b || '{}');
        const slug = P.slug || 'minimal-test';
        const dir = `/tmp/build-${slug}-${Date.now()}`;
        fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
        const html = `<!doctype html><html><head><meta charset=utf-8><title>${slug}</title></head><body><h1>Hello from container — ${slug}</h1><p>2+2=${2 + 2}</p><p>Built: ${new Date().toISOString()}</p></body></html>`;
        fs.writeFileSync(path.join(dir, 'dist', 'index.html'), html);

        const envVars = {};
        if (P.envVars && typeof P.envVars === 'object') {
          for (const ek in P.envVars) envVars[ek] = P.envVars[ek];
        }
        const envLines = ['#!/bin/sh'];
        for (const k in envVars) if (envVars[k]) envLines.push(`export ${k}=${JSON.stringify(envVars[k])}`);
        envLines.push('export HOME=/home/cuser');
        envLines.push(`cd ${dir}`);
        envLines.push(`node /home/cuser/upload-to-r2.mjs 2>&1`);
        const sf = `/tmp/run_min_${Date.now()}.sh`;
        fs.writeFileSync(sf, envLines.join('\n'));
        try { x(`chmod +x ${sf}`, { stdio: 'pipe' }); } catch {}
        try { x(`chown -R cuser:cuser ${dir}`, { stdio: 'pipe', shell: true }); } catch {}

        let uploadOk = false, uploadResult = null, stdoutTail = '';
        try {
          stdoutTail = x(`sh ${sf}`, { timeout: 60000, maxBuffer: 5 * 1024 * 1024, shell: true, encoding: 'utf-8' }).slice(-400);
          uploadResult = JSON.parse(fs.readFileSync(path.join(dir, '_upload_result.json'), 'utf-8'));
          uploadOk = uploadResult && uploadResult.uploaded > 0;
        } catch (e) { stdoutTail = (e.message || String(e)).slice(0, 400); }

        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}

        r.writeHead(200);
        r.end(JSON.stringify({
          ok: uploadOk,
          elapsedMs: Date.now() - t0,
          uploadResult,
          stdoutTail,
        }));
      } catch (e) {
        r.writeHead(200);
        r.end(JSON.stringify({ ok: false, error: e.message, elapsedMs: Date.now() - t0 }));
      }
    });
    return;
  }

  if (q.method === 'POST' && url.pathname === '/build-stub') {
    let b = '';
    q.on('data', c => { b += c; });
    q.on('end', () => {
      try {
        const P = JSON.parse(b);
        const jobId = `stub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const callbackUrl = P.callbackUrl || null;
        const callbackSecret = P.callbackSecret || null;
        jobs[jobId] = {
          jobId,
          status: 'running',
          dir: null,
          startTime: Date.now(),
          step: 'stub-init',
          error: null,
          files: null,
          uploadResult: null,
          callbackUrl,
          callbackSecret,
        };
        saveJob(jobId);
        pushStatus(jobId);

        const steps = ['stub-foundation', 'stub-inspect', 'stub-enhance', 'stub-finalize'];
        let i = 0;
        const tick = setInterval(() => {
          if (!jobs[jobId]) { clearInterval(tick); return; }
          if (i < steps.length) {
            setStatus(jobId, { step: steps[i] });
            i++;
          } else {
            setStatus(jobId, {
              status: 'complete',
              step: 'done',
              uploadResult: { uploaded: 3, failed: 0, version: `stub-v-${Date.now()}` },
              files: [{ name: 'index.html', content: '<h1>stub ok</h1>' }],
            });
            clearInterval(tick);
          }
        }, 6000);

        r.writeHead(200);
        r.end(JSON.stringify({ jobId, status: 'started', mode: 'stub' }));
      } catch (e) {
        r.writeHead(200);
        r.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  if (q.method === 'POST' && url.pathname === '/build') {
    let b = '';
    q.on('data', c => { b += c; });
    q.on('end', () => {
      try {
        const P = JSON.parse(b);
        const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const slug = P.slug || 'site';
        const isWarm = P.warmReuse === true;
        const iteration = typeof P.iteration === 'number' && P.iteration > 0 ? P.iteration : 1;
        // Warm reuse: reuse stable per-slug dir so node_modules + ~/.cache/vite + dist/
        // survive across convergence iterations (saves ~60-130s per warm iter).
        const dir = isWarm ? `/tmp/build-${slug}` : `/tmp/build-${slug}-${Date.now()}`;
        fs.mkdirSync(dir, { recursive: true });
        const hasWarmCache = isWarm && fs.existsSync(path.join(dir, 'node_modules')) && fs.existsSync(path.join(dir, 'package.json'));

        // Forced pre-build refresh — every build pulls heymegabyte/claude-skills + template
        // before the orchestrator runs, so Claude Code always sees the latest published
        // instructions/agents/components. No throttle window.
        const refreshResult = refreshSkillsForBuild(jobId);

        if (P.skipBuild !== true && fs.existsSync(`${TEMPLATE_DIR}/package.json`)) {
          if (hasWarmCache) {
            console.warn(`[${jobId}] Warm reuse: iteration ${iteration}, dir ${dir}, skipping template copy (node_modules cached)`);
          } else {
            try {
              x(`cp -r ${TEMPLATE_DIR}/* ${dir}/ 2>/dev/null; cp -r ${TEMPLATE_DIR}/.[!.]* ${dir}/ 2>/dev/null; true`, { shell: true, stdio: 'pipe' });
              console.warn(`[${jobId}] Template copied (warm=${isWarm}, iter=${iteration})`);
            } catch {}
          }
        }

        // Write each context file at exactly the requested key name. Keys that already
        // start with `_` (e.g. `_brand.json`, `_assets.json`, `_scraped_content.json`) land
        // verbatim — the orchestrator prompt instructs Claude to read those exact paths.
        // Legacy keys without a leading `_` are still prefixed so they ship as ignored
        // sidecar files (collectFiles strips files starting with `_`).
        if (P.contextFiles && typeof P.contextFiles === 'object') {
          for (const k in P.contextFiles) {
            const fileName = k.startsWith('_') ? k : `_${k}`;
            fs.writeFileSync(
              path.join(dir, fileName),
              typeof P.contextFiles[k] === 'string' ? P.contextFiles[k] : JSON.stringify(P.contextFiles[k], null, 2)
            );
          }
        }

        if (P.claudeMd) fs.writeFileSync(path.join(dir, 'CLAUDE.md'), P.claudeMd);

        try { x(`chown -R cuser:cuser ${dir}`, { stdio: 'pipe', shell: true }); } catch {}

        const envVars = { ANTHROPIC_API_KEY: P._anthropicKey || '' };
        if (P.envVars && typeof P.envVars === 'object') {
          for (const ek in P.envVars) envVars[ek] = P.envVars[ek];
        }

        const callbackUrl = P.callbackUrl || envVars.CALLBACK_URL || null;
        const callbackSecret = P.callbackSecret || envVars.CALLBACK_SECRET || null;

        // On warm convergence iterations, prepend prior-iteration recommendations
        // so the orchestrator focuses on targeted fixes instead of redoing research.
        let finalPrompt = P.prompt || '';
        if (isWarm && Array.isArray(P.priorRecommendations) && P.priorRecommendations.length > 0) {
          const recBlock = P.priorRecommendations
            .slice(0, 50)
            .map((rec, idx) => `${idx + 1}. [${rec.severity || 'minor'}] (${rec.category || 'unknown'}) ${rec.description || ''}`)
            .join('\n');
          const warmHeader = `## Prior Iteration Recommendations (Convergence Iteration ${iteration})\n\nThe previous build of this site was scored by the multi-judge stack and produced the following actionable recommendations. Address EACH ONE in this iteration. Do NOT re-run research, brand extraction, or template setup — those artifacts are already on disk in this warm container. Focus your subagents on surgical fixes.\n\n${recBlock}\n\nAfter applying the fixes above, re-run the validators and visual inspection. The convergence loop will score this build and decide whether another iteration is needed.\n\n---\n\n`;
          finalPrompt = warmHeader + finalPrompt;
          console.warn(`[${jobId}] Warm iteration ${iteration}: prepended ${P.priorRecommendations.length} prior recommendations to prompt`);
        }

        runJob(jobId, dir, finalPrompt, envVars, P.timeoutMin || 45, callbackUrl, callbackSecret, P.skipBuild === true, P._claudeOauth || null);
        if (jobs[jobId]) {
          jobs[jobId].prebuildRefresh = refreshResult;
          saveJob(jobId);
        }
        r.writeHead(200);
        r.end(JSON.stringify({ jobId, status: 'started', prebuildRefresh: refreshResult }));
      } catch (e) {
        r.writeHead(200);
        r.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  r.writeHead(404);
  r.end(JSON.stringify({ error: 'not found' }));
}).listen(8080, () => console.warn('[container] Ready on :8080'));
