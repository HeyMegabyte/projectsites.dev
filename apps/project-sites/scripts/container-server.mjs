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

// Sync universal agents from megabytespace/claude-skills into ~/.claude/agents/
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
// so megabytespace/claude-skills updates land without redeploying the worker.
let lastRefresh = Date.now();
function maybeRefreshSkills() {
  if (Date.now() - lastRefresh < 10 * 60 * 1000) return;
  lastRefresh = Date.now();
  refreshRepo('refresh', 'Skills', SKILLS_DIR);
  refreshRepo('refresh', 'Template', TEMPLATE_DIR);
  syncAgents('refresh');
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

function pushStatus(jobId) {
  const j = jobs[jobId];
  if (!j || !j.callbackUrl || !j.callbackSecret) return;
  const liveCount = j.status === 'running' && j.dir ? liveFileCount(j.dir) : 0;
  const finalCount = j.files ? j.files.length : 0;
  const payload = {
    jobId,
    status: j.status,
    step: j.step,
    elapsed: ((Date.now() - j.startTime) / 1000) | 0,
    fileCount: finalCount || liveCount,
    error: j.error ? String(j.error).slice(0, 500) : null,
    uploadResult: j.uploadResult || null,
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

function runJob(jobId, dir, prompt, envVars, timeoutMin, callbackUrl, callbackSecret, skipBuild) {
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
  };
  saveJob(jobId);
  pushStatus(jobId);

  const pf = path.join(dir, '_prompt.txt');
  fs.writeFileSync(pf, prompt);

  const envLines = ['#!/bin/sh'];
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
  child.stdout.on('data', d => { stdout += d.toString(); });
  child.stderr.on('data', d => { stderr += d.toString(); });

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
    console.warn(`[${jobId}] Claude Code exited code=${code} stdout=${stdout.length}b stderr=${stderr.length}b elapsed=${((Date.now() - jobs[jobId].startTime) / 1000) | 0}s`);

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
      }
    } else {
      console.warn(`[${jobId}] No package.json — skipping build`);
    }

    if (!buildOk) {
      setStatus(jobId, {
        status: 'error',
        error: 'npm build failed or produced no dist/ files',
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
      return {
        status: j.status,
        step: j.step,
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
        const dir = `/tmp/build-${P.slug || 'site'}-${Date.now()}`;
        fs.mkdirSync(dir, { recursive: true });

        // Lazy refresh — bring skills + template up to origin/main on burst job arrivals.
        maybeRefreshSkills();

        if (P.skipBuild !== true && fs.existsSync(`${TEMPLATE_DIR}/package.json`)) {
          try {
            x(`cp -r ${TEMPLATE_DIR}/* ${dir}/ 2>/dev/null; cp -r ${TEMPLATE_DIR}/.[!.]* ${dir}/ 2>/dev/null; true`, { shell: true, stdio: 'pipe' });
            console.warn(`[${jobId}] Template copied`);
          } catch {}
        }

        if (P.contextFiles && typeof P.contextFiles === 'object') {
          for (const k in P.contextFiles) {
            fs.writeFileSync(
              path.join(dir, `_${k}`),
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

        runJob(jobId, dir, P.prompt || '', envVars, P.timeoutMin || 45, callbackUrl, callbackSecret, P.skipBuild === true);
        r.writeHead(200);
        r.end(JSON.stringify({ jobId, status: 'started' }));
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
