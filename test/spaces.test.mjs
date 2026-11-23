import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyServer } from '../src/server.mjs';
import { walkable } from '../public/campus/world.js';

async function fixture(t){
  let at=100000;const server=createStudyServer({hub:true,roomCode:'main',studyPath:':memory:',now:()=>at});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,data)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
  const key=n=>n.toString(16).padStart(64,'0'),join=(n,code='main')=>post(`/api/${code}/join`,{name:'학생'+n,profileKey:key(n)});
  return {base,server,post,key,join,advance(ms){at+=ms;}};
}

test('the LAN main plaza accepts 100 valid distinct spawns; friend plazas are bounded and data/actions stay isolated',async t=>{
  const {post,key,join}=await fixture(t);const a=(await join(1)).data;
  const made=await post('/api/hub/rooms/create',{profileKey:key(1),name:'우리 과 광장',mode:'free',capacity:16});assert.equal(made.status,200);
  const code=made.data.room.code,b=(await join(2,code)).data;
  const main=(await post('/api/main/resume',{session:a.session})).data.state;
  assert.equal(main.capacity,100);assert.equal(main.players.length,1);
  assert.equal((await post('/api/main/action',{session:a.session,type:'bump',targetId:b.id})).status,409);
  await post('/api/main/action',{session:a.session,type:'chat',text:'메인에서만'});
  const friend=(await post(`/api/${code}/resume`,{session:b.session})).data.state;
  assert.equal(friend.messages.length,0);assert.equal(friend.players.length,1);assert.equal(friend.capacity,16);
  assert.equal((await post(`/api/${code}/action`,{session:a.session,type:'wave'})).status,401);
  const list=await post('/api/hub/rooms/list',{profileKey:key(2)});assert.ok(list.data.rooms.some(r=>r.code===code));
  for(let n=3;n<=101;n++)assert.equal((await join(n)).status,200);
  assert.equal((await join(102)).status,409);
  const full=(await post('/api/main/resume',{session:a.session})).data.state;
  assert.equal(new Set(full.players.map(p=>`${p.campus.x},${p.campus.y}`)).size,100);
  assert.ok(full.players.every(p=>walkable(p.campus.x,p.campus.y)));
  assert.ok(full.players.every(p=>p.x>=35 && p.x<=785 && p.y>=70 && p.y<=485));
  assert.equal(JSON.stringify(full).includes(key(1)),false);
});

test('study start blocks movement and bumps, confirmation alone updates shared rankings, and room changes keep one profile session',async t=>{
  const {post,key,join,advance}=await fixture(t);const a=(await join(1)).data,b=(await join(2)).data;
  const started=await post('/api/study/start',{profileKey:key(1),subject:'자료구조',goal:'트리 문제 풀기'});assert.equal(started.status,200);
  assert.equal((await post('/api/main/action',{session:a.session,type:'campus-move',x:600,y:600,facing:'west',motion:'walk'})).status,409);
  assert.equal((await post('/api/main/action',{session:b.session,type:'bump',targetId:a.id})).status,409);
  // Legacy controls must not cancel the persistent session or remove hit protection.
  for(const action of [{type:'focus',focus:false},{type:'move',x:600,y:400},{type:'seat',seat:0}]){
    assert.equal((await post('/api/main/action',{session:a.session,...action})).status,409);
  }
  advance(10*60000);
  assert.equal((await post('/api/study/ranking',{profileKey:key(1),scope:'today'})).data.rows.length,0);
  const active=started.data.study.active;
  const confirmed=await post('/api/study/confirm',{profileKey:key(1),sessionId:active.id,segmentStartAt:active.segmentStartAt,requestId:'c'.repeat(32),note:'트리 순회 5문제 풀이',stop:false});assert.equal(confirmed.status,200);
  assert.equal(confirmed.data.study.todayMs,10*60000);
  assert.equal((await post('/api/study/ranking',{profileKey:key(1),scope:'today'})).data.rows[0].ms,10*60000);
  const made=await post('/api/hub/rooms/create',{profileKey:key(1),name:'공부 광장',mode:'study'}),next=(await join(1,made.data.room.code)).data;
  assert.equal((await post('/api/study/me',{profileKey:key(1)})).data.study.active.id,active.id);
  const state=(await post(`/api/${made.data.room.code}/resume`,{session:next.session})).data.state;
  assert.equal(state.players[0].study.subject,'자료구조');assert.equal(state.room.mode,'study');
  assert.equal(JSON.stringify(state).includes('트리 문제 풀기'),false);
});

