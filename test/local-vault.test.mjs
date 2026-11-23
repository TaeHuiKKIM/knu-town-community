import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import * as data from '../public/campus/local-data.js';
import * as storage from '../public/campus/local-vault.js';

const key = 'a'.repeat(64);
const otherKey = 'b'.repeat(64);
const initial = { name: '우리 기록', avatar: 'male', coat: 'navy' };
const sourceId = '00000000-0000-4000-8000-000000000001';
const start = Date.parse('2026-11-16T00:00:00+09:00');
const minute = 60_000;
const id = n => n.toString(16).padStart(32, '0');

async function makeVault(t, options = {}) {
  const vault = await storage.LocalVault.open({ indexedDB: new IDBFactory(), key, initial, ...options });
  t.after(() => vault.close());
  return vault;
}

function archive(sequence = [1, 2, 3, 4]) {
  return {
    sourceId,
    cursor: sequence.at(-1) ?? 0,
    hasMore: false,
    records: sequence.map(seq => ({
      sourceId, seq, id: id(seq), sessionId: '00000000-0000-4000-8000-000000000003',
      subject: '수학', goal: '기출 풀이', note: '기출 풀이',
      fromAt: start + (seq - 1) * 90 * minute, toAt: start + seq * 90 * minute,
      confirmedAt: start + seq * 90 * minute,
    })),
  };
}

function backup(profileKey, name) {
  return JSON.stringify(data.createState({ ...initial, key: profileKey, name }, start));
}

test('reopening prefers the committed profile over a legacy key', async t => {
  const indexedDB = new IDBFactory();
  const vault = await makeVault(t, { indexedDB });
  await vault.updateProfile({ name: '바뀐 이름', coat: 'forest', session: 'ignore-me' });
  await vault.syncRecords(archive([1]), key);
  vault.close();

  const reopened = await makeVault(t, { indexedDB, key: otherKey });
  assert.deepEqual(reopened.state.profile, { key, name: '바뀐 이름', avatar: 'male', coat: 'forest' });
  assert.equal(reopened.cursor(sourceId), 1);
  assert.doesNotMatch(await reopened.exportText(), /ignore-me/);
});

test('the same confirmation page can be retried and cursor follows committed unique records', async t => {
  const vault = await makeVault(t);
  const changes = [];
  vault.addEventListener('change', event => changes.push(event.detail.revision));
  await vault.syncRecords({ ...archive([1, 2]), hasMore: true }, key);
  await vault.syncRecords(archive([3]), key);
  await vault.syncRecords(archive([1, 2]), key);
  assert.equal(vault.cursor(sourceId), 3);
  assert.equal(vault.state.records.length, 3);
  assert.deepEqual(changes, [1, 2]);
});

test('merge retains the live cursor and later archive sync fills in earlier records', async t => {
  const indexedDB = new IDBFactory();
  const vault = await makeVault(t, { indexedDB });
  await vault.syncRecords(archive([1]), key);
  const incoming = { ...data.createState({ key, ...initial }, start), records: archive([3]).records };
  await vault.importText(JSON.stringify(incoming), { mode: 'merge' });
  assert.equal(vault.cursor(sourceId), 1);
  vault.close();

  const reopened = await makeVault(t, { indexedDB });
  assert.equal(reopened.cursor(sourceId), 1);
  await reopened.syncRecords(archive([2, 3]), key);
  assert.equal(reopened.cursor(sourceId), 3);
  assert.deepEqual(reopened.state.records.map(record => record.seq).sort(), [1, 2, 3]);
});

