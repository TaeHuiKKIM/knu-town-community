import assert from 'node:assert/strict';
import test from 'node:test';
import * as data from '../public/campus/local-data.js';

const key = 'a'.repeat(64);
const profile = { key, name: '공부하는 개미', avatar: 'female', coat: 'forest' };
const firstSource = '00000000-0000-4000-8000-000000000001';
const secondSource = '00000000-0000-4000-8000-000000000002';
const midnight = Date.parse('2026-11-16T00:00:00+09:00'); // Monday in Korea
const minute = 60_000;
const id = n => n.toString(16).padStart(32, '0');

function record(n, startMinute, endMinute, sourceId = firstSource) {
  const fromAt = midnight + startMinute * minute;
  const toAt = midnight + endMinute * minute;
  return {
    sourceId, seq: n, id: id(n), sessionId: '00000000-0000-4000-8000-000000000003',
    subject: '수학', goal: '기출 풀기', note: '기출 풀이', fromAt, toAt, confirmedAt: toAt,
  };
}

function state(records = [], preferences = profile) {
  return { ...data.createState(preferences, midnight), records };
}

function dayOfStudy(offset = 0, base = 0, source = firstSource) {
  return Array.from({ length: 5 }, (_, i) => record(base + i + 1, offset + i * 90, offset + (i + 1) * 90, source));
}

test('unions overlapping confirmations across sources and splits KST day/week at midnight', () => {
  const a = state([record(1, -12, 8), record(2, 30, 34)]);
  const b = state([record(3, -7, 3, secondSource), record(4, 3, 10, secondSource)]);
  const combined = data.mergeStates(a, b);
  const stats = data.summary(combined, midnight + minute * 35);
  assert.equal(stats.totalMs, 26 * minute);
  assert.equal(stats.todayMs, 14 * minute);
  assert.equal(stats.weekMs, 14 * minute);
  assert.equal(stats.rewardMs, 26 * minute);
  assert.equal(stats.earnedSeeds, 2);
  assert.equal(stats.balance, 2);
  assert.equal(stats.recent[0].id, id(2));
  assert.deepEqual(data.mergeStates(combined, combined), combined);
});

test('caps each KST day at 6 hours and combines partial seed credit', () => {
  const save = state([...dayOfStudy(), record(6, 1_440, 1_445), record(7, 2_880, 2_885)]);
  const stats = data.summary(save, midnight + 2_886 * minute);
  assert.equal(stats.totalMs, 460 * minute);
  assert.equal(stats.todayMs, 5 * minute);
  assert.equal(stats.weekMs, 460 * minute);
  assert.equal(stats.rewardMs, 370 * minute);
  assert.equal(stats.earnedSeeds, 37);
});

test('keeps a zero-duration confirmation as a record without giving credit', () => {
  const save = data.parseBackup(JSON.stringify(state([record(1, 0, 0)])));
  assert.equal(data.summary(save, midnight).earnedSeeds, 0);
  assert.equal(data.summary(save, midnight).recent.length, 1);
});

test('replayed purchases and repeated item selections cost seeds only once', () => {
  const initial = state(dayOfStudy());
  const order = { id: id(100), itemId: 'focus-ginkgo', at: midnight };
  const bought = data.purchase(initial, order);
  assert.deepEqual(data.summary(bought, midnight).ownedItemIds, ['plain', 'focus-ginkgo']);
  assert.equal(data.summary(bought, midnight).balance, 12);
  assert.deepEqual(data.purchase(bought, order), bought);
  assert.deepEqual(data.purchase(bought, { ...order, id: id(101) }), bought);
  assert.throws(() => data.purchase(bought, { ...order, itemId: 'focus-lounge' }), /충돌/);
  assert.throws(() => data.purchase(bought, { ...order, id: id(102), itemId: 'focus-lounge' }), /씨앗/);
});

test('merge deduplicates purchases for one item and retains the current profile', () => {
  const initial = state(dayOfStudy());
  const copied = state(dayOfStudy(), { ...profile, name: '같은 프로필의 옛 이름' });
  const a = data.purchase(initial, { id: id(100), itemId: 'focus-ginkgo', at: midnight });
  const b = data.purchase(copied, { id: id(101), itemId: 'focus-ginkgo', at: midnight });
  const combined = data.mergeStates(a, b);
  assert.equal(combined.profile.key, key);
  assert.equal(combined.profile.name, profile.name);
  assert.equal(data.summary(combined, midnight).balance, 12);
  assert.throws(() => data.purchase(combined, { id: id(101), itemId: 'focus-lounge', at: midnight }), /충돌/);
});

test('rejects a merge between different profile keys even when records are identical', () => {
  const original = state(dayOfStudy());
  const another = state(dayOfStudy(), { ...profile, key: 'b'.repeat(64) });
  assert.throws(() => data.mergeStates(original, another), /프로필/);
});

