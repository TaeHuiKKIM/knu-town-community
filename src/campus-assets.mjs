import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { studyStyle, styleLayout } from '../public/campus/wardrobe.js';

const client = new Set(['app.js', 'network.js', 'local-data.js', 'local-vault.js', 'local-sync.js', 'local-checkpoint.js', 'local-ui.js', 'local.css', 'world.js', 'terrain.js', 'scenes.js', 'furniture.js', 'scene-view.js', 'scene-images.js', 'chat-scroll.js', 'wayfinding.js', 'ambient.js', 'world.css', 'play.js', 'impact.js', 'study.js', 'study-time.js', 'study-calendar.js', 'spaces.js', 'study.css', 'live.css', 'ui.css', 'skin.css', 'avatar.js', 'wardrobe.js', 'wardrobe-ui.js', 'student-motion.js', 'effects.js', 'tutor.js', 'tutor.css', 'sprites/data.js']);
const design = new Set(['style.css', 'pixel-ui.css', 'assets/interface.css', 'assets/sprite-data.js', 'assets/directional/data.js']);
const types = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2' };
const styles = new Map();
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function readStyle(id) {
  const root = new URL(`../design/character-v3/${id}/`, import.meta.url);
  const [text, image] = await Promise.all([
    readFile(new URL('runtime-manifest.json', root), 'utf8'),
    readFile(new URL('sprite-sheet-alpha.png', root)),
  ]);
  const source = JSON.parse(text), layout = styleLayout(source);
  if (source?.curation_applied !== true || source.degraded_static_fallback === true || !layout) return null;
  if (image.length < 33 || !image.subarray(0, 8).equals(pngSignature) || image.toString('ascii', 12, 16) !== 'IHDR'
    || image.readUInt32BE(16) !== layout.sheetWidth || image.readUInt32BE(20) !== layout.sheetHeight || image[25] !== 6) return null;
  // Expose only frame coordinates. Source, prompts and QA metadata stay in the design folder.
  return { image, manifest: JSON.stringify({ frame_layout: layout }) };
}

export async function wardrobeAssets(id) {
  if (!studyStyle(id)) return null;
  if (!styles.has(id)) styles.set(id, readStyle(id).catch(() => null));
  const entry = styles.get(id), assets = await entry;
  if (!assets && styles.get(id) === entry) styles.delete(id);
  return assets;
}

export async function campusAsset(pathname) {
  if (!pathname.startsWith('/campus/')) return null;
  const relative = pathname.slice('/campus/'.length);
  const style = /^wardrobe\/([a-z-]+)\/(runtime-manifest\.json|sprite-sheet-alpha\.png)$/.exec(relative);
  if (style) {
    const assets = await wardrobeAssets(style[1]);
    if (!assets) return null;
    if (style[2] === 'runtime-manifest.json') return { content: assets.manifest, type: 'application/json; charset=utf-8' };
    return { content: assets.image, type: 'image/png' };
  }
  const rasterOrFont = /^assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|woff2)$/.test(relative);
  const sprite=/^sprites\/(?:male|female)\/(?:burgundy|forest|navy|cse)\.png$/.test(relative);
  if (!client.has(relative) && !design.has(relative) && !rasterOrFont && !sprite) return null;
  const root = client.has(relative)||sprite ? '../public/campus/' : '../design/stage1/';
  try { return { content: await readFile(new URL(root + relative, import.meta.url)), type: types[extname(relative)] }; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
