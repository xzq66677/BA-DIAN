/**
 * 斩击演出特写（非测试脚本）：1v1 vs default AI，本人攻击后高频抓帧。
 * 用法：npx tsx scripts/visual-hitcut.ts [port]
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
await page.locator('input[placeholder="输入昵称"]').fill('斩击实测');
const selects = page.locator('select');
await selects.nth(2).selectOption('1'); // 1 个 AI
await page.getByRole('button', { name: /单人开局/ }).click();
await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
console.log('进入对局（1v1）');

// 出拳（第一轮）：点遮罩按钮 → 出石头
await page.locator('.pv-actions button').first().click({ timeout: 5000, force: true }).catch(() => {});
await page.locator('.throw-card').first().click({ timeout: 5000, force: true }).catch(() => {});
// 等行动阶段（AI 即时）；若 AI 赢了判定则自己先动，等待轮到我
await page.waitForTimeout(1200);

// 轮到我：选攻击 → 点目标 → 确认
let attacked = false;
for (let i = 0; i < 10 && !attacked; i++) {
  const skip = page.locator('.scard', { hasText: '跳过' }).first();
  const attack = page.locator('.scard', { hasText: '攻击' }).first();
  if (await attack.isVisible({ timeout: 400 }).catch(() => false)) {
    await attack.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    // 点击目标（目标卡有 is-targetable）
    const target = page.locator('.ccard.is-targetable').first();
    if (await target.isVisible({ timeout: 800 }).catch(() => false)) {
      await target.click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
      const confirm = page.locator('.confirm-bar button', { hasText: '确认发动' }).first();
      if (await confirm.isVisible({ timeout: 800 }).catch(() => false) && await confirm.isEnabled().catch(() => false)) {
        await confirm.click({ force: true }).catch(() => {});
        attacked = true;
        console.log('攻击已提交，开始抓帧');
        break;
      }
    }
  } else if (await skip.isVisible({ timeout: 400 }).catch(() => false)) {
    // 还没轮到我：先跳过等待下一轮
    await skip.click({ force: true }).catch(() => {});
    const confirm = page.locator('.confirm-bar button', { hasText: '确认发动' }).first();
    if (await confirm.isVisible({ timeout: 300 }).catch(() => false)) await confirm.click({ force: true }).catch(() => {});
  }
  // 下一轮出拳
  const veilBtn = page.locator('.pv-actions button').first();
  if (await veilBtn.isVisible({ timeout: 200 }).catch(() => false)) await veilBtn.click({ force: true }).catch(() => {});
  const throwCard = page.locator('.throw-card').first();
  if (await throwCard.isVisible({ timeout: 200 }).catch(() => false)) await throwCard.click({ force: true }).catch(() => {});
  await page.waitForTimeout(700);
}

if (!attacked) {
  console.log('未能完成攻击（可能判定一直未轮到）');
  await page.screenshot({ path: '/tmp/hitcut-fail.png' });
} else {
  // 高频抓帧：攻击提交后 2.5s 内每 140ms 一帧
  for (let f = 0; f < 16; f++) {
    const fx = await page.evaluate(() => ({
      hitcut: document.querySelectorAll('.hitcut').length,
      dmg: document.querySelectorAll('.dmg-float').length,
      fx: document.querySelectorAll('.fx-anim').length,
      ctl: !!document.querySelector('.battle-ctl'),
    }));
    if (fx.hitcut > 0 || fx.dmg > 0) {
      await page.screenshot({ path: `/tmp/hitcut-frame-${f}.png` });
      console.log(`帧 ${f}:`, JSON.stringify(fx), '← 已截图');
    }
    await page.waitForTimeout(140);
  }
}
console.log('JS错误:', errors.length ? errors : '无');
await browser.close();
