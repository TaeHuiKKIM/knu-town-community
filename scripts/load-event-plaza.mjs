// Bounded loopback exercise. The driver cannot target an existing room or database.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setTimeout as wait } from 'node:timers/promises';
import { createStudyServer } from '../src/server.mjs';
import { walkable } from '../public/campus/world.js';
import { applyMovement } from '../public/campus/network.js';

if (process.argv[2] === '--child') {
  const server = createStudyServer({ hub:true, roomCode:'main', studyPath:':memory:', tutor:null });
  const delay = monitorEventLoopDelay({resolution:10});
  delay.enable();
  let cpu;
  server.listen(0, '127.0.0.1', () => process.send({port:server.address().port}));
  process.on('message', command => {
    if (command === 'sample') {
      const used = process.cpuUsage(cpu); cpu = process.cpuUsage();
      process.send({...server.metrics, cpuMs:(used.user+used.system)/1000, lagP99:delay.percentile(99)/1e6});
      delay.reset();
    }
  });
} else {
  const seconds=Number(process.argv[2] ?? 10);
  assert.ok(Number.isInteger(seconds) && seconds >= 2 && seconds <= 30, 'Use 2–30 seconds per scenario');
  await run(seconds);
}

async function until(check,label) {
  const limit=performance.now()+6000;
  while (!check()) {
    if (performance.now()>limit) throw Error('Timed out waiting for '+label);
    await wait(15);
  }
}

function subscribe(base,peer) {
  peer.ready=false; peer.ended=false; peer.frames=0;
  const req=http.get(base+'/api/main/events?view=campus&moves=1&session='+peer.session,res=>{
    assert.equal(res.statusCode,200);
    res.setEncoding('utf8');
    let buffer='';
    res.on('data',chunk=>{
      buffer+=chunk;
      for(let end=buffer.indexOf('\n\n');end>=0;end=buffer.indexOf('\n\n')) {
        const frame=buffer.slice(0,end);
        buffer=buffer.slice(end+2);
        if(!frame.startsWith('data: ')) continue;
        const data=JSON.parse(frame.slice(6));
        peer.state=data.moves ? applyMovement(peer.state,data) : data;
        peer.ready=true; peer.frames++;
      }
    });
    res.on('close',()=>{peer.ended=true;});
    res.on('error',()=>{peer.ended=true;});
  });
  req.on('error',()=>{peer.ended=true;});
  peer.request=req;
}

async function run(seconds) {
  const host=fork(fileURLToPath(import.meta.url),['--child'],{stdio:['ignore','ignore','inherit','ipc']});
  const peers=[];
  try {
    const [{port}]=await once(host,'message');
    const base='http://127.0.0.1:'+port;
    async function sample() {
      const reply=once(host,'message');
      host.send('sample');return (await reply)[0];
    }
    async function post(path,data,status=200) {
      const response=await fetch(base+'/api/main/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(6000)});
      assert.equal(response.status,status);
      return response.json();
    }
    const join=i=>post('join',{name:'event-'+i,profileKey:i.toString(16).padStart(64,'0')});
    const action=(p,data)=>post('action',{session:p.session,...data});
    const signup=performance.now();
    for(let batch=0;batch<10;batch++) {
      const joined=await Promise.all(Array.from({length:10},(_,index)=>join(batch*10+index+1)));
      for(const {session,id} of joined){const p={session,id};peers.push(p);subscribe(base,p);}
      await until(()=>peers.every(p=>p.ready&&!p.ended),'initial SSE in batch '+batch);
    }
    await until(()=>peers.every(p=>p.state.players.length===100&&!p.ended),'100 complete rosters');
    await post('join',{name:'overflow',profileKey:'f'.repeat(64)},409);
    console.log(JSON.stringify({simultaneousStreams:peers.length,joinWaveMs:Math.round(performance.now()-signup),overflowStatus:409}));
    const floor=[];
    for(let y=580;floor.length<100;y+=12)for(let x=480;x<900&&floor.length<100;x+=13){
      if(walkable(x,y)&&walkable(x+2,y))floor.push({x,y});
    }
    for(const movers of [10,100]) {
      const before=await sample();
      const timings=[],frameCounts=peers.map(p=>p.frames),started=performance.now();
      for(let round=0;round<seconds*8;round++){
        await Promise.all(peers.slice(0,movers).map(async(p,i)=>{
          const at=performance.now();
          await action(p,{type:'campus-move',x:floor[i].x+2*(round%2),y:floor[i].y,facing:'east',motion:'walk'});
          timings.push(performance.now()-at);
        }));
        await wait(Math.max(0,started+(round+1)*125-performance.now()));
      }
      await until(()=>peers.every(p=>!p.ended&&p.frames>frameCounts[peers.indexOf(p)]&&
        p.state.players.find(v=>v.id===peers[0].id)?.campus.x===floor[0].x+2),'movement received by all');
      const end=await sample(),elapsed=(performance.now()-started)/1000;
      timings.sort((a,b)=>a-b);
      console.log(JSON.stringify({streams:100,movers,seconds:+elapsed.toFixed(2),successfulActions:timings.length,
        postP95ms:+timings[Math.floor(timings.length*.95)].toFixed(1),
        outboundMbitPerSec:+((end.bytesSent-before.bytesSent)*8/1e6/elapsed).toFixed(2),
        serverCpuOneCorePct:+(end.cpuMs/10/elapsed).toFixed(1),serverLoopP99ms:+end.lagP99.toFixed(1),
        receivedStreams:peers.filter(p=>!p.ended&&p.frames>frameCounts[peers.indexOf(p)]).length}));
    }
    await action(peers[0],{type:'chat',text:'event-check'});
    const hasChat=p=>p.state.messages.some(m=>m.text==='event-check'&&m.playerId===peers[0].id);
    await until(()=>peers.every(p=>hasChat(p)&&!p.ended),'chat delivered to 100');
    const last=peers.pop();
    await action(last,{type:'leave'});
    last.request.destroy();
    await until(()=>peers.every(p=>p.state.players.length===99),'leave received by 99');
    const joined=await join(101),late={session:joined.session,id:joined.id};
    peers.push(late);subscribe(base,late);
    await until(()=>peers.every(p=>p.ready&&!p.ended&&p.state.players.length===100&&hasChat(p)),'late entry');
    console.log(JSON.stringify({chatReceived:100,replacedOneParticipant:true,lateRoster:late.state.players.length,lateChat:true}));
  } finally {
    for(const p of peers)p.request?.destroy();
    host.kill();
  }
}
