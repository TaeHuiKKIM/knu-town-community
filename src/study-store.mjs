import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { CHECK_MS, dayWindow, weekWindow, pendingTime } from '../public/campus/study-time.js';

import { dailyStudy, monthWindow } from '../public/campus/study-calendar.js';

const ARCHIVE_PAGE_SIZE = 500;
const fail=(message,status=400,code)=>{throw Object.assign(Error(message),{status,code});};
function text(value,min,max,label){if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||/[\x00-\x1f\x7f]/.test(value))fail(`${label}을 ${min}~${max}자로 적어주세요.`);return value.trim();}

export class StudyStore {
  constructor(path=':memory:',{now=Date.now}={}){
    this.now=now;this.db=new DatabaseSync(path);this.active=new Map();this.closed=false;
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,key_hash TEXT NOT NULL UNIQUE,name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),subject TEXT NOT NULL,goal TEXT NOT NULL,started_at INTEGER NOT NULL,segment_start INTEGER NOT NULL,ended_at INTEGER);
      CREATE UNIQUE INDEX IF NOT EXISTS active_profile ON sessions(profile_id) WHERE ended_at IS NULL;
      CREATE TABLE IF NOT EXISTS checks(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id),session_id TEXT NOT NULL REFERENCES sessions(id),from_at INTEGER NOT NULL,to_at INTEGER NOT NULL,note TEXT NOT NULL,confirmed_at INTEGER NOT NULL,UNIQUE(session_id,from_at));
      CREATE INDEX IF NOT EXISTS checks_profile_time ON checks(profile_id,from_at,to_at);
      CREATE INDEX IF NOT EXISTS checks_profile_seq ON checks(profile_id);
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS spaces(code TEXT PRIMARY KEY,name TEXT NOT NULL,mode TEXT NOT NULL,capacity INTEGER NOT NULL,owner_id TEXT NOT NULL REFERENCES profiles(id));
      CREATE TABLE IF NOT EXISTS visits(profile_id TEXT NOT NULL REFERENCES profiles(id),code TEXT NOT NULL REFERENCES spaces(code),PRIMARY KEY(profile_id,code));`);
    this.db.prepare("INSERT INTO metadata VALUES ('archive_source_id',?) ON CONFLICT(key) DO NOTHING").run(randomUUID());
    this.sourceId = this.db.prepare("SELECT value FROM metadata WHERE key='archive_source_id'").get().value;
    for(const row of this.db.prepare('SELECT * FROM sessions WHERE ended_at IS NULL').all())this.active.set(row.profile_id,this.session(row));
  }
  session(row){return {id:row.id,profileId:row.profile_id,subject:row.subject,goal:row.goal,startedAt:row.started_at,segmentStartAt:row.segment_start,deadlineAt:row.segment_start+CHECK_MS};}
  profile(key,name,create=false){
    if(typeof key!=='string'||!/^[a-f0-9]{64}$/.test(key))fail('이 기기의 기록 정보를 다시 확인해주세요.');
    const hash=createHash('sha256').update(key).digest('hex');let row=this.db.prepare('SELECT id,name FROM profiles WHERE key_hash=?').get(hash);
    if(!row){if(!create)fail('먼저 광장에 입장해주세요.',401);name=text(name,1,16,'닉네임');row={id:randomUUID(),name};this.db.prepare('INSERT INTO profiles VALUES(?,?,?)').run(row.id,hash,name);}
    else if(name!==undefined){name=text(name,1,16,'닉네임');if(row.name!==name){this.db.prepare('UPDATE profiles SET name=? WHERE id=?').run(name,row.id);row={...row,name};}}
    return row;
  }
  getActive(id){const a=this.active.get(id);return a?{...a,status:this.now()>=a.deadlineAt?'awaiting':'active'}:null;}
  publicStudy(id){const a=this.getActive(id);return a?{subject:a.subject,startedAt:a.startedAt,segmentStartAt:a.segmentStartAt,status:a.status}:null;}
  start(profileId,subject,goal){
    subject=text(subject,2,30,'과목');goal=text(goal,2,120,'목표');const old=this.active.get(profileId);
    if(old){if(old.subject!==subject||old.goal!==goal)fail('진행 중인 공부를 먼저 확인해주세요.',409,'STUDY_CHANGED');return this.getActive(profileId);}
    const at=this.now(),s={id:randomUUID(),profileId,subject,goal,startedAt:at,segmentStartAt:at,deadlineAt:at+CHECK_MS};
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,NULL)').run(s.id,profileId,subject,goal,at,at);this.active.set(profileId,s);return this.getActive(profileId);
  }
  confirm(profileId,data){
    const note=text(data.note,2,160,'공부한 내용');
    if(typeof data.requestId!=='string'||!/^[a-f0-9]{32}$/.test(data.requestId)||typeof data.stop!=='boolean'||!Number.isSafeInteger(data.segmentStartAt))fail('공부 확인 정보를 다시 확인해주세요.');
    const receipt=this.db.prepare('SELECT profile_id FROM checks WHERE id=?').get(data.requestId);
    if(receipt){if(receipt.profile_id!==profileId)fail('이미 사용한 확인 정보예요.',409);return this.summary(profileId);}
    const row=this.db.prepare('SELECT * FROM sessions WHERE id=? AND profile_id=?').get(data.sessionId,profileId);
    if(!row)fail('이 공부 기록을 찾지 못했어요.',404);
    if(row.ended_at!==null)return this.summary(profileId);
    if(row.segment_start!==data.segmentStartAt)fail('다른 화면에서 이미 확인했어요.',409,'STUDY_CHANGED');
    if(data.stopAt!==undefined&&!Number.isFinite(data.stopAt))fail('종료 시각을 다시 확인해주세요.');
    const at=Math.max(this.now(),row.segment_start),end=Math.max(row.segment_start,Math.min(at,row.segment_start+CHECK_MS,data.stopAt??at));
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('INSERT INTO checks VALUES(?,?,?,?,?,?,?)').run(data.requestId,profileId,row.id,row.segment_start,end,note,at);
      if(data.stop)this.db.prepare('UPDATE sessions SET ended_at=? WHERE id=?').run(end,row.id);
      else this.db.prepare('UPDATE sessions SET segment_start=? WHERE id=?').run(at,row.id);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    if(data.stop)this.active.delete(profileId);else this.active.set(profileId,this.session({...row,segment_start:at}));
    return this.summary(profileId);
  }
  total(profileId,window){return this.db.prepare('SELECT COALESCE(SUM(MAX(0,MIN(to_at,?)-MAX(from_at,?))),0) AS ms FROM checks WHERE profile_id=? AND from_at<? AND to_at>?').get(window.end,window.start,profileId,window.end,window.start).ms;}
  summary(profileId){
    const at=this.now(),active=this.getActive(profileId),profile=this.db.prepare('SELECT id,name FROM profiles WHERE id=?').get(profileId);
    const { cursor } = this.db.prepare('SELECT COALESCE(MAX(rowid),0) AS cursor FROM checks WHERE profile_id=?').get(profileId);
    const recent = this.db.prepare('SELECT note,from_at AS fromAt,to_at AS toAt FROM checks WHERE profile_id=? ORDER BY confirmed_at DESC LIMIT 5').all(profileId);
    return {
      at, profile, active, recent,
      pendingMs: pendingTime(active,at),
      todayMs: this.total(profileId,dayWindow(at)),
      weekMs: this.total(profileId,weekWindow(at)),
      archive: { sourceId: this.sourceId, cursor },
    };
  }
  calendar(profileId, month){
    const window = monthWindow(month);
    if (!window) fail('조회할 달을 다시 선택해주세요.');
    const records = this.db.prepare('SELECT from_at AS fromAt, to_at AS toAt FROM checks WHERE profile_id=? AND from_at<? AND to_at>?')
      .all(profileId, window.end, window.start);
    return dailyStudy(records, month);
  }
  archive(profileId, since = 0) {
    if (!Number.isSafeInteger(since) || since < 0) fail('기록 위치를 다시 확인해주세요.');

    // Older confirmations may have fractional stop times. Backups use whole epoch milliseconds.
    const rows = this.db.prepare(`
      SELECT c.rowid AS seq, c.id, c.session_id AS sessionId, s.subject, s.goal, c.note,
             c.from_at AS fromAt, CAST(c.to_at AS INTEGER) AS toAt, c.confirmed_at AS confirmedAt
      FROM checks c
      JOIN sessions s ON s.id = c.session_id AND s.profile_id = c.profile_id
      WHERE c.profile_id = ? AND c.rowid > ?
      ORDER BY c.rowid
      LIMIT ?
    `).all(profileId, since, ARCHIVE_PAGE_SIZE + 1);
    const records = rows.slice(0, ARCHIVE_PAGE_SIZE).map(row => ({ sourceId: this.sourceId, ...row }));
    return {
      sourceId: this.sourceId,
      cursor: records.at(-1)?.seq ?? since,
      hasMore: rows.length > ARCHIVE_PAGE_SIZE,
      records,
    };
  }
  ranking(scope='today'){
    if(!['today','week'].includes(scope))fail('순위 기간을 다시 골라주세요.');const w=scope==='today'?dayWindow(this.now()):weekWindow(this.now());
    const rows=this.db.prepare('SELECT p.id,p.name,SUM(MAX(0,MIN(c.to_at,?)-MAX(c.from_at,?))) AS ms FROM checks c JOIN profiles p ON p.id=c.profile_id WHERE c.from_at<? AND c.to_at>? GROUP BY p.id HAVING ms>0 ORDER BY ms DESC,p.id').all(w.end,w.start,w.end,w.start);
    let rank=0,prior=-1;return rows.map((r,i)=>{if(r.ms!==prior)rank=i+1;prior=r.ms;return {...r,rank};});
  }
  spaces(profileId){return this.db.prepare('SELECT DISTINCT s.* FROM spaces s LEFT JOIN visits v ON v.code=s.code WHERE s.owner_id=? OR v.profile_id=? ORDER BY s.rowid DESC').all(profileId,profileId);}
  createSpace(profileId,{name,mode='free',capacity=16}){
    name=text(name,1,24,'광장 이름');if(!['free','study','social'].includes(mode)||!Number.isInteger(capacity)||capacity<2||capacity>16)fail('광장 설정을 확인해주세요.');
    if(this.db.prepare('SELECT count(*) AS n FROM spaces WHERE owner_id=?').get(profileId).n>=4||this.db.prepare('SELECT count(*) AS n FROM spaces').get().n>=100)fail('지금 만들 수 있는 광장이 모두 찼어요.',409);
    const code=randomUUID().replaceAll('-','');this.db.prepare('INSERT INTO spaces VALUES(?,?,?,?,?)').run(code,name,mode,capacity,profileId);return {code,name,mode,capacity,owner_id:profileId};
  }
  allSpaces(){return this.db.prepare('SELECT * FROM spaces').all();}
  visit(profileId,code){this.db.prepare('INSERT OR IGNORE INTO visits VALUES(?,?)').run(profileId,code);}
  close(){if(!this.closed){this.db.close();this.closed=true;}}
}
