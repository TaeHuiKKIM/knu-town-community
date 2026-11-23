import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeetupLink, readMeetupLink, publicPlaza, isMeetupRoom } from '../online/meetup-link.js';

const base='https://club.example/?room=main&unrelated=private#old';
const fields={kind:'department',title:'도서관에서 만나요',group:'캠퍼스 동아리'};

test('an invitation opens in the existing web room and carries only its chosen public details',async()=>{
  const link=await createMeetupLink(base,fields);
  const parsed=await readMeetupLink(link);
  assert.match(parsed.code,/^meet-[a-f0-9]{32}$/);
  assert.deepEqual(parsed.details,fields);
  assert.equal(link.searchParams.get('room'),parsed.code);
  assert.equal(link.searchParams.get('mode'),'web');
  assert.deepEqual([...link.searchParams.keys()].sort(),['mode','room']);
  assert.ok(!link.href.includes('unrelated')&&!link.href.includes('private'));
  assert.equal(await readMeetupLink(base),null);
  assert.ok(isMeetupRoom(parsed.code));assert.ok(!isMeetupRoom('main'));
  assert.equal(publicPlaza(link).href,'https://club.example/?mode=web');
});

test('duplicated names create isolated rooms and forged metadata cannot preview a different group in the same room',async()=>{
  const a=await createMeetupLink(base,fields),b=await createMeetupLink(base,fields);
  assert.notEqual(a.searchParams.get('room'),b.searchParams.get('room'));
  const h=new URLSearchParams(a.hash.slice(1));
  h.set('title','다른 모임');a.hash=h.toString();await assert.rejects(readMeetupLink(a));
  b.hash='';await assert.rejects(readMeetupLink(b));
});

test('creation validates brief public labels, permits an empty school label, and rejects malformed invitations',async()=>{
  await assert.rejects(createMeetupLink(base,{...fields,title:'  '}));
  await assert.rejects(createMeetupLink(base,{...fields,kind:'other'}));
  await assert.rejects(createMeetupLink(base,{...fields,group:'학'.repeat(31)}));
  await assert.rejects(createMeetupLink(base,{...fields,title:'a\nb'}));
  const blank=await createMeetupLink(base,{...fields,group:''});
  assert.equal((await readMeetupLink(blank)).details.group,'');
  const repeated=new URL(blank);repeated.searchParams.append('room','main');
  await assert.rejects(readMeetupLink(repeated));
  const wrongRoom=new URL(blank);wrongRoom.searchParams.set('room','main');await assert.rejects(readMeetupLink(wrongRoom));
  assert.equal(await readMeetupLink('https://club.example/?room=meet-regular'),null);
  const extra=new URL(blank);extra.searchParams.set('unrelated','discard');extra.hash+='&unrelated=discard';
  assert.ok(!(await readMeetupLink(extra)).link.href.includes('discard'));
});
