import test from 'node:test';
import assert from 'node:assert/strict';
import { StudyUI } from '../public/campus/study.js';
import { CopyCheckpoint } from '../public/campus/local-checkpoint.js';
import { ArchiveSync } from '../public/campus/local-sync.js';

test('a newer completed refresh prevents an older checkpoint from clearing active study or starting a copy',async()=>{
  const old=globalThis.document,fields=new Map();globalThis.document={getElementById(id){if(!fields.has(id))fields.set(id,{});return fields.get(id);}};
  try{
    const key='a'.repeat(64),archive={sourceId:'3e0fa72d-35d3-4c5d-8ef7-e3c2e3f85da0',cursor:0};
    const vault={state:{profile:{key}},generation:1,cursor:()=>0};
    const study=Object.create(StudyUI.prototype);Object.assign(study,{data:{active:null},version:0,busy:false,refreshing:false,pendingKey:'checkpoint-race',accept(data){this.data=data;}});
    let releaseOld,calls=0,copied=false;
    const room={profileKey:key,me:{id:'me'},online:true,service:async()=>++calls===1?new Promise(resolve=>releaseOld=resolve):{study:{profile:{id:'me'},active:{id:'active-new'},archive}}};study.room=room;
    const checkpoint=new CopyCheckpoint({vault,room,study,syncer:new ArchiveSync({vault,room})});
    const copying=checkpoint.check().then(()=>{copied=true;});
    const rejected=assert.rejects(copying,{code:'STUDY_BUSY'});
    assert.equal(await study.refresh(),true);assert.equal(study.active.id,'active-new');
    releaseOld({study:{profile:{id:'me'},active:null,archive}});await rejected;
    assert.equal(study.active.id,'active-new');assert.equal(copied,false);
  }finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}
});

test('busy or failed personal refresh cannot be treated as a completed backup checkpoint',async()=>{
  const old=globalThis.document,fields=new Map();globalThis.document={getElementById(id){if(!fields.has(id))fields.set(id,{});return fields.get(id);}};
  try{
    const ui=Object.create(StudyUI.prototype);Object.assign(ui,{busy:true,refreshing:false,version:0,pendingKey:'checkpoint-test',accept(data){this.data=data;},room:{me:{id:'A'},service:async()=>{throw Error('offline');}}});
    assert.equal(await ui.refresh(),false);ui.busy=false;assert.equal(await ui.refresh(),false);
    ui.room.service=async()=>({study:{profile:{id:'A'},active:null}});assert.equal(await ui.refresh(),true);
  }finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}
});

test('a delayed personal refresh cannot overwrite a successful study start',async()=>{
  const old=globalThis.document,fields=new Map();
  globalThis.document={getElementById(id){if(!fields.has(id))fields.set(id,{close(){}});return fields.get(id);}};
  try{
    const ui=Object.create(StudyUI.prototype);Object.assign(ui,{refreshing:false,busy:false,version:0,pendingKey:'test-pending',setFocus(){},renderClock(){},toast(){},accept(data){this.data=data;}});
    const preset={subject:'전공',goal:'트리 학습'};
    let resolveOldMe;ui.room={online:true,me:{id:'A'},service:async(path,payload)=>{
      if(path.endsWith('/me'))return new Promise(resolve=>resolveOldMe=resolve);
      assert.deepEqual(payload,preset);
      return {study:{active:{id:'new-study'}}};
    }};
    const refresh=ui.refresh();await ui.start(preset);assert.equal(ui.data.active.id,'new-study');
    resolveOldMe({study:{profile:{id:'A'},active:null}});await refresh;
    assert.equal(ui.data.active?.id,'new-study');
  }finally{if(old===undefined)delete globalThis.document;else globalThis.document=old;}
});

test('replaying an old offline stop cannot erase a newer pending stop',async()=>{
  const oldDoc=globalThis.document,oldStorage=globalThis.localStorage,values=new Map(),fields=new Map();
  globalThis.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  globalThis.document={getElementById(id){if(!fields.has(id))fields.set(id,{value:'새 공부 확인',close(){}});return fields.get(id);}};
  try{
    const active={id:'B',segmentStartAt:2000},summary={profile:{id:'p'},active};
    values.set('test',JSON.stringify({profileId:'p',payload:{sessionId:'A'}}));
    const ui=Object.create(StudyUI.prototype);Object.assign(ui,{version:0,busy:false,refreshing:false,pendingKey:'test',data:summary,checkActive:active,offset:0,setFocus(){},renderClock(){},toast(){},accept(data){this.data=data;}});
    let resolveA;ui.room={me:{id:'p'},service:async(path,payload)=>path.endsWith('/me')?{study:summary}:payload.sessionId==='A'?new Promise(resolve=>resolveA=resolve):Promise.reject(Error('offline'))};
    const replay=ui.refresh();await new Promise(resolve=>setImmediate(resolve));await ui.confirm(true);
    const newer=values.get('test');assert.equal(JSON.parse(newer).payload.sessionId,'B');
    resolveA({study:summary});await replay;assert.equal(values.get('test'),newer);
  }finally{if(oldDoc===undefined)delete globalThis.document;else globalThis.document=oldDoc;if(oldStorage===undefined)delete globalThis.localStorage;else globalThis.localStorage=oldStorage;}
});
