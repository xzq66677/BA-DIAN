/**
 * 演出层调试脚本（非测试）：真实浏览器开局 → 自驱动 → 采样演出层 DOM。
 * 用法：npx tsx scripts/debug-fx.ts [port]
 */
import { chromium } from 'playwright';

const port = process.argv[2] || '3199';
const baseUrl = `http://127.0.0.1:${port}`;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const jsErrors: string[] = [];
page.on('pageerror', (e) => jsErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') jsErrors.push('console: ' + m.text()); });

await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
await page.getByText(/拔 典/).waitFor({ timeout: 15000 });
await page.locator('input[placeholder="输入昵称"]').fill('演出调试');
const selects = page.locator('select');
await selects.nth(2).selectOption('2');
await page.getByRole('button', { name: /单人开局/ }).click();
await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
console.log('战场已进入');

const samples: string[] = [];
const t0 = Date.now();
while (Date.now() - t0 < 30000) {
  const veilBtn = await page.locator('.pv-actions button').first().isVisible({ timeout: 300 }).catch(() => false);
  if (veilBtn) {
    await page.locator('.pv-actions button').first().click();
  }
  const hasThrowCard = await page.locator('.throw-card').first().isVisible({ timeout: 300 }).catch(() => false);
  if (hasThrowCard) {
    await page.locator('.throw-card').first().click();
  }
  const skipVisible = await page.locator('.scard', { hasText: '跳过' }).first().isVisible({ timeout: 300 }).catch(() => false);
  if (skipVisible) {
    await page.locator('.scard', { hasText: '跳过' }).first().click();
    const confirm = page.locator('.confirm-bar button', { hasText: '确认发动' }).first();
    if (await confirm.isVisible({ timeout: 300 }).catch(() => false) && await confirm.isEnabled().catch(() => false)) {
      await confirm.click();
    }
  }
  // 采样演出层
  const snap = await page.evaluate(() => {
    const phase = document.querySelector('.tcg-chip.hot')?.textContent || '?';
    const round = document.querySelector('.tcg-header .tcg-chip:nth-child(3)')?.textContent || '?';
    return {
      phase, round,
      hitcut: document.querySelectorAll('.hitcut').length,
      dmgFloat: document.querySelectorAll('.dmg-float').length,
      ctl: document.querySelectorAll('.battle-ctl').length,
      depth: document.querySelector('.bc-depth')?.textContent || '-',
      zoneAlert: document.querySelectorAll('.zone-alert').length,
      moveBanner: document.querySelectorAll('.move-banner').length,
      death: document.querySelectorAll('.death-stamp').length,
      heal: document.querySelectorAll('.healfx').length,
      logs: document.querySelectorAll('.log-scroll .log-line').length,
      flip: document.querySelectorAll('.ccard.flip-flying').length,
    };
  });
  samples.push(JSON.stringify(snap));
  await page.waitForTimeout(500);
}

// 汇总
const counts: Record<string, number> = {};
for (const s of samples) {
  const o = JSON.parse(s);
  for (const k of ['hitcut', 'dmgFloat', 'ctl', 'zoneAlert', 'moveBanner', 'death', 'heal', 'flip'] as const) {
    counts[k] = Math.max(counts[k] ?? 0, o[k]);
  }
}
console.log('采样数:', samples.length);
console.log('峰值:', JSON.stringify(counts));
console.log('最后5个采样:', samples.slice(-5).join('\n'));
console.log('JS错误:', jsErrors.length ? jsErrors : '无');
await page.screenshot({ path: '/tmp/badian-fx-final.png', fullPage: false });
await browser.close();
