import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { RoomConnection } from '../public/campus/network.js';
import { createStudyServer } from '../src/server.mjs';

const code = 'retry-test';
const storageKey = `knu-session:${code}`;
const key = 'a'.repeat(64);

function tabStorage(t, values = new Map()) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: name => values.get(name) ?? null,
      setItem: (name, value) => values.set(name, value),
      removeItem: name => values.delete(name),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
    else delete globalThis.sessionStorage;
  });
  return values;
}

test('retrying a lost join response after reload returns the original participant', async t => {
  const server = createStudyServer({ roomCode: code });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });

  const values = tabStorage(t);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const fetch = globalThis.fetch;
  const joinKeys = [];
  let lostJoin;
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    const response = await fetch(new URL(path, origin), options);
    if (path.endsWith('/join')) {
      joinKeys.push(JSON.parse(options.body).joinKey);
      if (joinKeys.length === 1 && response.ok) {
        lostJoin = await response.json();
        throw new TypeError('simulated lost response');
      }
    }
    return response;
  });

  const room = new RoomConnection(code, { key, generation: 2 });
  await assert.rejects(room.join('학생', 'navy'), /방장과 연결되지 않았어요/);
  assert.ok(lostJoin, 'the host accepted the request before the response was lost');
  assert.equal(values.has(storageKey), false);

  const reloaded = new RoomConnection(code, { key, generation: 2 });
  reloaded.connect = () => {};
  let joinRequired = false;
  reloaded.addEventListener('joinrequired', () => { joinRequired = true; });
  await reloaded.resume();
  assert.equal(joinRequired, true);

  let players;
  reloaded.addEventListener('state', event => { players = event.detail.players; });
  await reloaded.join('학생', 'navy');

  assert.equal(joinKeys.length, 2);
  assert.equal(joinKeys[1], joinKeys[0], 'the retry must use the original join key');
  assert.deepEqual(reloaded.me, { id: lostJoin.id, session: lostJoin.session });
  assert.deepEqual(players?.map(player => player.id), [lostJoin.id]);
  assert.equal(values.has(storageKey + ':join'), false);
});

test('a different profile or save generation discards the previous pending join', async t => {
  for (const [name, profile] of [
    ['different profile', { key: 'b'.repeat(64), generation: 2 }],
    ['different save generation', { key, generation: 3 }],
  ]) {
    await t.test(name, async t => {
      const previousJoinKey = 'c'.repeat(32);
      tabStorage(t, new Map([
        [storageKey + ':join', previousJoinKey],
        [storageKey + ':profile', key],
        [storageKey + ':save', '2'],
      ]));
      const reloaded = new RoomConnection(code, profile);
      reloaded.connect = () => {};
      const attempts = [];
      reloaded.request = async (route, data) => {
        attempts.push({ route, data });
        return { id: 'new-player', session: 'new-session', state: { players: [{ id: 'new-player' }] } };
      };

      await reloaded.resume();
      assert.equal(attempts.length, 0);
      await reloaded.join('학생', 'navy');
      assert.equal(attempts.length, 1);
      assert.equal(attempts[0].route, 'join');
      assert.notEqual(attempts[0].data.joinKey, previousJoinKey);
    });
  }
});
