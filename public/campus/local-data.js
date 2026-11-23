import { CHECK_MS, dayWindow, weekWindow } from './study-time.js';
import { AVATARS, COATS } from './world.js';
import { canWearStyle, styleForAvatar, OUTFIT_BOX_SETS, studyStyle } from './wardrobe.js';

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
export const MAX_RECORDS = 20_000;
export const BOX_PRICE = 12;
export const BOX_THEMES = Object.freeze(['focus-sunset', 'focus-moonlight']);
export const OUTFIT_BOX_PRICE = 8;
export const CATALOG = Object.freeze([
  ...Object.keys(OUTFIT_BOX_SETS).map(id => Object.freeze({ id, cost: OUTFIT_BOX_PRICE })),
  ...BOX_THEMES.map(id => Object.freeze({ id, cost: BOX_PRICE })),
  Object.freeze({ id: 'play-bump', cost: 6 }),
  Object.freeze({ id: 'plain', cost: 0 }),
  Object.freeze({ id: 'focus-ginkgo', cost: 24 }),
  Object.freeze({ id: 'focus-lounge', cost: 36 }),
]);

const FORMAT = 'knu-town-local';
const VERSION = 1;
const REWARD_CAP_MS = 6 * 60 * 60 * 1000;
const SEED_MS = 10 * 60 * 1000;
const KEY = /^[a-f0-9]{64}$/;
const COMMAND_ID = /^[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const prices = new Map(CATALOG.map(({ id, cost }) => [id, cost]));
const themeItems = new Map([['plain', 'plain'], ['ginkgo', 'focus-ginkgo'], ['lounge', 'focus-lounge'], ['sunset', 'focus-sunset'], ['moonlight', 'focus-moonlight']]);

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function counter(value) { return Number.isSafeInteger(value) && value >= 0; }
function epoch(value) { return counter(value) && value <= 8_640_000_000_000_000; }
function identifier(value, pattern) { return typeof value === 'string' && pattern.test(value); }
function cleanText(value, min, max) {
  return typeof value === 'string' && value === value.trim()
    && value.length >= min && value.length <= max && !CONTROL.test(value);
}

export function cleanProfile(profile) {
  if (!isObject(profile)) throw new Error('저장할 프로필 정보를 확인해주세요.');
  const { key, name, avatar, coat, style } = profile;
  if (!identifier(key, KEY) || !cleanText(name, 0, 16) || !AVATARS.includes(avatar) || !COATS.includes(coat)
    || style != null && !styleForAvatar(style, avatar)) {
    throw new Error('저장할 프로필 정보를 확인해주세요.');
  }
  return { key, name, avatar, coat, ...(style ? { style } : {}) };
}

function cleanRecord(value) {
  if (!isObject(value)) throw new Error('공부 기록이 올바르지 않아요.');
  const { sourceId, seq, id, sessionId, subject, goal, note, fromAt, toAt, confirmedAt } = value;
  if (!identifier(sourceId, UUID) || !counter(seq) || seq === 0 || !identifier(id, COMMAND_ID)
    || !identifier(sessionId, UUID) || !cleanText(subject, 2, 30) || !cleanText(goal, 2, 120)
    || !cleanText(note, 2, 160) || !epoch(fromAt) || !epoch(toAt) || !epoch(confirmedAt)
    || fromAt > toAt || toAt > confirmedAt) {
    throw new Error('공부 기록이 올바르지 않아요.');
  }
  if (toAt - fromAt > CHECK_MS) throw new Error('공부 확인 기록은 90분 이하여야 해요.');
  return { sourceId, seq, id, sessionId, subject, goal, note, fromAt, toAt, confirmedAt };
}

function cleanPurchase(value) {
  if (!isObject(value)) throw new Error('구매 기록이 올바르지 않아요.');
  const { id, itemId, at } = value;
  if (!identifier(id, COMMAND_ID) || !prices.has(itemId) || !epoch(at)) {
    throw new Error('구매 기록이 올바르지 않아요.');
  }
  return { id, itemId, at };
}

function validateCount(list, label) {
  if (!Array.isArray(list)) throw new Error(`${label} 목록이 올바르지 않아요.`);
  if (list.length > MAX_RECORDS) throw new Error(`${label}은 최대 20,000개까지 저장할 수 있어요.`);
}

function sameRecord(a, b) {
  return a.seq === b.seq && a.sourceId === b.sourceId && a.sessionId === b.sessionId
    && a.subject === b.subject && a.goal === b.goal && a.note === b.note
    && a.fromAt === b.fromAt && a.toAt === b.toAt && a.confirmedAt === b.confirmedAt;
}

function samePurchase(a, b) { return a.itemId === b.itemId && a.at === b.at; }

export function mergeRecords(current, incoming) {
  validateCount(incoming, '공부 기록');
  const byId = new Map(current.map(record => [record.id, record]));
  const bySequence = new Set(current.map(record => `${record.sourceId}:${record.seq}`));
  const added = [];
  for (const value of incoming) {
    const record = cleanRecord(value);
    const old = byId.get(record.id);
    if (old) {
      if (!sameRecord(old, record)) throw new Error('공부 기록 ID가 기존 기록과 충돌해요.');
      continue;
    }
    const sequence = `${record.sourceId}:${record.seq}`;
    if (bySequence.has(sequence)) throw new Error('같은 장치의 공부 기록 순서가 충돌해요.');
    byId.set(record.id, record);
    bySequence.add(sequence);
    added.push(record);
  }
  if (!added.length) return current;
  const merged = [...current, ...added];
  validateCount(merged, '공부 기록');
  return merged;
}

export function readArchive(archive) {
  if (!isObject(archive) || !identifier(archive.sourceId, UUID)
    || !counter(archive.cursor) || typeof archive.hasMore !== 'boolean') {
    throw new Error('공부 기록 페이지를 읽을 수 없어요.');
  }
  validateCount(archive.records, '공부 기록');
  let maxSeq = 0;
  for (const record of archive.records) {
    if (!isObject(record) || record.sourceId !== archive.sourceId || !counter(record.seq)) {
      throw new Error('공부 기록의 출처를 확인해주세요.');
    }
    maxSeq = Math.max(maxSeq, record.seq);
  }
  if ((archive.records.length && maxSeq !== archive.cursor) || (archive.hasMore && !archive.records.length)) {
    throw new Error('공부 기록 페이지의 순서가 올바르지 않아요.');
  }
  return archive.records;
}

function mergePurchases(current, incoming) {
  validateCount(incoming, '구매 기록');
  const byId = new Map(current.map(value => [value.id, value]));
  const added = [];
  for (const value of incoming) {
    const purchase = cleanPurchase(value);
    const old = byId.get(purchase.id);
    if (old) {
      if (!samePurchase(old, purchase)) throw new Error('구매 ID가 기존 기록과 충돌해요.');
      continue;
    }
    if (purchase.itemId === 'plain') throw new Error('기본 배경은 구매 기록을 만들지 않아요.');
    byId.set(purchase.id, purchase);
    added.push(purchase);
  }
  if (!added.length) return current;
  const merged = [...current, ...added];
  validateCount(merged, '구매 기록');
  return merged;
}

function intervalTotals(records, at) {
  const intervals = records.filter(record => record.toAt > record.fromAt)
    .sort((a, b) => a.fromAt - b.fromAt || a.toAt - b.toAt);
  const today = dayWindow(at);
  const week = weekWindow(at);
  const daily = new Map();
  let totalMs = 0, todayMs = 0, weekMs = 0;
  const overlap = (start, end, window) => Math.max(0, Math.min(end, window.end) - Math.max(start, window.start));

  function count(start, end) {
    totalMs += end - start;
    todayMs += overlap(start, end, today);
    weekMs += overlap(start, end, week);
    while (start < end) {
      const day = dayWindow(start);
      const partEnd = Math.min(end, day.end);
      daily.set(day.start, Math.min(REWARD_CAP_MS, (daily.get(day.start) ?? 0) + partEnd - start));
      start = partEnd;
    }
  }

  let start = 0, end = 0;
  for (const { fromAt, toAt } of intervals) {
    if (fromAt > end) {
      if (end > start) count(start, end);
      start = fromAt;
    }
    end = Math.max(end, toAt);
  }
  if (end > start) count(start, end);
  const rewardMs = [...daily.values()].reduce((sum, ms) => sum + ms, 0);
  return { totalMs, todayMs, weekMs, rewardMs };
}

function inventory(state, rewardMs) {
  const items = new Set(state.purchases.map(purchase => purchase.itemId));
  const owned = CATALOG.filter(item => item.id === 'plain' || items.has(item.id));
  const earnedSeeds = Math.floor(rewardMs / SEED_MS);
  const spentSeeds = owned.reduce((sum, item) => sum + item.cost, 0);
  return { earnedSeeds, balance: earnedSeeds - spentSeeds, ownedItemIds: owned.map(item => item.id) };
}

function checkInventory(state) {
  const { rewardMs } = intervalTotals(state.records, state.updatedAt);

  const { balance, ownedItemIds } = inventory(state, rewardMs);
  checkStyleReward(state.profile, rewardMs, ownedItemIds);
  if (balance < 0) throw new Error('공부 기록에서 얻은 씨앗보다 구매 비용이 많아요.');
  if (!ownedItemIds.includes(themeItems.get(state.settings.focusTheme))) {
    throw new Error('보유한 집중 배경만 사용할 수 있어요.');
  }
}

function checkStyleReward(profile, rewardMs, owned) {
  if (!canWearStyle(profile.style, profile.avatar, rewardMs, owned)) throw new Error('확인한 공부 시간이 더 필요해요.');
}

export function updateAppearance(state, patch) {
  const appearance = { ...state.profile, ...patch, key: state.profile.key };
  if (appearance.avatar !== state.profile.avatar && !Object.hasOwn(patch, 'style')) delete appearance.style;
  const profile = cleanProfile(appearance);
  if (profile.style !== state.profile.style && profile.style) {
    checkStyleReward(profile, intervalTotals(state.records, state.updatedAt).rewardMs, state.purchases.map(item => item.itemId));
  }
  if (profile.name === state.profile.name && profile.avatar === state.profile.avatar
    && profile.coat === state.profile.coat && profile.style === state.profile.style) return state;
  return { ...state, profile };
}

export function setFocusTheme(state, value) {
  const focusTheme = value === 'focus-ginkgo' || value === 'focus-lounge' ? value.slice(6) : value;
  const itemId = themeItems.get(focusTheme);
  if (!itemId || (itemId !== 'plain' && !state.purchases.some(purchase => purchase.itemId === itemId))) {
    throw new Error('보유한 집중 배경만 사용할 수 있어요.');
  }
  if (focusTheme === state.settings.focusTheme) return state;
  return { ...state, settings: { focusTheme } };
}

export function createState(profile, now = Date.now()) {
  if (!epoch(now)) throw new Error('저장 시간을 확인해주세요.');
  const appearance = cleanProfile(profile);
  checkStyleReward(appearance, 0);
  return {
    format: FORMAT, version: VERSION, profile: appearance,
    records: [], purchases: [], settings: { focusTheme: 'plain' }, revision: 0, updatedAt: now,
  };
}

function checkSize(text) {
  // Every UTF-16 code unit takes at least one byte in UTF-8.
  if (text.length > MAX_BACKUP_BYTES || new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
    throw new Error('백업 파일은 20 MiB까지 사용할 수 있어요.');
  }
}

export function serializeBackup(state) {
  const text = JSON.stringify(state);
  checkSize(text);
  return text;
}

export function parseBackup(text) {
  if (typeof text !== 'string') throw new Error('백업은 JSON 파일이어야 해요.');
  checkSize(text);
  let input;
  try { input = JSON.parse(text); }
  catch { throw new Error('백업 파일의 JSON을 읽지 못했어요.'); }
  if (!isObject(input) || input.format !== FORMAT) throw new Error('경북대 타운 백업 형식이 아니에요.');
  if (input.version !== VERSION) throw new Error('지원하지 않는 백업 버전이에요.');
  if (!epoch(input.updatedAt) || !counter(input.revision)) throw new Error('백업의 저장 정보를 확인해주세요.');
  if (!isObject(input.settings) || !themeItems.has(input.settings.focusTheme)) {
    throw new Error('백업의 집중 배경 정보를 확인해주세요.');
  }
  const state = {
    format: FORMAT, version: VERSION, profile: cleanProfile(input.profile),
    records: mergeRecords([], input.records), purchases: mergePurchases([], input.purchases),
    settings: { focusTheme: input.settings.focusTheme }, revision: input.revision, updatedAt: input.updatedAt,
  };
  checkInventory(state);
  return state;
}

export function mergeStates(current, incoming) {
  if (current.profile.key !== incoming.profile.key) throw new Error('같은 프로필의 백업만 합칠 수 있어요.');
  const records = mergeRecords(current.records, incoming.records);
  const purchases = mergePurchases(current.purchases, incoming.purchases);
  if (records === current.records && purchases === current.purchases) return current;
  const next = { ...current, records, purchases };
  checkInventory(next);
  serializeBackup(next);
  return next;
}

export function summary(state, at = Date.now()) {
  const totals = intervalTotals(state.records, at);
  const recent = state.records.slice().sort((a, b) => b.confirmedAt - a.confirmedAt || b.toAt - a.toAt)
    .slice(0, 10);
  return { ...totals, ...inventory(state, totals.rewardMs), theme: state.settings.focusTheme, recent };
}

export function purchase(state, command) {
  const value = cleanPurchase(command);
  const used = state.purchases.find(purchase => purchase.id === value.id);
  if (used) {
    if (!samePurchase(used, value)) throw new Error('구매 ID가 기존 기록과 충돌해요.');
    return state;
  }
  if (value.itemId === 'plain' || state.purchases.some(purchase => purchase.itemId === value.itemId)) return state;
  const next = { ...state, purchases: [...state.purchases, value] };
  validateCount(next.purchases, '구매 기록');
  checkInventory(next);
  return next;
}

export function remainingOutfitSets(rewardMs, owned) {
  return Object.entries(OUTFIT_BOX_SETS).filter(([id, set]) =>
    !owned.includes(id) && set.styles.some(style => studyStyle(style).requiredMs > rewardMs)
  ).map(([id]) => id);
}

export function openSeedBox(state, id, at, kind = 'theme') {
  if (!['theme', 'outfit'].includes(kind)) throw new Error('상자 종류를 확인해주세요.');
  const outfit = kind === 'outfit';
  const pool = outfit ? Object.keys(OUTFIT_BOX_SETS) : BOX_THEMES;
  if (!identifier(id, COMMAND_ID)) throw new Error('상자 번호를 확인해주세요.');
  const receipt = state.purchases.find(item => item.id === id);
  if (receipt) {
    if (!pool.includes(receipt.itemId)) throw new Error('구매 번호가 겹쳐요.');
    return state;
  }
  const totals = summary(state);
  const available = outfit ? remainingOutfitSets(totals.rewardMs, totals.ownedItemIds) : BOX_THEMES.filter(itemId => !state.purchases.some(item => item.itemId === itemId));
  if (!available.length) throw new Error(outfit ? '상자 코디를 모두 열었어요.' : '상자 배경을 모두 모았어요.');
  const index = parseInt(id.slice(-2), 16) % available.length;
  return purchase(state, { id, at, itemId: available[index] });
}
