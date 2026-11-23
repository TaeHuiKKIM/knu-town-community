import {clock} from './study-time.js';

const DAY = 86400000, KST = 9 * 3600000;

export function monthKey(at = Date.now()) {
  return new Date(at + KST).toISOString().slice(0, 7);
}

export function monthWindow(month) {
  if (typeof month !== 'string' || !/^20\d\d-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, number] = month.split('-').map(Number);
  const first = Date.UTC(year, number - 1, 1);
  const count = (Date.UTC(year, number, 1) - first) / DAY;
  return {start: first - KST, end: first - KST + count * DAY, count, weekday: new Date(first).getUTCDay()};
}

export function shiftMonth(month, direction) {
  const window = monthWindow(month);
  return monthKey(direction < 0 ? window.start - DAY : window.end);
}

export function dailyStudy(records, month) {
  const {start, end, count} = monthWindow(month);
  const days = Array(count).fill(0);
  const intervals = records.filter(record => record.fromAt < end && record.toAt > start)
    .sort((a, b) => a.fromAt - b.fromAt);
  let countedThrough = start;
  for (const record of intervals) {
    let from = Math.max(countedThrough, record.fromAt);
    const to = Math.min(end, record.toAt);
    while (from < to) {
      const index = Math.floor((from - start) / DAY);
      const stop = Math.min(to, start + (index + 1) * DAY);
      days[index] += stop - from;
      from = stop;
    }
    countedThrough = Math.max(countedThrough, to);
  }
  return days;
}

export function renderCalendar(root, month, days, selectMonth) {
  const {weekday, count} = monthWindow(month);
  const node = (tag, name, text) => {
    const result = document.createElement(tag);
    result.className = name;
    if (text) result.textContent = text;
    return result;
  };
  const header = node('div', 'calendar-heading');
  const previous = node('button', 'menu-action', '‹'), next = node('button', 'menu-action', '›');
  previous.type = next.type = 'button';
  previous.setAttribute('aria-label', '이전 달');
  next.setAttribute('aria-label', '다음 달');
  const prevMonth = shiftMonth(month, -1), nextMonth = shiftMonth(month, 1);
  previous.disabled = !monthWindow(prevMonth);
  next.disabled = nextMonth > monthKey();
  previous.onclick = () => selectMonth(prevMonth);
  next.onclick = () => selectMonth(nextMonth);
  const [year, number] = month.split('-');
  header.append(previous, node('strong', '', `${year}년 ${Number(number)}월`), next);
  const grid = node('div', 'calendar-grid');
  for (const day of '일월화수목금토') grid.append(node('span', 'calendar-weekday', day));
  for (let i = 0; i < weekday; i++) grid.append(node('span', 'calendar-blank'));
  for (let i = 0; i < count; i++) {
    const ms = days[i] || 0, minutes = Math.floor(ms / 60000);
    const cell = node('div', 'calendar-day');
    cell.dataset.level = ms === 0 ? 0 : minutes < 60 ? 1 : minutes < 180 ? 2 : minutes < 360 ? 3 : 4;
    const duration = clock(ms).slice(0, -3);
    cell.setAttribute('aria-label', `${i + 1}일 ${duration}`);
    cell.append(node('b', '', String(i + 1)), node('span', '', duration));
    grid.append(cell);
  }
  root.replaceChildren(header, grid);
}
