// @ts-nocheck
/**
 * V4.3 · 移动端 3D 战场验证（Phase F）
 * 用法：npx tsx scripts/mobile3d-check.ts [baseUrl]
 *
 * 视口：390×844（窄屏竖屏）/ 844×390（手机横屏）。
 * 每个视口完整跑一局（单人开局 + AI），自动检查：
 *  - 横向溢出（scrollWidth ≤ innerWidth）；
 *  - 揭示台与「视角/2D」按钮组不重叠；
 *  - 行动坞不遮死战场主体（占高比记录）；
 *  - 关键点击目标尺寸（顶栏按钮/手牌卡/出拳卡）；
 *  - 触摸轨道旋转（pointer 事件模拟拖拽 → 画布仍渲染、无 JS 错误）；
 *  - 演出与淘汰反馈可见（dmg-float / death-stamp 捕获截图）；
 *  - 2D 回退切换可用。
 * 产物：/tmp/badian-shots/mb-<视口>-*.png + 控制台检查表。
 * ⚠️ 本脚本为 Playwright 设备视口模拟（无触屏/真实 GPU），实机差异已在报告中标注。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:3200';
const OUT = '/tmp/badian-shots';
fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { tag: 'narrow', width: 390, height: 844, hasTouch: true, isMobile: true },
  { tag: 'landscape', width: 844, height: 390, hasTouch: true, isMobile: true },
];

async function drive(page): Promise<void> {
  await page.evaluate(`(() => {
    const q = (s) => document.querySelector(s);
    const btn = (el) => { if (el) { el.click(); return true; } return false; };
    if (btn(q('.pv-actions button'))) return 'veil';
    if (btn(q('.throw-card'))) return 'throw';
    const skip = Array.from(document.querySelectorAll('.scard')).find((c) => (c.textContent || '').includes('跳过'));
    if (skip && !skip.classList.contains('selected')) skip.click();
    const confirm = Array.from(document.querySelectorAll('.confirm-bar button')).find((b) => (b.textContent || '').includes('确认发动') && !b.disabled);
    if (confirm) confirm.click();
  })()`).catch(() => {});
}

/** 布局检查（遮挡/溢出/点击区域） */
const layoutProbe = `(() => {
  const rect = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const overlap = (a, b) => a && b && !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  const reveal = rect('.bt3d-reveal-wrap');
  const corner = rect('.bt3d-corner');
  const dock = rect('.action-dock');
  const bf = rect('.battlefield');
  const smallTargets = [];
  for (const el of document.querySelectorAll('.tcg-header button, .scard, .throw-card, .bt3d-corner button, .battle-ctl .bc-btn')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.width < 32 || r.height < 24)) smallTargets.push({ t: (el.textContent || '').trim().slice(0, 8), w: Math.round(r.width), h: Math.round(r.height) });
  }
  return {
    overflowX: document.scrollingElement.scrollWidth > window.innerWidth + 1,
    revealCornerOverlap: overlap(reveal, corner),
    dockH: dock ? Math.round(dock.h) : -1,
    dockVsBf: dock && bf ? Math.round((dock.h / bf.h) * 100) : -1,
    smallTargets: smallTargets.slice(0, 8),
    has3d: !!document.querySelector('[data-testid="battle3d"]'),
    failed: document.querySelector('[data-testid="battle3d"]')?.dataset.failed,
  };
})()`;

