import test from 'node:test';
import assert from 'node:assert/strict';
import {walkingRoute} from '../public/campus/terrain.js';
import { walkable,freeSpawn } from '../public/campus/world.js';
import {sceneFurniture,seatAtPoint,furnitureSeats,seatApproach,nearbyUse,friendInReach} from '../public/campus/furniture.js';
import { createStudyServer } from '../src/server.mjs';

test('plaza planting beds and lamp bases are blocked while the paved approach stays open',()=>{
  for(const [x,y] of [[860,620],[800,700],[220,935],[1020,540],[850,493]])assert.equal(walkable(x,y),false,`obstacle ${x},${y}`);
  for(const [x,y] of [[860,520],[700,600],[600,700],[300,850],[214,700],[800,490],[300,700]])assert.equal(walkable(x,y),true,`pavement ${x},${y}`);
  const positions=[];for(let i=0;i<32;i++){const p=freeSpawn(positions);assert.ok(walkable(p.x,p.y));assert.ok(positions.every(q=>Math.hypot(p.x-q.x,p.y-q.y)>=60));positions.push(p);}
});

test('the HTTP server rejects the same flower beds without changing the player position',async t=>{
  const server=createStudyServer({roomCode:'terrain'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,data)=>{const r=await fetch(base+'/api/terrain/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
  const a=(await post('join',{name:'바닥검사'})).data;
  for(const [x,y]of[[860,620],[800,700],[220,935]])assert.equal((await post('action',{session:a.session,type:'campus-move',x,y,facing:'south',motion:'walk'})).status,400);
  const state=(await post('resume',{session:a.session})).data.state;
  assert.equal(state.players[0].campus.x,860);assert.equal(state.players[0].campus.y,520);
});

test('aisle positions determine the contextual action and occupied seats are skipped',()=>{
  const seats=furnitureSeats('lounge'), free=()=>false;
  assert.equal(nearbyUse('lounge',{x:690,y:848},seats,free).gate.target,'plaza');
  for(const seat of seats){
    const approach=seatApproach(seat);
    assert.equal(nearbyUse('lounge',approach,seats,free).seat.id,seat.id);
    assert.notEqual(nearbyUse('lounge',approach,seats,s=>s.id===seat.id)?.seat?.id,seat.id);
  }
  assert.equal(nearbyUse('plaza',{x:860,y:520},furnitureSeats('plaza'),free),null);
  assert.ok(friendInReach('plaza',{x:860,y:520},{scene:'plaza',x:910,y:520}));
  assert.equal(friendInReach('lounge',{x:860,y:520},{scene:'plaza',x:865,y:520}),false);
});

test('solid furniture in all three scenes can be selected from its illustrated surface',()=>{
  for(const scene of ['plaza','ginkgo','lounge']){
    for(const item of sceneFurniture(scene)){
      assert.equal(walkable(item.x,item.y-14,scene),false,item.id);
      assert.equal(seatAtPoint(scene,item.x,item.y-18)?.item.id,item.id);
    }
  }
});

test('all pond benches have independent seats, paved approaches and a route back to the plaza',()=>{
  const seats=furnitureSeats('plaza').filter(s=>s.kind==='pond-bench');
  assert.equal(seats.length,12);
  const can=(x,y)=>walkable(x,y,'plaza');
  for(const [x,y] of [[1162,694],[1100,751],[1000,675],[1090,550],[801,685]])assert.equal(can(x,y),false);
  const plaza={x:860,y:520}, starts=[plaza,...seats.map(seatApproach)];
  for(const seat of seats){
    const approach=seatApproach(seat);
    assert.equal(walkable(approach.x,approach.y,'plaza',false),false);
    assert.equal(seatAtPoint('plaza',seat.x,seat.y-13).id,seat.id);
    assert.equal(nearbyUse('plaza',approach,seats,()=>false).seat.id,seat.id);
    assert.ok(walkingRoute(approach,plaza,can).length,seat.id+' to plaza');
    for(const start of starts){
      const route=walkingRoute(start,approach,can);
      assert.ok(route.length,seat.id);
      let p=start;
      for(const q of route){
        const steps=Math.ceil(Math.hypot(q.x-p.x,q.y-p.y));
        for(let i=1;i<=steps;i++)assert.ok(can(p.x+(q.x-p.x)*i/steps,p.y+(q.y-p.y)*i/steps),seat.id);
        p=q;
      }
    }
  }
});
