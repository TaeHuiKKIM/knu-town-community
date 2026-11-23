import { measurePath } from "./path-report.js";
const STUN = { urls: "stun:stun.cloudflare.com:3478" };
async function description(pc, desc) {
  await pc.setLocalDescription(desc);
  if (pc.iceGatheringState !== "complete")
    await new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        pc.removeEventListener("icegatheringstatechange", change);
        resolve();
      };
      const change = () => {
        if (pc.iceGatheringState === "complete") finish();
      };
      const timer = setTimeout(finish, 4000);
      pc.addEventListener("icegatheringstatechange", change);
      change();
    });
  return pc.localDescription?.toJSON();
}
function candidates(sdp = "") {
  return sdp
    .split(/\r?\n/)
    .filter((line) => line.startsWith("a=candidate:"))
    .map((line) => line.slice(2));
}
export class PlazaMesh {
  constructor(room, events, web = false, autoStart = true) {
    this.web = web;
    this.chats = [];
    this.seq = 0;
    this.seen = new Map();
    this.room = room;
    this.events = events;
    this.secret = crypto.randomUUID();
    this.links = new Map();
    this.sessions = new Map();
    this.lastFailure = new Map();
    this.lastProbe = new Map();
    this.roster = [];
    this.mail = {};
    this.active = false;
    this.wake = () => this.maintain();
    if(autoStart)this.start();
  }
  start() {
    if(this.active)return;
    this.active=true;
    this.timer=setTimeout(()=>this.sync(),0);
    window.addEventListener("online", this.wake);
    document.addEventListener("visibilitychange", this.wake);
  }
  payload() {
    return {
      room: this.room,
      secret: this.secret,
      name: this.events.name(),
      ...(this.web
        ? { mode: "web", pose: this.events.pose(), chats: this.chats }
        : { mail: this.mail }),
    };
  }
  async sync() {
    if (!this.active || this.syncing) return;
    this.syncing = true;
    this.again = false;
    let delay = 6500;
    try {
      const controller = new AbortController(),
        timeout = setTimeout(() => controller.abort(), 20000);
      let response;
      try {
        response = await fetch("/api/rendezvous", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.payload()),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok)
        throw Error(
          response.status === 409
            ? "광장 정원 4명 · 다시 확인 중"
            : "친구 목록 재연결 중",
        );
      const { slot, id, roster } = await response.json();
      if (!this.active) return;
      if (this.slot !== slot) {
        delay = 900 + Math.random() * 500;
        for (const n of [...this.sessions.keys()]) this.drop(n);
        this.slot = slot;
        this.events.ready(slot);
      }
      this.id = id;
      this.roster = roster.filter((p) => p.id !== id);
      this.events.status("광장 입장");
      if (this.web) {
        this.updateWebPeers();
        delay = document.hidden ? 8000 : this.roster.length ? 1300 : 3200;
        return;
      }
      for (const [n, s] of this.sessions) {
        const p = this.roster.find((p) => p.slot === n);
        if ((p && p.id !== s.id) || (!p && !this.links.has(n))) this.drop(n);
      }
      for (const p of this.roster) this.negotiate(p);
      if (this.roster.some((p) => !this.links.has(p.slot)))
        delay = Math.min(delay, 2100 + Math.random() * 600);
      else if (this.links.size) delay = 10500;
    } catch (e) {
      if (!this.slot) delay = 1600 + Math.random() * 700;
      if (this.active)
        this.events.status(
          e.message.includes("정원") ? e.message : "친구 목록 재연결 중",
        );
    } finally {
      this.syncing = false;
      if (this.active) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.sync(), this.again ? 50 : delay);
      }
    }
  }
  updateWebPeers() {
    for (const [n, id] of this.links) {
      if (!this.roster.some((p) => p.slot === n && p.id === id)) {
        this.links.delete(n);
        this.events.left(n);
      }
    }
    for (const p of this.roster) {
      this.links.set(p.slot, p.id);
      if (p.pose) this.events.data(p.slot, { ...p.pose, name: p.name });
      let high = this.seen.get(p.id) || 0;
      for (const c of p.chats || []) {
        if (c.seq <= high) continue;
        this.events.data(p.slot, { t: "chat", text: c.text });
        high = c.seq;
      }
      this.seen.set(p.id, high);
    }
    this.events.status("광장 입장");
  }
  maintain() {
    if (!this.active) return;
    clearTimeout(this.timer);
    if (this.syncing) this.again = true;
    else this.timer = setTimeout(() => this.sync(), 30);
  }
  drop(n) {
    const s = this.sessions.get(n);
    if (!s) return;
    this.sessions.delete(n);
    delete this.mail[s.id];
    clearTimeout(s.deadline);
    clearInterval(s.sampler);
    if (s.report) this.lastProbe.set(n, { id: s.id, report: s.report });
    if (this.links.delete(n)) this.events.left(n);
    s.pc.close();
  }
  session(p, attempt) {
    const n = p.slot;
    this.drop(n);
    const pc = new RTCPeerConnection({ iceServers: [STUN] });
    const s = { id: p.id, attempt, pc, started: Date.now() };
    this.sessions.set(n, s);
    // Retain the last completed measurement across a negotiation retry.
    const sample = async () => {
      if (s.measuring) return;
      s.measuring = true;
      try {
        s.report = await measurePath(pc);
      } finally {
        s.measuring = false;
      }
    };
    s.sampler = setInterval(sample, 3500);

    const valid = () => this.active && this.sessions.get(n) === s;
    // The first description is bounded so a slow STUN server cannot stall entry.
    // Publish later candidates through the same mailbox as they become available.
    pc.onicecandidate = () => {
      const current = this.mail[s.id],
        desc = pc.localDescription;
      if (
        !valid() ||
        !current ||
        !desc ||
        current.sdp === desc.sdp ||
        this.links.has(n)
      )
        return;
      this.mail[s.id] = { type: desc.type, sdp: desc.sdp, attempt: s.attempt };
      this.maintain();
    };
    const attach = (ch) => {
      s.ch = ch;
      ch.onopen = () => {
        if (!valid()) return;
        clearTimeout(s.deadline);
        clearInterval(s.sampler);
        this.links.set(n, s);
        this.lastFailure.delete(n);
        this.events.connected(n);
        ch.send(JSON.stringify({ t: "hello" }));
        this.maintain();
      };
      ch.onmessage = (event) => {
        if (
          !valid() ||
          typeof event.data !== "string" ||
          event.data.length > 4096
        )
          return;
        try {
          const d = JSON.parse(event.data);
          if (d.t === "bye") {
            this.drop(n);
            this.maintain();
          } else if (d.t === "hello") this.events.connected(n);
          else this.events.data(n, d);
        } catch {}
      };
      ch.onclose = () => {
        if (valid()) {
          this.drop(n);
          this.maintain();
        }
      };
    };
    pc.ondatachannel = (e) => attach(e.channel);
    pc.oniceconnectionstatechange = () => {
      if (valid() && pc.iceConnectionState === "failed") {
        this.lastFailure.set(n, { id: s.id, reason: this.pendingStage(n) });
        this.drop(n);
        this.maintain();
      }
    };
    s.deadline = setTimeout(() => {
      if (valid() && !this.links.has(n)) {
        this.lastFailure.set(n, { id: s.id, reason: this.pendingStage(n) });
        this.drop(n);
        this.maintain();
      }
    }, 28000);
    s.attach = attach;
    return s;
  }
  async negotiate(p) {
    const n = p.slot,
      signal = p.signal;
    let s = this.sessions.get(n);
    try {
      if (
        s &&
        !this.links.has(n) &&
        s.pc.remoteDescription &&
        signal?.attempt === s.attempt &&
        signal.type === s.pc.remoteDescription.type
      ) {
        const known = (s.knownCandidates ??= new Set(
          candidates(s.pc.remoteDescription.sdp),
        ));
        for (const candidate of candidates(signal.sdp)) {
          if (known.has(candidate)) continue;
          known.add(candidate);
          try {
            await s.pc.addIceCandidate({ candidate, sdpMLineIndex: 0 });
          } catch {
            known.delete(candidate);
          }
        }
      }
      if (this.slot > n && !s) {
        s = this.session(p, crypto.randomUUID());
        s.attach(s.pc.createDataChannel("plaza", { ordered: true }));
        const d = await description(s.pc, await s.pc.createOffer());
        if (d && this.sessions.get(n) === s) {
          this.mail[s.id] = { ...d, attempt: s.attempt };
          this.maintain();
        }
      } else if (
        this.slot < n &&
        signal?.type === "offer" &&
        s?.attempt !== signal.attempt
      ) {
        s = this.session(p, signal.attempt);
        await s.pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        const d = await description(s.pc, await s.pc.createAnswer());
        if (d && this.sessions.get(n) === s) {
          this.mail[s.id] = { ...d, attempt: s.attempt };
          this.maintain();
        }
      } else if (
        this.slot > n &&
        s &&
        !s.answering &&
        signal?.type === "answer" &&
        s.attempt === signal.attempt &&
        s.pc.signalingState === "have-local-offer"
      ) {
        s.answering = true;
        await s.pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
      }
    } catch {
      if (s && this.sessions.get(n) === s) this.drop(n);
    }
  }
  pendingStage(n) {
    const s = this.sessions.get(n);
    if (!s) return "상대의 연결 제안 대기";
    const pc = s.pc,
      local = pc.localDescription,
      remote = pc.remoteDescription;
    if (!local)
      return remote ? "제안 수신 · 응답 준비 중" : "내 연결 제안 준비 중";
    if (!remote) return "연결 제안 준비됨 · 상대 응답 대기";
    const a = candidates(local.sdp).length,
      b = candidates(remote.sdp).length;
    if (!a || !b)
      return "경로 후보 부족 · 내 기기 " + a + "개 / 상대 " + b + "개";
    if (["connected", "completed"].includes(pc.iceConnectionState))
      return "경로 연결됨 · 데이터 채널 대기";
    return "경로 검사 중 · 내 기기 " + a + "개 / 상대 " + b + "개";
  }
  pendingDetail(p) {
    const last = this.lastFailure.get(p.slot);
    return (
      this.pendingStage(p.slot) +
      (last?.id === p.id ? " (이전 시도: " + last.reason + ")" : "")
    );
  }
  send(data, to) {
    if (this.web) {
      if (data.t === "chat") {
        this.chats.push({ seq: ++this.seq, text: data.text });
        this.chats = this.chats.slice(-12);
        this.maintain();
      }
      return;
    }
    for (const [n, s] of this.links)
      if ((to === undefined || to === n) && s.ch.readyState === "open")
        s.ch.send(JSON.stringify(data));
  }
  async route(i) {
    if (this.web) return "웹 연결 · HTTPS";
    const pc = this.links.get(i)?.pc;
    if (!pc) return "직결 대기";
    try {
      const stats = await pc.getStats();
      let pair;
      for (const row of stats.values())
        if (row.type === "transport" && row.selectedCandidatePairId)
          pair = stats.get(row.selectedCandidatePairId);
      pair ??= [...stats.values()].find(
        (s) =>
          s.type === "candidate-pair" && s.state === "succeeded" && s.nominated,
      );
      const a = stats.get(pair?.localCandidateId)?.candidateType,
        b = stats.get(pair?.remoteCandidateId)?.candidateType;
      return a && b ? "직결 · " + a + " ↔ " + b : "직결 · 경로 유형 미표시";
    } catch {
      return "직결 · 경로 유형 미표시";
    }
  }
  close() {
    if(!this.active)return;
    this.active = false;
    clearTimeout(this.timer);
    window.removeEventListener("online", this.wake);
    document.removeEventListener("visibilitychange", this.wake);
    this.send({ t: "bye" });
    for (const n of [...this.sessions.keys()]) this.drop(n);
    if (this.slot)
      fetch("/api/rendezvous", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...this.payload(), mail: {}, leave: true }),
        keepalive: true,
      }).catch(() => {});
  }
}
