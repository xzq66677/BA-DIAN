import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto('http://127.0.0.1:3200', { waitUntil: 'domcontentloaded' });
await page.getByText(/拔 典/).waitFor({ timeout: 15000 });
await page.locator('input[placeholder="输入昵称"]').fill('牌桌实测');
await page.locator('select').nth(2).selectOption('3');
await page.getByRole('button', { name: /单人开局/ }).click();
await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/badian-shots/bt-rps.png' });
// 驱动到行动阶段并截图
const t0 = Date.now();
let eventsShot = false;
let eventsShot2 = false;
let overShot = false;
while (Date.now() - t0 < 120000) {
  const s = await page.evaluate(() => ({
    over: !!document.querySelector('.win-overlay'),
    finaleChip: !!document.querySelector('.finale-wait-chip'),
    hitcut: document.querySelectorAll('.hitcut').length,
    bomb: document.querySelectorAll('.ivan-bomb').length,
    boom: document.querySelectorAll('.ivan-boom-fx').length,
    alert: document.querySelectorAll('.zone-alert').length,
    death: document.querySelectorAll('.death-stamp').length,
    veil: document.querySelectorAll('.pv-actions button').length,
    throwCard: document.querySelectorAll('.throw-card').length,
    act: !!document.querySelector('.confirm-bar'),
  })).catch(() => null);
  if (!s || s.over) break;
  if (s.veil > 0) await page.locator('.pv-actions button').first().click({ timeout: 500, force: true }).catch(() => {});
  else if (s.throwCard > 0) await page.locator('.throw-card').first().click({ timeout: 500, force: true }).catch(() => {});
  else if (s.act) {
    if (!eventsShot && s.act) {
      // 行动阶段首帧（不依赖事件瞬间）
      eventsShot = true;
      await page.waitForTimeout(1200);
      await page.screenshot({ path: '/tmp/badian-shots/bt-act.png' });
    }
    if (!eventsShot2 && (s.hitcut || s.bomb || s.alert || s.boom || s.death)) {
      eventsShot2 = true;
      await page.screenshot({ path: '/tmp/badian-shots/bt-events.png' });
    }
    const skip = page.locator('.scard', { hasText: /^跳过/ }).first();
    if (await skip.isVisible({ timeout: 100 }).catch(() => false)) {
      await skip.click({ timeout: 500, force: true }).catch(() => {});
      const c = page.locator('.confirm-bar button', { hasText: '确认发动' }).first();
      if (await c.isVisible({ timeout: 100 }).catch(() => false)) await c.click({ timeout: 500, force: true }).catch(() => {});
    }
  }
  if (s.finaleChip && !overShot) {
    await page.screenshot({ path: '/tmp/badian-shots/bt-finale-wait.png' });
    overShot = true;
  }
  await page.waitForTimeout(200);
}
await page.waitForTimeout(1500);
if (await page.locator('.win-overlay').isVisible().catch(() => false)) {
  await page.screenshot({ path: '/tmp/badian-shots/bt-finale.png' });
}
console.log(`events=${eventsShot} JS错误=${errors.length ? errors : '无'}`);
await browser.close();
