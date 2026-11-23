import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { chromium } from "playwright-core";

// Keep this test independent of public room state and of other students.
const types = {
  html: "text/html", js: "text/javascript", webmanifest: "application/manifest+json",
  png: "image/png", css: "text/css", woff2: "font/woff2"
};
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const route = pathname === "/" ? "/index.html" : pathname;
  if (!/^\/[\w./-]+$/.test(route) || route.startsWith("/api/") || route.includes("..")) {
    res.writeHead(404).end(); return;
  }
  try {
    const bytes = await readFile(new URL("./dist" + route, import.meta.url));
    res.writeHead(200, { "Content-Type": types[route.split(".").at(-1)] ?? "application/octet-stream" }).end(bytes);
  } catch { res.writeHead(404).end(); }
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
let context;
try {
  const origin = "http://127.0.0.1:" + server.address().port;
  // Chromium intentionally disables installation in incognito. An empty
  // userDataDir creates a disposable, ordinary profile for this test.
  context = await chromium.launchPersistentContext("", {
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
    viewport: { width: 390, height: 844 }
  });
  const page = await context.newPage();
  await page.goto(origin + "/?room=install-check");
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send("Page.getAppManifest");
  assert.deepEqual(manifest.errors, []);
  const parsed = JSON.parse(manifest.data);
  assert.equal(parsed.name, "크누타운 · 캠퍼스 스터디");
  assert.equal(parsed.start_url, "/");
  assert.equal(parsed.display, "standalone");
  for (const icon of parsed.icons) {
    const response = await context.request.get(origin + icon.src);
    assert.equal(response.status(), 200);
    const png = await response.body();
    assert.equal(png.readUInt32BE(16) + "x" + png.readUInt32BE(20), icon.sizes);
  }
  const touch = await page.locator('link[rel="apple-touch-icon"]').getAttribute("href");
  const appleIcon = await (await context.request.get(origin + touch)).body();
  assert.equal(appleIcon.readUInt32BE(16), 180);
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.active);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  assert.deepEqual(installabilityErrors, []);
  await page.evaluate(() => localStorage.setItem("install-check", "kept"));
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "크누타운에 연결할 수 없어요" }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("room"), "install-check");
  assert.equal(await page.evaluate(() => fetch("/api/rendezvous").then(() => true, () => false)), false);
  await context.setOffline(false);
  await page.getByRole("link", { name: "다시 연결" }).click();
  await page.locator("#world").waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("install-check")), "kept");
  assert.equal(new URL(page.url()).searchParams.get("room"), "install-check");
  console.log("Installability, original room link, offline recovery and icon sizes passed.");
} finally {
  await context?.close();
  server.closeAllConnections();
  server.close();
}
