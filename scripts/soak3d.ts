// @ts-nocheck
/**
 * V4.3 · 3D 长局稳定性压测（Phase B）
 * 用法：npx tsx scripts/soak3d.ts [baseUrl]
 *
 * 场景：
 *  1. 连续 2 局（同一房间「再来一局」restart）——多局连续对局 + 演出链累计；
 *  2. 中局注入后台暂停/恢复（visibilitychange 模拟），验证 raf 不双启动；
 *  3. gojo 布阵 1 局（复活 ×N / 领域 / 高事件密度）；
 *  4. 3D↔2D 切换各一次；
 *  5. 每局采样：时长 / 回合数 / 日志事件数 / JS 错误 / context lost / 回退状态 /
 *     debugStats / DOM 节点数 / JS heap 趋势（泄漏观测量）。
 *
 * 产物：/tmp/badian-shots/soak-*.png + 控制台汇总表。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:3200';
const OUT = '/tmp/badian-shots';
fs.mkdirSync(OUT, { recursive: true });

const results: Record<string, unknown>[] = [];

/** 对局推进（真人身份代操作；原生 DOM click 绕过 React actionability 抖动） */
async function drive(page): Promise<void> {
  await page.evaluate(`(() => {
    const q = (s) => document.querySelector(s);
    const btn = (el) => { if (el) { el.click(); return true; } return false; };
    if (btn(q('.pv-actions button'))) return 'veil';
    if (btn(q('.throw-card'))) return 'throw';
    const cards = Array.from(document.querySelectorAll('.scard'));
    const skip = cards.find((c) => (c.textContent || '').includes('跳过'));
    if (skip && !skip.classList.contains('selected')) skip.click();
    const confirm = Array.from(document.querySelectorAll('.confirm-bar button')).find((b) => (b.textContent || '').includes('确认发动') && !b.disabled);
    if (confirm) confirm.click();
  })()`).catch(() => {});
}

/** 等待对局结束（win-overlay），返回对局统计 */
async function playToEnd(page, tag: string, limitMs = 240000) {
  const t0 = Date.now();
  let over = false;
  while (Date.now() - t0 < limitMs) {
    over = await page.evaluate(`!!document.querySelector('.win-overlay')`).catch(() => false);
    if (over) break;
    await drive(page);
    await page.waitForTimeout(350);
  }
  // 终局延迟呈现（finale gate）：over 后尾随日志可能让队列短暂重新变忙 → 门重新锁定，
  // 兜底放行上限 FINALE_WAIT_MAX_MS=6500 + 驻留 620ms → 给最长 9s 放行窗口
  if (over) {
    await page.waitForTimeout(2800);
    for (let i = 0; i < 12 && !(await page.evaluate(`!!document.querySelector('.win-overlay')`).catch(() => false)); i++) {
      await page.waitForTimeout(750);
    }
  }
  const snap = await page.evaluate(`(() => {
    const roundChip = document.querySelector('.tcg-header .tcg-chip:nth-child(3)');
    return {
      round: roundChip ? (roundChip.textContent || '').replace(/\\D/g, '') : '?',
      logs: document.querySelectorAll('.log-line').length,
      over: !!document.querySelector('.win-overlay'),
      failed3d: document.querySelector('[data-testid="battle3d"]')?.dataset.failed || 'n/a',
      stats: window.__b3scene ? window.__b3scene.debugStats() : null,
      dom: document.querySelectorAll('*').length,
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
      lost: (window.__lost || []).length,
    };
  })()`).catch(() => null);
  const dur = Math.round((Date.now() - t0) / 1000);
  console.log(`[${tag}] 时长=${dur}s 回合=${snap?.round} 日志=${snap?.logs} over=${snap?.over} 3D失败=${snap?.failed3d} entities=${snap?.stats?.entities} dom=${snap?.dom} heap=${snap?.heap}MB ctxLost=${snap?.lost}`);
  await page.screenshot({ path: `${OUT}/soak-${tag}.png` });
  return { dur, ...snap };
}

async function newPage(browser): Promise<any> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => { results.push({ type: 'jserror', page: page._tag || '?', msg: String(e).slice(0, 200) }); });
  page.on('console', (m) => { if (/too many active webgl/i.test(m.text())) results.push({ type: 'ctx-warn', msg: m.text().slice(0, 120) }); });
  await page.addInitScript(`(() => {
    window.__lost = [];
    document.addEventListener('webglcontextlost', () => window.__lost.push(Math.round(performance.now())), true);
    window.__rafCount = 0;
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => orig((t) => { window.__rafCount++; cb(t); });
    window.__rafRate = () => { const a = window.__rafCount; return () => window.__rafCount - a; };
  })()`);
  return page;
}

async function gotoHome(page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    try { await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 45000 }); return; }
    catch { await page.waitForTimeout(3000); }
  }
  throw new Error('goto failed');
}

async function startSolo(page, name: string): Promise<void> {
  await gotoHome(page);
  await page.getByText(/拔 典/).waitFor({ timeout: 20000 });
  await page.locator('input[placeholder="输入昵称"]').fill(name);
  await page.locator('select').nth(2).selectOption('3');
  await page.getByRole('button', { name: /单人开局/ }).click();
  await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
  await page.waitForFunction(`!!window.__b3scene`, { timeout: 8000 });
}

const browser = await chromium.launch({ headless: true });

