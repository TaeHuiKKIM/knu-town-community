import test from 'node:test';
import assert from 'node:assert/strict';
import {ArchiveSync} from '../public/campus/local-sync.js';
import {RoomConnection} from '../public/campus/network.js';
import {LocalUI} from '../public/campus/local-ui.js';

const key='a'.repeat(64),sourceId='3e0fa72d-35d3-4c5d-8ef7-e3c2e3f85da0';
function fixture(service){const cursors=new Map(),pages=[],errors=[];const vault={state:{profile:{key}},cursor:id=>cursors.get(id)||0,async syncRecords(page,owner){assert.equal(owner,this.state.profile.key);pages.push(page);cursors.set(page.sourceId,page.cursor);}};const room={profileKey:key,online:true,service};return {vault,room,pages,errors,sync:new ArchiveSync({vault,room,onError:e=>errors.push(e)})};}

test('only missing archive pages are fetched; repeated markers and replays do not pull again',async()=>{
  const requests=[],f=fixture(async(path,data)=>{requests.push({path,...data});return {sourceId,cursor:data.since+1,hasMore:data.since===0,records:[{seq:data.since+1}]};});
  await f.sync.observe({sourceId,cursor:2});await f.sync.flush();
  assert.equal(f.pages.length,2);assert.deepEqual(requests.map(r=>r.since),[0,1]);
  await f.sync.observe({sourceId,cursor:2});await f.sync.flush();assert.equal(requests.length,2);
});

test('an old in-flight page cannot be imported into a replacement profile or clear a newer transfer',async()=>{
  let resolveOld;const f=fixture(()=>new Promise(resolve=>resolveOld=resolve));
  const old=f.sync.observe({sourceId,cursor:1});await new Promise(r=>setImmediate(r));
  f.sync.clear();f.vault.state.profile.key='b'.repeat(64);f.room.profileKey='b'.repeat(64);
  resolveOld({sourceId,cursor:1,hasMore:false,records:[{seq:1}]});await old;
  assert.equal(f.pages.length,0);assert.equal(f.errors.length,0);
});

test('a broken or failed archive page never claims a complete copy, and retry resumes at the last committed cursor',async()=>{
  let fail=true;const requests=[],f=fixture(async(path,data)=>{requests.push(data.since);if(fail)throw Error('network');return {sourceId,cursor:1,hasMore:false,records:[{seq:1}]};});
  await f.sync.observe({sourceId,cursor:1});await assert.rejects(f.sync.flush(),/network/);assert.equal(f.pages.length,0);
  fail=false;await f.sync.observe({sourceId,cursor:1});await f.sync.flush();assert.equal(f.pages.length,1);assert.deepEqual(requests,[0,0]);
});

test('an HTTP-confirmed host can serve archive pages before the room is joined', async () => {
  const f = fixture(async () => ({ sourceId, cursor: 1, hasMore: false, records: [{ seq: 1 }] }));
  f.room.online = false;
  await f.sync.observe({ sourceId, cursor: 1 }, { connected: true });
  await f.sync.flush();
  assert.equal(f.vault.cursor(sourceId), 1);
});

test('losing the participant event stream between archive pages does not interrupt HTTP archive requests', async () => {
  const requests = [];
  const f = fixture(async (path, { since }) => {
    requests.push(since);
    f.room.online = false;
    return { sourceId, cursor: since + 1, hasMore: since === 0, records: [{ seq: since + 1 }] };
  });
  await f.sync.observe({ sourceId, cursor: 2 });
  await f.sync.flush();
  assert.deepEqual(requests, [0, 1]);
  assert.equal(f.vault.cursor(sourceId), 2);
});

test('flush rejects when ownership was lost before the wanted cursor could commit', async () => {
  const f = fixture(async () => ({ sourceId, cursor: 1, hasMore: false, records: [{ seq: 1 }] }));
  f.vault.syncRecords = async () => {
    throw Object.assign(new Error('owner changed'), { code: 'LOCAL_OWNER_CHANGED' });
  };
  await f.sync.observe({ sourceId, cursor: 1 });
  await assert.rejects(f.sync.flush(), { code: 'COPY_ARCHIVE_INCOMPLETE' });
});

test('restoring a different local profile cannot resume an old participant or replay its pending transfer',async()=>{
  const old=globalThis.sessionStorage,values=new Map([['knu-session:main','old-session'],['knu-session:main:profile',key],['knu-session:main:transfer',JSON.stringify({type:'transfer',session:'old-session',targetCode:'friend',transferKey:'c'.repeat(32)})]]);
  globalThis.sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  try{const room=new RoomConnection('main',{key:'b'.repeat(64)});let calls=0,join=false;room.request=async()=>{calls++;return{};};room.addEventListener('joinrequired',()=>join=true);await room.resume();assert.equal(calls,0);assert.equal(join,true);assert.equal(values.has('knu-session:main:transfer'),false);}
  finally{if(old===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=old;}
});

test('a same-profile restore invalidates a stale page and its participant before late appearance writes',async()=>{
  const old=globalThis.sessionStorage,values=new Map([['knu-session:main','old-session'],['knu-session:main:profile',key],['knu-session:main:save','1']]);globalThis.sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  try{
    let writes=0;const ui=Object.create(LocalUI.prototype);Object.assign(ui,{sessionGeneration:1,vault:{state:{profile:{key}},generation:2,async updateProfile(){writes++;}},room:{profileKey:key}});await ui.saveAppearance({coat:'navy'});assert.equal(ui.stale,true);assert.equal(writes,0);
    const room=new RoomConnection('main',{key,generation:2});let calls=0;room.request=async()=>{calls++;return{};};await room.resume();assert.equal(calls,0);
  }finally{if(old===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=old;}
});
