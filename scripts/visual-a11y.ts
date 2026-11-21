/**
 * Reduced Motion + 窄屏验证（非测试脚本）：
 * 1. reduced-motion 下打开终局弹层：金光粒子/动画应静止降级，信息仍完整
 * 2. 窄屏 390×844：act 阶段 compact 揭示台 + 待爆警示 + 终局弹层
 * 用法：npx tsx scripts/visual-a11y.ts [port]
 */
import { chromium } from 'playwright';

const port = process.argv[2] || '3200';
const baseUrl = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });

// ── 1. Reduced Motion：终局弹层 ──
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText(/拔 典/).waitFor({ timeout: 15000 });
  await page.locator('input[placeholder="输入昵称"]').fill('降级实测');
  await page.locator('select').nth(2).selectOption('3');
  await page.getByRole('button', { name: /单人开局/ }).click();
  await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
  // 快速打完
  const t0 = Date.now();
  while (Date.now() - t0 < 120000) {
    if (await page.locator('.win-overlay').isVisible().catch(() => false)) break;
    const veil = page.locator('.pv-actions button').first();
    if (await veil.isVisible({ timeout: 100 }).catch(() => false)) await veil.click({ timeout: 500, force: true }).catch(() => {});
    const tc = page.locator('.throw-card').first();
    if (await tc.isVisible({ timeout: 100 }).catch(() => false)) await tc.click({ timeout: 500, force: true }).catch(() => {});
    const skip = page.locator('.scard', { hasText: /^跳过/ }).first();
    if (await skip.isVisible({ timeout: 100 }).catch(() => false)) {
      await skip.click({ timeout: 500, force: true }).catch(() => {});
      const c = page.locator('.confirm-bar button', { hasText: '确认发动' }).first();
      if (await c.isVisible({ timeout: 100 }).catch(() => false)) await c.click({ timeout: 500, force: true }).catch(() => {});
    }
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1000);
  if (await page.locator('.win-overlay').isVisible().catch(() => false)) {
    const rm = await page.evaluate(() => {
      const rays = document.querySelector('.win-rays');
      const particles = document.querySelector('.win-particles i');
      const art = document.querySelector('.win-art');
      return {
        rayAnim: rays ? getComputedStyle(rays).animationName : 'none',
        particleAnim: particles ? getComputedStyle(particles as Element).animationName : 'none',
        artAnim: art ? getComputedStyle(art).animationName : 'none',
        overlayVisible: !!document.querySelector('.win-overlay'),
      };
    });
    console.log('[reduced-motion]', JSON.stringify(rm));
    await page.screenshot({ path: '/tmp/badian-shots/rm-win.png' });
  } else {
    console.log('[reduced-motion] 未能在时限内打完');
  }
  console.log('[reduced-motion] JS错误 =', errors.length ? errors : '无');
  await ctx.close();
}

// ── 2. 窄屏：act 阶段 + 终局 ──
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText(/拔 典/).waitFor({ timeout: 15000 });
  await page.locator('input[placeholder="输入昵称"]').fill('窄屏降级');
  await page.locator('select').nth(2).selectOption('3');
  await page.getByRole('button', { name: /单人开局/ }).click();
  await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
  // 等 act 阶段截 compact 揭示台
  const t0 = Date.now();
  let actShot = false;
  while (Date.now() - t0 < 120000) {
    if (await page.locator('.win-overlay').isVisible().catch(() => false)) break;
    if (!actShot && await page.locator('.reveal-board.compact').isVisible().catch(() => false)) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: '/tmp/badian-shots/narrow-compact.png' });
      actShot = true;
    }
    const veil = page.locator('.pv-actions button').first();
    if (await veil.isVisible({ timeout: 100 }).catch(() => false)) await veil.click({ timeout: 500, force: true }).catch(() => {});
    const tc = page.locator('.throw-card').first();
    if (await tc.isVisible({ timeout: 100 }).catch(() => false)) await tc.click({ timeout: 500, force: true }).catch(() => {});
    const skip = page.locator('.scard', { hasText: /^跳过/ }).first();
    if (await skip.isVisible({ timeout: 100 }).catch(() => false)) {
      await skip.click({ timeout: 500, force: true }).catch(() => {});
      const c = page.locator('.confirm-bar button', { hasText: '确认发动' }).first();
      if (await c.isVisible({ timeout: 100 }).catch(() => false)) await c.click({ timeout: 500, force: true }).catch(() => {});
    }
    await page.waitForTimeout(200);
  }
  console.log('[narrow] compact揭示台截图 =', actShot);
  await page.waitForTimeout(800);
  if (await page.locator('.win-overlay').isVisible().catch(() => false)) {
    await page.screenshot({ path: '/tmp/badian-shots/narrow-win-v3.png' });
    // 检查按钮是否溢出
    const btns = await page.evaluate(() => {
      const b = document.querySelector('.win-btns');
      const r = b?.getBoundingClientRect();
      return { bottom: r?.bottom, vh: window.innerHeight, overflow: r ? r.bottom > window.innerHeight : false };
    });
    console.log('[narrow] win按钮溢出 =', JSON.stringify(btns));
  }
  console.log('[narrow] JS错误 =', errors.length ? errors : '无');
  await ctx.close();
}

await browser.close();
console.log('完成');
