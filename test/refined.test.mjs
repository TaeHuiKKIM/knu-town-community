import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyServer } from '../src/server.mjs';
import { RoomConnection } from '../public/campus/network.js';
import * as world from '../public/campus/world.js';
import { readFile } from 'node:fs/promises';

test('chooses front, back and all diagonal directions, preserving the last idle heading', () => {
  const directions = [[0,1,'south'],[0,-1,'north'],[-1,0,'west'],[1,0,'east'],[-1,1,'southwest'],[1,1,'southeast'],[-1,-1,'northwest'],[1,-1,'northeast']];
  for (const [x,y,name] of directions) assert.equal(world.directionFor(x,y,'south'),name);
  assert.equal(world.directionFor(0,0,'northwest'),'northwest');
  assert.equal(world.spawn(0).facing,'south');
});

test('identical online snapshots do not repeatedly enable busy UI controls', () => {
  const room=new RoomConnection('status-test'), events=[];
  room.addEventListener('status',e=>events.push(e.detail));
  room.status('online'); room.status('online'); room.status('offline'); room.status('online');
  assert.deepEqual(events,['online','offline','online']);
});

test('leaving a disconnected room still closes the local session', async () => {
  const room=new RoomConnection('offline-exit');let closed=false;
  room.me={id:'local-player',session:'local-session'};room.source={close(){closed=true;}};
  room.request=async()=>{throw Error('network unavailable');};
  await room.leave().catch(()=>{});
  assert.equal(room.me,null);assert.equal(room.source,null);assert.equal(closed,true);
});

test('a delayed failure from an old participant cannot expire a new participant', async () => {
  const room=new RoomConnection('late-probe');let rejectProbe;
  room.me={id:'A',session:'session-A'};room.connect=()=>{};
  room.request=async(route,data)=>{
    if(data.type==='ping')return new Promise((_,reject)=>{rejectProbe=reject;});
    if(route==='join')return {id:'B',session:'session-B',state:{players:[{id:'B'}]}};
    return {ok:true};
  };
  const pending=room.probe();await room.leave();await room.join('B','burgundy','female');
  rejectProbe(Object.assign(Error('old session expired'),{status:401}));await pending;
  assert.equal(room.me?.id,'B');assert.equal(room.me?.session,'session-B');
});

test('both runtime characters have eight idle and six-frame walking rows in every coat atlas', async () => {
  const {STUDENTS}=await import('../public/campus/sprites/data.js');
  for(const avatar of world.AVATARS){
    for(const coat of world.COATS){
      const png=await readFile(new URL(`../public/campus/sprites/${avatar}/${coat}.png`,import.meta.url));
      assert.equal(png.subarray(1,4).toString(),'PNG');const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
      const layout=STUDENTS[avatar].frame_layout;
      assert.equal(height,layout.sheetHeight);
      assert.equal(width,layout.sheetWidth);
      for(const [action,count] of [['wave_south',6],['jump_south',6],['study_south',4]]){
        assert.equal(layout.rows[action].length,count);
        assert.ok(layout.rows[action].every(r=>r.x+r.w<=width && r.y+r.h<=height));
      }
      for(const facing of world.DIRECTIONS){
        for(const [pose,count] of [['idle',1],['walk',6]]){
          const row=STUDENTS[avatar].frame_layout.rows[`${pose}_${facing}`];assert.equal(row.length,count,`${avatar}/${facing}/${pose}`);
          for(const r of row){assert.equal(r.w,96);assert.equal(r.h,128);assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=width&&r.y+r.h<=height);}
        }
      }
    }
  }
});

test('female avatar and eight headings persist, while repeated joins reuse one private participant', async t => {
  const server=createStudyServer({roomCode:'refined-test'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(route,data)=>{const r=await fetch(`${base}/api/refined-test/${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
  const joinKey='a'.repeat(32), payload={name:'분수앞여학생',avatar:'female',coat:'navy',joinKey};
  const a=await post('join',payload), retry=await post('join',payload);
  assert.equal(a.status,200); assert.equal(retry.data.id,a.data.id); assert.equal(retry.data.session,a.data.session);
  assert.equal(retry.data.state.players.length,1); assert.equal(retry.data.state.players[0].avatar,'female');
  assert.equal(JSON.stringify(retry.data.state).includes(joinKey),false);
  assert.equal((await post('join',{name:'오류',avatar:'unknown'})).status,400);
  for(const facing of ['south','north','east','west','southeast','southwest','northeast','northwest']) {
    assert.equal((await post('action',{session:a.data.session,type:'campus-move',x:700,y:600,facing,motion:'walk'})).status,200,facing);
  }
  const resumed=await post('resume',{session:a.data.session});
  assert.equal(resumed.data.state.players[0].avatar,'female');
  assert.equal(resumed.data.state.players[0].campus.facing,'northwest');
  const stale=await fetch(base+'/r/expired-room'); assert.equal(stale.status,404);
  assert.match(stale.headers.get('content-type'),/text\/html/);
  assert.match(await stale.text(),/현재 광장/);
});
