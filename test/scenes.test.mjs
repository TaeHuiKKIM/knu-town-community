import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudyServer} from '../src/server.mjs';
import {walkable,freeSpawn} from '../public/campus/world.js';
import {SCENES,sceneInfo,arrivalFrom} from '../public/campus/scenes.js';
import {furnitureSeats,seatApproach} from '../public/campus/furniture.js';

test('all six areas have valid entrances, destinations and 32 distinct floor spawns',()=>{
  assert.deepEqual(Object.keys(SCENES),['plaza','ginkgo','lounge','it','it4','lecture']);
  for(const id of ['unknown','__proto__','constructor','toString',['plaza'],null])assert.equal(sceneInfo(id),null,'only explicit scene IDs are accepted');
  for(const scene of Object.values(SCENES)){
    assert.ok(walkable(scene.spawn.x,scene.spawn.y,scene.id));
    for(const gate of scene.portals){assert.ok(walkable(gate.x,gate.y,scene.id),`${scene.id} gate`);assert.ok(SCENES[gate.target]);}
    const points=[];for(let i=0;i<32;i++){const p=freeSpawn(points,scene.id);assert.ok(walkable(p.x,p.y,scene.id));assert.ok(points.every(q=>Math.hypot(q.x-p.x,q.y-p.y)>=60));points.push(p);}
  }
  assert.equal(walkable(420,320,'ginkgo'),false);assert.equal(walkable(760,650,'ginkgo'),true);
  assert.equal(walkable(160,500,'lounge'),false);assert.equal(walkable(760,650,'lounge'),true);
  // Ginkgo trunks stand right beside the avenue that narrows toward the North Gate.
  assert.equal(walkable(560,300,'ginkgo'),false);assert.equal(walkable(765,300,'ginkgo'),true);assert.equal(walkable(330,880,'ginkgo'),false);
  // IT forecourt: the building, its planters and the lawn corners stay out of reach.
  assert.equal(walkable(768,420,'it'),false);assert.equal(walkable(768,700,'it'),true);assert.equal(walkable(100,950,'it'),false);assert.equal(walkable(40,680,'it'),true);
  assert.equal(walkable(768,420,'it4'),false);assert.equal(walkable(1230,800,'it4'),true);
  for(const [from,to] of [['plaza','it'],['it','plaza'],['ginkgo','it'],['it','ginkgo'],['it','it4'],['it4','it'],['it4','lecture'],['lecture','it4']]){const p=arrivalFrom(from,to);assert.ok(p&&walkable(p.x,p.y,to),`${from} to ${to} arrival`);}
});

test('area travel keeps identity and outfit, isolates hits and rejects stale movement/study travel',async t=>{
  const server=createStudyServer({hub:true,roomCode:'main'});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,data)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
  const key='a'.repeat(64),a=(await post('/api/main/join',{name:'산책친구',avatar:'female',coat:'forest',profileKey:key})).data;
  const b=(await post('/api/main/join',{name:'광장친구',profileKey:'b'.repeat(64)})).data;
  const action=data=>post('/api/main/action',{session:a.session,...data});
  for(const scene of ['unknown','__proto__','constructor','toString',['plaza']])assert.equal((await action({type:'scene',scene})).status,400);
  assert.equal((await action({type:'scene',scene:'lounge',via:'plaza-library'})).status,409,'distant gate cannot be used as a nearby entrance');
  assert.equal((await action({type:'scene',scene:'ginkgo'})).status,200);
  let mine=(await post('/api/main/resume',{session:a.session})).data.state.players.find(p=>p.id===a.id);
  assert.equal(mine.avatar,'female');assert.equal(mine.coat,'forest');assert.equal(mine.campus.scene,'ginkgo');assert.equal(mine.campus.positionRevision,1);
  assert.equal((await action({type:'scene',scene:'ginkgo'})).status,200);
  assert.equal((await action({type:'campus-move',x:700,y:600,facing:'east',motion:'walk',positionRevision:0})).data.code,'STALE_MOVE');
  assert.equal((await post('/api/main/action',{session:b.session,type:'bump',targetId:a.id})).status,409);
  assert.equal((await action({type:'campus-move',x:420,y:320,facing:'east',motion:'walk',positionRevision:1})).status,400);
  assert.equal((await action({type:'scene',scene:'lounge'})).status,200);
  assert.equal((await action({type:'bump',targetId:b.id})).status,409);
  await post('/api/study/start',{profileKey:key,subject:'자료구조',goal:'기출 문제 풀이'});
  assert.equal((await action({type:'scene',scene:'plaza'})).data.code,'STUDY_ACTIVE');
});

