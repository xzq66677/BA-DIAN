/**
 * 大伊万演出链实测（非测试脚本）：选小女孩投掷大伊万 → 等待回合末爆炸 →
 * 高频采样截图验证 投掷物飞行 / 待爆警示 / 爆炸冲击 / 逐目标结算。
 * 用法：npx tsx scripts/visual-ivan.ts [port]
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const port = process.argv[2] || '3200';
const baseUrl = `http://127.0.0.1:${port}`;
const outDir = '/tmp/badian-shots';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
await page.getByText(/拔 典/).waitFor({ timeout: 15000 });

// 选「卖大伊万的小女孩」：selects[0] 是角色卡（value=charId），nth(2) 是 AI 数量
await page.locator('input[placeholder="输入昵称"]').fill('伊万指挥官');
await page.locator('select').nth(0).selectOption('ivan-girl');
const chosenChar = await page.locator('select').nth(0).inputValue();
console.log('已选角色:', chosenChar);
if (chosenChar !== 'ivan-girl') throw new Error('角色选择失败: ' + chosenChar);
await page.locator('select').nth(2).selectOption('2'); // 2 AI
await page.getByRole('button', { name: /单人开局/ }).click();
await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
console.log('进入对局');

let phase = '';
let ivanThrown = false;
const t0 = Date.now();
let shots = 0;
let sawPending = false;
let sawFly = false;
let sawBoom = false;

while (Date.now() - t0 < 90000) {
  const state = await page.evaluate(() => {
    const body = document.body.textContent || '';
    return {
      over: document.querySelector('.win-overlay') !== null,
      pending: document.querySelectorAll('.ivan-pending').length,
      bomb: document.querySelectorAll('.ivan-bomb').length,
      boom: document.querySelectorAll('.ivan-boom-fx').length,
      zonePending: document.querySelectorAll('.zone-pending-ivan').length,
      zoneAlertIvan: document.querySelectorAll('.zone-alert-ivan').length,
      hitcut: document.querySelectorAll('.hitcut').length,
      death: document.querySelectorAll('.death-stamp').length,
      actPhase: !!document.querySelector('.confirm-bar'),
      veil: document.querySelectorAll('.pv-actions button').length,
      throwCard: document.querySelectorAll('.throw-card').length,
      skipCard: Array.from(document.querySelectorAll('.scard')).some((s) => s.textContent?.includes('投掷大伊万')),
      selectedText: document.querySelector('.confirm-bar')?.textContent || '',
    };
  }).catch(() => null);
  if (!state) { await page.waitForTimeout(200); continue; }
  if (state.over) break;

  // 1) 出拳阶段驱动
  if (state.veil > 0) {
    await page.locator('.pv-actions button').first().click({ timeout: 800, force: true }).catch(() => {});
  } else if (state.throwCard > 0) {
    if (shots === 0 || phase !== 'rps') await page.screenshot({ path: `${outDir}/ivan-rps.png` }).catch(() => {});
    phase = 'rps';
    await page.locator('.throw-card').first().click({ timeout: 800, force: true }).catch(() => {});
  }

  // 2) 行动阶段：优先投掷大伊万（选房间 R2/R3/R4 有人的房间 → 默认第一个房间选项即可，AI 初始分散）
  if (state.actPhase && state.skipCard && !ivanThrown) {
    const ivanCard = page.locator('.scard', { hasText: '投掷大伊万' }).first();
    await ivanCard.click({ timeout: 800, force: true }).catch(() => {});
    // 选一个目标房间：优先与 AI 同房间的？直接选下拉里第一个非空房间
    const roomSel = page.locator('.confirm-bar select').first();
    if (await roomSel.isVisible().catch(() => false)) {
      const opts = await roomSel.locator('option').allTextContents();
      // 找有人的房间（含（人名）括号）
      const occupied = opts.findIndex((o) => /（.+\）/.test(o) && !o.startsWith('R1'));
      const idx = occupied >= 0 ? occupied : 0;
      await roomSel.selectOption({ index: idx }).catch(() => {});
      const chosen = opts[idx]?.split('（')[0] || '';
      console.log('投掷目标房间:', chosen, opts[idx]);
      await page.screenshot({ path: `${outDir}/ivan-throw-select.png` }).catch(() => {});
    }
    const confirm = page.locator('.confirm-bar button', { hasText: '确认发动' }).first();
    if (await confirm.isVisible().catch(() => false) && await confirm.isEnabled().catch(() => false)) {
      await confirm.click({ timeout: 800, force: true }).catch(() => {});
      ivanThrown = true;
      console.log('已投掷大伊万');
      // 飞行采样（投掷物出现 → 飞行）
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(180);
        const s2 = await page.evaluate(() => ({
          bomb: document.querySelectorAll('.ivan-bomb').length,
        })).catch(() => ({ bomb: 0 }));
        if (s2.bomb > 0 && !sawFly) {
          sawFly = true;
          await page.screenshot({ path: `${outDir}/ivan-fly.png` }).catch(() => {});
          console.log('截到投掷物飞行');
        }
      }
    }
  } else if (state.actPhase) {
    // 已投掷：跳过行动推进回合
    const skip = page.locator('.scard', { hasText: /^跳过/ }).first();
    if (await skip.isVisible({ timeout: 120 }).catch(() => false)) {
      await skip.click({ timeout: 600, force: true }).catch(() => {});
      const confirm = page.locator('.confirm-bar button', { hasText: '确认发动' }).first();
      if (await confirm.isVisible({ timeout: 150 }).catch(() => false)) await confirm.click({ timeout: 600, force: true }).catch(() => {});
    }
  }

  // 3) 待爆警示采样
  if (state.pending > 0 && !sawPending) {
    sawPending = true;
    await page.screenshot({ path: `${outDir}/ivan-pending.png` }).catch(() => {});
    console.log('截到待爆警示');
  }

  // 4) 爆炸/受击采样
  if (state.boom > 0 && !sawBoom) {
    sawBoom = true;
    await page.screenshot({ path: `${outDir}/ivan-boom.png` }).catch(() => {});
    console.log('截到爆炸冲击');
  }
  if ((state.zoneAlertIvan > 0 || state.death > 0) && shots < 3) {
    shots++;
    await page.screenshot({ path: `${outDir}/ivan-aftermath-${shots}.png` }).catch(() => {});
    console.log('截到结算反馈', JSON.stringify(state));
  }

  await page.waitForTimeout(200);
}

await page.waitForTimeout(800);
await page.screenshot({ path: `${outDir}/ivan-final.png` });
console.log(`sawFly=${sawFly} sawPending=${sawPending} sawBoom=${sawBoom} JS错误=${errors.length ? errors : '无'}`);
await browser.close();
