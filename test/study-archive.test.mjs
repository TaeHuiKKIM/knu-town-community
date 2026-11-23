import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudyServer } from '../src/server.mjs';
import { StudyStore } from '../src/study-store.mjs';

const key = number => number.toString(16).padStart(64, '0');
const requestId = number => number.toString(16).padStart(32, '0');
const uuidV4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

function clock() {
  let at = Date.parse('2026-11-18T10:00:00+09:00');
  return { now: () => at, advance(ms) { at += ms; } };
}

function confirmation(session, number, note, stop = true) {
  return { sessionId: session.id, segmentStartAt: session.segmentStartAt, requestId: requestId(number), note, stop };
}

async function serve(t, now) {
  const server = createStudyServer({ hub: true, roomCode: 'archive-room', now });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise(resolve => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, data) => {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return { status: response.status, data: await response.json() };
  };
  return { base, post };
}

test('archive returns 500 records per page and the next cursor skips gaps from other profiles', t => {
  const time = clock();
  const store = new StudyStore(':memory:', { now: time.now });
  t.after(() => store.close());
  const owner = store.profile(key(1), '소유자', true);
  const peer = store.profile(key(2), '친구', true);
  const subject = '자료구조', goal = '트리 순회 복습', note = '트리 순회 5문제 풀이';
  const session = store.start(owner.id, subject, goal);
  const peerSession = store.start(peer.id, '수학', '비밀 목표');

  let active = session;
  for (let n = 1; n <= 501; n++) {
    time.advance(60000);
    active = store.confirm(owner.id, confirmation(active, n, note, false)).active;
    if (n === 250) store.confirm(peer.id, confirmation(peerSession, 502, '비밀 노트'));
  }

  const first = store.archive(owner.id);
  assert.match(first.sourceId, uuidV4);
  assert.equal(first.hasMore, true);
  assert.equal(first.records.length, 500);
  assert.equal(first.cursor, 501);
  assert.deepEqual(first.records.map(record => record.seq), Array.from({ length: 500 }, (_, i) => i < 250 ? i + 1 : i + 2));
  assert.deepEqual(first.records[0], {
    sourceId: first.sourceId, seq: 1, id: requestId(1), sessionId: session.id, subject, goal, note,
    fromAt: session.segmentStartAt, toAt: session.segmentStartAt + 60000, confirmedAt: session.segmentStartAt + 60000,
  });
  assert.deepEqual(store.archive(owner.id, 0), first);
  const last = store.archive(owner.id, first.cursor);
  assert.equal(last.hasMore, false);
  assert.deepEqual(last.records.map(record => record.id), [requestId(501)]);
  assert.equal(last.cursor, 502);
  assert.deepEqual(store.archive(owner.id, first.cursor), last);
  const exact = store.archive(owner.id, first.records[0].seq);
  assert.equal(exact.records.length, 500);
  assert.equal(exact.cursor, 502);
  assert.equal(exact.hasMore, false);
  assert.deepEqual(store.archive(owner.id, last.cursor), { sourceId: first.sourceId, cursor: 502, hasMore: false, records: [] });
  assert.deepEqual(store.archive(owner.id, 999), { sourceId: first.sourceId, cursor: 999, hasMore: false, records: [] });
  assert.deepEqual(store.summary(owner.id).archive, { sourceId: first.sourceId, cursor: 502 });
  assert.deepEqual(store.summary(peer.id).archive, { sourceId: first.sourceId, cursor: 251 });
});

test('archive marker and records survive reopening the same database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knu-study-archive-'));
  const path = join(dir, 'archive.sqlite');
  const time = clock();
  let store;
  try {
    store = new StudyStore(path, { now: time.now });
    const profile = store.profile(key(1), '소유자', true);
    const active = store.start(profile.id, '수학', '적분 5문제');
    time.advance(60000);
    store.confirm(profile.id, confirmation(active, 1, '적분 풀이 완료'));
    const archive = store.archive(profile.id);
    assert.match(archive.sourceId, uuidV4);
    store.close();

    store = new StudyStore(path, { now: time.now });
    assert.deepEqual(store.archive(store.profile(key(1)).id), archive);
    assert.deepEqual(store.summary(profile.id).archive, { sourceId: archive.sourceId, cursor: archive.cursor });
    const other = new StudyStore();
    try {
      const otherProfile = other.profile(key(1), '소유자', true);
      assert.notEqual(other.archive(otherProfile.id).sourceId, archive.sourceId);
    } finally { other.close(); }
  } finally {
    store?.close();
    rmSync(path, { force: true });
    rmSync(path + '-wal', { force: true });
    rmSync(path + '-shm', { force: true });
    rmdirSync(dir);
  }
});

