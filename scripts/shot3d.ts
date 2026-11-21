// @ts-nocheck
/**
 * V4.1 · 3D 战场演出取证（Playwright + 真实引擎自动对局）
 * 用法：npx tsx scripts/shot3d.ts [baseUrl]
 * 产物：/tmp/badian-shots/d3-*.png（按演出类别抓帧）
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:3200';
const OUT = '/tmp/badian-shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const jsErrors = [];
page.on('pageerror', (e) => jsErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') jsErrors.push('console:' + m.text()); });

let opened = false;
for (let i = 0; i < 3 && !opened; i++) {
  try { await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 }); opened = true; }
  catch { await page.waitForTimeout(3000); }
}
await page.getByText(/拔 典/).waitFor({ timeout: 20000 });

await page.locator('input[placeholder="输入昵称"]').fill('D3验证员');
const selects = page.locator('select');
await selects.nth(2).selectOption('3');
await page.getByRole('button', { name: /单人开局/ }).click();
await page.getByText(/行动坞/).waitFor({ timeout: 20000 });

await page.waitForTimeout(2200);
await page.screenshot({ path: `${OUT}/d3-01-rps-phase.png` });

// 自动推进 + 按演出类别抓帧（每类一张）
const captured = new Set();
let idx = 2;
const CAPTURE = [
  ['act-collapsed', () => !!document.querySelector('.action-dock.is-waiting') && document.querySelectorAll('.b3-plate').length > 0, 'act-phase'],
  ['dmg', () => document.querySelectorAll('.dmg-float').length > 0, 'hit'],
  ['hitcut3d', () => document.querySelectorAll('.b3-float .dmg-float').length > 1, 'hit2'],
  ['heal', () => document.querySelectorAll('.heal-float').length > 0, 'heal'],
  ['miss', () => document.querySelectorAll('.miss-float').length > 0, 'miss'],
  ['throw', () => Array.from(document.querySelectorAll('.b3-ticker')).some((e) => e.textContent.includes('投掷')), 'ivan-throw'],
  ['boom', () => Array.from(document.querySelectorAll('.b3-ticker')).some((e) => e.textContent.includes('爆炸')), 'ivan-boom'],
  ['alert', () => document.querySelectorAll('.zone-alert').length > 0, 'zone-alert'],
  ['death', () => document.querySelectorAll('.death-stamp').length > 0, 'eliminate'],
  ['revive', () => document.querySelectorAll('.revive-burst').length > 0, 'revive'],
  ['domain', () => Array.from(document.querySelectorAll('.b3-ticker')).some((e) => e.textContent.includes('领域')), 'domain'],
  ['finale', () => !!document.querySelector('.win-overlay'), 'finale'],
];
let finaleShot = false;

const t0 = Date.now();
let iter = 0;
while (Date.now() - t0 < 75000) {
  iter++;
  for (const [key, check, label] of CAPTURE) {
    if (captured.has(key)) continue;
    const hit = await page.evaluate(check).catch((e) => { console.log('EVAL-ERR', key, String(e).slice(0, 120)); return false; });
    if (iter <= 18) console.log('iter', iter, key, hit);
    if (hit) {
      captured.add(key);
      console.log('SHOT', label);
      await page.screenshot({ path: `${OUT}/d3-${String(idx).padStart(2, '0')}-${label}.png` }).catch(() => {});
      idx++;
    }
  }
  if (await page.evaluate(() => !!document.querySelector('.win-overlay')).catch(() => false)) { finaleShot = true; break; }
  // 推进对局
  const veilBtn = page.locator('.pv-actions button').first();
  if (await veilBtn.isVisible({ timeout: 120 }).catch(() => false)) await veilBtn.click();
  const throwCard = page.locator('.throw-card').first();
  if (await throwCard.isVisible({ timeout: 120 }).catch(() => false)) await throwCard.click();
  const skip = page.locator('.scard', { hasText: '跳过' }).first();
  if (await skip.isVisible({ timeout: 120 }).catch(() => false)) {
    await skip.click();
    const confirm = page.locator('.confirm-bar button', { hasText: '确认发动' }).first();
    if (await confirm.isVisible({ timeout: 120 }).catch(() => false) && await confirm.isEnabled().catch(() => false)) await confirm.click();
  }
  await page.waitForTimeout(220);
}
if (finaleShot) await page.waitForTimeout(2600); // 终局延迟呈现：等演出链播完
await page.screenshot({ path: `${OUT}/d3-${String(idx).padStart(2, '0')}-finale-shown.png` }).catch(() => {});

console.log('CAPTURED', JSON.stringify([...captured]));
console.log('JS-ERRORS', JSON.stringify(jsErrors.slice(0, 8)));
await browser.close();
