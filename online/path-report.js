export function describeCandidates(sdp = "") {
  const kinds = new Set();
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.startsWith("a=candidate:")) continue;
    const parts = line.split(/\s+/),
      type = parts[parts.indexOf("typ") + 1],
      protocol = parts[2]?.toLowerCase();
    if (
      ["host", "srflx", "prflx", "relay"].includes(type) &&
      ["udp", "tcp"].includes(protocol)
    )
      kinds.add(
        type +
          "/" +
          protocol +
          (type === "host" && parts[4]?.endsWith(".local") ? "(mDNS)" : ""),
      );
  }
  return [...kinds].join(", ") || "없음";
}
export async function measurePath(pc) {
  const local = pc.localDescription,
    remote = pc.remoteDescription;
  const result = [
    "제안·응답 " + (local?.type || "대기") + "/" + (remote?.type || "대기"),
    "로컬 " + describeCandidates(local?.sdp),
    "상대 " + describeCandidates(remote?.sdp),
    "ICE " + pc.iceConnectionState,
  ];
  try {
    const rows = [...(await pc.getStats()).values()].filter(
      (r) => r.type === "candidate-pair",
    );
    const total = (key) =>
      rows.length && rows.every((r) => Number.isFinite(r[key]))
        ? rows.reduce((n, r) => n + r[key], 0)
        : "미표시";
    result.push(
      "후보 쌍 " + rows.length + "개",
      "검사 송신 " +
        total("requestsSent") +
        " / 응답 수신 " +
        total("responsesReceived") +
        " / 검사 수신 " +
        total("requestsReceived"),
    );
  } catch {
    result.push("통계 미제공");
  }
  return result.join(" · ");
}
