import { Container } from '@cloudflare/containers';
import type { Env } from './types/env.js';

/**
 * SiteBuilderContainer — Async Claude Code executor with heartbeat polling
 *
 * Architecture:
 * 1. Dockerfile pre-bakes: Claude Code CLI, git, cuser, skills repo, template repo, inspect.js
 * 2. Entrypoint starts HTTP server on :8080
 * 3. POST /build → starts Claude Code async, returns { jobId } immediately
 * 4. GET /status?jobId=X → returns { status, elapsed, step } for heartbeat polling
 * 5. GET /result?jobId=X → returns { files[] } when complete
 * 6. Single `claude -p` run handles: research, logo, building, GPT-4o self-inspection, fixes
 * 7. Container does NOT touch D1 or R2 — workflow handles storage
 */
export class SiteBuilderContainer extends Container<Env> {
  defaultPort = 8080;
  enableInternet = true;

  entrypoint = ['node', '-e',
    'const{execSync:x,spawn:sp}=require("child_process"),fs=require("fs"),path=require("path"),http=require("http");' +
    'const NL=String.fromCharCode(10);' +
    'var CP=x("which claude",{encoding:"utf-8"}).trim();' +
    'console.log("[boot] Claude at:",CP);' +
    'var CUSER_HOME="/home/cuser";' +
    'var SKILLS_DIR=CUSER_HOME+"/.agentskills";' +
    'var TEMPLATE_DIR=CUSER_HOME+"/template";' +
    // Git pull skills + template at boot
    'try{x("cd "+SKILLS_DIR+" && git pull origin main 2>&1",{timeout:30000,shell:true,encoding:"utf-8"});console.log("[boot] Skills updated")}catch(e){console.warn("[boot] Skills pull failed:",e.message.slice(0,100))}' +
    'try{x("cd "+TEMPLATE_DIR+" && git pull origin main 2>&1",{timeout:30000,shell:true,encoding:"utf-8"});console.log("[boot] Template updated")}catch(e){console.warn("[boot] Template pull failed:",e.message.slice(0,100))}' +
    // Job store: { [jobId]: { status, dir, startTime, step, error, files } }
    'var jobs={};' +
    // collectFiles: recursively collect all non-underscore files from dir
    'function collectFiles(dir,base){' +
      'base=base||"";var files=[];' +
      'try{for(var f of fs.readdirSync(dir)){' +
        'if(f.startsWith("_")||f==="node_modules"||f===".git"||f===".claude")continue;' +
        'var fp=path.join(dir,f),rel=base?base+"/"+f:f,st=fs.statSync(fp);' +
        'if(st.isDirectory()){files=files.concat(collectFiles(fp,rel))}' +
        'else if(st.isFile()&&st.size<500000&&st.size>0){' +
          'try{files.push({name:rel,content:fs.readFileSync(fp,"utf-8")})}catch(e){}' +
        '}' +
      '}}catch(e){}return files' +
    '}' +
    // runJob: async job execution — runs Claude Code in background
    'function runJob(jobId,dir,prompt,envVars,timeoutMin){' +
      'jobs[jobId]={status:"running",dir:dir,startTime:Date.now(),step:"claude-code",error:null,files:null};' +
      // Write prompt to file
      'var pf=path.join(dir,"_prompt.txt");' +
      'fs.writeFileSync(pf,prompt);' +
      // Build shell script with all env vars
      'var envLines=["#!/bin/sh"];' +
      'for(var k in envVars){if(envVars[k])envLines.push("export "+k+"="+JSON.stringify(envVars[k]))}' +
      'envLines.push("export HOME=/home/cuser");' +
      'envLines.push("cd "+dir);' +
      'envLines.push(CP+" --dangerously-skip-permissions -p < "+pf);' +
      'var sf="/tmp/run_"+jobId+".sh";' +
      'fs.writeFileSync(sf,envLines.join(NL));' +
      'x("chmod +x "+sf,{stdio:"pipe"});' +
      'var to=(timeoutMin||45)*60000;' +
      'console.log("["+jobId+"] Starting Claude Code ("+Math.round(prompt.length/1024)+"KB prompt, "+timeoutMin+"min timeout)");' +
      // Run async
      'var child=sp("su",["cuser","-s","/bin/sh","-c","sh "+sf],{' +
        'timeout:to,shell:true,stdio:["pipe","pipe","pipe"],maxBuffer:100*1024*1024' +
      '});' +
      'var stdout="",stderr="";' +
      'child.stdout.on("data",function(d){stdout+=d.toString()});' +
      'child.stderr.on("data",function(d){stderr+=d.toString()});' +
      'child.on("close",function(code){' +
        'console.log("["+jobId+"] Claude Code exited code="+code+" stdout="+stdout.length+"b stderr="+stderr.length+"b elapsed="+((Date.now()-jobs[jobId].startTime)/1000|0)+"s");' +
        // Run npm build after Claude Code finishes
        'jobs[jobId].step="npm-build";' +
        'if(fs.existsSync(path.join(dir,"package.json"))){' +
          'try{' +
            'x("cd "+dir+" && npm install --legacy-peer-deps 2>&1",{timeout:120000,maxBuffer:50*1024*1024,shell:true,encoding:"utf-8"});' +
            'x("cd "+dir+" && npm run build 2>&1",{timeout:120000,maxBuffer:50*1024*1024,shell:true,encoding:"utf-8"});' +
            'console.log("["+jobId+"] npm build done")' +
          '}catch(be){console.warn("["+jobId+"] Build error:",be.message.slice(0,200))}' +
        '}' +
        // Upload to R2 via upload script (uses CF_API_TOKEN etc. from env vars)
        'jobs[jobId].step="r2-upload";' +
        'try{' +
          'var uploadOut=x("cd "+dir+" && node /home/cuser/upload-to-r2.mjs 2>&1",{timeout:120000,maxBuffer:10*1024*1024,shell:true,encoding:"utf-8"});' +
          'console.log("["+jobId+"] R2 upload done:",uploadOut.slice(0,200));' +
          'try{jobs[jobId].uploadResult=JSON.parse(fs.readFileSync(path.join(dir,"_upload_result.json"),"utf-8"))}catch(e){}' +
        '}catch(ue){console.warn("["+jobId+"] R2 upload error:",ue.message.slice(0,200))}' +
        // Collect files
        'jobs[jobId].step="collecting";' +
        'var files=collectFiles(dir);' +
        'console.log("["+jobId+"] Collected "+files.length+" files");' +
        'jobs[jobId].files=files;' +
        'jobs[jobId].status=code===0?"complete":"complete";' + // complete even on non-zero if files exist
        'jobs[jobId].step="done";' +
        'if(files.length===0){' +
          'jobs[jobId].status="error";' +
          'jobs[jobId].error="No files generated. stdout="+stdout.length+"b stderr="+stderr.slice(0,500)' +
        '}' +
      '});' +
      'child.on("error",function(e){' +
        'console.error("["+jobId+"] Process error:",e.message);' +
        // Still try to collect files — Claude Code may have written some before crashing
        'var files=collectFiles(dir);' +
        'jobs[jobId].files=files;' +
        'jobs[jobId].status=files.length>0?"complete":"error";' +
        'jobs[jobId].error=e.message;' +
        'jobs[jobId].step="done"' +
      '});' +
    '}' +
    // HTTP server with 3 endpoints
    'http.createServer((q,r)=>{' +
      'r.setHeader("Content-Type","application/json");' +
      'var url=new URL(q.url,"http://localhost");' +
      // GET /health
      'if(q.method==="GET"&&url.pathname==="/health"){return r.end(JSON.stringify({ok:true,jobs:Object.keys(jobs).length}))}' +
      // GET /status — heartbeat polling
      'if(q.method==="GET"&&url.pathname==="/status"){' +
        'var jid=url.searchParams.get("jobId");' +
        'if(!jid||!jobs[jid])return r.end(JSON.stringify({error:"unknown job"}));' +
        'var j=jobs[jid];' +
        'return r.end(JSON.stringify({status:j.status,step:j.step,elapsed:((Date.now()-j.startTime)/1000|0),fileCount:j.files?j.files.length:0,error:j.error?j.error.slice(0,500):null,uploadResult:j.uploadResult||null}))' +
      '}' +
      // GET /result — get files when complete
      'if(q.method==="GET"&&url.pathname==="/result"){' +
        'var jid=url.searchParams.get("jobId");' +
        'if(!jid||!jobs[jid])return r.end(JSON.stringify({error:"unknown job"}));' +
        'var j=jobs[jid];' +
        'if(j.status==="running")return r.end(JSON.stringify({error:"still running",status:j.status,step:j.step}));' +
        // Clean up build dir after result is fetched
        'try{if(j.dir)fs.rmSync(j.dir,{recursive:true,force:true})}catch(e){}' +
        'var result={status:j.status,files:j.files||[],error:j.error};' +
        'delete jobs[jid];' + // Free memory
        'return r.end(JSON.stringify(result))' +
      '}' +
      // POST /build — start async build
      'if(q.method==="POST"&&url.pathname==="/build"){' +
        'var b="";q.on("data",function(c){b+=c});q.on("end",function(){' +
          'try{' +
            'var P=JSON.parse(b);' +
            'var jobId="job-"+Date.now()+"-"+Math.random().toString(36).slice(2,8);' +
            'var dir="/tmp/build-"+(P.slug||"site")+"-"+Date.now();' +
            'fs.mkdirSync(dir,{recursive:true});' +
            // Copy template as starting point
            'if(fs.existsSync(TEMPLATE_DIR+"/package.json")){' +
              'try{x("cp -r "+TEMPLATE_DIR+"/* "+dir+"/ 2>/dev/null; cp -r "+TEMPLATE_DIR+"/.[!.]* "+dir+"/ 2>/dev/null; true",{shell:true,stdio:"pipe"});' +
              'console.log("["+jobId+"] Template copied")}catch(e){}' +
            '}' +
            // Write context files (research data, scraped content, etc.)
            'if(P.contextFiles&&typeof P.contextFiles==="object"){' +
              'for(var k in P.contextFiles){' +
                'fs.writeFileSync(path.join(dir,"_"+k),typeof P.contextFiles[k]==="string"?P.contextFiles[k]:JSON.stringify(P.contextFiles[k],null,2))' +
              '}' +
            '}' +
            // Write CLAUDE.md into the build dir for Claude Code to read
            'if(P.claudeMd){fs.writeFileSync(path.join(dir,"CLAUDE.md"),P.claudeMd)}' +
            // Own by cuser
            'try{x("chown -R cuser:cuser "+dir,{stdio:"pipe",shell:true})}catch(e){}' +
            // Build env vars object with all API keys
            'var envVars={ANTHROPIC_API_KEY:P._anthropicKey||""};' +
            'if(P.envVars&&typeof P.envVars==="object"){for(var ek in P.envVars){envVars[ek]=P.envVars[ek]}}' +
            // Start async job
            'runJob(jobId,dir,P.prompt||"",envVars,P.timeoutMin||45);' +
            'r.writeHead(200);r.end(JSON.stringify({jobId:jobId,status:"started"}))' +
          '}catch(e){' +
            'r.writeHead(200);r.end(JSON.stringify({error:e.message}))' +
          '}' +
        '});return' +
      '}' +
      'r.writeHead(404);r.end(JSON.stringify({error:"not found"}))' +
    '}).listen(8080,function(){console.log("[container] Ready on :8080")})'
  ];

  override async fetch(request: Request): Promise<Response> {
    try {
      await this.startAndWaitForPorts([8080], { portReadyTimeoutMS: 180000 });
    } catch (err) {
      return new Response(JSON.stringify({ error: `Container start failed: ${err}` }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }
    return super.fetch(request);
  }

  override async onStart(): Promise<void> {}
}
