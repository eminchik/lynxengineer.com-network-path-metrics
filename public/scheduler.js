// Shared by the real local tool and the hosted simulation. No background service.
globalThis.LynxScheduler = class {
  running=false;
  stop(){this.signal?.abort();this.cancel?.();}
  async start({mode='once',delay=1000,startAt=Date.now(),run,cancel=()=>{},onWait=()=>{},onCycle=()=>{}}){
    if(this.running)throw Error('A loop is already active.');
    if(!['once','continuous','scheduled'].includes(mode)||!Number.isFinite(delay)||delay<0||!Number.isFinite(startAt))throw Error('Invalid schedule.');
    this.running=true;this.signal=new AbortController();this.cancel=cancel;let cycle=0;
    const signal=this.signal.signal;
    const wait=async until=>{while(!signal.aborted&&Date.now()<until){onWait(until);await new Promise(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,Math.min(1000,until-Date.now()));signal.addEventListener('abort',done,{once:true});});}};
    try{if(mode==='scheduled')await wait(startAt);while(!signal.aborted){await run();if(signal.aborted)break;cycle++;const proceed=onCycle(cycle);if(proceed===false||mode==='once')break;await wait(Date.now()+(mode==='continuous'?1000:delay));}}finally{this.running=false;this.cancel=null;}
  }
};
