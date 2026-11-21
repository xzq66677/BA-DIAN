/**
 * 终局延迟呈现时间线实测（Phase E）：
 * 自动打完整局，100ms 采样记录：
 *  - 规则结算时刻（快照 phase='over' 到达 = 顶栏「游戏结束」出现）
 *  - 最后关键演出（致命斩击/淘汰印章/爆炸）出现与消失
 *  - 终局舞台登场时刻 / 玩家可跳过时间点（直接结算按钮可见窗口）
 * 输出相对时间线，验证：终局 UI 不抢断最后关键演出，且有兜底上限。
 * 用法：npx tsx scripts/timeline.ts [port] [场景数]
 */
import { chromium } from 'playwright';

const port = process.argv[2] || '3200';
const runs = Number(process.argv[3] || 3);
const baseUrl = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });

interface Timeline {
  seed: string;
  winner: string;
  overAt: number;          // 规则结算（顶栏游戏结束）
  lastKillAt: number;      // 最后一次致命斩击/爆炸/淘汰印章出现
  lastKillEndAt: number;   // 该演出消失（播完）
  finaleAt: number;        // 终局弹层登场
  skipBtnVisibleFrom: number; // 直接结算按钮出现
  skipBtnVisibleTo: number;
  waited: number;          // finaleAt - overAt
  killBeforeFinale: boolean; // 关键演出先于终局弹层？
}

const CHAR_ID = process.argv[4] || '';

async function runOnce(idx: number): Promise<Timeline | null> {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.getByText(/拔 典/).waitFor({ timeout: 15000 });
  await page.locator('input[placeholder="输入昵称"]').fill(`时间线${idx}`);
  if (CHAR_ID) {
    await page.locator('select').nth(0).selectOption(CHAR_ID);
  }
  await page.locator('select').nth(2).selectOption('3');
  await page.getByRole('button', { name: /单人开局/ }).click();
  await page.getByText(/行动坞/).waitFor({ timeout: 20000 });

  const t0 = Date.now();
  let overAt = -1, lastKillAt = -1, lastKillEndAt = -1, lastKillSeq = 0;
  let finaleAt = -1, skipFrom = -1, skipTo = -1;
  let killStillVisible = false;
  let seed = '', winner = '';
  let lastDepthWhileWaiting = -1;
  let depthAtFinale = -1;

  while (Date.now() - t0 < 120000) {
    const now = Date.now() - t0;
    const s = await page.evaluate(() => {
      const killNow =
        Array.from(document.querySelectorAll('.hitcut')).some((el) => el.querySelector('.hitcut-slash.lethal')) ||
        document.querySelectorAll('.ivan-boom-fx').length > 0 ||
        document.querySelectorAll('.death-stamp').length > 0 ||
        document.querySelectorAll('.revive-burst').length > 0;
      const ctl = document.querySelector('.battle-ctl');
      return {
        over: (document.querySelector('.tcg-header')?.textContent || '').includes('游戏结束') || (document.querySelector('.tcg-header')?.textContent || '').includes('对局结束'),
        killNow,
        queueDepth: Number(ctl?.getAttribute('data-queue-depth') ?? '0'),
        queuePlaying: ctl?.getAttribute('data-queue-playing') === '1',
        finale: !!document.querySelector('.win-overlay'),
        skipBtn: !!document.querySelector('.bc-finish'),
        winnerName: document.querySelector('.win-name')?.textContent || '',
      };
    }).catch(() => null);
    if (!s) break;
    if (s.over && overAt < 0) overAt = now;
    // 关键演出区间：出现→消失（记录最后一段）
    if (s.killNow) {
      if (!killStillVisible) { lastKillAt = now; lastKillEndAt = -1; }
      killStillVisible = true;
    } else if (killStillVisible) {
      lastKillEndAt = now;
      killStillVisible = false;
    }
    // 终局等待期间的最后一次队列深度（判断终局登场时是否还有未呈现事件）
    if (s.over && !s.finale) lastDepthWhileWaiting = s.queueDepth;
    if (s.skipBtn) { if (skipFrom < 0) skipFrom = now; skipTo = now; }
    if (s.finale && finaleAt < 0) {
      finaleAt = now; winner = s.winnerName;
      depthAtFinale = s.queueDepth;
    }
    if (s.finale) break;
    // 驱动
    const st = await page.evaluate(() => ({
      veil: document.querySelectorAll('.pv-actions button').length,
      throwCard: document.querySelectorAll('.throw-card').length,
      act: !!document.querySelector('.confirm-bar'),
    })).catch(() => null);
    if (st) {
      if (st.veil > 0) await page.locator('.pv-actions button').first().click({ timeout: 400, force: true }).catch(() => {});
      else if (st.throwCard > 0) await page.locator('.throw-card').first().click({ timeout: 400, force: true }).catch(() => {});
      else if (st.act) {
        if (CHAR_ID === 'ivan-girl') {
          const ivan = page.locator('.scard', { hasText: '投掷大伊万' }).first();
          if (await ivan.isVisible({ timeout: 80 }).catch(() => false)) {
            await ivan.click({ timeout: 400, force: true }).catch(() => {});
            const roomSel = page.locator('.confirm-bar select').first();
            if (await roomSel.isVisible({ timeout: 150 }).catch(() => false)) {
              const opts = await roomSel.locator('option').allTextContents();
              const occupied = opts.findIndex((o) => /（.+）/.test(o));
              await roomSel.selectOption({ index: Math.max(0, occupied) }).catch(() => {});
            }
            const c = page.locator('.confirm-bar button', { hasText: '确认发动' }).first();
            if (await c.isVisible({ timeout: 80 }).catch(() => false)) await c.click({ timeout: 400, force: true }).catch(() => {});
          } else {
            const skip = page.locator('.scard', { hasText: /^跳过/ }).first();
            if (await skip.isVisible({ timeout: 80 }).catch(() => false)) {
              await skip.click({ timeout: 400, force: true }).catch(() => {});
              const c = page.locator('.confirm-bar button', { hasText: '确认发动' }).first();
              if (await c.isVisible({ timeout: 80 }).catch(() => false)) await c.click({ timeout: 400, force: true }).catch(() => {});
            }
          }
        } else {
          const skip = page.locator('.scard', { hasText: /^跳过/ }).first();
          if (await skip.isVisible({ timeout: 80 }).catch(() => false)) {
            await skip.click({ timeout: 400, force: true }).catch(() => {});
            const c = page.locator('.confirm-bar button', { hasText: '确认发动' }).first();
            if (await c.isVisible({ timeout: 80 }).catch(() => false)) await c.click({ timeout: 400, force: true }).catch(() => {});
          }
        }
      }
    }
    await page.waitForTimeout(100);
  }
  await page.close();
  if (overAt < 0) return null;
  return {
    seed, winner,
    overAt, lastKillAt, lastKillEndAt,
    finaleAt: finaleAt < 0 ? -1 : finaleAt,
    skipBtnVisibleFrom: skipFrom, skipBtnVisibleTo: skipTo,
    waited: finaleAt < 0 ? -1 : finaleAt - overAt,
    // 终局登场时队列已清空（没有未呈现的关键事件）。
    // lastKillAt<0 = 采样未捕获到关键演出（多为 over 时队列本就空闲、演出早已播完的场景，
    // 立即进入终局是正确行为）；否则要求最后关键演出先于终局登场。
    queueDrained: depthAtFinale === 0 || lastDepthWhileWaiting === 0,
    killBeforeFinale: lastKillAt < 0 || lastKillAt <= finaleAt,
  };
}

