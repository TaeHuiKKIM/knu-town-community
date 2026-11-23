import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const module=await import('../src/study-store.mjs').catch(()=>({}));
function store(path=':memory:',now=()=>Date.now()){assert.equal(typeof module.StudyStore,'function');return new module.StudyStore(path,{now});}
const key='1'.repeat(64),req=n=>n.toString(16).padStart(32,'0');

test('only confirmed study earns time, a 90-minute unconfirmed segment freezes, and an old retry cannot confirm a new segment',()=>{
  let at=Date.parse('2026-11-18T10:00:00+09:00');const db=store(':memory:',()=>at);
  try{
    const p=db.profile(key,'크누',true),s=db.start(p.id,'전공','자료구조 3장');
    at+=95*60000;assert.equal(db.summary(p.id).todayMs,0);assert.equal(db.summary(p.id).pendingMs,90*60000);assert.equal(db.summary(p.id).active.status,'awaiting');
    const payload={sessionId:s.id,segmentStartAt:s.segmentStartAt,requestId:req(1),note:'트리 순회 문제 10개',stop:false};
    db.confirm(p.id,payload);assert.equal(db.summary(p.id).todayMs,90*60000);
    at+=10000;db.confirm(p.id,payload);assert.equal(db.summary(p.id).todayMs,90*60000);
    const next=db.summary(p.id).active;assert.equal(next.segmentStartAt,at-10000);
    assert.throws(()=>db.confirm(p.id,{...payload,requestId:req(2)}),e=>e.status===409);
  }finally{db.close();}
});

test('early finish requires a study note, uses server time, and duplicate tabs share one study session',()=>{
  let at=100000;const db=store(':memory:',()=>at);
  try{
    const p=db.profile(key,'크누',true),s=db.start(p.id,'영어','단어 30개');
    assert.equal(db.start(p.id,'영어','단어 30개').id,s.id);
    at+=20*60000;
    assert.throws(()=>db.confirm(p.id,{sessionId:s.id,segmentStartAt:s.segmentStartAt,requestId:req(3),note:' ',stop:true}),e=>e.status===400);
    db.confirm(p.id,{sessionId:s.id,segmentStartAt:s.segmentStartAt,requestId:req(3),note:'단어 30개 복습 완료',stop:true,stopAt:at+99999999});
    assert.equal(db.summary(p.id).todayMs,20*60000);assert.equal(db.summary(p.id).active,null);
    const next=db.start(p.id,'영어','새 단어 10개');db.confirm(p.id,{sessionId:s.id,segmentStartAt:s.segmentStartAt,requestId:req(3),note:'단어 30개 복습 완료',stop:true});
    assert.equal(db.summary(p.id).active.id,next.id);
  }finally{db.close();}
});

test('daily and Monday-week rankings split at Korean midnight and expose no study goals, notes or keys',()=>{
  let at=Date.parse('2026-11-15T23:59:50+09:00');const db=store(':memory:',()=>at);
  try{
    const p=db.profile(key,'크누',true),s=db.start(p.id,'전공','비밀목표');at+=20000;
    db.confirm(p.id,{sessionId:s.id,segmentStartAt:s.segmentStartAt,requestId:req(4),note:'비밀공부내용',stop:true});
    assert.equal(db.summary(p.id).todayMs,10000);assert.equal(db.summary(p.id).weekMs,10000);
    const ranks=db.ranking('today');assert.equal(ranks[0].ms,10000);
    const text=JSON.stringify(ranks);for(const secret of [key,'비밀목표','비밀공부내용'])assert.equal(text.includes(secret),false);
  }finally{db.close();}
});

test('SQLite keeps identity, pending study and confirmed history after a server restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'knu-study-')),path=join(dir,'records.sqlite');let at=100000,db=store(path,()=>at);
  try{
    const p=db.profile(key,'크누',true),s=db.start(p.id,'수학','적분 5문제');at+=60000;db.close();db=store(path,()=>at);
    assert.equal(db.profile(key).id,p.id);assert.equal(db.summary(p.id).active.id,s.id);
    db.confirm(p.id,{sessionId:s.id,segmentStartAt:s.segmentStartAt,requestId:req(5),note:'적분 5문제 풀이',stop:true});db.close();db=store(path,()=>at);
    assert.equal(db.summary(p.id).todayMs,60000);
  }finally{db.close();for(const suffix of ['','-wal','-shm'])try{unlinkSync(path+suffix);}catch{}rmdirSync(dir);}
});
