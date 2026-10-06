import net from 'node:net';
import os from 'node:os';
import {spawn} from 'node:child_process';
export const interfaces = () => Object.entries(os.networkInterfaces()).flatMap(([name, rows]) => rows.filter(r => r.family === 'IPv4').map(r => ({name, address:r.address, cidr:r.cidr})));
const number = ip => ip.split('.').reduce((a,v) => (a*256+Number(v))>>>0,0);
export function subnet(value) {
  const [ip,prefix,...rest]=value.split('/');
  if(net.isIP(ip)!==4 || rest.length || (prefix!==undefined && !/^(\d|[12]\d|3[0-2])$/.test(prefix))) throw Error('Use an IPv4 address or CIDR, e.g. 10.10.0.0/24.');
  const bits=prefix===undefined?32:Number(prefix), mask=bits===0?0:(0xffffffff<<(32-bits))>>>0;
  return {ip,bits,contains:target=>net.isIP(target)===4 && ((number(target)&mask)>>>0)===((number(ip)&mask)>>>0)};
}
export function validate(input, local=null, platform=process.platform) {
  let source=String(input.source||'').trim(), target=String(input.destination||'').trim();
  if(source){const s=subnet(source); const candidates=(local??interfaces()).filter(r=>s.contains(r.address)); if(candidates.length!==1) throw Error('Source must match exactly one local IPv4 address. Select its exact IP if the subnet is ambiguous.');source=candidates[0].address;}
  if(platform==='win32' && source) throw Error('Windows IPv4 uses automatic source selection. Leave source blank, or run on Linux/macOS for source binding.');
  const d=subnet(target);
  if(d.bits<32){target=String(input.targetHost||'').trim();if(!d.contains(target)) throw Error('Enter a destination host IP inside the destination subnet.');}
  else target=d.ip;
  const first=Number(target.split('.')[0]);if(first===0 || first>=224 || target==='255.255.255.255')throw Error('Use a unicast destination IPv4 address.');
  const count=Number(input.count??20), maxHops=Number(input.maxHops??30);
  if(!Number.isInteger(count)||count<2||count>120||!Number.isInteger(maxHops)||maxHops<1||maxHops>64)throw Error('Samples: 2–120; maximum hops: 1–64.');
  return {source,target,count,maxHops,destination:input.destination};
}
export function parseRTT(line){const m=line.match(/time\s*([=<])\s*([\d.,]+)\s*ms/i);return m?{ms:Number(m[2].replace(',','.')),lessThan:m[1]==='<'}:null;}
export function parseHop(line){const m=line.match(/^\s*(\d+)\s+(.+)$/);if(!m)return null;const ips=[...new Set((m[2].match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)||[]).filter(ip=>net.isIP(ip)===4))];const times=[...m[2].matchAll(/(<)?\s*(\d+(?:[.,]\d+)?)\s*ms/g)].map(x=>({ms:Number(x[2].replace(',','.')),lessThan:!!x[1]}));if(!ips.length&&!m[2].includes('*'))return null;return {ttl:Number(m[1]),ips,times,raw:line.trim(),average:times.length?times.reduce((a,t)=>a+t.ms,0)/times.length:null};}
export function metrics(samples){const good=samples.filter(x=>x.ms!==null);const values=good.map(x=>x.ms);const deltas=[];for(let i=1;i<samples.length;i++)if(samples[i].ms!==null&&samples[i-1].ms!==null)deltas.push(Math.abs(samples[i].ms-samples[i-1].ms));return {sent:samples.length,received:good.length,loss:samples.length?100*(samples.length-good.length)/samples.length:0,last:samples.at(-1)?.ms??null,average:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,jitter:deltas.length?deltas.reduce((a,b)=>a+b,0)/deltas.length:null,upperBound:good.some(x=>x.lessThan)};}
export function commands(c, platform=process.platform){
  const win=platform==='win32', mac=platform==='darwin';
  return {ping:win?['ping',['-4','-n','1','-w','1000',c.target]]:['ping',[...(mac?[]:['-4']),'-n','-c','1','-W',mac?'1000':'1',...(c.source?[mac?'-S':'-I',c.source]:[]),c.target]],trace:win?['tracert',['-4','-d','-h',String(c.maxHops),'-w','1000',c.target]]:['traceroute',['-n','-m',String(c.maxHops),'-q','3','-w','1',...(c.source?['-s',c.source]:[]),c.target]]};
}
export function run(command,args,{signal,timeout=5000,onLine=()=>{}}={}){
  return new Promise((resolve,reject)=>{if(signal?.aborted)return reject(Error('Stopped'));let output='',buffer='',expired=false;const child=spawn(command,args,{shell:false,windowsHide:true,env:{...process.env,LC_ALL:'C',LANG:'C'}});const kill=()=>child.kill();signal?.addEventListener('abort',kill,{once:true});const timer=setTimeout(()=>{expired=true;kill();},timeout);const finish=()=>{clearTimeout(timer);signal?.removeEventListener('abort',kill);};child.stdout.on('data',b=>{const s=b.toString();output+=s;buffer+=s;let i;while((i=buffer.indexOf('\n'))>=0){onLine(buffer.slice(0,i));buffer=buffer.slice(i+1);}if(output.length>1000000)kill();});child.stderr.on('data',b=>output+=b.toString());child.on('error',e=>{finish();reject(Error(e.code==='ENOENT'?`${command} is missing. Install the OS network utilities; see README.`:e.message));});child.on('close',code=>{finish();if(buffer)onLine(buffer);resolve({code,output,expired});});});
}
