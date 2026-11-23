// Bounded loopback transport smoke test. Driver and server share this process.
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { walkable } from '../public/campus/world.js';
import { createStudyServer } from '../src/server.mjs';

const seconds=Number(process.argv[2]||10);
if(!Number.isFinite(seconds)||seconds<1||seconds>30)throw Error('Use 1–30 seconds per scenario.');
for(const [count,focused] of [[16,0],[32,0],[32,16],[64,64]]){
  const server=createStudyServer({hub:true,roomCode:'main'}),controller=new AbortController();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const room=count===64?'reading-hall':'main';
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,data)=>{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!response.ok)throw Error(`Unexpected HTTP ${response.status}`);return response.json();};
  const paths=[];
  for(let y=600;paths.length<count;y+=35){
    for(let x=500;x<1100&&paths.length<count;x+=35){
      if(walkable(x,y)&&walkable(x+3,y))paths.push({x,y});
    }
  }
  let received=0,errors=0,requests=0;const players=[],reads=[],latencies=[];
  try{
    for(let i=0;i<count;i++){
      const p=await post(`/api/${room}/join`,{name:`load-${i}`,profileKey:i.toString(16).padStart(64,'0')});players.push(p);
      if(count===64)await post(`/api/${room}/action`,{session:p.session,type:'reading-desk',desk:i+1});
      const stream=await fetch(`${base}/api/${room}/events?session=${p.session}&view=${i<focused?'study':'campus'}`,{signal:controller.signal});
      reads.push((async()=>{try{for await(const chunk of stream.body)received+=chunk.byteLength;}catch(error){if(!controller.signal.aborted)throw error;}})());
    }
    await new Promise(resolve=>setTimeout(resolve,150));
    const before={...server.metrics},cpu=process.cpuUsage(),heap=process.memoryUsage().heapUsed,delay=monitorEventLoopDelay({resolution:10});delay.enable();
    const start=performance.now(),rounds=Math.floor(seconds*8);
    for(let n=0;n<rounds;n++){
      if(count!==64)await Promise.all(players.map(async(p,i)=>{const at=performance.now();try{await post(`/api/${room}/action`,{session:p.session,type:'campus-move',x:paths[i].x+(n%2)*3,y:paths[i].y,facing:'east',motion:'walk'});requests++;}catch{errors++;}latencies.push(performance.now()-at);}));
      const remaining=start+(n+1)*125-performance.now();if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
    }
    const elapsed=performance.now()-start,used=process.cpuUsage(cpu);delay.disable();latencies.sort((a,b)=>a-b);
    console.log(JSON.stringify({players:count,focusedStreams:focused,seconds:+(elapsed/1000).toFixed(2),room,requests,errors,postP95ms:latencies.length?+latencies[Math.floor(latencies.length*.95)].toFixed(1):null,movementBroadcasts:server.metrics.movementBroadcasts-before.movementBroadcasts,framesSent:server.metrics.framesSent-before.framesSent,sentMiB:+((server.metrics.bytesSent-before.bytesSent)/1048576).toFixed(2),combinedOneCoreCpuPct:+((used.user+used.system)/elapsed/10).toFixed(1),combinedHeapDeltaMiB:+((process.memoryUsage().heapUsed-heap)/1048576).toFixed(2),eventLoopP99ms:+(delay.percentile(99)/1e6).toFixed(1),maxBufferedBytes:server.metrics.maxBufferedBytes}));
  }finally{controller.abort();await Promise.allSettled(reads);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
