export const meetupKinds = new Map([
  ['department','학과 모임'], ['club','동아리 모임'], ['study','스터디'], ['social','과팅']
]);

export function isMeetupRoom(code) { return typeof code==='string'&&/^meet-[a-f0-9]{32}$/.test(code); }

export function isMeetupInvite(current){
  const url=new URL(current);
  return isMeetupRoom(url.searchParams.get('room'))||new URLSearchParams(url.hash.slice(1)).has('seed');
}

function label(value, limit, required=false) {
  if(typeof value!=='string' || /[\p{Cc}\p{Cf}]/u.test(value)) throw Error('모임 정보를 확인해 주세요.');
  const text=value.trim().normalize('NFC');
  if([...text].length>limit || (required&&!text))throw Error('모임 이름과 소속의 길이를 확인해 주세요.');
  return text;
}

function validate({kind,title,group}) {
  if(!meetupKinds.has(kind))throw Error('모임 종류를 선택해 주세요.');
  return {kind,title:label(title,36,true),group:label(group??'',30)};
}

async function roomCode(seed,{kind,title,group}) {
  const bytes=new TextEncoder().encode(JSON.stringify([1,seed,kind,title,group]));
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  return 'meet-'+Array.from(hash.slice(0,16),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function publicPlaza(current) {
  const url=new URL('/',current);
  url.searchParams.set('mode','web');
  return url;
}

export async function createMeetupLink(current,fields) {
  const details=validate(fields),seed=crypto.randomUUID(),url=publicPlaza(current);
  url.searchParams.set('room',await roomCode(seed,details));
  url.hash=new URLSearchParams({seed,...details}).toString();
  return url;
}

export async function readMeetupLink(current) {
  const url=new URL(current),code=url.searchParams.get('room');
  if(!isMeetupInvite(url))return null;
  if(!/^meet-[a-f0-9]{32}$/.test(code)||url.searchParams.getAll('room').length!==1||url.hash.length>2600)throw Error('모임 초대 링크를 확인해 주세요.');
  const info=new URLSearchParams(url.hash.slice(1)),seed=info.get('seed');
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(seed))throw Error('초대 정보가 빠졌어요.');
  for(const field of ['seed','kind','title','group'])if(info.getAll(field).length!==1)throw Error('모임 초대 정보가 올바르지 않아요.');
  const details=validate(Object.fromEntries(info));
  if(await roomCode(seed,details)!==code)throw Error('모임 정보가 바뀌었어요. 초대 링크를 다시 받아 주세요.');
  const link=publicPlaza(url);link.searchParams.set('room',code);
  link.hash=new URLSearchParams({seed,...details}).toString();
  return {code,details,link};
}
