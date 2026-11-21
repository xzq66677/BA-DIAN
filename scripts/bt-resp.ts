/**
 * 沉浸牌桌响应式检查：窄屏 390×844 / 横屏 844×390 各打一局截图。
 */
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });

async function check(name: string, viewport: { width: number; height: number }, extra = {}) {
  const page = await browser.newPage({ viewport, ...extra });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('http://127.0.0.1:3200', { waitUntil: 'domcontentloaded' });
  await page.getByText(/拔 典/).waitFor({ timeout: 15000 });
  await page.locator('input[placeholder="输入昵称"]').fill(`${name}实测`);
  await page.locator('select').nth(2).selectOption('3');
  await page.getByRole('button', { name: /单人开局/ }).click();
  await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `/tmp/badian-shots/bt-${name}-rps.png` });
  const t0 = Date.now();
  let actShot = false;
  let overflowChecked = false;
  while (Date.now() - t0 < 120000) {
    const s = await page.evaluate(() => ({
      over: !!document.querySelector('.win-overlay') || !!document.querySelector('.finale-wait-chip'),
      veil: document.querySelectorAll('.pv-actions button').length,
      throwCard: document.querySelectorAll('.throw-card').length,
      act: !!document.querySelector('.confirm-bar'),
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    })).catch(() => null);
    if (!s || s.over) break;
    if (!overflowChecked && s.act) {
      overflowChecked = true;
      // 横向溢出检查
      if (s.hScroll) console.log(`[${name}] ⚠ 出现横向溢出`);
    }
    if (s.veil > 0) await page.locator('.pv-actions button').first().click({ timeout: 400, force: true }).catch(() => {});
    else if (s.throwCard > 0) await page.locator('.throw-card').first().click({ timeout: 400, force: true }).catch(() => {});
    else if (s.act && !actShot) {
      actShot = true;
      await page.waitForTimeout(600);
      await page.screenshot({ path: `/tmp/badian-shots/bt-${name}-act.png` });
      const h2 = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
      if (h2) console.log(`[${name}] ⚠ act 阶段横向溢出`);
    }
    if (s.act) {
      const skip = page.locator('.scard', { hasText: /^跳过/ }).first();
      if (await skip.isVisible({ timeout: 80 }).catch(() => false)) {
        await skip.click({ timeout: 400, force: true }).catch(() => {});
        const c = page.locator('.confirm-bar button', { hasText: '确认发动' }).first();
        if (await c.isVisible({ timeout: 80 }).catch(() => false)) await c.click({ timeout: 400, force: true }).catch(() => {});
      }
    }
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(1200);
  if (await page.locator('.win-overlay').isVisible().catch(() => false)) {
    await page.screenshot({ path: `/tmp/badian-shots/bt-${name}-finale.png` });
  }
  console.log(`[${name}] act=${actShot} JS错误=${errors.length ? errors.slice(0, 2) : '无'}`);
  await page.close();
}

await check('narrow', { width: 390, height: 844 }, { hasTouch: true, isMobile: true });
await check('land', { width: 844, height: 390 });
await browser.close();
