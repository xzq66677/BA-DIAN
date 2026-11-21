/**
 * 原型对比截图（Phase B）：?proto=A|B|C 各自自动打完一局，
 * 抓取 出拳/行动/终局等待/终局舞台 四类场景截图。
 * 用法：npx tsx scripts/proto-shots.ts [port]
 */
import { chromium } from 'playwright';

const port = process.argv[2] || '3200';
const baseUrl = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ headless: true });

async function shoot(arch: 'A' | 'B' | 'C') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${baseUrl}/?proto=${arch}`, { waitUntil: 'domcontentloaded' });
  await page.locator('.proto-root').waitFor({ timeout: 15000 });
  console.log(`[proto-${arch}] 已进入`);

  const t0 = Date.now();
  let shots = 0;
  let sawEvents = false;
  let finaleWaitShot = false;
  let finaleShot = false;
  let midShot = false;
  let earlyShot = false;
  while (Date.now() - t0 < 110000) {
    const st = await page.evaluate(() => ({
      hitcut: document.querySelectorAll('.hitcut').length,
      bomb: document.querySelectorAll('.ivan-bomb').length,
      boom: document.querySelectorAll('.ivan-boom-fx').length,
      alert: document.querySelectorAll('.zone-alert').length,
      death: document.querySelectorAll('.death-stamp').length,
      beam: document.querySelectorAll('.pa-beam').length,
      route: document.querySelectorAll('.pb-route').length,
      heal: document.querySelectorAll('.healfx').length,
      finaleChip: !!document.querySelector('.finale-chip'),
      finale: !!document.querySelector('.win-overlay'),
      rps: !!document.querySelector('.pc-center-label') && document.body.textContent?.includes('隐藏出拳'),
      over: (document.querySelector('.pbar')?.textContent || '').includes('对局结束'),
    })).catch(() => null);
    if (!st) break;

    if (!earlyShot && (st.rps || st.alert)) {
      earlyShot = true;
      await page.screenshot({ path: `/tmp/badian-shots/proto-${arch}-rps.png` });
    }
    if (!sawEvents && (st.hitcut || st.bomb || st.boom || st.alert || st.death || st.beam || st.route || st.heal)) {
      sawEvents = true;
      await page.screenshot({ path: `/tmp/badian-shots/proto-${arch}-events.png` });
      console.log(`[proto-${arch}] 事件演出截图`, JSON.stringify(st));
    }
    if (!midShot && shots === 0 && (st.hitcut || st.beam || st.route || st.bomb)) {
      // 再抓一张事件中段
      midShot = true;
      await page.waitForTimeout(400);
      await page.screenshot({ path: `/tmp/badian-shots/proto-${arch}-events2.png` });
    }
    if (!finaleWaitShot && st.finaleChip) {
      finaleWaitShot = true;
      await page.screenshot({ path: `/tmp/badian-shots/proto-${arch}-finale-wait.png` });
      console.log(`[proto-${arch}] 终局等待截图（终局延迟呈现生效）`);
    }
    if (!finaleShot && st.finale) {
      finaleShot = true;
      await page.waitForTimeout(900);
      await page.screenshot({ path: `/tmp/badian-shots/proto-${arch}-finale.png` });
      break;
    }
    if (st.over && !st.finale && !finaleShot) {
      // 兜底放行后的终局
      await page.waitForTimeout(800);
      await page.screenshot({ path: `/tmp/badian-shots/proto-${arch}-finale.png` });
      finaleShot = true;
      break;
    }
    await page.waitForTimeout(180);
    shots++;
  }
  if (!finaleShot) await page.screenshot({ path: `/tmp/badian-shots/proto-${arch}-end.png` });
  console.log(`[proto-${arch}] sawEvents=${sawEvents} finaleWait=${finaleWaitShot} finale=${finaleShot} JS错误=${errors.length ? errors : '无'}`);
  await page.close();
}

await shoot('A');
await shoot('B');
await shoot('C');
await browser.close();
console.log('完成');
