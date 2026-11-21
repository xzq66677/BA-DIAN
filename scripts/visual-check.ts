/**
 * 演出视觉实测（非测试脚本）：真实浏览器开局自驱动，
 * 在演出进行中高频截图，验证斩击/飘字/控制条的真实渲染效果。
 * 用法：npx tsx scripts/visual-check.ts [port]
 */
import { chromium } from 'playwright';

const port = process.argv[2] || '3199';
const baseUrl = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
await page.getByText(/拔 典/).waitFor({ timeout: 15000 });
await page.locator('input[placeholder="输入昵称"]').fill('视觉实测');
const selects = page.locator('select');
await selects.nth(2).selectOption('2');
await page.getByRole('button', { name: /单人开局/ }).click();
await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
console.log('进入对局');

let shotIdx = 0;
const t0 = Date.now();
let sawFx = false;
while (Date.now() - t0 < 26000) {
  // 自驱动（点击可能因 React 重渲染 detach，容错处理）
  try {
    const veilBtn = page.locator('.pv-actions button').first();
    if (await veilBtn.isVisible({ timeout: 150 }).catch(() => false)) await veilBtn.click({ timeout: 800, force: true }).catch(() => {});
    const throwCard = page.locator('.throw-card').first();
    if (await throwCard.isVisible({ timeout: 150 }).catch(() => false)) await throwCard.click({ timeout: 800, force: true }).catch(() => {});
    const skip = page.locator('.scard', { hasText: '跳过' }).first();
    if (await skip.isVisible({ timeout: 150 }).catch(() => false)) {
      await skip.click({ timeout: 800, force: true }).catch(() => {});
      const confirm = page.locator('.confirm-bar button', { hasText: '确认发动' }).first();
      if (await confirm.isVisible({ timeout: 150 }).catch(() => false) && await confirm.isEnabled().catch(() => false)) {
        await confirm.click({ timeout: 800, force: true }).catch(() => {});
      }
    }
  } catch { /* 重渲染竞态，下一轮重试 */ }
  // 演出中截图
  const fx = await page.evaluate(() => ({
    hitcut: document.querySelectorAll('.hitcut').length,
    dmgFloat: document.querySelectorAll('.dmg-float').length,
    ctl: !!document.querySelector('.battle-ctl'),
    banner: document.querySelectorAll('.move-banner').length,
    alert: document.querySelectorAll('.zone-alert').length,
    death: document.querySelectorAll('.death-stamp').length,
    heal: document.querySelectorAll('.healfx').length,
  }));
  if (fx.hitcut || fx.dmgFloat || fx.banner || fx.death || fx.heal) {
    sawFx = true;
    if (shotIdx < 4) {
      await page.screenshot({ path: `/tmp/badian-fx-${++shotIdx}.png` });
      console.log(`截图 ${shotIdx}:`, JSON.stringify(fx));
    }
  } else if (fx.ctl && shotIdx === 0) {
    await page.screenshot({ path: `/tmp/badian-fx-${++shotIdx}.png` });
    console.log(`截图 ${shotIdx} (控制条):`, JSON.stringify(fx));
  }
  await page.waitForTimeout(160);
}
console.log('sawFx =', sawFx, '截图数 =', shotIdx, 'JS错误 =', errors.length ? errors : '无');
if (!sawFx) await page.screenshot({ path: '/tmp/badian-fx-none.png' });
await browser.close();
