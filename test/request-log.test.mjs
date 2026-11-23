import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequestLogger } from '../src/request-log.mjs';

test('movement and static assets produce no entries or time checks', () => {
  const log = createRequestLogger({
    write: () => assert.fail('unexpected log entry'),
    now: () => assert.fail('unexpected clock read')
  });
  for (let i = 0; i < 1000; i++) {
    log({ method: 'POST', kind: 'action', remote: '127.0.0.1' });
    log({ method: 'GET', kind: 'asset', remote: '127.0.0.1' });
  }
});

test('diagnostics keep the first four samples per kind, then count additional requests', () => {
  let time = 0;
  const lines = [];
  const log = createRequestLogger({ write: line => lines.push(line), now: () => time });
  for (let i = 0; i < 100; i++) log({ method:'GET', kind:'info', remote:'192.0.2.' + i });
  log({ method:'GET', kind:'health', remote:'192.0.2.1' });
  log({ method:'POST', kind:'join', remote:'192.0.2.2' });
  assert.equal(lines.length, 6);
  assert.match(lines[4], /192\.0\.2\.1 GET health$/);
  assert.match(lines[5], /192\.0\.2\.2 POST join$/);
  time = 70000;
  log({ method:'POST', kind:'action', remote:'192.0.2.3' });
  assert.equal(lines.length, 6);
  log({ method:'GET', kind:'info', remote:'192.0.2.5' });
  assert.match(lines[6], /96 additional diagnostic requests/);
  assert.match(lines[7], /192\.0\.2\.5 GET info$/);
});