test('travelling does not reset the victim protection or attacker cooldown',async t=>{
  let at=100000;const server=createStudyServer({roomCode:'safety',now:()=>at});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}/api/safety/`,post=async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
  const a=(await post('join',{name:'A'})).data,b=(await post('join',{name:'B'})).data,c=(await post('join',{name:'C'})).data;
  assert.equal((await post('action',{session:a.session,type:'bump',targetId:b.id})).status,200);at+=181;
  await post('action',{session:b.session,type:'scene',scene:'ginkgo'});
  await post('action',{session:a.session,type:'scene',scene:'ginkgo'});
  let state=(await post('resume',{session:b.session})).data.state;
  assert.equal(state.players.find(p=>p.id===b.id).campus.hitAt,100000);
  assert.equal(state.players.find(p=>p.id===a.id).campus.attackAt,100000);
  await post('action',{session:c.session,type:'scene',scene:'ginkgo'});
  const victim=state.players.find(p=>p.id===b.id).campus;
  await post('action',{session:c.session,type:'campus-move',x:victim.x+30,y:victim.y,facing:'west',motion:'idle',positionRevision:1});
  assert.equal((await post('action',{session:c.session,type:'bump',targetId:b.id})).status,409);
  at+=1000;assert.equal((await post('action',{session:c.session,type:'bump',targetId:b.id})).status,200);
});

test('paired entrances land on walkable ground beyond the return threshold',()=>{
  for(const from of Object.values(SCENES)){
    for(const gate of from.portals){
      const arrival=arrivalFrom(from.id,gate.target);
      const reverse=SCENES[gate.target].portals.find(g=>g.target===from.id);
      assert.ok(walkable(arrival.x,arrival.y,gate.target));
      const distance=Math.hypot(arrival.x-reverse.x,arrival.y-reverse.y);
      assert.ok(distance>22 && distance<80);
    }
  }
});

test('수업중 can only start on the IT5 forecourt and ends when the student leaves it',async t=>{
  const server=createStudyServer({hub:true,roomCode:'main'});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,data)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
  const a=(await post('/api/main/join',{name:'수업친구',profileKey:'c'.repeat(64)})).data;
  const action=data=>post('/api/main/action',{session:a.session,...data});
  const mine=async()=>(await post('/api/main/resume',{session:a.session})).data.state.players.find(p=>p.id===a.id);
  assert.equal((await action({type:'class',on:true})).data.code,'CLASS_PLACE','not in the plaza');
  assert.equal((await action({type:'class',on:'yes'})).status,400);
  assert.equal((await action({type:'scene',scene:'it'})).status,200);
  assert.equal((await action({type:'class',on:true})).status,200);
  assert.equal((await mine()).inClass,true);
  assert.equal((await action({type:'scene',scene:'it4'})).status,200);
  assert.equal((await mine()).inClass,false,'leaving IT5 ends the class');
  assert.equal((await action({type:'class',on:true})).data.code,'CLASS_PLACE','not in IT4 either');
});

test('the IT4 lecture room has 8 desks with 3 chairs each, all reachable from its door',()=>{
  const seats=furnitureSeats('lecture');
  assert.equal(seats.length,24);assert.equal(new Set(seats.map(s=>s.id.replace(/-\d+$/,''))).size,8);
  assert.ok(seats.every(s=>s.chair&&s.facing==='north'),'everyone faces the chalkboard');
  // Flood fill the walkable floor from the door on a 10px grid.
  const start=arrivalFrom('it4','lecture'),seen=new Set(),queue=[[Math.round(start.x/10),Math.round(start.y/10)]];
  while(queue.length){const [x,y]=queue.pop(),k=x+','+y;if(seen.has(k)||!walkable(x*10,y*10,'lecture'))continue;seen.add(k);queue.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);}
  for(const seat of seats){const a=seatApproach(seat);assert.ok(walkable(a.x,a.y,'lecture'),seat.id);
    assert.ok([[0,0],[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy])=>seen.has((Math.round(a.x/10)+dx)+','+(Math.round(a.y/10)+dy))),seat.id+' reachable');}
});
