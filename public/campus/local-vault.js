import {
  openSeedBox, createState, mergeRecords, mergeStates, parseBackup, purchase, readArchive,
  serializeBackup, setFocusTheme, updateAppearance,
} from './local-data.js';

const DB_NAME = 'knu-town-local';
const STORE = 'vault';
const HEAD = 'current';
const RECOVERY = 'pre-import';
const SNAPSHOT_LIMIT = 3;
const OPEN_TIMEOUT_MS = 4000;

function openDatabase(factory, name, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!factory) {
      reject(new Error('이 브라우저에서 기록을 저장할 수 없어요.'));
      return;
    }
    const request = factory.open(name, 1);
    let finished = false;
    const timer = setTimeout(() => fail(new Error('브라우저 저장을 여는 데 시간이 너무 오래 걸려요.')), timeoutMs);
    function fail(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(error);
    }
    request.onupgradeneeded = () => {
      if (finished) {
        request.transaction.abort();
        return;
      }
      request.result.createObjectStore(STORE);
    };
    request.onblocked = () => fail(new Error('다른 탭에서 브라우저 저장을 사용 중이에요. 해당 탭을 닫고 다시 열어주세요.'));
    request.onerror = () => fail(request.error);
    request.onsuccess = () => {
      const db = request.result;
      if (finished) {
        db.close();
        return;
      }
      finished = true;
      clearTimeout(timer);
      resolve(db);
    };
  });
}

// Apply and write from the request callback while the IndexedDB transaction is active.
// Its completion event is the only success signal for a state or recovery snapshot.
function transact(db, { mode, recovery = false, timeoutMs }, apply) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const current = store.get(HEAD);
    const backups = recovery ? store.get(RECOVERY) : null;
    let error;
    let result;
    const timer = timeoutMs === undefined ? undefined : setTimeout(
      () => abort(new Error('브라우저 저장을 읽는 데 시간이 너무 오래 걸려요.')), timeoutMs,
    );
    function abort(reason) {
      error = reason;
      try { tx.abort(); }
      catch (abortError) {
        // A completed transaction may be waiting to deliver its completion event.
        if (abortError.name !== 'InvalidStateError') throw abortError;
      }
    }
    tx.onabort = () => {
      clearTimeout(timer);
      reject(error ?? tx.error ?? new Error('브라우저 저장이 중단됐어요.'));
    };
    tx.oncomplete = () => {
      clearTimeout(timer);
      resolve(result);
    };
    function process() {
      try {
        const previous = current.result;
        const snapshots = backups?.result ?? [];
        result = apply(previous, snapshots);
        if (result.head !== previous) store.put(result.head, HEAD);
        if (result.snapshots !== snapshots) store.put(result.snapshots, RECOVERY);
      } catch (reason) {
        abort(reason);
      }
    }
    // Reads are queued in order, so the last successful read can use both results.
    (backups ?? current).onsuccess = process;
  });
}

function lockState(state) {
  Object.freeze(state.profile);
  Object.freeze(state.settings);
  for (const record of state.records) Object.freeze(record);
  for (const purchase of state.purchases) Object.freeze(purchase);
  Object.freeze(state.records);
  Object.freeze(state.purchases);
  return Object.freeze(state);
}

function sameContents(current, incoming) {
  const normalized = { ...incoming, revision: current.revision, updatedAt: current.updatedAt };
  return JSON.stringify(current) === JSON.stringify(normalized);
}

function ownerChanged() {
  return Object.assign(new Error('다른 저장본으로 바뀌었어요. 기록을 다시 확인해주세요.'), {
    code: 'LOCAL_OWNER_CHANGED',
  });
}

function assertOwner(head, expectedKey, expectedGeneration) {
  if (expectedKey !== head.state.profile.key || expectedGeneration !== head.generation) throw ownerChanged();
}

export class LocalVault extends EventTarget {
  #db;
  #state;
  #generation;
  #cursors;
  #channel;
  #closed = false;

  static async open({
    key, initial = {}, indexedDB = globalThis.indexedDB, dbName = DB_NAME, timeoutMs = OPEN_TIMEOUT_MS,
  } = {}) {
    const db = await openDatabase(indexedDB, dbName, timeoutMs);
    try {
      const { head } = await transact(db, { mode: 'readwrite', timeoutMs }, (existing, snapshots) => {
        if (existing) return { head: existing, snapshots };
        const state = createState({
          key, name: initial?.name ?? '', avatar: initial?.avatar ?? 'male', coat: initial?.coat ?? 'burgundy',
        });
        return { head: { state, generation: 0, cursors: new Map() }, snapshots };
      });
      return new LocalVault(db, head);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  constructor(db, head) {
    super();
    this.#db = db;
    this.#publish(head);
    db.onversionchange = () => this.close();
    db.onclose = () => this.close();
    // Tabs can observe commits promptly where supported. Transactions always read
    // the latest head even when messaging is unavailable.
    if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      try {
        this.#channel = new BroadcastChannel(`knu-town-local:${db.name}`);
        this.#channel.onmessage = ({ data }) => {
          if (!this.#closed && Number.isSafeInteger(data) && data > this.state.revision) {
            void this.refresh().catch(() => {});
          }
        };
      } catch { /* Storage still works without tab notifications. */ }
    }
  }

