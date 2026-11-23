import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createStudyServer } from '../../src/server.mjs';
import { SCENES } from '../../public/campus/scenes.js';
import { sceneFurniture, furnitureSeats } from '../../public/campus/furniture.js';

const { chromium } = createRequire(new URL('../../online/package.json', import.meta.url))('playwright-core');
const [output, ...scenes] = process.argv.slice(2);
const server = createStudyServer({ roomCode: 'previews', hub: true, tutor: null });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
  const page = await browser.newPage({ viewport: {width: 1536, height: 1024}, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:' + server.address().port + '/r/previews');
  await page.locator('#nickname').fill('미리보기');
  await page.locator('#join-button').click();
  await page.locator('#player:visible').waitFor();
  for (const id of scenes) {
    const scene = SCENES[id];
    await page.locator('.scene-chip').click();
    await page.locator('#scene-list .scene-card').filter({hasText: scene.name}).click();
    const world = page.locator('#world[data-scene="' + id + '"]');
    await world.waitFor();
    const layers = sceneFurniture(id).length + furnitureSeats(id).length + (scene.signs?.length ?? 0);
    await page.waitForFunction(n => document.querySelectorAll('#world > .furniture, #world > .building-sign').length === n, layers);
    // Reuse the game's positioned, depth-sorted furniture and lettering at the map's native size.
    await world.evaluate(async world => {
      const original = world.querySelector('#scene-art');
      const stage = document.createElement('div');
      stage.id = 'preview-art';
      stage.style.cssText = 'position:fixed;inset:0;width:1536px;height:1024px;overflow:hidden;z-index:2147483647;pointer-events:none';
      const background = original.cloneNode();
      background.removeAttribute('id');
      background.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
      stage.append(background);
      for (const layer of world.querySelectorAll(':scope > .furniture, :scope > .building-sign')) stage.append(layer.cloneNode(true));
      document.body.append(stage);
      const backgrounds = new Set([...stage.children].map(el => getComputedStyle(el).backgroundImage).filter(v => v.startsWith('url(')));
      await Promise.all([...backgrounds].map(value => {
        const image = new Image();
        image.src = value.slice(4, -1).replace(/^"|"$/g, '');
        return image.decode();
      }));
      await background.decode();
      await document.fonts.ready;
    });
    const stage = page.locator('#preview-art');
    await stage.screenshot({ path: join(output, id + '.png'), animations: 'disabled' });
    await stage.evaluate(node => node.remove());
  }
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
