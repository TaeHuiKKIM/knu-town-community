import { archiveIncomplete, isArchiveMarker } from './local-sync.js';

export class CopyCheckpoint {
  constructor({ vault, room, study, syncer, onOffline = () => {}, hasPending = () => false }) {
    Object.assign(this, { vault, room, study, syncer, onOffline, hasPending });
  }

  async check({
    localOnly = false,
    expectedKey = this.vault.state.profile.key,
    expectedGeneration = this.vault.generation,
  } = {}) {
    const { vault, room, study, syncer } = this;
    const studyVersion = study.version;
    const assertReady = (requireIdle = false) => {
      if (vault.state.profile.key !== expectedKey || room.profileKey !== expectedKey
        || vault.generation !== expectedGeneration) {
        throw Object.assign(new Error('다른 탭에서 자료가 바뀌었어요. 새로고침해주세요'), { code: 'LOCAL_OWNER_CHANGED' });
      }
      if (this.hasPending() || (requireIdle && study.active)) {
        throw Object.assign(new Error('진행 중인 공부를 먼저 확인하고 휴식해주세요'), { code: 'STUDY_ACTIVE' });
      }
      if (study.busy || study.refreshing || study.version !== studyVersion) {
        throw Object.assign(new Error('공부 기록 확인이 끝난 뒤 다시 시도해주세요'), { code: 'STUDY_BUSY' });
      }
    };
    const unavailable = cause => {
      this.onOffline(cause);
      return Object.assign(new Error('방장에 연결할 수 없어요. 저장된 자료만으로 진행할지 선택해주세요', { cause }), {
        code: 'COPY_HOST_UNREACHABLE',
      });
    };

    assertReady(localOnly);
    if (localOnly) return { mode: 'local' };

    let result;
    try {
      result = await room.service('/api/study/me');
    } catch (error) {
      const noHostProfile = error.status === 401 && !room.me;
      assertReady(noHostProfile);
      if (noHostProfile) return { mode: 'no-host-profile' };
      if (error.status) throw error;
      throw unavailable(error);
    }
    assertReady();
    const data = result?.study;
    if (!data || (data.active !== null && (!data.active || typeof data.active !== 'object'))) {
      throw archiveIncomplete();
    }
    study.accept(data);
    assertReady(true);
    if (!isArchiveMarker(data.archive)) throw archiveIncomplete();
    const marker = { sourceId: data.archive.sourceId, cursor: data.archive.cursor };
    try {
      await syncer.observe(marker, { connected: true });
      assertReady(true);
      await syncer.flush();
    } catch (error) {
      assertReady(true);
      if (error.code === 'ARCHIVE_HOST_UNREACHABLE') throw unavailable(error);
      throw error;
    }
    assertReady(true);
    if (vault.cursor(marker.sourceId) < marker.cursor) throw archiveIncomplete();
    return { mode: 'host' };
  }
}