  get state() { return this.#state; }
  get generation() { return this.#generation; }

  #publish({ state, generation, cursors }) {
    if (this.#state && state.revision <= this.#state.revision) return;
    const changed = this.#state !== undefined;
    this.#state = lockState(state);
    this.#generation = generation;
    // Older databases replay from the beginning because they lack live checkpoints.
    this.#cursors = cursors ?? new Map();
    if (changed) this.dispatchEvent(new CustomEvent('change', { detail: this.#state }));
  }

  async #read(recovery = false) {
    const result = await transact(this.#db, { mode: 'readonly', recovery }, (head, snapshots) => ({ head, snapshots }));
    this.#publish(result.head);
    return result;
  }

  async #write(apply, {
    recovery = false, resetCursors = false, checkpoint,
    expectedKey = this.state.profile.key, expectedGeneration = this.generation,
  } = {}) {
    let changed = false;
    const result = await transact(this.#db, { mode: 'readwrite', recovery }, (head, snapshots) => {
      const current = head.state;
      assertOwner(head, expectedKey, expectedGeneration);
      const updatedAt = Date.now();
      const updated = apply(current, snapshots, updatedAt);
      const previousCursors = head.cursors ?? new Map();
      let cursors = previousCursors;
      if (checkpoint && checkpoint.cursor > (previousCursors.get(checkpoint.sourceId) ?? 0)) {
        cursors = new Map(previousCursors).set(checkpoint.sourceId, checkpoint.cursor);
      }
      if (updated === current && cursors === previousCursors) return { head, snapshots };
      const state = { ...updated, revision: current.revision + 1, updatedAt };
      serializeBackup(state);
      changed = true;
      if (!recovery) return { head: { state, generation: head.generation, cursors }, snapshots };
      const before = { id: `before-${current.revision}`, createdAt: updatedAt, state: current };
      const kept = [before, ...snapshots].slice(0, SNAPSHOT_LIMIT);
      return { head: { state, generation: head.generation + 1, cursors: resetCursors ? new Map() : cursors }, snapshots: kept };
    });
    this.#publish(result.head);
    if (changed && !this.#closed) {
      try { this.#channel?.postMessage(result.head.state.revision); }
      catch { /* The commit succeeded even if tab notifications are unavailable. */ }
    }
    return this.state;
  }

  async refresh() {
    await this.#read();
    return this.state;
  }

  updateProfile(patch) {
    const changes = { ...patch };
    return this.#write(state => updateAppearance(state, changes));
  }

  cursor(sourceId) { return this.#cursors.get(sourceId) ?? 0; }

  async syncRecords(archive, expectedKey, expectedGeneration = this.generation) {
    if (typeof expectedKey !== 'string') throw ownerChanged();
    const incoming = readArchive(archive);
    const checkpoint = incoming.length ? { sourceId: archive.sourceId, cursor: archive.cursor } : undefined;
    return this.#write(state => {
      const records = mergeRecords(state.records, incoming);
      return records === state.records ? state : { ...state, records };
    }, { checkpoint, expectedKey, expectedGeneration });
  }

  buy(itemId, id) {
    return this.#write((state, _snapshots, at) => {
      // Retries keep the timestamp of the original command.
      const existing = state.purchases.find(purchase => purchase.id === id);
      return purchase(state, { id, itemId, at: existing?.at ?? at });
    });
  }

  openBox(id, kind = 'theme') {
    return this.#write((state, _snapshots, at) => openSeedBox(state, id, at, kind));
  }

  setTheme(id) { return this.#write(state => setFocusTheme(state, id)); }

  async exportText({ expectedKey = this.state.profile.key, expectedGeneration = this.generation } = {}) {
    const { head } = await this.#read();
    assertOwner(head, expectedKey, expectedGeneration);
    return serializeBackup(head.state);
  }

  async importText(text, { mode, expectedKey = this.state.profile.key, expectedGeneration = this.generation } = {}) {
    if (mode !== 'merge' && mode !== 'replace') throw new Error('백업을 적용할 방법을 골라주세요.');
    const incoming = parseBackup(text);
    return this.#write(current => {
      if (mode === 'merge') return mergeStates(current, incoming);
      return sameContents(current, incoming) ? current : incoming;
    }, { recovery: true, resetCursors: mode === 'replace', expectedKey, expectedGeneration });
  }

  async getSnapshots() {
    const { snapshots } = await this.#read(true);
    return snapshots;
  }

  restoreSnapshot(id, { expectedKey = this.state.profile.key, expectedGeneration = this.generation } = {}) {
    return this.#write((current, snapshots) => {
      const snapshot = snapshots.find(item => item.id === id);
      if (!snapshot) throw new Error('이 복구본을 찾지 못했어요.');
      return sameContents(current, snapshot.state) ? current : snapshot.state;
    }, { recovery: true, resetCursors: true, expectedKey, expectedGeneration });
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#channel?.close();
    this.#db.close();
  }
}
