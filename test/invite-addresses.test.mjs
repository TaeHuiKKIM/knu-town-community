import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudyServer, localAddresses } from '../src/server.mjs';

test('a Wi-Fi-only host advertises and encodes only its listening address', async t => {
  const interfaces = localAddresses();
  const wifi = interfaces.find(entry => /wi-fi|wlan|무선/i.test(entry.name)) ?? interfaces[0];
  if (!wifi) return t.skip('A non-loopback IPv4 interface is needed for this check.');
  const server = createStudyServer({ roomCode: 'invite-test' });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, wifi.address, resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  const origin = `http://${wifi.address}:${port}`;
  const api = origin + '/api/invite-test';
  const url = origin + '/r/invite-test';
  const info = await (await fetch(api + '/info')).json();
  assert.deepEqual(info.urls.map(entry => entry.url), [url]);
  assert.equal((await fetch(api + '/qr?url=' + encodeURIComponent(url))).status, 200);
  const unreachable = `http://127.0.0.1:${port}/r/invite-test`;
  assert.equal((await fetch(api + '/qr?url=' + encodeURIComponent(unreachable))).status, 400);
});

for (const address of ['127.0.0.1', '0.0.0.0']) {
  test(`loopback QR still opens on a server listening at ${address}`, async t => {
    const server = createStudyServer({ roomCode: 'compat' });
    await new Promise((resolve, reject) => server.once('error', reject).listen(0, address, resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const target = origin + '/r/compat';
    const qr = await fetch(origin + '/api/compat/qr?url=' + encodeURIComponent(target));
    assert.equal(qr.status, 200);
    if (address === '127.0.0.1') {
      const info = await (await fetch(origin + '/api/compat/info')).json();
      assert.deepEqual(info.urls.map(entry => entry.url), [target]);
    }
  });
}
