import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudyServer } from '../src/server.mjs';
import { walkable } from '../public/campus/world.js';

async function setup(t) {
  let clock = 100000;
  const server = createStudyServer({ roomCode: 'actions', now: () => clock, hub: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(path, data) {
    const res = await fetch(base + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    return { status: res.status, data: await res.json() };
  }
  const profileKey = 'a'.repeat(64);
  const a = (await post('/api/actions/join', { name: '크누', profileKey })).data;
  const b = (await post('/api/actions/join', { name: '누리', profileKey: 'b'.repeat(64) })).data;
  const action = (player, data) => post('/api/actions/action', { ...data, session: player.session });
  const jump = (player, data = {}) => action(player, { type: 'jump', scene: 'plaza', positionRevision: 0, ...data });
  const campus = async (player) => {
    const result = await post('/api/actions/resume', { session: player.session });
    return result.data.state.players.find(p => p.id === player.id).campus;
  };
  return { base, post, action, jump, campus, a, b, profileKey, advance(ms) { clock += ms; } };
}

test('server-timed jump is shared by SSE and cannot alter movement, position or player defenses', async t => {
  const { base, action, jump, campus, a, b, advance } = await setup(t);
  const before = await campus(a);
  const res = await fetch(`${base}/api/actions/events?session=${b.session}`, { signal: AbortSignal.timeout(4000) });
  const reader = res.body.getReader();
  t.after(() => reader.cancel().catch(() => {}));
  await reader.read();
  assert.equal((await jump(a, { jumpAt: 4, x: 0, y: 0, lift: 999 })).status, 200);
  const event = new TextDecoder().decode((await reader.read()).value);
  const state = JSON.parse(event.split('\n')[0].slice(6));
  const after = state.players.find(p => p.id === a.id).campus;
  assert.equal(after.jumpAt, state.at);
  assert.equal(after.nextJumpAt, state.at + 800);
  assert.deepEqual(after, { ...before, jumpAt: state.at, nextJumpAt: state.at + 800 });
  const repeat = await jump(a);
  assert.equal(repeat.status, 429);
  assert.equal(repeat.data.code, 'COOLDOWN');
  advance(799);
  assert.equal((await jump(a)).status, 429);
  advance(1);
  assert.equal((await jump(a)).status, 200);
  assert.equal((await action(b, { type: 'bump', targetId: a.id })).status, 200);
  const hit = await campus(a);
  assert.equal(hit.jumpAt, 0);
  assert.equal(hit.positionRevision, 1);
  assert.equal(walkable(hit.x, hit.y, hit.scene), true);
  const paused = await jump(a, { positionRevision: 1 });
  assert.equal(paused.status, 409);
  assert.equal(paused.data.code, 'KNOCKBACK');
  const movement = { type: 'campus-move', scene: 'plaza', x: hit.x, y: hit.y, motion: 'walk', facing: 'south' };
  assert.equal((await action(a, { ...movement, positionRevision: 0 })).data.code, 'STALE_MOVE');
  advance(180);
  assert.equal((await action(a, { ...movement, positionRevision: 1 })).status, 200);
});

test('late actions cannot cross scenes, and scene changes preserve the jump cooldown', async t => {
  const { action, jump, campus, advance, a } = await setup(t);
  assert.equal((await jump(a)).status, 200);
  assert.equal((await action(a, { type: 'scene', scene: 'ginkgo' })).status, 200);
  assert.equal((await campus(a)).jumpAt, 0);
  assert.equal((await jump(a)).data.code, 'STALE_ACTION');
  assert.equal((await action(a, { type: 'wave', scene: 'plaza', positionRevision: 0 })).data.code, 'STALE_ACTION');
  assert.equal((await jump(a, { scene: 'ginkgo', positionRevision: 1 })).data.code, 'COOLDOWN');
  advance(800);
  assert.equal((await jump(a, { scene: 'ginkgo', positionRevision: 1 })).status, 200);
  assert.equal((await campus(a)).scene, 'ginkgo');
});

test('study interrupts a jump and rejects new jump and wave requests; invalid actions stay rejected', async t => {
  const { base, post, action, jump, campus, a, profileKey } = await setup(t);
  assert.equal((await fetch(base + '/campus/student-motion.js')).status, 200);
  assert.equal((await action({ session: 'invalid' }, { type: 'jump' })).status, 401);
  assert.equal((await action(a, { type: 'fly' })).status, 400);
  assert.equal((await action(a, { type: 'jump' })).data.code, 'STALE_ACTION');
  assert.equal((await jump(a)).status, 200);
  assert.equal((await post('/api/study/start', { profileKey, subject: '자료구조', goal: '트리 순회' })).status, 200);
  assert.equal((await campus(a)).jumpAt, 0);
  assert.equal((await jump(a)).data.code, 'STUDY_ACTIVE');
  assert.equal((await action(a, { type: 'wave' })).data.code, 'STUDY_ACTIVE');
});
