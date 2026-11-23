const diagnosticKinds = new Set(['health', 'room-page', 'info', 'qr', 'join', 'events']);
const samplesPerKind = 4;

export function createRequestLogger({ write = console.log, now = Date.now } = {}) {
  const samples = new Map();
  let minute;
  let omitted = 0;

  return ({ method, kind, remote }) => {
    if (!diagnosticKinds.has(kind)) return;
    const timestamp = now();
    const currentMinute = Math.floor(timestamp / 60_000);
    if (currentMinute !== minute) {
      if (omitted) write(`[request] ${new Date(timestamp).toISOString()} ${omitted} additional diagnostic requests in the previous active minute`);
      samples.clear();
      omitted = 0;
      minute = currentMinute;
    }

    const count = samples.get(kind) ?? 0;
    if (count === samplesPerKind) {
      omitted++;
      return;
    }
    samples.set(kind, count + 1);
    write(`[request] ${new Date(timestamp).toISOString()} ${remote} ${method} ${kind}`);
  };
}
