const SOURCE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export function isArchiveMarker(marker) {
  return !!marker && typeof marker.sourceId === 'string' && SOURCE_ID.test(marker.sourceId)
    && Number.isSafeInteger(marker.cursor) && marker.cursor >= 0;
}

export function archiveIncomplete() {
  return Object.assign(new Error('기록 일부를 아직 받지 못했어요. 다시 연결해주세요'), {
    code: 'COPY_ARCHIVE_INCOMPLETE',
  });
}

export class ArchiveSync {
  constructor({ vault, room, onError = () => {} }) {
    Object.assign(this, { vault, room, onError });
    this.generation = 0;
    this.running = null;
    this.wanted = null;
    this.lastError = null;
  }

  observe(marker, { connected = this.room.online } = {}) {
    if (!this.vault || !connected || !isArchiveMarker(marker)) return Promise.resolve();
    if (this.wanted?.sourceId !== marker.sourceId || this.wanted.cursor < marker.cursor) {
      this.wanted = marker;
    }
    if (this.running) return this.running;
    if (this.vault.cursor(this.wanted.sourceId) >= this.wanted.cursor) {
      this.lastError = null;
      return Promise.resolve();
    }
    const generation = ++this.generation;
    const key = this.vault.state.profile.key;
    const vaultGeneration = this.vault.generation;
    this.lastError = null;
    const work = Promise.resolve().then(() => this.pull(generation, key, vaultGeneration)).catch(error => {
      if (!this.owns(generation, key, vaultGeneration) || error.code === 'LOCAL_OWNER_CHANGED') return;
      this.lastError = error;
      this.onError(error);
    }).finally(() => {
      if (this.generation === generation && this.running === work) this.running = null;
    });
    this.running = work;
    return work;
  }

  owns(generation, key, vaultGeneration) {
    return this.generation === generation && this.vault.state.profile.key === key
      && this.room.profileKey === key && this.vault.generation === vaultGeneration;
  }

  async pull(generation, key, vaultGeneration) {
    while (this.owns(generation, key, vaultGeneration) && this.wanted) {
      const target = this.wanted;
      const since = this.vault.cursor(target.sourceId);
      if (since >= target.cursor) return;
      let page;
      try {
        // The archive HTTP request has its own timeout and is independent of the room event stream.
        page = await this.room.service('/api/study/archive', { since });
      } catch (error) {
        if (error.status) throw error;
        throw Object.assign(new Error(error.message, { cause: error }), { code: 'ARCHIVE_HOST_UNREACHABLE' });
      }
      if (!this.owns(generation, key, vaultGeneration)) return;
      if (!page || page.sourceId !== target.sourceId || !Number.isSafeInteger(page.cursor) || page.cursor < since
        || typeof page.hasMore !== 'boolean' || !Array.isArray(page.records) || (page.hasMore && page.cursor <= since)) {
        throw new Error('공부 기록 사본을 다시 확인해주세요');
      }
      await this.vault.syncRecords(page, key, vaultGeneration);
      if (!this.owns(generation, key, vaultGeneration)) return;
      const committed = this.vault.cursor(target.sourceId);
      if (committed < page.cursor || (!page.hasMore && committed < target.cursor)) throw archiveIncomplete();
    }
  }

  async flush() {
    if (this.running) await this.running;
    if (this.lastError) throw this.lastError;
    if (this.wanted && this.vault.cursor(this.wanted.sourceId) < this.wanted.cursor) throw archiveIncomplete();
  }

  clear() {
    this.generation++;
    this.running = null;
    this.wanted = null;
    this.lastError = null;
  }
}
