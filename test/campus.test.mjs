import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyServer } from '../src/server.mjs';

async function room(t) {
  const server = createStudyServer({ roomCode: 'campus-test' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (route, data) => {
    const response = await fetch(`${base}/api/campus-test/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return { status: response.status, data: await response.json() };
  };
  return { base, post };
}

test('campus movement, outfits, waves and chat author reach another participant on SSE', async t => {
  const { base, post } = await room(t);
  const a = (await post('join', { name: '과잠친구', coat: 'forest' })).data;
  const b = (await post('join', { name: '광장친구' })).data;
  assert.equal(a.state.players[0].coat, 'forest');
  assert.equal(a.state.players[0].campus.x, 860);
  const controller = new AbortController(); t.after(() => controller.abort());
  const response = await fetch(`${base}/api/campus-test/events?session=${b.session}`, { signal: controller.signal });
  const reader = response.body.getReader(); let buffer = '';
  async function until(predicate) {
    const timeout = AbortSignal.timeout(3000);
    while (!timeout.aborted) {
      const chunk = await Promise.race([reader.read(), new Promise((_, reject) => timeout.addEventListener('abort', () => reject(Error('SSE timeout')), { once: true }))]);
      buffer += new TextDecoder().decode(chunk.value);
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (!event.startsWith('data: ')) continue;
        const state = JSON.parse(event.slice(6));
        if (predicate(state)) return state;
      }
    }
  }
  await until(s => s.players.length === 2);
  assert.equal((await post('action', { session: a.session, type: 'campus-move', x: 700, y: 600, facing: 'left', motion: 'walk' })).status, 200);
  const moving = await until(s => s.players.some(p => p.id === a.id && p.campus.x === 700 && p.campus.facing === 'left' && p.campus.motion === 'walk'));
  const movedAt = moving.players.find(p => p.id === a.id).campus.movedAt;
  assert.equal(typeof movedAt, 'number', 'remote animation must expire using movement time, not unrelated room broadcasts');
  await post('action', { session: a.session, type: 'outfit', coat: 'navy' });
  const dressed = await until(s => s.players.some(p => p.id === a.id && p.coat === 'navy'));
  assert.equal(dressed.players.find(p => p.id === a.id).campus.movedAt, movedAt);
  await post('action', { session: a.session, type: 'wave' });
  await until(s => s.players.some(p => p.id === a.id && p.campus.waveAt > 0));
  await post('action', { session: a.session, type: 'chat', text: '<img onerror=alert(1)> 본관 앞!' });
  const state = await until(s => s.messages.some(m => m.playerId === a.id));
  assert.equal(state.messages.at(-1).text, '<img onerror=alert(1)> 본관 앞!');
  assert.equal(JSON.stringify(state).includes(a.session), false);
  assert.equal(JSON.stringify(state).includes(b.session), false);
  assert.equal((await post('action', { session: a.session, type: 'campus-move', x: 700, y: 600, facing: 'left', motion: 'idle' })).status, 200);
  await until(s => s.players.some(p => p.id === a.id && p.campus.motion === 'idle'));
});

test('validates campus coordinates and appearance without changing the accepted state', async t => {
  const { post } = await room(t);
  assert.equal((await post('join', { name: '잘못된 옷', coat: 'unknown' })).status, 400);
  const a = (await post('join', { name: '검증친구' })).data;
  const move = { session: a.session, type: 'campus-move', x: 700, y: 600, facing: 'right', motion: 'idle' };
  for (const patch of [{ x: 0 }, { y: 100 }, { x: 1080, y: 720 }, { x: null }, { facing: 'up' }, { motion: 'fly' }]) {
    assert.equal((await post('action', { ...move, ...patch })).status, 400, JSON.stringify(patch));
  }
  assert.equal((await post('action', { session: a.session, type: 'outfit', coat: '../navy' })).status, 400);
  assert.equal((await post('action', { session: 'wrong', type: 'outfit', coat: 'navy' })).status, 401);
  const resumed = await post('resume', { session: a.session });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.state.players.length, 1);
  assert.equal(resumed.data.state.players[0].campus.x, 860);
  assert.equal(resumed.data.state.players[0].coat, 'burgundy');
});

test('resumes the same participant after refresh and rejects a departed session', async t => {
  const { post } = await room(t);
  const a = (await post('join', { name: '새로고침친구', coat: 'navy' })).data;
  await post('action', { session: a.session, type: 'campus-move', x: 600, y: 700, facing: 'left', motion: 'idle' });
  const resumed = await post('resume', { session: a.session });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.id, a.id);
  assert.equal(resumed.data.state.players.length, 1);
  assert.equal(resumed.data.state.players[0].campus.x, 600);
  assert.equal(resumed.data.state.players[0].coat, 'navy');
  await post('action', { session: a.session, type: 'leave' });
  assert.equal((await post('resume', { session: a.session })).status, 401);
});

test('serves the campus and its local raster assets, keeps classic view and excludes private sources', async t => {
  const { base } = await room(t);
  const campus = await fetch(`${base}/r/campus-test`);
  assert.equal(campus.status, 200);
  assert.match(await campus.text(), /\/campus\/app.js/);
  const classic = await fetch(`${base}/r/campus-test?view=classic`);
  assert.match(await classic.text(), /id="room"/);
  for(const path of ['/campus/local-data.js','/campus/local-vault.js','/campus/local-sync.js','/campus/local-ui.js','/campus/local.css','/campus/study.js','/campus/study-time.js','/campus/study.css','/campus/spaces.js','/campus/scenes.js','/campus/terrain.js','/campus/scene-view.js','/campus/ambient.js','/campus/world.css','/campus/assets/ginkgo-walk-v1.png','/campus/assets/library-lounge-v1.png'])assert.equal((await fetch(base+path)).status,200,path);
  assert.equal((await fetch(base+'/.runtime/study.sqlite')).status,404);
  for (const path of ['/campus/app.js', '/campus/network.js', '/campus/world.js', '/campus/play.js', '/campus/impact.js', '/campus/ui.css', '/campus/avatar.js', '/campus/effects.js', '/campus/sprites/data.js', '/campus/style.css', '/campus/assets/play/bump.png', '/campus/assets/knu-plaza-v3.png', '/campus/assets/Galmuri11.woff2']) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
  for (const avatar of ['male', 'female']) {
    for (const coat of ['burgundy', 'forest', 'navy', 'cse']) {
      const response = await fetch(`${base}/campus/sprites/${avatar}/${coat}.png`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
    }
  }
  for (const path of ['/campus/.env', '/.runtime/qa-sample.knutown.json', '/campus/../server.mjs', '/campus/source/requests.json', '/campus/assets/../../generation.json', '/.runtime/host.json', '/campus/sprites/female/raw/idle_south.png', '/campus/sprites/female/unknown.png', '/design/character-v2/female/sprite-request.json']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(`${base}/`, { redirect: 'manual' })).status, 302);
});