test('only live sync advances a cursor when replace and restore replay already stored records', async t => {
  const vault = await makeVault(t);
  await vault.syncRecords(archive([2]), key);
  const incoming = { ...data.createState({ key, ...initial }, start), records: archive([3]).records };
  await vault.importText(JSON.stringify(incoming), { mode: 'replace' });
  assert.equal(vault.cursor(sourceId), 0);
  await vault.syncRecords(archive([3]), key);
  assert.equal(vault.cursor(sourceId), 3);
  const [previous] = await vault.getSnapshots();
  await vault.restoreSnapshot(previous.id);
  assert.equal(vault.cursor(sourceId), 0);
  await vault.syncRecords(archive([2]), key);
  assert.equal(vault.cursor(sourceId), 2);
  assert.equal(vault.state.records.length, 1);
});

test('failed purchase and unauthorized theme leave the committed state intact after reopening', async t => {
  const indexedDB = new IDBFactory();
  const vault = await makeVault(t, { indexedDB });
  await vault.syncRecords(archive(), key);
  await vault.buy('focus-ginkgo', id(100));
  const previous = await vault.exportText();
  await assert.rejects(vault.buy('focus-lounge', id(101)), /씨앗/);
  await assert.rejects(vault.setTheme('focus-lounge'), /배경/);
  assert.equal(await vault.exportText(), previous);
  vault.close();
  const reopened = await makeVault(t, { indexedDB });
  assert.equal(await reopened.exportText(), previous);
  await reopened.setTheme('focus-ginkgo');
  assert.equal(reopened.state.settings.focusTheme, 'ginkgo');
});

