import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
test('HTTP streaming with fixture processes, validation and origin protection',{skip:process.platform==='win32'},async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'lynx-test-'));const port=31876,base=`http://127.0.0.1:${port}`;let child;
 try{
 await writeFile(path.join(dir,'ping'),'#!/bin/sh\necho "64 bytes from 1.1.1.1: icmp_seq=1 ttl=64 time=12.5 ms"\n',{mode:0o755});
 await writeFile(path.join(dir,'traceroute'),'#!/bin/sh\necho " 1 10.0.0.1 1.0 ms 2.0 ms 3.0 ms"\necho " 2 * * *"\necho " 3 1.1.1.1 12.0 ms 12.5 ms 13.0 ms"\n',{mode:0o755});
 child=spawn(process.execPath,['server.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,PATH:dir+path.delimiter+process.env.PATH,PORT:String(port)},stdio:['ignore','pipe','pipe']});
 child.stderr.on('data',b=>process.stderr.write(b));
 await Promise.race([once(child.stdout,'data'),once(child,'exit').then(()=>{throw Error('Server exited');})]);
 const response=await fetch(base);assert.equal(response.status,200);assert.match(await response.text(),/Observed route/);
 assert.equal((await fetch(base+'/api/interfaces')).status,200);
 for(const asset of ['/tabs.js','/tabs.css','/logo.png'])assert.equal((await fetch(base+asset)).status,200);
 assert.equal((await fetch(base+'/api/run',{method:'POST'})).status,403);
 const request=body=>fetch(base+'/api/run',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await request({destination:'1.1.1.1; id'})).status,400);
 const run=await request({destination:'1.1.1.1',count:2,maxHops:3});assert.equal(run.status,200);
 const events=(await run.text()).trim().split('\n').map(JSON.parse);
 assert.equal(events.filter(e=>e.type==='hop').length,3);assert.equal(events.filter(e=>e.type==='ping').length,2);
 const done=events.at(-1);assert.equal(done.type,'done');assert.equal(done.data.metrics.average,12.5);assert.equal(done.data.metrics.loss,0);assert.equal(done.data.reached,true);
 const parallel=await Promise.all(Array.from({length:8},()=>request({destination:'1.1.1.1',count:2,maxHops:3})));
 assert(parallel.every(r=>r.status===200),'Eight concurrent traceroutes must be accepted');
 const ninth=await request({destination:'1.1.1.1',count:2,maxHops:3});assert.equal(ninth.status,429);
 const results=await Promise.all(parallel.map(r=>r.text()));assert(results.every(s=>s.includes('"type":"done"')),'Every concurrent stream must complete');
 }finally{if(child){const exit=once(child,'exit');child.kill();await exit;}await rm(dir,{recursive:true,force:true});}
});