// ── 局 1：随机角色 + 中局后台暂停/恢复 + raf 速率采样 ──────────
{
  const page = await newPage(browser);
  page._tag = 'g1';
  await startSolo(page, '压测A');
  await page.waitForTimeout(6000);
  await drive(page);

  // 后台暂停 → 恢复（帧计数验证不双启动）
  const rateBefore = await page.evaluate(`(() => { const b = window.__rafCount; return new Promise((res) => setTimeout(() => res(Math.round((window.__rafCount - b) / 2)), 2000)); })()`);
  await page.evaluate(`(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  })()`);
  await page.waitForTimeout(1000);
  const rateHidden = await page.evaluate(`(() => { const b = window.__rafCount; return new Promise((res) => setTimeout(() => res(window.__rafCount - b), 2000)); })()`);
  await page.evaluate(`(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  })()`);
  await page.waitForTimeout(500);
  const rateAfter = await page.evaluate(`(() => { const b = window.__rafCount; return new Promise((res) => setTimeout(() => res(Math.round((window.__rafCount - b) / 2)), 2000)); })()`);
  const rateSteady = await page.evaluate(`(() => { const b = window.__rafCount; return new Promise((res) => setTimeout(() => res(Math.round((window.__rafCount - b) / 2)), 2000)); })()`);
  console.log(`[g1 可见性] 帧率 前=${rateBefore}fps 隐藏中=${rateHidden} 恢复后=${rateAfter}fps 再2s=${rateSteady}fps（双启动特征：恢复后≈2×前值且持续）`);
  results.push({ g1: { rateBefore, rateHidden, rateAfter, rateSteady } });

  const r1 = await playToEnd(page, 'g1-end');
  results.push({ game1: r1 });

  // 同房间 restart → 局 2（多局连续）。
  // 服务端 restart 语义 = 回房间大厅（座位保留），房主需在大厅再次点「开始对局」
  const restartBtn = page.locator('.win-modal button', { hasText: '再来一局' });
  if (await restartBtn.count() > 0) {
    await restartBtn.click();
    await page.waitForTimeout(1200);
    // 回大厅 → 作为房主重新开始
    for (let i = 0; i < 10; i++) {
      const inLobby = await page.evaluate(`!!document.querySelector('.seat-slot')`).catch(() => false);
      if (!inLobby) break;
      const startBtn = page.getByRole('button', { name: /开始对局|单人开局/ });
      if (await startBtn.count() > 0) { await startBtn.click().catch(() => {}); break; }
      await page.waitForTimeout(800);
    }
    const t0 = Date.now();
    let backInGame = false;
    while (Date.now() - t0 < 20000) {
      backInGame = await page.evaluate(`!!document.querySelector('.privacy-veil, .scard-row')`).catch(() => false);
      if (backInGame) break;
      await page.waitForTimeout(500);
    }
    const stats2 = await page.evaluate(`window.__b3scene ? window.__b3scene.debugStats() : null`);
    console.log(`[g2] 新局开始=${backInGame} 场景 entities=${stats2?.entities} rooms=${stats2?.rooms}`);
    results.push({ g2SceneReused: !!stats2 && stats2.entities > 0 });
    if (backInGame) {
      const r2 = await playToEnd(page, 'g2-end');
      results.push({ game2: r2 });
    }
  } else {
    console.log('[g2] 无「再来一局」按钮（可能平局/非房主），跳过连续局');
  }
  await page.close();
}

// ── 局 3：gojo 布阵（复活/领域高密度） + 3D↔2D 切换 ──────────
{
  const page = await newPage(browser);
  page._tag = 'g3';
  await gotoHome(page);
  await page.getByText(/拔 典/).waitFor({ timeout: 20000 });
  await page.locator('input[placeholder="输入昵称"]').fill('压测B');
  await page.getByRole('button', { name: /创建房间/ }).click();
  await page.getByText(/玩家卡位/).waitFor({ timeout: 20000 });
  const charSel = page.locator('select', { hasText: 'AI 角色：🎲 随机' });
  await charSel.selectOption('gojo');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: /添加 AI/ }).click();
  const seatSels = page.locator('.seat-slot select');
  const n = await seatSels.count();
  for (let i = 0; i < n; i++) await seatSels.nth(i).selectOption('gojo').catch(() => {});
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: /开始对局|单人开局/ }).click({ timeout: 15000 });
  await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
  await page.waitForFunction(`!!window.__b3scene`, { timeout: 8000 });
  console.log('[g3] gojo 布阵开局（全员五条悟：复活+领域高密度）');

  // 中局 3D→2D→3D
  await page.waitForTimeout(8000);
  await drive(page);
  await page.locator('.bt3d-corner button', { hasText: '2D' }).click();
  await page.waitForTimeout(700);
  const to2d = await page.evaluate(`({ scene: !!window.__b3scene, table: !!document.querySelector('.battlefield.bt-table') })`);
  await page.locator('.battlefield .bt3d-corner button', { hasText: '3D' }).click();
  await page.waitForFunction(`!!window.__b3scene`, { timeout: 8000 });
  await page.waitForTimeout(700);
  const back3d = await page.evaluate(`window.__b3scene.debugStats()`);
  console.log(`[g3 切换] 2D: scene=${to2d.scene} table=${to2d.table} → 3D: entities=${back3d.entities} rooms=${back3d.rooms}`);
  results.push({ g3Toggle: { to2d, back3dEntities: back3d.entities, back3dRooms: back3d.rooms } });

  const r3 = await playToEnd(page, 'g3-end');
  results.push({ game3: r3 });
  await page.close();
}

// ── 汇总 ─────────────────────────────────────────────────────
const gllogDump = await (async () => null)();
const jsErrors = results.filter((r) => (r as { type?: string }).type === 'jserror');
const ctxWarns = results.filter((r) => (r as { type?: string }).type === 'ctx-warn');
console.log('\n═══ soak3d 汇总 ═══');
console.log(`JS 错误=${jsErrors.length} 上下文警告=${ctxWarns.length}`);
for (const r of results) console.log(JSON.stringify(r));
await browser.close();
