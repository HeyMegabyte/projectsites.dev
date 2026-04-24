import { Container } from '@cloudflare/containers';
import type { Env } from './types/env.js';

/**
 * SiteBuilderContainer — Stateless Claude Code executor
 *
 * Architecture:
 * 1. Dockerfile pre-bakes: Claude Code CLI, git, non-root `cuser`, skills repo, template repo, CLAUDE.md
 * 2. Entrypoint runs `git pull` on skills + template repos, then starts HTTP server on :8080
 * 3. Each POST contains: prompt text + optional existing files
 * 4. Container runs `claude -p` as `cuser`, returns all generated/modified files
 * 5. Container does NOT touch D1 or R2 — workflow handles storage
 *
 * The workflow calls the container multiple times (one per build stage).
 * Each call is under 20 minutes. Files are passed in and out via JSON.
 */
export class SiteBuilderContainer extends Container<Env> {
  defaultPort = 8080;
  enableInternet = true;

  entrypoint = ['node', '-e',
    'const{execSync:x}=require("child_process"),fs=require("fs"),path=require("path"),http=require("http");' +
    'const NL=String.fromCharCode(10);' +
    // All pre-baked in Dockerfile: Claude Code, git, cuser, skills, template, CLAUDE.md
    // Boot only does git pull to get latest changes
    'var CP=x("which claude",{encoding:"utf-8"}).trim();' +
    'console.log("[boot] Claude at:",CP);' +
    'var CUSER_HOME="/home/cuser";' +
    'var SKILLS_DIR=CUSER_HOME+"/.agentskills";' +
    'var TEMPLATE_DIR=CUSER_HOME+"/template";' +
    'try{x("cd "+SKILLS_DIR+" && git pull origin main 2>&1",{timeout:30000,shell:true,encoding:"utf-8"});console.log("[boot] Skills updated")}catch(e){console.warn("[boot] Skills pull failed:",e.message.slice(0,100))}' +
    'try{x("cd "+TEMPLATE_DIR+" && git pull origin main 2>&1",{timeout:30000,shell:true,encoding:"utf-8"});console.log("[boot] Template updated")}catch(e){console.warn("[boot] Template pull failed:",e.message.slice(0,100))}' +
    // runClaude: write prompt to file, run as cuser, return success
    'function runClaude(dir,prompt,label,timeoutMin){' +
      'var pf=path.join(dir,"_prompt_"+label+".txt");' +
      'fs.writeFileSync(pf,prompt);' +
      'var sh=["#!/bin/sh","export ANTHROPIC_API_KEY="+process.env.ANTHROPIC_API_KEY,"export HOME=/home/cuser","cd "+dir,CP+" --dangerously-skip-permissions -p < "+pf].join(NL);' +
      'var sf="/tmp/run_"+label+".sh";' +
      'fs.writeFileSync(sf,sh);x("chmod +x "+sf,{stdio:"pipe"});' +
      'var t0=Date.now(),to=(timeoutMin||10)*60000;' +
      'console.log("["+label+"] Start ("+Math.round(prompt.length/1024)+"KB, "+timeoutMin+"min)");' +
      'try{' +
        'var out=x("su cuser -s /bin/sh -c \\"sh "+sf+"\\"",{timeout:to,maxBuffer:100*1024*1024,shell:true,encoding:"utf-8"});' +
        'console.log("["+label+"] Done in "+((Date.now()-t0)/1000|0)+"s, stdout: "+(out||"").length+"b");' +
        // Check if Claude Code wrote files to disk
        'var diskFiles=[];try{diskFiles=fs.readdirSync(dir).filter(f=>!f.startsWith("_"))}catch(e){}' +
        'console.log("["+label+"] Files on disk: "+diskFiles.join(", "));' +
        // If Claude Code output HTML to stdout (pipe mode behavior), save it
        'if(out&&out.length>100){' +
          // Save ALL stdout as index.html if no index.html exists on disk
          'if(!fs.existsSync(path.join(dir,"index.html"))){' +
            'var htmlOut=out;' +
            // Strip markdown fences if present
            'htmlOut=htmlOut.replace(/^```html\\n?/,"").replace(/^```\\n?/,"").replace(/\\n?```$/,"");' +
            // Find the start of HTML
            'var docIdx=htmlOut.indexOf("<!DOCTYPE");' +
            'var htIdx=htmlOut.indexOf("<html");' +
            'var startIdx=docIdx>=0?docIdx:(htIdx>=0?htIdx:-1);' +
            'if(startIdx>0)htmlOut=htmlOut.substring(startIdx);' +
            'if(htmlOut.length>200){' +
              'fs.writeFileSync(path.join(dir,"index.html"),htmlOut);' +
              'console.log("["+label+"] Saved stdout to index.html ("+htmlOut.length+"b)")' +
            '}' +
          '}' +
        '}' +
        'return true' +
      '}catch(e){' +
        'var eOut=e.stdout||"";' +
        'console.log("["+label+"] Error stdout: "+(eOut||"").length+"b");' +
        'if(eOut&&eOut.length>200&&!fs.existsSync(path.join(dir,"index.html"))){' +
          'var h=eOut.replace(/^```html\\n?/,"").replace(/\\n?```$/,"");' +
          'var di=h.indexOf("<!DOCTYPE");var hi=h.indexOf("<html");' +
          'var si=di>=0?di:(hi>=0?hi:0);' +
          'if(si>0)h=h.substring(si);' +
          'fs.writeFileSync(path.join(dir,"index.html"),h);' +
          'console.log("["+label+"] Saved error stdout to index.html")' +
        '}' +
        'var errMsg=(e.message||"").slice(0,300);' +
        'var errOut=(e.stderr||"").toString().slice(0,300);' +
        'var errStdout=(e.stdout||"").toString().slice(0,300);' +
        'console.warn("["+label+"] Failed "+((Date.now()-t0)/1000|0)+"s: "+errMsg+" stderr:"+errOut+" stdout:"+errStdout);' +
        // Store error for diagnostics
        'if(!global._lastClaudeError)global._lastClaudeError={};' +
        'global._lastClaudeError[label]={msg:errMsg,stderr:errOut,stdout:errStdout};' +
        'return false' +
      '}' +
    '}' +
    // collectFiles: recursively collect all non-underscore files from dir
    'function collectFiles(dir,base){' +
      'base=base||"";' +
      'var files=[];' +
      'try{' +
        'for(var f of fs.readdirSync(dir)){' +
          'if(f.startsWith("_")||f==="node_modules"||f===".git")continue;' +
          'var fp=path.join(dir,f);' +
          'var rel=base?base+"/"+f:f;' +
          'var st=fs.statSync(fp);' +
          'if(st.isDirectory()){files=files.concat(collectFiles(fp,rel))}' +
          'else if(st.isFile()&&st.size<500000&&st.size>0){' +
            'try{files.push({name:rel,content:fs.readFileSync(fp,"utf-8")})}catch(e){}' +
          '}' +
        '}' +
      '}catch(e){console.warn("[collect] Error:",e.message)}' +
      'return files' +
    '}' +
    // HTTP server
    'http.createServer((q,r)=>{' +
      'r.setHeader("Content-Type","application/json");' +
      'if(q.method==="GET")return r.end(JSON.stringify({ok:true}));' +
      'var b="";q.on("data",c=>b+=c);q.on("end",()=>{' +
        'try{' +
          'var P=JSON.parse(b);' +
          'if(P._anthropicKey)process.env.ANTHROPIC_API_KEY=P._anthropicKey;' +
          'var dir="/tmp/build-"+(P.slug||"site")+"-"+Date.now();' +
          'fs.mkdirSync(dir,{recursive:true});' +
          // If no existing files provided (Stage A), copy template as starting point
          'var hasExisting=P.existingFiles&&Array.isArray(P.existingFiles)&&P.existingFiles.length>0;' +
          'if(!hasExisting&&fs.existsSync(TEMPLATE_DIR+"/package.json")){' +
            'console.log("[container] Copying template into build dir...");' +
            'try{x("cp -r "+TEMPLATE_DIR+"/* "+dir+"/ 2>/dev/null; cp -r "+TEMPLATE_DIR+"/.[!.]* "+dir+"/ 2>/dev/null; true",{shell:true,stdio:"pipe"});' +
            'console.log("[container] Template copied")}catch(e){console.warn("[container] Template copy failed:",e.message.slice(0,100))}' +
          '}' +
          // Write existing files to dir (from previous stage) — create subdirs as needed
          'if(P.existingFiles&&Array.isArray(P.existingFiles)){' +
            'for(var f of P.existingFiles){' +
              'var fp=path.join(dir,f.name);' +
              'var fd=path.dirname(fp);' +
              'if(fd!==dir)fs.mkdirSync(fd,{recursive:true});' +
              'fs.writeFileSync(fp,f.content)' +
            '}' +
            'console.log("[container] Restored "+P.existingFiles.length+" existing files")' +
          '}' +
          // Write context files (research data etc)
          'if(P.contextFiles&&typeof P.contextFiles==="object"){' +
            'for(var k in P.contextFiles){' +
              'fs.writeFileSync(path.join(dir,"_"+k),typeof P.contextFiles[k]==="string"?P.contextFiles[k]:JSON.stringify(P.contextFiles[k],null,2))' +
            '}' +
          '}' +
          // Make build dir owned by cuser so Claude Code can write files
          'try{x("chown -R cuser:cuser "+dir,{stdio:"pipe",shell:true})}catch(e){console.warn("[chown]",e.message)}' +
          // Run prompts sequentially
          'var prompts=P.prompts||[];' +
          'var results=[];' +
          'for(var i=0;i<prompts.length;i++){' +
            'var p=prompts[i];' +
            'var ok=runClaude(dir,p.text,p.label||("step-"+i),p.timeoutMin||10);' +
            'results.push({label:p.label||("step-"+i),success:ok})' +
          '}' +
          // If package.json exists, run npm install + build to produce dist/
          'var hasPackageJson=fs.existsSync(path.join(dir,"package.json"));' +
          'if(hasPackageJson){' +
            'console.log("[container] Vite project detected — running npm install + build...");' +
            'try{' +
              'x("cd "+dir+" && npm install --legacy-peer-deps 2>&1",{timeout:120000,maxBuffer:50*1024*1024,shell:true,encoding:"utf-8"});' +
              'console.log("[container] npm install done");' +
              'x("cd "+dir+" && npm run build 2>&1",{timeout:120000,maxBuffer:50*1024*1024,shell:true,encoding:"utf-8"});' +
              'console.log("[container] npm run build done");' +
            '}catch(buildErr){' +
              'console.warn("[container] Build failed:",buildErr.message.slice(0,200));' +
            '}' +
          '}' +
          // Collect all output files (source + dist if built)
          'var files=collectFiles(dir);' +
          'console.log("[container] Generated "+files.length+" files from "+prompts.length+" prompts");' +
          // Add diagnostic info
          'var diag={apiKeySet:!!process.env.ANTHROPIC_API_KEY,apiKeyLen:(process.env.ANTHROPIC_API_KEY||"").length,claudeInstalled:false,promptCount:prompts.length,filesOnDisk:[],results:results,errors:global._lastClaudeError||{}};' +
          'try{diag.claudeInstalled=!!x("which claude",{encoding:"utf-8",stdio:"pipe"}).trim()}catch(e){}' +
          'try{diag.filesOnDisk=fs.readdirSync(dir)}catch(e){}' +
          // Cleanup
          'try{fs.rmSync(dir,{recursive:true,force:true})}catch(e){}' +
          // Return result with diagnostics
          'r.writeHead(200);r.end(JSON.stringify({status:"ok",files:files,results:results,diag:diag}))' +
        '}catch(e){' +
          'console.error("[container] Error:",e.message);' +
          'r.writeHead(200);r.end(JSON.stringify({status:"error",error:e.message,files:[]}))' +
        '}' +
      '})' +
    '}).listen(8080,()=>console.log("[container] Ready on :8080"))'
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