for (const vp of VIEWPORTS) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    hasTouch: vp.hasTouch,
    isMobile: vp.isMobile,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.getByText(/拔 典/).waitFor({ timeout: 20000 });
  await page.locator('input[placeholder="输入昵称"]').fill('移动端验证');
  await page.locator('select').nth(2).selectOption('3');
  await page.getByRole('button', { name: /单人开局/ }).click();
  await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
  await page.waitForFunction(`!!window.__b3scene`, { timeout: 8000 }).catch(() => {});

  const has3d = await page.evaluate(`!!window.__b3scene`);
  console.log(`\n═══ [${vp.tag}] ${vp.width}×${vp.height} 3D=${has3d} ═══`);

  // 出拳阶段截图 + 布局检查
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/mb-${vp.tag}-rps.png` });
  let lay = await page.evaluate(layoutProbe).catch(() => null);
  console.log(`[出拳阶段] overflowX=${lay?.overflowX} 揭示台与按钮重叠=${lay?.revealCornerOverlap} 行动坞占战场高=${lay?.dockVsBf}% 小目标=${JSON.stringify(lay?.smallTargets || [])}`);

  // 推进到行动阶段
  const t0 = Date.now();
  let capturedHit = false, capturedDeath = false, acted = false;
  while (Date.now() - t0 < 150000) {
    const over = await page.evaluate(`!!document.querySelector('.win-overlay')`).catch(() => false);
    if (over) break;
    await drive(page);
    acted = true;
    await page.waitForTimeout(320);
    if (!capturedHit || !capturedDeath) {
      const hit = await page.evaluate(`document.querySelectorAll('.dmg-float').length > 0`).catch(() => false);
      const death = await page.evaluate(`document.querySelectorAll('.death-stamp').length > 0`).catch(() => false);
      if (hit && !capturedHit) { capturedHit = true; await page.screenshot({ path: `${OUT}/mb-${vp.tag}-hit.png` }); }
      if (death && !capturedDeath) { capturedDeath = true; await page.screenshot({ path: `${OUT}/mb-${vp.tag}-death.png` }); }
    }
  }
  await page.waitForTimeout(2200);
  for (let i = 0; i < 10; i++) {
    if (await page.evaluate(`!!document.querySelector('.win-overlay')`).catch(() => false)) break;
    await page.waitForTimeout(700);
  }
  lay = await page.evaluate(layoutProbe).catch(() => null);
  console.log(`[对局中/终局] 捕获受击=${capturedHit} 淘汰=${capturedDeath} overflowX=${lay?.overflowX} 3D失败=${lay?.failed}`);
  await page.screenshot({ path: `${OUT}/mb-${vp.tag}-end.png` });

  // 关闭终局弹层（否则拦截后续点击；「查看战场」保留战场可见）
  await page.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll('.win-modal button'));
    const v = btns.find((b) => (b.textContent || '').includes('查看战场'));
    if (v) v.click();
    else document.querySelector('.win-overlay')?.click();
  })()`).catch(() => {});
  await page.waitForTimeout(500);

  // 触摸轨道旋转（pointer 事件模拟水平拖拽）
  if (has3d) {
    const before = await page.screenshot({ path: `${OUT}/mb-${vp.tag}-orbit-before.png` });
    const cx = vp.width / 2, cy = vp.height * 0.4;
    await page.evaluate(`(() => {
      const cv = document.querySelector('.b3-canvas');
      const opts = (x, y) => ({ bubbles: true, pointerId: 1, clientX: x, clientY: y, isPrimary: true });
      cv.dispatchEvent(new PointerEvent('pointerdown', opts(${cx}, ${cy})));
      for (let i = 1; i <= 8; i++) {
        cv.dispatchEvent(new PointerEvent('pointermove', opts(${cx} + i * 14, ${cy})));
      }
      cv.dispatchEvent(new PointerEvent('pointerup', opts(${cx} + 112, ${cy})));
    })()`).catch(() => {});
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/mb-${vp.tag}-orbit-after.png` });
    console.log(`[触摸轨道] 拖拽模拟完成（截图 before/after 人工比对）jsErrors=${errs.length}`);
  }

  // 2D 回退切换
  if (has3d) {
    const btn = page.locator('.bt3d-corner button', { hasText: '2D' });
    if (await btn.count() > 0) {
      await btn.click();
      await page.waitForTimeout(600);
      const to2d = await page.evaluate(`({ table: !!document.querySelector('.battlefield.bt-table'), scene: !!window.__b3scene })`);
      console.log(`[2D回退] bt-table=${to2d.table} scene释放=${!to2d.scene}`);
      await page.screenshot({ path: `${OUT}/mb-${vp.tag}-2dfallback.png` });
    }
  }

  console.log(`[${vp.tag}] jsErrors=${errs.length}${errs.length ? ' ' + errs[0] : ''}`);
  await browser.close();
}
console.log('\n═══ 移动端验证完成（截图见 /tmp/badian-shots/mb-*.png） ═══');
