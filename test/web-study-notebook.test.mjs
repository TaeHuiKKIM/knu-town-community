import test from "node:test";
import assert from "node:assert/strict";
import {indexedDB,IDBFactory} from "fake-indexeddb";
import {initialNotebook,changeNotebook,openNotebook} from "../online/study-notebook.js";
import {CHECK_MS} from "../public/campus/study-time.js";
import {summary,serializeBackup} from "../public/campus/local-data.js";
import {chairs} from "../online/lounge.js";
import {gateRoute} from "../online/gate-route.js";
import {seatApproach,furnitureBlocked} from "../public/campus/furniture.js";
import {walkable} from "../public/campus/world.js";
const profile={name:"학생",avatar:"female",coat:"forest"};
const start={type:"start",subject:"컴퓨터 구조",goal:"캐시 문제 풀이"};
test("wardrobe saves travel with a web backup and old local appearances migrate only once",async()=>{
  const oldDb=globalThis.indexedDB;
  globalThis.indexedDB=new IDBFactory();
  try{
    const db=await new Promise(resolve=>{
      const request=globalThis.indexedDB.open("knu-web-study",1);
      request.onupgradeneeded=()=>request.result.createObjectStore("study");
      request.onsuccess=()=>resolve(request.result);
    });
    const legacy=initialNotebook(profile);delete legacy.appearanceSaved;
    await new Promise(resolve=>{const tx=db.transaction("study","readwrite");tx.objectStore("study").put(legacy,"notebook");tx.oncomplete=resolve;});
    db.close();
    const look={name:"새 닉네임",avatar:"male",coat:"navy",style:null};
    const write=await openNotebook(profile,look);
    assert.equal((await write()).archive.profile.name,look.name);
    const updated=await write({type:"appearance",appearance:{...look,coat:"cse"}});
    assert.equal(updated.archive.profile.coat,"cse");
    const restored=changeNotebook(initialNotebook(profile),{type:"import",text:serializeBackup(updated.archive)});
    assert.deepEqual(restored.archive.profile,updated.archive.profile);
    const second=await openNotebook(profile,look);
    assert.equal((await second()).archive.profile.coat,"cse");
  }finally{globalThis.indexedDB=oldDb;}
});
test("web confirms at most 90 minutes, rejects repeated confirmation and uses LAN rewards",()=>{
  const at=Date.now()-3*CHECK_MS;
  let book=changeNotebook(initialNotebook(profile),start,at);
  const confirm={type:"confirm",segment:book.active.segment,note:"캐시 문제 풀이 완료",more:true};
  book=changeNotebook(book,confirm,at+2*CHECK_MS);
  assert.equal(summary(book.archive).totalMs,CHECK_MS);
  assert.equal(summary(book.archive).balance,9);
  assert.throws(()=>changeNotebook(book,confirm));
  book=changeNotebook(book,{type:"outfit-box"});
  assert.equal(summary(book.archive).balance,1);
  const style=summary(book.archive).ownedItemIds.includes("wear-ash")?"female-ash":"female-offshoulder";
  book=changeNotebook(book,{type:"appearance",appearance:{name:"독서",avatar:"female",coat:"cse",style}});
  const imported=changeNotebook(initialNotebook(profile),{type:"import",text:serializeBackup(book.archive)});
  assert.deepEqual(imported.archive.records,book.archive.records);
  assert.deepEqual(imported.archive.profile,book.archive.profile);
  assert.equal(summary(imported.archive).balance,1);
});
test("competing tabs confirm one record and reopening retains it",async()=>{
  globalThis.indexedDB=indexedDB;
  const [a,b]=await Promise.all([openNotebook(profile),openNotebook(profile)]);
  const first=await a(start);
  const op={type:"confirm",note:"문제 완료",segment:first.active.segment,more:false};
  const attempts=await Promise.allSettled([a(op),b(op)]);
  assert.equal(attempts.filter(r=>r.status==="fulfilled").length,1);
  const read=await openNotebook(profile);
  assert.equal((await read()).archive.records.length,1);
});
test("all 30 team lounge chairs are reachable from the plaza door",()=>{
  assert.equal(chairs.length,30);
  for(const seat of chairs){
    assert.equal(walkable(seat.x,seat.y,"lounge"),false,seat.table.id);
    const approach=seatApproach(seat);
    assert.ok(walkable(approach.x,approach.y,"lounge"),seat.table.id);
    assert.ok(gateRoute({x:690,y:848},approach,(x,y)=>walkable(x,y,"lounge")).length,seat.table.id);
  }
});
test("sofa bodies block walking while each seat remains approachable from the front",()=>{
  for(const seat of chairs.filter(c=>c.table.kind==="sofa")){
    for(const offset of [-50,-20,0])assert.ok(furnitureBlocked("lounge",seat.x,seat.y+offset));
    assert.equal(furnitureBlocked("lounge",seat.x,seat.y+18),false);
  }
});

test("web seat IDs keep library and outdoor seats from earlier clients in the same order",async()=>{
  const {campusSeats}=await import("../online/campus-seats.js");
  assert.deepEqual(campusSeats.slice(0,30).map(s=>s.scene),Array(30).fill("lounge"));
  assert.deepEqual(campusSeats.slice(30,38).map(s=>s.table.id),
    ["plaza-west","plaza-west","plaza-south","plaza-south","ginkgo-west","ginkgo-west","ginkgo-east","ginkgo-east"]);
  assert.equal(campusSeats.slice(38).length,12);
  assert.ok(campusSeats.slice(38).every(s=>s.table.kind==="pond-bench"&&s.scene==="plaza"));
});
