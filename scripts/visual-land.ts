import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
await page.goto('http://127.0.0.1:3200', { waitUntil: 'domcontentloaded' });
await page.getByText(/拔 典/).waitFor({ timeout: 15000 });
await page.locator('input[placeholder="输入昵称"]').fill('横屏核对');
await page.locator('select').nth(2).selectOption('3');
await page.getByRole('button', { name: /单人开局/ }).click();
await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
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
await page.waitForTimeout(1200);
if (await page.locator('.win-overlay').isVisible().catch(() => false)) {
  const m = await page.evaluate(() => {
    const modal = document.querySelector('.win-modal')?.getBoundingClientRect();
    const btns = document.querySelector('.win-btns')?.getBoundingClientRect();
    return { modalBottom: modal?.bottom, vh: innerHeight, btnsBottom: btns?.bottom, fit: (btns?.bottom ?? 0) <= innerHeight - 2 };
  });
  console.log('[landscape-win]', JSON.stringify(m));
  await page.screenshot({ path: '/tmp/badian-shots/land-win-v3b.png' });
}
await browser.close();
