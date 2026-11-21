// @ts-nocheck
/**
 * V4.2 · 3D 演出覆盖矩阵取证（Playwright + 真实引擎自动对局）
 * 用法：npx tsx scripts/pres3d-matrix.ts [baseUrl]
 * 产物：/tmp/badian-shots/mx-<视口>-<类别>.png + 控制台矩阵汇总
 *
 * 每个视口完整跑一局（1 真人挂机 + 3 AI），通过 __b3scene.debugStats()
 * 与 DOM 工件轮询捕获每个演出类别的峰值帧。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:3200';
const OUT = '/tmp/badian-shots';
const LINEUP = process.env.LINEUP || ''; // 'gojo' = 全员五条悟（定向覆盖 复活/领域）
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { tag: 'desktop', width: 1440, height: 900 },
  { tag: 'narrow', width: 390, height: 844 },
  { tag: 'landscape', width: 844, height: 390 },
];

// 类别 → 探测条件（DOM 工件或 debugStats 活动量）
const probe = (page) => ({
  attackBeam: `window.__b3scene && window.__b3scene.debugStats().fx > 0`,
  walk3d: `window.__b3scene && window.__b3scene.debugStats().walks > 0`,
  healRing: `window.__b3scene && window.__b3scene.debugStats().fx > 0 && !!document.querySelector('.heal-float')`,
  miss: `!!document.querySelector('.miss-float')`,
  hitFloat: `document.querySelectorAll('.dmg-float').length > 0`,
  slashCombo: `document.querySelectorAll('.b3-float .dmg-float').length > 1`,
  zoneAlert: `document.querySelectorAll('.zone-alert').length > 0`,
  deathStamp: `document.querySelectorAll('.death-stamp').length > 0`,
  reviveBurst: `document.querySelectorAll('.revive-burst').length > 0`,
  ivanTicker: `Array.from(document.querySelectorAll('.b3-ticker')).some(e => e.textContent.includes('投掷'))`,
  boomTicker: `Array.from(document.querySelectorAll('.b3-ticker')).some(e => e.textContent.includes('爆炸'))`,
  domainTicker: `Array.from(document.querySelectorAll('.b3-ticker')).some(e => e.textContent.includes('领域'))`,
  finaleCam: `window.__b3scene && window.__b3scene.debugStats().entities > 0 && !!document.querySelector('.tcg-chip.hot') && document.body.textContent.includes('游戏结束')`,
});

for (const vp of VIEWPORTS) {
  // HEADED=1 → 有头模式 + 硬件 GPU（D3D11）：验证真实 GPU 路径（无头默认 SwiftShader 软件渲染不稳定）
  const headed = !!process.env.HEADED;
  const browser = await chromium.launch({ headless: !headed, args: headed ? ['--use-angle=d3d11'] : [] });
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const jsErrors = [];
  page.on('pageerror', (e) => jsErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') jsErrors.push('console:' + m.text()); });

  let opened = false;
  for (let i = 0; i < 3 && !opened; i++) {
    try { await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 }); opened = true; }
    catch { await page.waitForTimeout(3000); }
  }
  await page.getByText(/拔 典/).waitFor({ timeout: 20000 });
  await page.locator('input[placeholder="输入昵称"]').fill('矩阵验证');
  const selects = page.locator('select');
  if (LINEUP === 'gojo') {
    // 创建房间 → 大厅指定全员五条悟（2条命→复活；领域展开→domain）→ 单人开局
    await page.getByRole('button', { name: /创建房间/ }).click();
    await page.getByText(/玩家卡位/).waitFor({ timeout: 20000 });
    const charSel = page.locator('select', { hasText: 'AI 角色：🎲 随机' });
    await charSel.selectOption('gojo');
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /添加 AI/ }).click();
    // 自己也切五条悟（人类席位下拉）
    const seatSels = page.locator('.seat-slot select');
    const n = await seatSels.count();
    for (let i = 0; i < n; i++) await seatSels.nth(i).selectOption('gojo').catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/mx-debug-lobby.png` });
    const seats = await page.evaluate(`document.querySelectorAll('.seat-slot').length`);
    console.log(`  lobby seats=${seats}`);
    await page.getByRole('button', { name: /开始对局|单人开局/ }).click({ timeout: 15000 });
  } else {
    await selects.nth(2).selectOption('3');
    await page.getByRole('button', { name: /单人开局/ }).click();
  }
  await page.getByText(/行动坞/).waitFor({ timeout: 20000 });

  // 等待 3D 场景探针就绪
  try {
    await page.waitForFunction(`!!window.__b3scene`, { timeout: 8000 });
  } catch { /* 无 WebGL 时跳过本视口 */ }
  // 上下文丢失探针（区分「WebGL 上下文丢失」与其它回退原因）+ 精确时刻
  await page.evaluate(`(() => {
    window.__ctxLost = false;
    window.__ctxLostAt = null;
    const cv = document.querySelector('.b3-canvas');
    if (cv) cv.addEventListener('webglcontextlost', () => {
      window.__ctxLost = true;
      window.__ctxLostAt = {
        t: Math.round(performance.now()),
        round: document.querySelector('.tcg-header .tcg-chip:nth-child(3)')?.textContent,
        phase: document.querySelector('.tcg-chip.hot')?.textContent,
        tickers: Array.from(document.querySelectorAll('.b3-ticker')).map(e => e.textContent).join('|').slice(0, 120),
        floats: document.querySelectorAll('.b3-float').length,
      };
    }, { once: true });
  })()`).catch(() => {});
  // 瞬态演出记录器：MutationObserver 捕获每次 ticker/浮层出现（防轮询错过）
  await page.evaluate(`(() => {
    window.__seen = {};
    const rec = (cls, txt) => { window.__seen[cls] = (window.__seen[cls] || 0) + 1; };
    const mo = new MutationObserver(() => {
      for (const t of document.querySelectorAll('.b3-ticker')) {
        const s = t.textContent || '';
        if (s.includes('领域')) rec('domainTicker');
        if (s.includes('投掷')) rec('ivanTicker');
        if (s.includes('爆炸')) rec('boomTicker');
      }
      if (document.querySelector('.revive-burst')) rec('reviveBurst');
      if (document.querySelector('.death-stamp')) rec('deathStamp');
      if (document.querySelector('.miss-float')) rec('miss');
      if (document.querySelector('.heal-float')) rec('healRing');
    });
    mo.observe(document.body, { childList: true, subtree: true });
  })()`).catch(() => {});

  const has3d = await page.evaluate(`!!window.__b3scene`);
  const captured = {};
  const t0 = Date.now();
  const LIMIT = 120000; // 单视口最多 2 分钟（AI 打完整局）
  while (Date.now() - t0 < LIMIT) {
    const over0 = await page.evaluate(`!!document.querySelector('.win-overlay')`).catch(() => false);
    if (over0) {
      await page.waitForTimeout(2600); // 终局延迟呈现：等演出链播完
      await page.screenshot({ path: `${OUT}/mx-${vp.tag}-finale-modal.png` });
      await page.locator('.win-modal').click({ position: { x: 8, y: 8 } }).catch(() => {});
      await page.waitForTimeout(700);
      await page.screenshot({ path: `${OUT}/mx-${vp.tag}-battlefield-over.png` });
      break;
    }
    const conds = probe(page);
    // 批量探测（一次 evaluate 返回全部条件，避免串行 evaluate 拉长轮询间隔错过瞬态演出）
    try {
      const hits: Record<string, boolean> = await page.evaluate(`(() => {
        const tickers = Array.from(document.querySelectorAll('.b3-ticker')).map(e => e.textContent || '');
        return {
          attackBeam: !!(window.__b3scene && window.__b3scene.debugStats().fx > 0),
          walk3d: !!(window.__b3scene && window.__b3scene.debugStats().walks > 0),
          healRing: !!(window.__b3scene && window.__b3scene.debugStats().fx > 0 && document.querySelector('.heal-float')),
          miss: !!document.querySelector('.miss-float'),
          hitFloat: document.querySelectorAll('.dmg-float').length > 0,
          slashCombo: document.querySelectorAll('.b3-float .dmg-float').length > 1,
          zoneAlert: document.querySelectorAll('.zone-alert').length > 0,
          deathStamp: document.querySelectorAll('.death-stamp').length > 0,
          reviveBurst: document.querySelectorAll('.revive-burst').length > 0,
          ivanTicker: tickers.some(t => t.includes('投掷')),
          boomTicker: tickers.some(t => t.includes('爆炸')),
          domainTicker: tickers.some(t => t.includes('领域')),
        };
      })()`);
      for (const [k, hit] of Object.entries(hits)) {
        if (hit && !captured[k]) {
          captured[k] = true;
          await page.screenshot({ path: `${OUT}/mx-${vp.tag}-${k}.png` });
        }
      }
    } catch { /* 页面跳转中 */ }
    // 推进对局（真人身份代操作；React 高频重渲染下 Playwright actionability 不稳定，
    // 改用原生 DOM click——React 合成事件正常触发）
    try {
      const acted = await page.evaluate(`(() => {
        const q = (s) => document.querySelector(s);
        const btn = (el) => { if (el) { el.click(); return true; } return false; };
        // 1) 出拳隐私揭示按钮
        if (btn(q('.pv-actions button'))) return 'veil';
        // 2) 出拳卡（第一张）
        if (btn(q('.throw-card'))) return 'throw';
        // 3) 行动卡：优先「领域展开」，否则「跳过」
        const cards = Array.from(document.querySelectorAll('.scard'));
        const dom = cards.find((c) => (c.querySelector('.scard-name')?.textContent || '') === '领域展开');
        const skip = cards.find((c) => (c.textContent || '').includes('跳过'));
        const pick = dom || skip;
        if (!pick) return null;
        if (pick.classList.contains('selected') || pick === dom) pick.click();
        const confirm = Array.from(document.querySelectorAll('.confirm-bar button')).find((b) => (b.textContent || '').includes('确认发动') && !b.disabled);
        if (confirm) { confirm.click(); return pick === dom ? 'domain' : 'skip-confirm'; }
        return pick === dom ? 'domain-pick' : 'skip-pick';
      })()`).catch(() => null);
      if (process.env.DEBUG && acted) console.log(`  [${vp.tag}] act=${acted}`);
      if (acted === 'domain' && !captured.__domainClicked) {
        captured.__domainClicked = true;
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/mx-debug-domain-click.png` });
      }
    } catch { /* 阶段切换竞态，下轮重试 */ }
    await page.waitForTimeout(300);
  }

  const stats = has3d ? await page.evaluate(`window.__b3scene ? window.__b3scene.debugStats() : null`).catch(() => null) : null;
  const ctxLost = await page.evaluate(`!!window.__ctxLost`).catch(() => false);
  const ctxAt = await page.evaluate(`window.__ctxLostAt`).catch(() => null);
  const hostGone = await page.evaluate(`!document.querySelector('.b3-host')`).catch(() => true);
  const seen = await page.evaluate(`window.__seen || {}`).catch(() => ({}));
  console.log(`[${vp.tag}] 3D=${has3d} captured=[${Object.keys(captured).filter(k => !k.startsWith('__')).join(',')}] seen=${JSON.stringify(seen)} stats=${JSON.stringify(stats)} ctxLost=${ctxLost} ctxAt=${JSON.stringify(ctxAt)} hostGone=${hostGone} jsErrors=${jsErrors.length}`);
  if (jsErrors.length) console.log(`  ERRORS: ${jsErrors.slice(0, 3).join(' | ')}`);
  await browser.close();
}