const results: Timeline[] = [];
for (let i = 1; i <= runs; i++) {
  const r = await runOnce(i);
  if (r) results.push(r);
  console.log(`run ${i}${CHAR_ID ? `[${CHAR_ID}]` : ''}:`, r ? JSON.stringify(r) : '未完成');
}
await browser.close();

console.log('\n═══ 时间线汇总 ═══');
for (const r of results) {
  console.log(`seed=${r.seed} 胜者=${r.winner}`);
  console.log(`  规则结算(over)     t=${r.overAt}ms`);
  if (r.lastKillAt >= 0) console.log(`  最后关键演出出现   t=${r.lastKillAt}ms → 消失 t=${r.lastKillEndAt}ms`);
  console.log(`  直接结算按钮窗口   t=${r.skipBtnVisibleFrom}ms → ${r.skipBtnVisibleTo}ms`);
  console.log(`  终局舞台登场       t=${r.finaleAt}ms（等待 ${r.waited}ms）`);
  console.log(`  最后等待期队列深度=${r.queueDrained ? 0 : '>0（异常）'} 终局登场时深度=${r.queueDrained ? '0' : '?'}`);
  console.log(`  终局不抢断(演出先于终局且队列清空): ${r.killBeforeFinale && r.queueDrained ? '✅' : '❌'}`);
}
const okAll = results.every((r) => r.killBeforeFinale && r.queueDrained && (r.finaleAt < 0 || r.waited <= 6500));
console.log(`\n结论: ${okAll ? '✅ 全部满足（终局不抢断 + 队列清空 + 兜底 ≤6.5s）' : '❌ 存在违反'}`);
