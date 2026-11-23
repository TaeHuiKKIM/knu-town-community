import test from 'node:test';
import assert from 'node:assert/strict';

test('slow movement requests coalesce to the latest position and preserve the final idle', async () => {
  const { latestSender } = await import('../public/campus/network.js');
  const sent = [], releases = [];
  const sender = latestSender(data => { sent.push(data); return new Promise(resolve => releases.push(resolve)); });
  sender.push({ x: 1, motion: 'walk' });
  sender.push({ x: 2, motion: 'walk' });
  sender.push({ x: 3, motion: 'idle' });
  assert.equal(sent.length, 1, 'only one request may be in flight');
  releases.shift()(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, [{ x: 1, motion: 'walk' }, { x: 3, motion: 'idle' }]);
  releases.shift()();
});

test('clearing movement on disconnect discards unsent input', async () => {
  const { latestSender } = await import('../public/campus/network.js');
  const sent = []; let release;
  const sender = latestSender(data => { sent.push(data); return new Promise(resolve => { release = resolve; }); });
  sender.push({ x: 1 }); sender.push({ x: 2 }); sender.clear();
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent, [{ x: 1 }]);
});

test('successful connectivity probe reopens a stalled room stream without another player action', async () => {
  const { RoomConnection } = await import('../public/campus/network.js');
  const room = new RoomConnection('probe-test');
  room.me = { session: 'test-session', id: 'test-id' };
  // Browser EventSource is outside Node; keep the probe/connection state machine real.
  room.request = async () => ({ ok: true });
  let connections = 0; room.connect = () => { connections++; };
  await room.probe(); assert.equal(connections, 1);
  room.online = true;
  await room.probe(); assert.equal(connections, 1, 'healthy streams must not be replaced');
});

test('retries a saved participant automatically after a transient refresh restore failure', async () => {
  const { RoomConnection } = await import('../public/campus/network.js');
  const previous = globalThis.sessionStorage;
  globalThis.sessionStorage = { getItem: () => 'saved-session' };
  try {
    const room = new RoomConnection('restore-test'); let attempts = 0;
    room.request = async () => { if (++attempts === 1) throw Error('temporary connection failure'); return { id: 'same-player', state: { players: [{ id: 'same-player' }] } }; };
    room.connect = () => {};
    await room.resume(); assert.equal(room.me, null);
    await room.probe();
    assert.equal(attempts, 2, 'the periodic probe must retry the saved session');
    assert.equal(room.me.id, 'same-player'); assert.equal(room.me.session, 'saved-session');
  } finally { if (previous === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previous; }
});

test('cropped desktop and mobile cameras keep walkable player positions in view', async () => {
  const { cameraTransform } = await import('../public/campus/world.js');
  for (const [width, height, mobile] of [[504, 736, false], [1704, 236, false], [390, 700, true], [1144, 736, false]]) {
    for (const [x, y] of [[211, 466], [1079, 529], [500, 939]]) {
      const camera = cameraTransform({ width, height, x, y, mobile });
      const screenX = camera.x + x * camera.scale, screenY = camera.y + y * camera.scale;
      assert.ok(screenX > 0 && screenX < width, `${width}x${height}: player x ${x} disappeared`);
      assert.ok(screenY > 0 && screenY < height, `${width}x${height}: player y ${y} disappeared`);
    }
  }
});

test('an old ping cannot expire a participant while a room transfer is completing', async () => {
  const { RoomConnection } = await import('../public/campus/network.js');
  const room=new RoomConnection('transfer-race');room.me={id:'A',session:'old'};room.online=true;room.source={close(){}};
  let rejectPing,resolveTransfer,finished=false;
  room.request=async(_,data)=>data.type==='ping'?new Promise((_,reject)=>rejectPing=reject):new Promise(resolve=>resolveTransfer=resolve);
  room.finishTransfer=()=>{finished=true;};room.connect=()=>{};
  const ping=room.probe(),transfer=room.transfer('friend');
  rejectPing(Object.assign(Error('old room removed'),{status:401}));await ping;
  resolveTransfer({code:'friend',session:'new',id:'A'});await transfer;
  assert.equal(finished,true);assert.equal(room.me.id,'A');
});

test('a lost room-transfer response is retried by the regular probe using the same receipt',async()=>{
  const {RoomConnection}=await import('../public/campus/network.js'),old=globalThis.sessionStorage,values=new Map();
  globalThis.sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  try{
    const room=new RoomConnection('retry-transfer');room.me={id:'A',session:'old'};room.online=true;room.source={close(){}};
    const sent=[];let finished=false;room.finishTransfer=()=>{finished=true;};
    room.request=async(_,data)=>{sent.push(data);if(sent.length===1)throw Error('response lost');return {code:'friend',session:'new'};};
    await assert.rejects(room.transfer('friend'));assert.equal(room.mode,'offline');assert.ok(room.pendingTransfer());
    await room.probe();assert.equal(finished,true);assert.equal(sent.length,2);assert.equal(sent[0].transferKey,sent[1].transferKey);
  }finally{if(old===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=old;}
});

test('explicitly leaving cancels a lost transfer before another join',async()=>{
  const {RoomConnection}=await import('../public/campus/network.js'),old=globalThis.sessionStorage,values=new Map();
  globalThis.sessionStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  try{
    const room=new RoomConnection('cancel-transfer');room.me={id:'A',session:'old'};room.online=true;room.source={close(){}};room.request=async()=>{throw Error('offline');};
    await assert.rejects(room.transfer('friend'));assert.ok(room.pendingTransfer());
    await assert.rejects(room.leave());assert.equal(room.pendingTransfer(),null);
  }finally{if(old===undefined)delete globalThis.sessionStorage;else globalThis.sessionStorage=old;}
});
