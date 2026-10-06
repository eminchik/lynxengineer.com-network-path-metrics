import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {interfaces,validate,commands,run,parseHop,parseRTT,metrics} from './probes.js';
const port=Number(process.env.PORT||3000);let active=0;
const files={'/tabs.js':['tabs.js','text/javascript'],'/tabs.css':['tabs.css','text/css'],'/logo.png':['logo.png','image/png'],'/scheduler.js':['scheduler.js','text/javascript'],'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css']};
const server=http.createServer(async(req,res)=>{
  const allowed=[`localhost:${port}`,`127.0.0.1:${port}`];
  const fail=(code,msg)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify({error:msg}));};
  if(!allowed.includes(req.headers.host))return fail(403,'Open this tool through localhost.');
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'");
  if(req.method==='GET'&&req.url==='/api/interfaces'){res.setHeader('Content-Type','application/json');let rows=[],warning=null;try{rows=interfaces();}catch{warning='Local interfaces could not be enumerated. Automatic routing is still available.';}return res.end(JSON.stringify({platform:process.platform,interfaces:rows,warning}));}
  if(req.method==='GET'&&files[req.url]){const [name,type]=files[req.url];res.setHeader('Content-Type',type);return res.end(await readFile(new URL(`./public/${name}`,import.meta.url)));}
  if(req.method!=='POST'||req.url!=='/api/run')return fail(404,'Not found');
  if(!allowed.some(h=>req.headers.origin===`http://${h}`)||req.headers['content-type']!=='application/json')return fail(403,'Same-origin JSON requests required.');
  if(active>=8)return fail(429,'Eight runs are already active across open windows. Stop one first.');
  let config;
  try{let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('Request too large');}config=validate(JSON.parse(body));}catch(e){return fail(400,e.message);}
  if(active>=8)return fail(429,'Eight runs are already active across open windows. Stop one first.');
  active++;res.writeHead(200,{'Content-Type':'application/x-ndjson','X-Accel-Buffering':'no'});res.flushHeaders();
  const controller=new AbortController(),signal=controller.signal;res.on('close',()=>controller.abort());
  const send=(type,data)=>{if(!res.destroyed&&!signal.aborted)res.write(JSON.stringify({type,data})+'\n');};
  const cmd=commands(config),samples=[],hops=[];let pingStatus='complete',traceStatus='complete';
  send('start',{...config,platform:process.platform,started:new Date().toISOString(),traceProtocol:process.platform==='win32'?'ICMP':'UDP'});
  await Promise.allSettled([
    (async()=>{try{for(let i=0;i<config.count&&!signal.aborted;i++){const started=Date.now();const r=await run(...cmd.ping,{signal});if(signal.aborted)break;if(r.expired||r.code>(process.platform==='darwin'?2:1))throw Error(`Ping command failed: ${r.output.trim()||'process timeout'}`);const reply=r.output.split(/\r?\n/).map(parseRTT).find(Boolean);if(r.code===0&&!reply)throw Error('Ping output could not be parsed. English OS output is required on Windows.');samples.push({sequence:i+1,time:new Date().toISOString(),ms:reply?.ms??null,lessThan:reply?.lessThan??false});send('ping',{sample:samples.at(-1),metrics:metrics(samples)});if(i<config.count-1)await delay(Math.max(0,1000-(Date.now()-started)),undefined,{signal});}}catch(e){pingStatus='error';if(!signal.aborted)send('warning',{component:'ping',message:e.message});}})(),
    (async()=>{try{const r=await run(...cmd.trace,{signal,timeout:config.maxHops*3500+10000,onLine:line=>{send('raw',line);const hop=parseHop(line);if(hop){hops.push(hop);send('hop',hop);}}});if(r.expired||r.code!==0||!hops.length)throw Error(`Trace incomplete or failed: ${r.expired?'time limit':r.output.trim().slice(-1000)}`);}catch(e){traceStatus='error';if(!signal.aborted)send('warning',{component:'trace',message:e.message});}})()
  ]);
  send('done',{metrics:metrics(samples),pingStatus,traceStatus,reached:hops.some(h=>h.ips.includes(config.target)),finished:new Date().toISOString()});active--;res.end();
});
server.listen(port,'127.0.0.1',()=>console.log(`Lynx Path: http://localhost:${port}`));