test('rejects a merge with conflicting confirmations or unaffordable independent purchases', () => {
  const initial = state(dayOfStudy());
  const ginkgo = data.purchase(initial, { id: id(100), itemId: 'focus-ginkgo', at: midnight });
  const lounge = data.purchase(initial, { id: id(101), itemId: 'focus-lounge', at: midnight });
  assert.throws(() => data.mergeStates(ginkgo, lounge), /씨앗/);
  assert.throws(() => data.mergeStates(initial, state([{ ...initial.records[0], note: '다른 기록' }])), /충돌/);
  assert.throws(() => data.mergeStates(initial, state([{ ...initial.records[0], id: id(104) }])), /충돌/);
});

test('requires the same full payload when merging the same purchase ID', () => {
  const initial = state(dayOfStudy());
  const order = { id: id(100), itemId: 'focus-ginkgo', at: midnight };
  assert.throws(() => data.mergeStates(data.purchase(initial, order),
    data.purchase(initial, { ...order, at: midnight + 1 })), /충돌/);
});

test('backup parsing validates format, version, record span, fields and size', () => {
  const initial = state([record(1, 0, 90)]);
  assert.throws(() => data.parseBackup('<bad-json>'), /JSON/);
  assert.throws(() => data.parseBackup(JSON.stringify({ ...initial, version: 2 })), /버전/);
  assert.throws(() => data.parseBackup(JSON.stringify({ ...initial, records: [record(1, 0, 91)] })), /90분/);
  for (const field of ['subject', 'goal', 'note']) {
    assert.throws(() => data.parseBackup(JSON.stringify({
      ...initial, records: [{ ...initial.records[0], [field]: 'x' }],
    })), /기록/);
  }
  for (const change of [{ sourceId: 'wrong' }, { seq: 0 }, { sessionId: 'wrong' }, { confirmedAt: -1 }]) {
    assert.throws(() => data.parseBackup(JSON.stringify({
      ...initial, records: [{ ...initial.records[0], ...change }],
    })), /기록/);
  }
  assert.throws(() => data.parseBackup(JSON.stringify({
    ...initial, records: Array(data.MAX_RECORDS + 1).fill(initial.records[0]),
  })), /20,000/);
  assert.throws(() => data.parseBackup('가'.repeat(Math.ceil(data.MAX_BACKUP_BYTES / 3) + 1)), /20\s*MiB/);
});

test('whitelists the saved shape and rejects a focus theme without ownership', () => {
  const initial = state([record(1, 0, 10)]);
  const raw = {
    ...initial, lanSession: 'test-only-lan-field',
    profile: { ...profile, session: 'test-only-session-field' },
    records: [{ ...initial.records[0], roomCode: 'test-only-room-code' }],
  };
  assert.deepEqual(data.parseBackup(JSON.stringify(raw)), initial);
  assert.throws(() => data.parseBackup(JSON.stringify({
    ...initial, settings: { focusTheme: 'focus-lounge' },
  })), /배경/);
});
test('seed boxes restore the same prize, never repeat a collected theme and reject overspending', () => {
  const initial = state(dayOfStudy());
  const first = data.openSeedBox(initial, id(10), midnight);
  assert.equal(first.purchases.length, 1);
  assert.equal(data.summary(first).balance, 24);
  const restored = data.parseBackup(data.serializeBackup(first));
  assert.equal(data.openSeedBox(restored, id(10), midnight + minute), restored);
  const second = data.openSeedBox(restored, id(11), midnight);
  assert.notEqual(second.purchases[0].itemId, second.purchases[1].itemId);
  assert.equal(data.summary(second).balance, 12);
  assert.throws(() => data.openSeedBox(second, id(12), midnight), /모두/);
  assert.throws(() => data.openSeedBox(state(), id(10), midnight), /씨앗/);
});

test('outfit boxes unlock both matching avatars, survive backup, and skip time-earned sets', () => {
  const wallet = state([record(1, 0, 85)]);
  const won = data.openSeedBox(wallet, id(1), midnight, 'outfit');
  assert.equal(data.summary(won).balance, 0);
  assert.equal(won.purchases[0].itemId, 'wear-campus');
  const dressed = data.updateAppearance(won, { style: 'female-offshoulder' });
  const restored = data.parseBackup(data.serializeBackup(dressed));
  assert.equal(restored.profile.style, 'female-offshoulder');
  assert.equal(data.openSeedBox(restored, id(1), midnight, 'outfit'), restored);
  assert.equal(data.updateAppearance(restored, { avatar: 'male', style: 'male-hoodie' }).profile.style, 'male-hoodie');
  assert.throws(() => data.openSeedBox(wallet, id(1), midnight + minute, 'bad'));
  assert.throws(() => data.openSeedBox(won, id(2), midnight, 'outfit'), /씨앗/);
  assert.deepEqual(data.remainingOutfitSets(3 * 3600000, []), ['wear-campus']);
  assert.deepEqual(data.remainingOutfitSets(10 * 3600000, []), []);
  assert.throws(() => data.openSeedBox(won, id(1), midnight), /겹쳐/);
});
