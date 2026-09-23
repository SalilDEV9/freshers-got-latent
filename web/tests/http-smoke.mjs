import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:4189';
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','4189'],{cwd:new URL('..',import.meta.url),env:{...process.env,APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});
let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
try{
 let ready=false;for(let i=0;i<40;i++){try{const r=await fetch(origin);if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}
 assert.ok(ready,'Production server did not become ready');
 const home=await fetch(origin);assert.match(await home.text(),/Continue with Google/);assert.equal(home.headers.get('x-frame-options'),'DENY');
 for(const path of ['/dashboard/audience','/admin','/gate','/control','/results'])assert.equal((await fetch(origin+path)).status,200);
 const forbidden=await fetch(origin+'/api/action',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:'{"action":"issue"}'});assert.equal(forbidden.status,403);
 const noType=await fetch(origin+'/api/action',{method:'POST',headers:{Origin:origin},body:'hello'});assert.equal(noType.status,415);
 console.log('Production HTTP smoke passed: six routes, framing protection, cross-origin rejection, JSON requirement. Auth/data flows require configured staging.');
}finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}
