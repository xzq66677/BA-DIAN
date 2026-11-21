/**
 * 基线/对比截图脚本（非测试）：自动打完一局，抓取关键场景截图。
 * 用法：npx tsx scripts/baseline-shots.ts [port] [输出目录前缀]
 *
 * 场景：首页 / 大厅 / 出拳阶段 / 行动阶段 / 战斗中(多帧) / 终局胜利弹层 / 终局战场
 * 视口：桌面 1440×900 / 窄屏 390×844 / 横屏 844×390
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const port = process.argv[2] || '3200';
const tag = process.argv[3] || 'base';
const baseUrl = `http://127.0.0.1:${port}`;
const outDir = `/tmp/badian-shots`;
fs.mkdirSync(outDir, { recursive: true });

async function driveGame(page: import('playwright').Page, opts: { screenshots: boolean; maxMs: number }) {
  // 驱动对局：出拳 → 跳过/攻击 → 确认，直到 over 或超时
  const t0 = Date.now();
  let actionDone = 0;
  while (Date.now() - t0 < opts.maxMs) {
    const over = await page.evaluate(() => document.querySelector('.win-overlay') !== null || document.body.textContent?.includes('对局结束') === true).catch(() => false);
    if (over) return true;
    try {
      const veilBtn = page.locator('.pv-actions button').first();
      if (await veilBtn.isVisible({ timeout: 120 }).catch(() => false)) await veilBtn.click({ timeout: 600, force: true }).catch(() => {});
      const throwCard = page.locator('.throw-card').first();
      if (await throwCard.isVisible({ timeout: 120 }).catch(() => false)) {
        if (opts.screenshots) {
          await page.screenshot({ path: `${outDir}/${tag}-rps.png` }).catch(() => {});
        }
        await throwCard.click({ timeout: 600, force: true }).catch(() => {});
      }
      // 有机会就攻击而不是总跳过（制造伤害演出）
      const skip = page.locator('.scard', { hasText: '跳过' }).first();
      const attack = page.locator('.scard', { hasText: /^攻击/ }).first();
      const pick = actionDone % 3 === 2 ? attack : skip;
      if (await pick.isVisible({ timeout: 120 }).catch(() => false)) {
        await pick.click({ timeout: 600, force: true }).catch(() => {});
        // 若攻击需要目标，点第一个可选目标
        const tgt = page.locator('.ccard.is-targetable, .seat.is-targetable').first();
        if (await tgt.isVisible({ timeout: 200 }).catch(() => false)) await tgt.click({ timeout: 400, force: true }).catch(() => {});
        const confirm = page.locator('.confirm-bar button', { hasText: '确认发动' }).first();
        if (await confirm.isVisible({ timeout: 200 }).catch(() => false) && await confirm.isEnabled().catch(() => false)) {
          if (opts.screenshots && actionDone === 1) await page.screenshot({ path: `${outDir}/${tag}-act-phase.png` }).catch(() => {});
          await confirm.click({ timeout: 600, force: true }).catch(() => {});
        }
        actionDone++;
      }
    } catch { /* 重渲染竞态重试 */ }
    await page.waitForTimeout(220);
  }
  return false;
}

const browser = await chromium.launch({ headless: true });

// ── 桌面 1440×900 ──
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText(/拔 典/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/${tag}-home.png` });

  await page.locator('input[placeholder="输入昵称"]').fill('基线实测');
  const selects = page.locator('select');
  await selects.nth(2).selectOption('3'); // 3 AI：更快分出胜负
  await page.getByRole('button', { name: /单人开局/ }).click();
  await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outDir}/${tag}-table-rps.png` });

  const finished = await driveGame(page, { screenshots: true, maxMs: 120000 });
  await page.waitForTimeout(1500);
  if (await page.locator('.win-overlay').isVisible().catch(() => false)) {
    await page.screenshot({ path: `${outDir}/${tag}-win-overlay.png` });
    // 关闭弹层看终局战场
    await page.locator('.win-modal .tcg-btn', { hasText: '查看战场' }).click().catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${outDir}/${tag}-over-table.png` });
  } else {
    await page.screenshot({ path: `${outDir}/${tag}-mid-table.png` });
  }
  console.log(`[desktop] finished=${finished} errors=${errors.length}`);
  await page.close();
}

// ── 窄屏 390×844 ──
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText(/拔 典/).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${outDir}/${tag}-narrow-home.png` });

  await page.locator('input[placeholder="输入昵称"]').fill('窄屏实测');
  const selects = page.locator('select');
  await selects.nth(2).selectOption('3');
  await page.getByRole('button', { name: /单人开局/ }).click();
  await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${outDir}/${tag}-narrow-table.png` });

  const finished = await driveGame(page, { screenshots: false, maxMs: 120000 });
  await page.waitForTimeout(1200);
  if (await page.locator('.win-overlay').isVisible().catch(() => false)) {
    await page.screenshot({ path: `${outDir}/${tag}-narrow-win.png` });
  } else {
    await page.screenshot({ path: `${outDir}/${tag}-narrow-mid.png` });
  }
  console.log(`[narrow] finished=${finished} errors=${errors.length}`);
  await page.close();
}

// ── 横屏 844×390 ──
{
  const page = await browser.newPage({ viewport: { width: 844, height: 390 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText(/拔 典/).waitFor({ timeout: 15000 });
  await page.locator('input[placeholder="输入昵称"]').fill('横屏实测');
  const selects = page.locator('select');
  await selects.nth(2).selectOption('3');
  await page.getByRole('button', { name: /单人开局/ }).click();
  await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${outDir}/${tag}-land-table.png` });
  const finished = await driveGame(page, { screenshots: false, maxMs: 120000 });
  await page.waitForTimeout(1200);
  if (await page.locator('.win-overlay').isVisible().catch(() => false)) {
    await page.screenshot({ path: `${outDir}/${tag}-land-win.png` });
  }
  console.log(`[landscape] finished=${finished} errors=${errors.length}`);
  await page.close();
}

await browser.close();
console.log('完成：', fs.readdirSync(outDir).filter((f) => f.startsWith(tag)).join(', '));
