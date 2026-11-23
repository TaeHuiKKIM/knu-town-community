import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyServer } from '../src/server.mjs';

test('two participants exchange movement, seats, focus and chat over the real HTTP stream', async t => {
  const server = createStudyServer({ roomCode: 'test-room' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, data) => {
    const res = await fetch(`${base}/api/test-room/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    return { status: res.status, data: await res.json() };
  };
  const a = await post('join', { name: '가영' });
  const b = await post('join', { name: '민수' });
  assert.equal(a.status, 200);
  assert.equal(b.data.state.players.length, 2);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await fetch(`${base}/api/test-room/events?session=${b.data.session}`, { signal: controller.signal });
  const reader = stream.body.getReader();
  let buffered = '';
  async function nextState(predicate) {
    const deadline = AbortSignal.timeout(3000);
    while (!deadline.aborted) {
      const chunk = await Promise.race([reader.read(), new Promise((_, reject) => deadline.addEventListener('abort', () => reject(new Error('stream timeout')), { once: true }))]);
      buffered += new TextDecoder().decode(chunk.value);
      let split;
      while ((split = buffered.indexOf('\n\n')) >= 0) {
        const event = buffered.slice(0, split); buffered = buffered.slice(split + 2);
        if (!event.startsWith('data: ')) continue;
        const state = JSON.parse(event.slice(6));
        if (predicate(state)) return state;
      }
    }
  }
  await nextState(s => s.players.length === 2);
  assert.equal((await post('action', { session: a.data.session, type: 'move', x: 350, y: 390 })).status, 200);
  await nextState(s => s.players.some(p => p.name === '가영' && p.x === 350));
  assert.equal((await post('action', { session: a.data.session, type: 'seat', seat: 0 })).status, 200);
  assert.equal((await post('action', { session: b.data.session, type: 'seat', seat: 0 })).status, 409);
  assert.equal((await post('action', { session: a.data.session, type: 'focus', focus: true })).status, 200);
  await nextState(s => s.players.some(p => p.name === '가영' && p.focusSince));
  await post('action', { session: a.data.session, type: 'chat', text: '같이 공부해요' });
  const state = await nextState(s => s.messages.some(m => m.text === '같이 공부해요'));
  assert.equal(state.messages.at(-1).name, '가영');
  assert.equal(JSON.stringify(state).includes(a.data.session), false, 'session secrets must not be broadcast');
  await post('action', { session: a.data.session, type: 'leave' });
  await nextState(s => s.players.length === 1);
  controller.abort();
});

test('rejects unknown rooms, foreign origins, invalid sessions and bounds; enforces capacity', async t => {
  const server = createStudyServer({ roomCode: 'test-room' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, data, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
  assert.equal((await fetch(base + '/r/wrong')).status, 404);
  assert.equal((await request('/api/test-room/join', { name: 'x' }, { Origin: 'http://elsewhere.invalid' })).status, 403);
  assert.equal((await request('/api/test-room/join', { name: '  ' })).status, 400);
  assert.equal((await request('/api/test-room/action', { session: 'wrong', type: 'move', x: 1, y: 1 })).status, 401);
  const first = await (await request('/api/test-room/join', { name: '첫 번째' })).json();
  assert.equal((await request('/api/test-room/action', { session: first.session, type: 'move', x: -20, y: Infinity })).status, 400);
  for (let i = 1; i < 8; i++) assert.equal((await request('/api/test-room/join', { name: `참가자${i}` })).status, 200);
  assert.equal((await request('/api/test-room/join', { name: '아홉 번째' })).status, 409);
  assert.equal((await fetch(base + '/health')).status, 200);
});

test('keeps a connected background tab present while removing an abandoned join', async t => {
  const server = createStudyServer({ roomCode: 'background-room', ttl: 100 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/background-room/`;
  const join = async name => (await fetch(base + 'join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })).json();
  const connected = await join('백그라운드 공부');
  await join('연결 없이 떠난 참가자');
  const controller = new AbortController(); t.after(() => controller.abort());
  const stream = await fetch(base + `events?session=${connected.session}`, { signal: controller.signal });
  const reader = stream.body.getReader(); await reader.read();
  await new Promise(resolve => setTimeout(resolve, 5150));
  const chunk = await reader.read();
  const update = new TextDecoder().decode(chunk.value).split('\n\n').find(line => line.startsWith('data: '));
  assert.ok(update, 'cleanup broadcasts presence');
  const state = JSON.parse(update.slice(6));
  assert.equal(state.players.length, 1, 'an open stream survives background timer throttling');
  assert.equal(state.players[0].name, '백그라운드 공부');
  controller.abort();
});
