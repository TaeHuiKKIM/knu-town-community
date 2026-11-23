export const CHECK_MS=90*60*1000;
export const KST=9*60*60*1000;
export function dayWindow(at){const start=Math.floor((at+KST)/86400000)*86400000-KST;return {start,end:start+86400000};}
export function weekWindow(at){const day=dayWindow(at),weekday=new Date(day.start+KST).getUTCDay();const start=day.start-((weekday+6)%7)*86400000;return {start,end:start+7*86400000};}
export function pendingTime(active,at){return active?Math.max(0,Math.min(at,active.deadlineAt)-active.segmentStartAt):0;}
export function clock(ms){const s=Math.floor(Math.max(0,ms)/1000);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');}
