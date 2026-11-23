import test from 'node:test';
import assert from 'node:assert/strict';
import {tutorInvite} from '../online/lan-tutor.js';

test('a campus LAN invite opens the tutor in the intended room',()=>{
  assert.equal(tutorInvite(' http://172.18.0.22:4183/r/main?view=classic '),'http://172.18.0.22:4183/r/main#tutor');
  assert.equal(tutorInvite('http://192.168.1.20:4183/'),'http://192.168.1.20:4183/r/main#tutor');
  assert.equal(tutorInvite('http://10.1.2.3/r/reading-hall#old'),'http://10.1.2.3/r/reading-hall#tutor');
});
test('unrelated URLs do not become LAN tutor invites',()=>{
  for(const url of ['','https://example.com/r/main','http://172.32.0.1/r/main','http://10.0.0.1.evil.invalid/r/main','http://user@10.1.2.3/r/main','http://10.1.2.3/api/tutor/ask','javascript:alert(1)']){
    assert.equal(tutorInvite(url),null);
  }
});
