import { DIRECTIONS } from './world.js';

export const COAT_LABELS = Object.freeze({ burgundy: '버건디', forest: '포레스트', navy: '네이비', cse: '컴학 과잠' });

export const STUDY_STYLES = Object.freeze([
  { id: 'male-ash', avatar: 'male', name: '애쉬 과잠', hours: 3, look: 'coat' },
  { id: 'male-hoodie', avatar: 'male', name: '시험기간 후드', hours: 10, look: 'exam' },
  { id: 'male-jacket', avatar: 'male', name: '캠퍼스 재킷', hours: 30, look: 'dressy' },
  { id: 'female-ash', avatar: 'female', name: '애쉬 과잠', hours: 3, look: 'coat' },
  { id: 'female-offshoulder', avatar: 'female', name: '오프숄더 니트', hours: 10, look: 'dressy' },
].map(style => Object.freeze({ ...style, requiredMs: style.hours * 3_600_000 })));

// The wardrobe groups outfits into three tabs. The free coats always belong to 과잠룩.
export const LOOKS = Object.freeze([
  Object.freeze({ id: 'coat', name: '과잠룩' }),
  Object.freeze({ id: 'exam', name: '시험기간룩' }),
  Object.freeze({ id: 'dressy', name: '꾸꾸꾸룩' }),
]);

const catalog = new Map(STUDY_STYLES.map(style => [style.id, style]));
const frameCounts = new Map(DIRECTIONS.flatMap(direction => [[`idle_${direction}`, 1], [`walk_${direction}`, 6]]));
frameCounts.set('wave_south', 6);
frameCounts.set('jump_south', 6);
frameCounts.set('study_south', 4);

export function studyStyle(id) { return catalog.get(id) ?? null; }

export function outfitName(coat, styleId) {
  const style = studyStyle(styleId);
  if (style) return style.name;
  return coat === 'cse' ? COAT_LABELS.cse : COAT_LABELS[coat] + ' 과잠';
}
export function styleForAvatar(id, avatar) {
  const style = studyStyle(id);
  return style?.avatar === avatar ? style : null;
}
export const OUTFIT_BOX_SETS = Object.freeze({
  'wear-ash': { name: '애쉬 과잠 세트', styles: ['male-ash', 'female-ash'] },
  'wear-campus': { name: '후드·오프숄더 세트', styles: ['male-hoodie', 'female-offshoulder'] },
});

export function canWearStyle(id, avatar, rewardMs, owned = []) {
  if (id == null) return true;
  const style = styleForAvatar(id, avatar);
  return !!style && (rewardMs >= style.requiredMs ||
    owned.some(item => OUTFIT_BOX_SETS[item]?.styles.includes(id)));
}

export function styleLayout(manifest) {
  const layout = manifest?.frame_layout;
  if (layout?.cellWidth !== 96 || layout.cellHeight !== 128 || layout.sheetWidth !== 576 || layout.sheetHeight !== 2432) return null;
  const rows = {}, occupied = new Set();
  for (const [key, count] of frameCounts) {
    const frames = layout.rows?.[key];
    if (!Array.isArray(frames) || frames.length !== count) return null;
    rows[key] = [];
    for (const rect of frames) {
      if (!rect) return null;
      const { x, y, w, h } = rect;
      if (w !== 96 || h !== 128 || !Number.isInteger(x) || !Number.isInteger(y) ||
          x < 0 || y < 0 || x % w || y % h || x + w > layout.sheetWidth || y + h > layout.sheetHeight) return null;
      const cell = `${x},${y}`;
      if (occupied.has(cell)) return null;
      occupied.add(cell);
      rows[key].push({ x, y, w, h });
    }
  }
  return { sheetWidth: layout.sheetWidth, sheetHeight: layout.sheetHeight, cellWidth: 96, cellHeight: 128, rows };
}