test('concurrent tabs make purchases from the latest committed state', async t => {
  const indexedDB = new IDBFactory();
  const first = await makeVault(t, { indexedDB });
  const second = await makeVault(t, { indexedDB });
  await first.syncRecords(archive(), key);
  const results = await Promise.allSettled([
    first.buy('focus-ginkgo', id(100)), second.buy('focus-lounge', id(101)),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  await second.refresh();
  assert.equal(second.state.purchases.length, 1);
  assert.equal(await first.exportText(), await second.exportText());
});

test('late archive results cannot repopulate a save replaced in another tab', async t => {
  const indexedDB = new IDBFactory();
  const first = await makeVault(t, { indexedDB });
  const second = await makeVault(t, { indexedDB });
  const generation = second.generation;
  await first.importText(backup(key, '같은 소유자'), { mode: 'replace' });
  await assert.rejects(second.syncRecords(archive([1]), key, generation), { code: 'LOCAL_OWNER_CHANGED' });

  await first.importText(backup(otherKey, '다른 소유자'), { mode: 'replace' });
  await assert.rejects(second.syncRecords(archive([1]), key), { code: 'LOCAL_OWNER_CHANGED' });
  await second.refresh();
  assert.equal(second.state.profile.key, otherKey);
  assert.equal(second.state.records.length, 0);
});

test('a stale tab cannot merge or export after another tab replaces its owner', async t => {
  const indexedDB = new IDBFactory();
  const first = await makeVault(t, { indexedDB });
  const second = await makeVault(t, { indexedDB });
  const incoming = { ...data.createState({ key, ...initial }, start), records: archive([1]).records };
  await first.importText(backup(otherKey, '다른 소유자'), { mode: 'replace' });
  await assert.rejects(second.importText(JSON.stringify(incoming), { mode: 'merge' }), { code: 'LOCAL_OWNER_CHANGED' });
  await assert.rejects(second.exportText(), { code: 'LOCAL_OWNER_CHANGED' });
  assert.equal((await first.getSnapshots()).length, 1);
  assert.equal(first.state.records.length, 0);
});

test('an owner and generation pinned before refresh protect replacement, restore and export', async t => {
  const indexedDB = new IDBFactory();
  const first = await makeVault(t, { indexedDB });
  const second = await makeVault(t, { indexedDB });
  const guard = { expectedKey: key, expectedGeneration: second.generation };
  await first.importText(backup(key, '다른 저장본'), { mode: 'replace' });
  await second.refresh();
  const [previous] = await second.getSnapshots();
  await assert.rejects(second.importText(backup(otherKey, '다른 소유자'), {
    mode: 'replace', ...guard,
  }), { code: 'LOCAL_OWNER_CHANGED' });
  await assert.rejects(second.restoreSnapshot(previous.id, guard), { code: 'LOCAL_OWNER_CHANGED' });
  await assert.rejects(second.exportText(guard), { code: 'LOCAL_OWNER_CHANGED' });
  assert.equal(second.state.profile.name, '다른 저장본');
  assert.equal((await second.getSnapshots()).length, 1);
});

test('a failed merge stores neither conflicting data nor a new recovery snapshot', async t => {
  const vault = await makeVault(t);
  await vault.syncRecords(archive(), key);
  const previous = vault.state;
  const incoming = data.purchase(previous, { id: id(101), itemId: 'focus-lounge', at: start });
  await vault.buy('focus-ginkgo', id(100));
  const saved = await vault.exportText();
  await assert.rejects(vault.importText(JSON.stringify(incoming), { mode: 'merge' }), /씨앗/);
  assert.equal(await vault.exportText(), saved);
  assert.deepEqual(await vault.getSnapshots(), []);
});

test('an aborted import leaves both current records and recovery snapshots unchanged', async t => {
  const indexedDB = new IDBFactory();
  const vault = await makeVault(t, { indexedDB });
  await vault.syncRecords(archive([1]), key);
  const previous = await vault.exportText();
  let changeCount = 0;
  vault.addEventListener('change', () => changeCount++);

  // Interrupt actual IndexedDB requests after both writes have happened and
  // before the transaction commits, as when storage confirms a late failure.
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const request = put.apply(this, args);
    if (Array.isArray(args[0])) request.addEventListener('success', () => this.transaction.abort());
    return request;
  };
  try {
    await assert.rejects(vault.importText(backup(otherKey, '다른 소유자'), { mode: 'replace' }), /중단/);
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  assert.equal(changeCount, 0);
  assert.equal(vault.state.profile.key, key);
  vault.close();
  const reopened = await makeVault(t, { indexedDB });
  assert.equal(await reopened.exportText(), previous);
  assert.deepEqual(await reopened.getSnapshots(), []);
});

test('reapplying a backup skips needless revisions and keeps earlier recovery snapshots', async t => {
  const vault = await makeVault(t);
  const incoming = backup(otherKey, '다른 소유자');
  await vault.importText(incoming, { mode: 'replace' });
  const committed = vault.state;
  await vault.importText(incoming, { mode: 'replace' });
  assert.strictEqual(vault.state, committed);
  assert.equal((await vault.getSnapshots()).length, 1);
  assert.throws(() => { vault.state.profile.key = key; }, TypeError);
});

test('imports retain the three most recent recovery snapshots across reopen', async t => {
  const indexedDB = new IDBFactory();
  const vault = await makeVault(t, { indexedDB });
  for (const name of ['첫째', '둘째', '셋째', '넷째']) {
    await vault.importText(backup(key, name), { mode: 'replace' });
  }
  vault.close();
  const reopened = await makeVault(t, { indexedDB });
  const snapshots = await reopened.getSnapshots();
  assert.deepEqual(snapshots.map(snapshot => snapshot.state.profile.name), ['셋째', '둘째', '첫째']);
  await reopened.restoreSnapshot(snapshots[1].id);
  assert.equal(reopened.state.profile.name, '둘째');
  assert.ok(reopened.state.revision > snapshots[0].state.revision);
  assert.equal((await reopened.getSnapshots())[0].state.profile.name, '넷째');
});

test('rejected storage open leaves multiplayer callers free to handle the error', async () => {
  await assert.rejects(storage.LocalVault.open({ indexedDB: null, key, initial }), /저장/);
});

test('storage requests that never settle time out', async () => {
  await assert.rejects(storage.LocalVault.open({ indexedDB: { open: () => ({}) }, key, timeoutMs: 15 }), /오래 걸려요/);
});
