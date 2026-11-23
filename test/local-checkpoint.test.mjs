import test from 'node:test';
import assert from 'node:assert/strict';
import { CopyCheckpoint } from '../public/campus/local-checkpoint.js';
import { ArchiveSync } from '../public/campus/local-sync.js';

const key = 'a'.repeat(64);
const sourceId = '3e0fa72d-35d3-4c5d-8ef7-e3c2e3f85da0';
const marker = { sourceId, cursor: 2 };

function fixture({ me = null, service, summary = { active: null, archive: marker } } = {}) {
  const paths = [];
  const cursors = new Map();
  const vault = {
    state: { profile: { key } },
    generation: 1,
    cursor: id => cursors.get(id) ?? 0,
    async syncRecords(page) { cursors.set(page.sourceId, page.cursor); },
  };
  const room = {
    me, online: false, profileKey: key,
    async service(path, data) {
      paths.push([path, data]);
      return service ? service(path, data) : { study: summary };
    },
  };
  const study = {
    active: null,
    version: 0,
    busy: false,
    refreshing: false,
    accept(data) { this.active = data.active; },
  };
  let offline = false;
  const syncer = new ArchiveSync({ vault, room });
  const options = { vault, room, study, syncer, onOffline: () => { offline = true; } };
  return { ...options, paths, cursors, get offline() { return offline; }, checkpoint: new CopyCheckpoint(options) };
}

test('a waiting tab checks the shared profile and caches study active in another tab', async () => {
  const active = { id: 'studying' };
  const f = fixture({ summary: { active, archive: marker } });
  await assert.rejects(f.checkpoint.check(), { code: 'STUDY_ACTIVE' });
  assert.equal(f.study.active, active);
  assert.deepEqual(f.paths.map(([path]) => path), ['/api/study/me']);
});

test('a waiting tab with a host-confirmed idle profile can complete a copy without a participant stream', async () => {
  const f = fixture({
    service: async (path, data) => path === '/api/study/me'
      ? { study: { active: null, archive: marker } }
      : { sourceId, cursor: data.since + 1, hasMore: data.since === 0, records: [{ seq: data.since + 1 }] },
  });
  f.study.active = { id: 'old-cache' };
  assert.deepEqual(await f.checkpoint.check(), { mode: 'host' });
  assert.equal(f.study.active, null);
  assert.equal(f.vault.cursor(sourceId), 2);
  assert.deepEqual(f.paths.slice(1).map(([, data]) => data.since), [0, 1]);
});

test('401 certifies an absent profile only before joining', async () => {
  const denied = Object.assign(new Error('unauthorized'), { status: 401 });
  const service = async () => { throw denied; };
  const waiting = fixture({ service });
  const joined = fixture({ me: { id: 'me' }, service });
  assert.deepEqual(await waiting.checkpoint.check(), { mode: 'no-host-profile' });
  await assert.rejects(joined.checkpoint.check(), error => error === denied);
});

test('an absent profile response cannot override cached active study', async () => {
  const f = fixture({ service: async () => {
    throw Object.assign(new Error('unauthorized'), { status: 401 });
  } });
  f.study.active = { id: 'active' };
  await assert.rejects(f.checkpoint.check(), { code: 'STUDY_ACTIVE' });
});

test('HTTP failures do not enable local fallback', async () => {
  const denied = Object.assign(new Error('forbidden'), { status: 403 });
  const f = fixture({ service: async () => { throw denied; } });
  await assert.rejects(f.checkpoint.check(), error => error === denied);
  assert.equal(f.offline, false);
});

test('an unreachable host requires a separate explicit local-only retry', async () => {
  const f = fixture({ service: async () => { throw new Error('connection'); } });
  await assert.rejects(f.checkpoint.check(), { code: 'COPY_HOST_UNREACHABLE' });
  assert.equal(f.offline, true);
  assert.deepEqual(await f.checkpoint.check({ localOnly: true }), { mode: 'local' });
  assert.equal(f.paths.length, 1);
});

test('local-only mode cannot copy while a cached study is active', async () => {
  const f = fixture();
  f.study.active = { id: 'active' };
  await assert.rejects(f.checkpoint.check({ localOnly: true }), { code: 'STUDY_ACTIVE' });
  assert.equal(f.paths.length, 0);
});

test('a pending stop blocks both host and local-only checkpoints', async () => {
  const f = fixture();
  const checkpoint = new CopyCheckpoint({ ...f, hasPending: () => true });
  await assert.rejects(checkpoint.check(), { code: 'STUDY_ACTIVE' });
  await assert.rejects(checkpoint.check({ localOnly: true }), { code: 'STUDY_ACTIVE' });
  assert.equal(f.paths.length, 0);
});

test('a same-owner restore during the host check invalidates the checkpoint', async () => {
  const f = fixture({ service: async () => {
    f.vault.generation++;
    return { study: { active: null, archive: marker } };
  } });
  await assert.rejects(f.checkpoint.check(), { code: 'LOCAL_OWNER_CHANGED' });
  assert.equal(f.paths.length, 1);
});

test('local-only mode rejects a caller with a stale owner', async () => {
  const f = fixture();
  await assert.rejects(f.checkpoint.check({ localOnly: true, expectedKey: 'b'.repeat(64) }), {
    code: 'LOCAL_OWNER_CHANGED',
  });
});

test('an intervening study action invalidates an older summary even after the action finishes', async () => {
  const f = fixture({ service: async () => {
    f.study.version++;
    return { study: { active: null, archive: marker } };
  } });
  await assert.rejects(f.checkpoint.check(), { code: 'STUDY_BUSY' });
  assert.equal(f.paths.length, 1);
});

test('a summary refresh that starts during archive synchronization invalidates the checkpoint', async () => {
  const f = fixture({
    service: async path => {
      if (path === '/api/study/me') return { study: { active: null, archive: marker } };
      f.study.refreshing = true;
      return { sourceId, cursor: 2, hasMore: false, records: [{ seq: 2 }] };
    },
  });
  await assert.rejects(f.checkpoint.check(), { code: 'STUDY_BUSY' });
});

test('a malformed archive marker blocks a host copy', async () => {
  const f = fixture({ summary: { active: null, archive: { sourceId: '', cursor: 0 } } });
  await assert.rejects(f.checkpoint.check(), { code: 'COPY_ARCHIVE_INCOMPLETE' });
  assert.equal(f.paths.length, 1);
});

test('an archive page failure does not pass as a successful host copy', async () => {
  const f = fixture({
    service: async (path, data) => {
      if (path === '/api/study/me') return { study: { active: null, archive: marker } };
      if (data.since === 0) return { sourceId, cursor: 1, hasMore: true, records: [{ seq: 1 }] };
      throw new Error('connection');
    },
  });
  await assert.rejects(f.checkpoint.check(), { code: 'COPY_HOST_UNREACHABLE' });
  assert.equal(f.vault.cursor(sourceId), 1);
  assert.equal(f.offline, true);
});

test('a resolved archive flush still requires the captured cursor to be committed', async () => {
  const f = fixture();
  const checkpoint = new CopyCheckpoint({
    ...f,
    syncer: { async observe() {}, async flush() {} },
  });
  await assert.rejects(checkpoint.check(), { code: 'COPY_ARCHIVE_INCOMPLETE' });
  assert.equal(f.offline, false);
});
