/**
 * 大伊万演出链高频探针：投掷后 100ms 间隔采样 8 秒，
 * 记录每个时间点的关键 DOM 状态，定位飞行/警示/爆炸的确切窗口。
 */
import { chromium } from 'playwright';

const port = process.argv[2] || '3200';
const baseUrl = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
await page.getByText(/拔 典/).waitFor({ timeout: 15000 });
await page.locator('input[placeholder="输入昵称"]').fill('伊万指挥官');
await page.locator('select').nth(0).selectOption('ivan-girl');
await page.locator('select').nth(2).selectOption('1'); // 1 AI：减少干扰
await page.getByRole('button', { name: /单人开局/ }).click();
await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
console.log('进入对局');

// 驱动到我的行动回合，投掷大伊万
let thrown = false;
const t0 = Date.now();
while (Date.now() - t0 < 60000 && !thrown) {
  const s = await page.evaluate(() => ({
    veil: document.querySelectorAll('.pv-actions button').length,
    throwCard: document.querySelectorAll('.throw-card').length,
    ivanCard: Array.from(document.querySelectorAll('.scard')).some((x) => x.textContent?.includes('投掷大伊万')),
    confirm: !!document.querySelector('.confirm-bar .tcg-btn'),
    over: !!document.querySelector('.win-overlay'),
  })).catch(() => null);
  if (!s || s.over) break;
  if (s.veil > 0) await page.locator('.pv-actions button').first().click({ timeout: 500, force: true }).catch(() => {});
  else if (s.throwCard > 0) await page.locator('.throw-card').first().click({ timeout: 500, force: true }).catch(() => {});
  else if (s.ivanCard) {
    await page.locator('.scard', { hasText: '投掷大伊万' }).first().click({ timeout: 500, force: true }).catch(() => {});
    await page.waitForTimeout(150);
    const roomSel = page.locator('.confirm-bar select').first();
    if (await roomSel.isVisible().catch(() => false)) {
      const opts = await roomSel.locator('option').allTextContents();
      const occupied = opts.findIndex((o) => /（.+）/.test(o) && !o.startsWith('R1'));
      await roomSel.selectOption({ index: occupied >= 0 ? occupied : 0 }).catch(() => {});
    }
    const confirm = page.locator('.confirm-bar button', { hasText: '确认发动' }).first();
    if (await confirm.isVisible().catch(() => false) && await confirm.isEnabled().catch(() => false)) {
      await confirm.click({ timeout: 500, force: true }).catch(() => {});
      thrown = true;
    }
  }
  await page.waitForTimeout(150);
}
console.log('thrown =', thrown);
if (!thrown) { await browser.close(); process.exit(1); }

// 高频采样 8 秒
const t1 = Date.now();
const rows: string[] = [];
let lastLogCount = -1;
while (Date.now() - t1 < 8000) {
  const s = await page.evaluate(() => ({
    bomb: document.querySelectorAll('.ivan-bomb').length,
    pending: document.querySelectorAll('.ivan-pending').length,
    zonePending: document.querySelectorAll('.zone-pending-ivan').length,
    boom: document.querySelectorAll('.ivan-boom-fx').length,
    alertIvan: document.querySelectorAll('.zone-alert-ivan').length,
    hitcut: document.querySelectorAll('.hitcut').length,
    death: document.querySelectorAll('.death-stamp').length,
    ctlDepth: document.querySelector('.bc-depth')?.textContent || '',
    logCount: document.querySelectorAll('.log-scroll .log-line').length,
    lastLog: document.querySelector('.log-scroll .log-line')?.textContent?.slice(0, 60) || '',
    overlay: !!document.querySelector('.win-overlay'),
  })).catch(() => null);
  if (s) {
    if (s.logCount !== lastLogCount) {
      lastLogCount = s.logCount;
      rows.push(`t+${Date.now() - t1}ms LOG[${s.logCount}] ${s.lastLog} | bomb=${s.bomb} pending=${s.pending}/${s.zonePending} boom=${s.boom} alert=${s.alertIvan} hit=${s.hitcut} death=${s.death} ctl="${s.ctlDepth}" over=${s.overlay}`);
    } else if (s.bomb || s.boom || s.pending || s.death) {
      rows.push(`t+${Date.now() - t1}ms bomb=${s.bomb} pending=${s.pending}/${s.zonePending} boom=${s.boom} hit=${s.hitcut} death=${s.death}`);
    }
    if (s.bomb > 0 && !rows.some((r) => r.includes('SHOT-FLY'))) {
      await page.screenshot({ path: '/tmp/badian-shots/ivan2-fly.png' });
      rows.push('SHOT-FLY saved');
    }
    if (s.boom > 0 && !rows.some((r) => r.includes('SHOT-BOOM'))) {
      await page.screenshot({ path: '/tmp/badian-shots/ivan2-boom.png' });
      rows.push('SHOT-BOOM saved');
    }
    if (s.death > 0 && !rows.some((r) => r.includes('SHOT-DEATH'))) {
      await page.screenshot({ path: '/tmp/badian-shots/ivan2-death.png' });
      rows.push('SHOT-DEATH saved');
    }
    if (s.pending > 0 && !rows.some((r) => r.includes('SHOT-PENDING'))) {
      await page.screenshot({ path: '/tmp/badian-shots/ivan2-pending.png' });
      rows.push('SHOT-PENDING saved');
    }
  }
  await page.waitForTimeout(100);
}
console.log(rows.join('\n'));
console.log('JS错误 =', errors.length ? errors : '无');
await browser.close();