test('archive accepts only nonnegative safe integer cursors', t => {
  const store = new StudyStore();
  t.after(() => store.close());
  const profile = store.profile(key(1), '소유자', true);
  for (const since of [-1, null, '0', 1.25, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => store.archive(profile.id, since), { status: 400 });
  }
});

test('archive preserves integer ms for legacy fractional stop times', t => {
  const time = clock();
  const store = new StudyStore(':memory:', { now: time.now });
  t.after(() => store.close());
  const profile = store.profile(key(1), '소유자', true);
  const active = store.start(profile.id, '수학', '적분 5문제');
  const receipt = confirmation(active, 1, '적분 풀이 완료');
  time.advance(60000);
  const stopAt = time.now() - 0.25;
  store.confirm(profile.id, { ...receipt, stopAt });
  assert.equal(store.archive(profile.id).records[0].toAt, Math.floor(stopAt));
});

test('archive HTTP requests require an existing key and use only its confirmed records', async t => {
  const time = clock();
  const { base, post } = await serve(t, time.now);
  const ownerKey = key(1), peerKey = key(2);
  const archive = data => post('/api/study/archive', data);
  const owner = await post('/api/archive-room/join', { name: '소유자', profileKey: ownerKey });
  const peer = await post('/api/archive-room/join', { name: '친구', profileKey: peerKey });
  assert.equal(owner.status, 200);
  assert.equal(peer.status, 200);

  const goal = '나만 보는 목표', note = '나만 보는 노트';
  const { data: { study } } = await post('/api/study/start', { profileKey: ownerKey, subject: '전공', goal });
  const ownerId = study.profile.id;
  const pending = await archive({ profileKey: ownerKey });
  assert.equal(pending.status, 200);
  assert.deepEqual(pending.data, { sourceId: study.archive.sourceId, cursor: 0, hasMore: false, records: [] });

  time.advance(60000);
  const confirmed = await post('/api/study/confirm', { profileKey: ownerKey, ...confirmation(study.active, 1, note, false) });
  assert.equal(confirmed.status, 200);
  time.advance(60000);
  const downloaded = await archive({ profileKey: ownerKey });
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.data.records.length, 1);
  assert.equal(downloaded.data.records[0].goal, goal);
  assert.equal(downloaded.data.records[0].note, note);
  assert.equal(downloaded.data.records[0].toAt, time.now() - 60000);
  assert.deepEqual(confirmed.data.study.archive, { sourceId: downloaded.data.sourceId, cursor: downloaded.data.cursor });
  for (const since of [null, '0', -1, 1.25, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await archive({ profileKey: ownerKey, since })).status, 400);
  }
  assert.equal((await archive({ profileKey: key(3), profileId: ownerId })).status, 401);
  const peerArchive = await archive({ profileKey: peerKey, profileId: ownerId });
  assert.equal(peerArchive.status, 200);
  assert.deepEqual(peerArchive.data.records, []);

  const ranking = await post('/api/study/ranking', { profileKey: peerKey, scope: 'today' });
  assert.equal(ranking.data.rows[0].ms, 60000);
  const stream = await fetch(`${base}/api/archive-room/events?session=${peer.data.session}`, { signal: AbortSignal.timeout(3000) });
  assert.equal(stream.status, 200);
  const decoder = new TextDecoder();
  let frame = '';
  for await (const chunk of stream.body) {
    frame += decoder.decode(chunk, { stream: true });
    if (frame.includes('\n\n')) break;
  }
  assert.match(frame, /^data: .*소유자.*\n\n/);
  const ownerHash = createHash('sha256').update(ownerKey).digest('hex');
  for (const secret of [goal, note, ownerKey, ownerHash, downloaded.data.sourceId]) {
    assert.equal(frame.includes(secret), false);
    assert.equal(JSON.stringify(ranking.data).includes(secret), false);
  }
  for (const secret of [ownerKey, ownerHash, peerKey]) {
    assert.equal(JSON.stringify(downloaded.data).includes(secret), false);
  }
});
