import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { LocalVault } from '../public/campus/local-vault.js';
import { Avatars } from '../public/campus/avatar.js';
import { parseBackup, serializeBackup, summary } from '../public/campus/local-data.js';
import { styleLayout } from '../public/campus/wardrobe.js';
import { createStudyServer } from '../src/server.mjs';

const initial = { name: '크누', avatar: 'male', coat: 'navy' };
const profileKey = 'b'.repeat(64);
const sourceId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const start = Date.parse('2026-11-16T00:00+09:00');
const ninety = 90 * 60_000;
const maleManifest = new URL('../design/character-v3/male-ash/runtime-manifest.json', import.meta.url);
const maleAsset = '/campus/wardrobe/male-ash';

test('earned style persists in the local vault and v1 backup while the old profile shape still loads', async t => {
  const indexedDB = new IDBFactory();
  const vault = await LocalVault.open({ key: profileKey, indexedDB, initial });
  t.after(() => vault.close());
  const old = await vault.exportText();
  assert.deepEqual(parseBackup(old).profile, { key: profileKey, ...initial });
  await assert.rejects(vault.updateProfile({ style: 'male-ash' }), /공부/);
  const records = [1, 2].map(seq => ({
    sourceId, seq, id: String(seq).padStart(32, '0'), sessionId, subject: '컴퓨터', goal: '알고리즘 연습', note: '문제 풀이',
    fromAt: start + (seq - 1) * ninety, toAt: start + seq * ninety, confirmedAt: start + seq * ninety,
  }));
  await vault.syncRecords({ sourceId, cursor: 2, hasMore: false, records }, profileKey);
  const earned = summary(vault.state, start + 2 * ninety);
  assert.equal(earned.rewardMs, 3 * 60 * 60_000);
  await vault.updateProfile({ style: 'male-ash' });
  assert.equal(parseBackup(await vault.exportText()).profile.style, 'male-ash');
  await assert.rejects(vault.updateProfile({ style: 'male-jacket' }), /공부/);
  await assert.rejects(vault.updateProfile({ style: 'female-ash' }), /프로필/);
  assert.throws(() => parseBackup(serializeBackup({ ...vault.state, records: [] })), /공부/);
  assert.equal(summary(vault.state).balance, earned.balance);
  await vault.updateProfile({ avatar: 'female' });
  assert.equal(vault.state.profile.style, undefined);
});

test('the lazy renderer validates a real compatible atlas and keeps the default after a failed load', async () => {
  const manifest = JSON.parse(await readFile(maleManifest, 'utf8'));
  assert.equal(styleLayout(manifest).rows.jump_south.length, 6);
  assert.equal(styleLayout({ frame_layout: { ...manifest.frame_layout, rows: {} } }), null);
  let fetches = 0, available = false;
  class FakeImage {
    naturalWidth = 576;
    naturalHeight = 2432;
    set src(value) { assert.equal(value, maleAsset + '/sprite-sheet-alpha.png'); queueMicrotask(() => this.onload()); }
  }
  const art = new Avatars({
    imageFactory: () => new FakeImage(),
    fetchImpl: async url => {
      assert.equal(url, maleAsset + '/runtime-manifest.json');
      fetches++;
      return { ok: available, json: async () => manifest };
    },
  });
  assert.equal(fetches, 0);
  assert.equal(art.hasStyle('male-ash'), false);
  await assert.rejects(art.loadStyle('male-ash'));
  assert.equal(art.hasStyle('male-ash'), false);
  available = true;
  await Promise.all([art.loadStyle('male-ash'), art.loadStyle('male-ash')]);
  assert.equal(fetches, 2);
  assert.equal(art.hasStyle('male-ash'), true);
  art.ready = true;
  const painted=[];
  const canvas = { dataset: {}, style: {}, getContext: () => ({ clearRect() {}, drawImage(...args) { painted.push(args); } }) };
  art.paint(canvas, { style: 'male-ash', waveAt: 1000, epoch: 1200 });
  assert.equal(canvas.dataset.style, 'male-ash');
  assert.equal(canvas.dataset.animation, 'wave_south');
  const frame=styleLayout(manifest).rows.wave_south[1];
  let y=frame.y;
  for(const [,x,top,width,height] of painted){
    assert.deepEqual([x,top,width],[frame.x,y,frame.w]);
    y+=height;
  }
  assert.equal(y,frame.y+frame.h);
});

test('a published style is served by an exact route and survives join, room changes and old outfit requests', async t => {
  const server = createStudyServer({ hub: true, roomCode: 'main' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(path, data) {
    const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return { status: res.status, data: await res.json() };
  }
  const manifest = await fetch(base + maleAsset + '/runtime-manifest.json');
  assert.equal(manifest.status, 200);
  assert.equal(styleLayout(await manifest.json()).sheetWidth, 576);
  const image = await fetch(base + maleAsset + '/sprite-sheet-alpha.png');
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), await readFile(new URL('sprite-sheet-alpha.png', maleManifest)));
  for (const path of ['/raw/south/walk.png', '/sprite-request.json', '/../../.env']) {
    assert.equal((await fetch(base + maleAsset + path)).status, 404);
  }
  const join = data => post('/api/main/join', { profileKey, ...initial, ...data });
  const legacy = await join({ name: '기존 참가자' });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.data.state.players.find(p => p.id === legacy.data.id).style ?? null, null);
  assert.equal((await join({ style: 'female-ash' })).status, 400);
  assert.equal((await join({ style: 'constructor' })).status, 400);
  const player = (await join({ style: 'male-ash' })).data;
  assert.equal(player.state.players.find(p => p.id === player.id).style, 'male-ash');
  const room = (await post('/api/hub/rooms/create', { profileKey, name: '새 광장', mode: 'free' })).data.room.code;
  const moved = (await post('/api/main/action', { session: player.session, type: 'transfer', targetCode: room, transferKey: 'e'.repeat(32) })).data;
  const state = async () => (await post(`/api/${room}/resume`, { session: moved.session })).data.state.players[0];
  assert.equal((await state()).style, 'male-ash');
  assert.equal((await state()).coat, 'navy');
  const outfit = coat => post(`/api/${room}/action`, { session: moved.session, type: 'outfit', coat });
  assert.equal((await outfit('forest')).status, 200);
  assert.equal((await state()).style ?? null, null);
  assert.equal((await state()).coat, 'forest');
  const rewear = await post(`/api/${room}/action`, { session: moved.session, type: 'outfit', coat: 'forest', style: 'male-ash' });
  assert.equal(rewear.status, 200);
  assert.equal((await state()).style, 'male-ash');
});
