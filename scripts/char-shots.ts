// @ts-nocheck
/**
 * 角色视觉取证（Playwright + char-harness 隔离渲染）
 * 用法：npx tsx scripts/char-shots.ts <charId[,charId2,...]> [viteBaseUrl] [输出目录]
 * 产物：<out>/<charId>/NN-<pose>-<view>.png + lineup.png + <charId>-narrow-*.png
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const CHARS = (process.argv[2] || 'laodaye').split(',');
const BASE = process.argv[3] || 'http://127.0.0.1:5199';
const OUT = process.argv[4] || '/tmp/badian-char-shots';
fs.mkdirSync(OUT, { recursive: true });

const POSES = ['reset', 'idle', 'walk', 'attack', 'flinch', 'cast', 'drink', 'crouch', 'cheer', 'dead', 'revive', 'signal'];
const VIEWS = ['three', 'front', 'side'];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') jsErrors.push('console:' + m.text()); });

let opened = false;
for (let i = 0; i < 3 && !opened; i++) {
  try {
    await page.goto(`${BASE}/char-harness.html`, { waitUntil: 'load', timeout: 30000 });
    opened = true;
  } catch { await page.waitForTimeout(2000); }
}
if (!opened) { console.error('✗ 无法打开 harness'); process.exit(1); }

const shots = [];
for (const char of CHARS) {
  const dir = `${OUT}/${char}`;
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const pose of POSES) {
    for (const view of VIEWS) {
      await page.goto(`${BASE}/char-harness.html?char=${char}&pose=${pose}&view=${view}`, { waitUntil: 'load' });
      await page.waitForTimeout(120);
      const label = await page.locator('#label').textContent();
      const file = `${dir}/${String(++n).padStart(2, '0')}-${pose}-${view}.png`;
      await page.screenshot({ path: file });
      shots.push(`${file} | ${label.trim().replace(/\n/g, ' ')}`);
    }
  }
  // 窄屏构图（默认站姿 + attack）
  const narrow = await browser.newPage({ viewport: { width: 390, height: 844 } });
  narrow.on('pageerror', (e) => jsErrors.push('narrow:' + String(e)));
  for (const pose of ['reset', 'attack']) {
    await narrow.goto(`${BASE}/char-harness.html?char=${char}&pose=${pose}&view=three`, { waitUntil: 'load' });
    await narrow.waitForTimeout(120);
    await narrow.screenshot({ path: `${dir}/${char}-narrow-${pose}.png` });
  }
  await narrow.close();

  // 有 stick 挂件的角色（拔棍）：拍"已拔棍"状态（无棍角色该帧与 reset 相同）
  await page.goto(`${BASE}/char-harness.html?char=${char}&pose=reset&stick=1&view=three`, { waitUntil: 'load' });
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${dir}/${char}-stick-drawn.png` });
}

// 同屏 lineup：所有请求角色 + gojo 基准（同尺度比较站姿）
{
  const all = [...new Set(['gojo', ...CHARS])];
  await page.goto(`${BASE}/char-harness.html?chars=${all.join(',')}`, { waitUntil: 'load' });
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${OUT}/lineup-${all.join('-')}.png` });
}

console.log(shots.join('\n'));
console.log(`\n共 ${shots.length} 张原始帧 → ${OUT}`);
if (jsErrors.length) {
  console.error(`\n✗ 页面错误 ${jsErrors.length} 条：`);
  console.error(jsErrors.slice(0, 10).join('\n'));
  process.exit(2);
}
await browser.close();
