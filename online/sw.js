// Give only offline page navigations a response. Live rooms, game assets and
// personal records keep their normal browser/network behaviour.
const offlinePage = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#f8f3e7"><title>크누타운 · 연결 대기</title>
<style>body{margin:0;min-height:100svh;display:grid;place-items:center;background:#f8f3e7;color:#352b25;font:1rem/1.6 system-ui,sans-serif}main{padding:28px;max-width:24rem}h1{font-size:1.5rem}a{display:inline-block;margin-top:12px;padding:10px 18px;background:#78213c;color:#fff;border-radius:5px;font-weight:700;text-decoration:none}</style></head>
<body><main><h1>크누타운에 연결할 수 없어요</h1><p>인터넷 연결을 확인하고 다시 입장해 주세요.</p><a href="">다시 연결</a></main></body></html>`;

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.mode !== "navigate" || request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !["/", "/index.html"].includes(url.pathname)) return;
  event.respondWith(fetch(request).catch(() => new Response(offlinePage, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"
    }
  })));
});
