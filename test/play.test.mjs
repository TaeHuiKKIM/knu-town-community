import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyServer } from '../src/server.mjs';
import { walkable } from '../public/campus/world.js';
import * as play from '../public/campus/play.js';

test('the displacement input gate waits until both the animation and server hold finish',()=>{
  assert.equal(typeof play.movementReady,'function');
  assert.equal(play.movementReady({knockback:null,hitUntil:1180},1179),false);
  assert.equal(play.movementReady({knockback:{},hitUntil:1180},1180),false);
  assert.equal(play.movementReady({knockback:null,hitUntil:1180},1180),true);
});

async function setup(t) {
  let clock=100000;
  const server=createStudyServer({roomCode:'play-test',now:()=>clock});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function post(route,data){const r=await fetch(base+'/api/play-test/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};}
  const a=(await post('join',{name:'크누',avatar:'male'})).data,b=(await post('join',{name:'누리',avatar:'female',coat:'forest'})).data;
  return {base,post,a,b,advance(ms){clock+=ms;},async state(){return (await post('resume',{session:a.session})).data.state;}};
}

test('a nearby friend is pushed once and a shared impact event reaches the other player over SSE',async t=>{
  const {base,post,a,b,state}=await setup(t);
  const stream=await fetch(base+'/api/play-test/events?session='+b.session),reader=stream.body.getReader();
  t.after(()=>reader.cancel().catch(()=>{}));
  await reader.read();
  const before=(await state()).players.find(p=>p.id===b.id);
  const hit=await post('action',{session:a.session,type:'bump',targetId:b.id});
  assert.equal(hit.status,200);
  const eventState=JSON.parse(new TextDecoder().decode((await reader.read()).value).split('data: ')[1].split('\n\n')[0]);
  const after=eventState.players.find(p=>p.id===b.id),event=eventState.impacts.at(-1);
  assert.equal(event.attackerId,a.id);assert.equal(event.targetId,b.id);assert.ok(event.id);
  assert.equal(after.avatar,'female');assert.equal(after.coat,'forest');
  assert.equal(after.campus.positionRevision,1);assert.equal(after.campus.motion,'idle');
  assert.ok(Math.hypot(after.campus.x-before.campus.x,after.campus.y-before.campus.y)>25);
  assert.ok(Math.hypot(after.campus.x-before.campus.x,after.campus.y-before.campus.y)<=36.01);
  assert.equal(walkable(after.campus.x,after.campus.y),true);
  assert.equal(JSON.stringify(eventState).includes(a.session),false);
});

test('range, self, missing players and foreign sessions cannot create an impact or move another player',async t=>{
  const {post,a,b,state}=await setup(t);
  for(const payload of [{session:a.session,targetId:a.id},{session:a.session,targetId:'missing'},{session:'foreign',targetId:b.id}]){
    assert.notEqual((await post('action',{type:'bump',...payload})).status,200);
  }
  await post('action',{session:b.session,type:'campus-move',x:300,y:850,facing:'south',motion:'idle'});
  assert.equal((await post('action',{session:a.session,type:'bump',targetId:b.id})).status,409);
  assert.equal((await state()).impacts.length,0);
});

test('attack cooldown and victim grace prevent repeat hits; opting out or studying prevents either side playing',async t=>{
  const {post,a,b,state,advance}=await setup(t),hit=()=>post('action',{session:a.session,type:'bump',targetId:b.id});
  assert.equal((await hit()).status,200);
  assert.equal((await hit()).status,429);
  advance(800);assert.equal((await hit()).status,409);
  advance(201);
  assert.equal((await post('action',{session:b.session,type:'playful',enabled:false})).status,200);
  assert.equal((await hit()).status,409);
  assert.equal((await state()).players.find(p=>p.id===b.id).playful,false);
  assert.equal((await post('action',{session:b.session,type:'bump',targetId:a.id})).status,409);
  await post('action',{session:b.session,type:'playful',enabled:true});
  await post('action',{session:b.session,type:'seat',seat:0});
  await post('action',{session:b.session,type:'focus',focus:true});
  assert.equal((await hit()).status,409);
  assert.equal((await post('action',{session:b.session,type:'bump',targetId:a.id})).status,409);
  assert.equal((await post('action',{session:a.session,type:'playful',enabled:'yes'})).status,400);
});

test('knockback checks its full short path and stale movement cannot undo the correction',async t=>{
  const {post,a,b,state,advance}=await setup(t);
  await post('action',{session:a.session,type:'campus-move',x:250,y:700,facing:'west',motion:'idle'});
  await post('action',{session:b.session,type:'campus-move',x:214,y:700,facing:'east',motion:'idle'});
  assert.equal((await post('action',{session:a.session,type:'bump',targetId:b.id})).status,200);
  const pushed=(await state()).players.find(p=>p.id===b.id).campus;
  assert.ok(pushed.x<=214&&pushed.x>210);assert.equal(walkable(pushed.x,pushed.y),true);
  const stale={session:b.session,type:'campus-move',x:214,y:700,facing:'east',motion:'walk',positionRevision:0};
  assert.equal((await post('action',stale)).status,409);
  advance(181);
  assert.equal((await post('action',stale)).status,409);
  const moved=await post('action',{...stale,x:230,positionRevision:pushed.positionRevision});assert.equal(moved.status,200);
  assert.equal((await state()).players.find(p=>p.id===b.id).campus.x,230);
});