test('movement is batched and study-only streams skip movement but receive chat/state changes',async t=>{
  const {base,server,post,join}=await fixture(t);const a=(await join(1)).data;
  const controller=new AbortController();t.after(()=>controller.abort());
  const open=async view=>{const r=await fetch(base+`/api/main/events?session=${a.session}&view=${view}`,{signal:controller.signal});const reader=r.body.getReader();await reader.read();return reader;};
  const normal=await open('campus');
  const b=(await join(2)).data;
  const r=await fetch(base+`/api/main/events?session=${b.session}&view=study`,{signal:controller.signal}),focused=r.body.getReader();await focused.read();
  const before=server.metrics.movementBroadcasts;
  for(let i=0;i<8;i++)await post('/api/main/action',{session:a.session,type:'campus-move',x:600+i,y:600,facing:'east',motion:'walk'});
  await new Promise(resolve=>setTimeout(resolve,160));
  assert.ok(server.metrics.movementBroadcasts-before<=2);
  const waiting=focused.read();assert.equal(await Promise.race([waiting.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),80))]),false);
  await post('/api/main/action',{session:a.session,type:'chat',text:'집중 화면에도 도착'});
  const event=await waiting;assert.match(new TextDecoder().decode(event.value),/집중 화면에도 도착/);
  await normal.cancel();await focused.cancel();
});

test('a room transfer is atomic, retries reuse the receipt, and a full destination keeps the original participant',async t=>{
  const {post,key,join}=await fixture(t),a=(await join(1)).data;
  const code=(await post('/api/hub/rooms/create',{profileKey:key(1),name:'두 명 광장',capacity:2})).data.room.code;
  const payload={session:a.session,type:'transfer',targetCode:code,transferKey:'d'.repeat(32)};
  const moved=await post('/api/main/action',payload);assert.equal(moved.status,200);
  const retry=await post('/api/main/action',payload);assert.equal(retry.data.session,moved.data.session);
  assert.equal((await post('/api/main/resume',{session:a.session})).status,401);
  assert.equal((await post(`/api/${code}/resume`,{session:moved.data.session})).data.state.players.length,1);
  await join(2,code);const c=(await join(3)).data;
  assert.equal((await post('/api/main/action',{session:c.session,type:'transfer',targetCode:code,transferKey:'e'.repeat(32)})).status,409);
  assert.equal((await post('/api/main/resume',{session:c.session})).status,200);
});

test('64 hall readers compete for seats and release them when transferring rooms',async t=>{
  const {post,key,join}=await fixture(t);
  const code='reading-hall';
  const readers=[];
  for(let index=1;index<=64;index++){
    const reply=await join(index,code);
    assert.equal(reply.status,200);
    readers.push(reply.data);
  }
  assert.equal((await join(65,code)).status,409);
  const reserve=(i,desk)=>post('/api/'+code+'/action',{type:'reading-desk',session:readers[i].session,desk});
  const race=await Promise.all([reserve(0,64),reserve(1,64)]);
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  const winner=race.findIndex(r=>r.status===200);
  assert.equal((await reserve(winner,65)).status,400);
  const moved=await post('/api/'+code+'/action',{type:'transfer',session:readers[winner].session,targetCode:'main',transferKey:'a'.repeat(32)});
  assert.equal(moved.status,200);
  assert.equal((await reserve(1-winner,64)).status,200);
  const study=await post('/api/study/start',{profileKey:key(2-winner),subject:'전공',goal:'자료구조 읽기'});
  assert.equal(study.status,200);
  assert.equal((await reserve(1-winner,5)).status,409);
});

test('furniture seats are scene-local, exclusive, and released when standing or changing scenes',async t=>{
  const {base,post,join}=await fixture(t);
  assert.equal((await fetch(base+'/campus/furniture.js')).status,200);
  const {furnitureSeats,seatApproach}=await import('../public/campus/furniture.js');
  const a=(await join(1)).data,b=(await join(2)).data;
  const action=(player,data)=>post('/api/main/action',{session:player.session,...data});
  const position=async player=>(await post('/api/main/resume',{session:player.session})).data.state.players.find(p=>p.id===player.id).campus;
  for(const scene of ['plaza','ginkgo','lounge']){
    if(scene!=='plaza'){
      for(const player of [a,b])assert.equal((await action(player,{type:'scene',scene})).status,200);
    }
    const seats=furnitureSeats(scene);
    assert.equal(seats.length,scene==='lounge'?30:scene==='plaza'?16:4);
    assert.ok(seats.every(seat=>!walkable(seat.x,seat.y,scene)));
    if(scene==='lounge')assert.deepEqual(new Set(seats.filter(seat=>seat.chair).map(seat=>seat.facing)),new Set(['north','south']));
    const seat=seats[0],aRevision=(await position(a)).positionRevision,bRevision=(await position(b)).positionRevision;
    const sit=(player,id,positionRevision)=>action(player,{type:'furniture-seat',seat:id,scene,positionRevision});
    const move=(player,positionRevision)=>action(player,{type:'campus-move',scene,...seatApproach(seat),facing:'south',motion:'walk',positionRevision});
    assert.equal((await sit(b,seat.id,bRevision)).status,409);
    assert.equal((await action(a,{type:'campus-move',scene,x:seat.x,y:seat.y,facing:'south',motion:'walk',positionRevision:aRevision})).status,400);
    assert.equal((await move(a,aRevision)).status,200);
    assert.equal((await move(b,bRevision)).status,200);
    assert.equal((await sit(a,seat.id,aRevision)).status,200);
    assert.equal((await position(a)).furnitureSeat,seat.id);
    assert.equal((await move(a,aRevision)).data.code,'STALE_MOVE');
    assert.equal((await move(a,aRevision+1)).data.code,'SEATED');
    assert.equal((await sit(b,seat.id,bRevision)).status,409);
    assert.equal((await sit(a,null,aRevision+1)).status,200);
    const standing=await position(a);
    assert.ok(walkable(standing.x,standing.y,scene));
    assert.equal((await sit(a,seats[1].id,aRevision+2)).status,200);
    assert.equal((await position(a)).furnitureSeat,seats[1].id);
    assert.equal((await sit(b,seat.id,bRevision)).status,200);
  }
  await action(b,{type:'scene',scene:'plaza'});
  assert.equal((await position(b)).furnitureSeat,null);
});

test('friend calendars require current-room consent and expose only KST daily totals',async t=>{
  const {post,key,join,advance}=await fixture(t);
  const month='2026-11';
  const midnight=Date.parse('2026-11-02T00:00:00+09:00');
  advance(midnight-60000-100000);
  const a=(await join(1)).data,b=(await join(2)).data;
  const started=await post('/api/study/start',{profileKey:key(1),subject:'자료구조',goal:'트리 복습'});
  assert.equal(started.status,200);
  const active=started.data.study.active;
  advance(120000);
  const confirmed=await post('/api/study/confirm',{profileKey:key(1),sessionId:active.id,
    segmentStartAt:active.segmentStartAt,requestId:'e'.repeat(32),note:'복습 완료',stop:true});
  assert.equal(confirmed.status,200);
  const share=enabled=>post('/api/main/action',{session:a.session,type:'calendar-sharing',enabled});
  const calendar=session=>post('/api/main/action',{session,type:'friend-calendar',playerId:a.id,month});
  assert.equal((await calendar(b.session)).status,404);
  assert.equal((await share(true)).status,200);
  const result=await calendar(b.session);
  assert.equal(result.status,200);
  assert.deepEqual(result.data,{days:[60000,60000,...Array(28).fill(0)]});
  assert.equal((await calendar('invalid')).status,401);
  assert.equal((await share(false)).status,200);
  assert.equal((await calendar(b.session)).status,404);
});
test('event campus movement patches preserve chat and stationary players, while a new stream starts with complete state', async t => {
  const {base,post,join} = await fixture(t);
  const a=(await join(1)).data, b=(await join(2)).data;
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(base + '/api/main/events?moves=1&session=' + b.session,{signal:controller.signal});
  const reader=response.body.getReader(), decoder=new TextDecoder();
  let buffer='';
  async function next(){
    while(!buffer.includes('\n\n')){ const {value,done}=await reader.read(); assert.ok(!done); buffer+=decoder.decode(value,{stream:true}); }
    const end=buffer.indexOf('\n\n'), data=buffer.slice(0,end); buffer=buffer.slice(end+2);
    if(!data.startsWith('data: '))return next();
    return JSON.parse(data.slice(6));
  }
  const initial=await next();
  assert.equal(initial.players.length,2);
  await post('/api/main/action',{session:a.session,type:'chat',text:'before move'});
  const afterChat=await next();
  await post('/api/main/action',{session:a.session,type:'campus-move',x:600,y:600,facing:'east',motion:'walk'});
  const patch=await next();
  assert.equal(patch.moves.length,1);
  const {applyMovement}=await import('../public/campus/network.js');
  const merged=applyMovement(afterChat,patch);
  assert.equal(merged.players[0].campus.x,600);
  assert.equal(merged.players[1],afterChat.players[1]);
  assert.deepEqual(merged.messages,afterChat.messages);
  assert.deepEqual(merged.players,(await post('/api/main/resume',{session:b.session})).data.state.players);
  await reader.cancel();
});
