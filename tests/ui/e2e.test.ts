// @vitest-environment node
/// <reference lib="dom" />
/**
 * 真实浏览器端到端测试（Playwright + Chromium headless）
 * 依赖系统库（已通过 playwright install-deps 安装）。
 * 覆盖：首页渲染与卡池图加载 → 单人开局 → 真实出拳 → AI 推进对局 → 大厅添加AI选角/聊天 → 机制测试场。
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { expect } from '@playwright/test';
import { attachBrowserTransport } from '../support/browser-transport.js';
import { startTestServer, type TestServer } from '../support/test-server.js';
import { ALL_CASES } from '../../shared/src/testcases/index.js';
import type { SlotState } from '../../shared/src/characters/slot-hero.js';

let browser: Browser;
let server: TestServer;
let baseUrl = '';

beforeAll(async () => {
  // B-014 教训：E2E 前强制重建客户端，防止 dist 陈旧（服务端走 vitest 实时转换，无需构建）
  // B-027：构建必须以 NODE_ENV=production 执行 —— vitest 进程内 NODE_ENV=test 会把
  // React 开发版打进 bundle（体积翻倍 + StrictMode 双调用 effect），E2E 就会测到非生产行为
  // B-030：构建到独立 dist-e2e 目录 —— 此前直接重建 client/dist，而本机 systemd 生产实例
  // 恰好静态服务该目录，导致「跑一次测试 = 无意间更新生产内容」。测试基建必须与生产隔离。
  const root = path.resolve(import.meta.dirname, '../..');
  const scratch = path.join(root, '.tmp-build');
  mkdirSync(scratch, { recursive: true });
  // esbuild on Windows uses a named temporary file under TEMP; isolate each browser build.
  const temp = mkdtempSync(path.join(scratch, 'browser-'));
  execSync('npx vite build client --outDir dist-e2e --emptyOutDir', {
    cwd: root, stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production', TEMP: temp, TMP: temp, TMPDIR: temp },
  });
  process.env.CLIENT_DIST = path.resolve(import.meta.dirname, '../../client/dist-e2e');
  server = await startTestServer(await import('../../server/src/index.js'));
  baseUrl = server.url;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
}, 90000);

afterAll(async () => {
  try {
    await browser?.close();
  } finally {
    await server?.close();
  }
});

async function newPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await attachBrowserTransport(page, server);
  return page;
}

describe('真实浏览器端到端', { timeout: 120000 }, () => {
  it('首页渲染：卡池立绘真实加载 + 房间列表容器', async () => {
    const page = await newPage(browser);
    await page.goto(baseUrl + '/?entrance=classic', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/拔 典/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/角色卡池/)).toBeVisible();

    // 卡面 webp 真实加载（至少一张 naturalWidth > 0）
    await page.waitForTimeout(1200);
    const loaded = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('.char-showcase img'));
      return { total: imgs.length, ok: imgs.filter((i) => (i as HTMLImageElement).naturalWidth > 0).length };
    });
    expect(loaded.total).toBeGreaterThanOrEqual(9);
    expect(loaded.ok).toBeGreaterThanOrEqual(9);
    await page.close();
  });

  it('单人开局（+2AI随机）→ 战场渲染 → 隐藏出拳 → AI 自动推进', async () => {
    const page = await newPage(browser);
    await page.goto(baseUrl + '/?entrance=classic', { waitUntil: 'domcontentloaded' });
    await page.getByText(/拔 典/).waitFor({ timeout: 15000 });

    await page.locator('input[placeholder="输入昵称"]').fill('E2E勇者');
    const selects = page.locator('select');
    await selects.nth(2).selectOption('2'); // AI 数量 2
    await page.getByRole('button', { name: /单人开局/ }).click();

    // 战场出现
    await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
    await expect(page.locator('.battlefield')).toBeVisible();
    // Issue #61：真人（本机）+ AI 混合局默认慢速演出
    await expect(page.locator('.battlefield')).toHaveAttribute('data-pace', 'slow');
    // 角色卡在场上（AI 已有随机角色 → 卡面 img）：
    // 2D 牌桌 = .ccard-art img；3D 战场 = .b3-av img（名牌头像）+ .ms-art img（我的席位）
    await page.waitForTimeout(1500);
    const cardImgs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.ccard-art img, .b3-av img, .ms-art img'))
        .filter((i) => (i as HTMLImageElement).naturalWidth > 0).length,
    );
    expect(cardImgs).toBeGreaterThanOrEqual(1);

    // 隐藏出拳：本人出拳（卡背式按钮）
    const throwBtn = page.getByRole('button', { name: /开始出拳/ }).first();
    if (await throwBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await throwBtn.click();
      await page.locator('.throw-card').first().click();
    }

    // 等待对局推进（AI 行动 → 日志增长）
    await page.waitForTimeout(4000);
    const logs = await page.locator('.log-scroll .log-line').count();
    expect(logs).toBeGreaterThan(3);
    await page.close();
  });

  it('战斗日志可自主开关，2D / 3D / 手机窄屏与横屏关闭后不遮挡', async () => {
    const page = await newPage(browser);
    await page.addInitScript(() => localStorage.setItem('badian-renderer', '2d'));
    await page.goto(baseUrl + '/?entrance=classic', { waitUntil: 'domcontentloaded' });
    await page.getByText(/拔 典/).waitFor({ timeout: 15000 });
    await page.locator('input[placeholder="输入昵称"]').fill('日志验收员');
    await page.locator('select').nth(2).selectOption('1');
    await page.getByRole('button', { name: /单人开局/ }).click();
    await page.getByText(/行动坞/).waitFor({ timeout: 20000 });

    const log = page.locator('.log-side');
    const toggle = page.getByRole('button', { name: /📜 日志/ });
    await expect(log).toBeVisible();
    await toggle.click();
    await expect(log).toBeHidden();
    await expect(page.locator('.tcg-main')).toHaveClass(/no-log/);
    await toggle.click();
    await expect(log).toBeVisible();

    await page.getByRole('button', { name: '3D', exact: true }).click();
    await expect(page.locator('.tcg-app')).toHaveClass(/s3d-mode/);
    await expect(log).toBeHidden();
    await toggle.click();
    await expect(log).toBeVisible();
    await toggle.click();
    await expect(log).toBeHidden();

    await page.setViewportSize({ width: 844, height: 390 });
    await expect(log).toBeHidden();
    await toggle.click();
    await expect(log).toBeVisible();
    await log.getByRole('button', { name: '关闭日志' }).click();
    await expect(log).toBeHidden();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(log).toBeHidden();
    await toggle.click();
    await expect(log).toBeVisible();
    await toggle.click();
    await expect(log).toBeHidden();
    expect(await log.boundingBox()).toBeNull();
    await page.close();
  });

  it('房主创建房间 → 另一玩家从列表加入 → 双向聊天 → 双方进入对局', async () => {
    const host = await newPage(browser);
    const guest = await newPage(browser);
    const jsErrors: string[] = [];
    host.on('pageerror', (e) => jsErrors.push(`host: ${String(e)}`));
    guest.on('pageerror', (e) => jsErrors.push(`guest: ${String(e)}`));
    try {
      await host.goto(baseUrl + '/?entrance=classic', { waitUntil: 'domcontentloaded' });
      await host.getByText(/拔 典/).waitFor({ timeout: 15000 });
      await host.locator('input[placeholder="输入昵称"]').fill('联机房主');
      await host.getByRole('button', { name: '仅创建（邀请好友）' }).click();
      await host.getByText(/玩家卡位/).waitFor({ timeout: 20000 });
      const code = (await host.locator('.tcg-panel').first().innerText()).match(/\b[A-Z2-9]{4}\b/)?.[0];
      expect(code).toBeTruthy();

      await guest.goto(baseUrl + '/?entrance=classic', { waitUntil: 'domcontentloaded' });
      await guest.getByText(/拔 典/).waitFor({ timeout: 15000 });
      await guest.locator('input[placeholder="输入昵称"]').fill('联机客人');
      const roomItem = guest.locator('.room-item').filter({ hasText: code! });
      await expect(roomItem).toBeVisible({ timeout: 10000 });
      await roomItem.getByRole('button', { name: '加入', exact: true }).click();
      await expect(host.locator('.seat-slot')).toHaveCount(2);
      await expect(guest.locator('.seat-slot')).toHaveCount(2);
      await expect(host.locator('.seat-slots')).toContainText('联机客人');
      await expect(guest.locator('.seat-slots')).toContainText('联机房主');

      await host.getByPlaceholder('输入消息…').fill('房主欢迎你');
      await host.getByRole('button', { name: '发送', exact: true }).click();
      await expect(guest.locator('.chat-log')).toContainText('房主欢迎你');
      await guest.getByPlaceholder('输入消息…').fill('客人已加入');
      await guest.getByRole('button', { name: '发送', exact: true }).click();
      await expect(host.locator('.chat-log')).toContainText('客人已加入');

      await host.getByRole('button', { name: /开始对局/ }).click();
      await expect(host.locator('.battlefield')).toBeVisible({ timeout: 20000 });
      await expect(guest.locator('.battlefield')).toBeVisible({ timeout: 20000 });
      await expect(host.locator('.tcg-header')).toContainText(code!);
      await expect(guest.locator('.tcg-header')).toContainText(code!);
      expect(jsErrors).toEqual([]);
    } finally {
      await guest.close();
      await host.close();
    }
  });

  it('战斗演出：结构化事件驱动受击斩击 / 演出控制条 / HP条 / 无JS错误', async () => {
    const page = await newPage(browser);
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(String(e)));
    await page.goto(baseUrl + '/?entrance=classic', { waitUntil: 'domcontentloaded' });
    await page.getByText(/拔 典/).waitFor({ timeout: 15000 });

    // 单人开局：2 个随机 AI（对局必有攻击/伤害/移动事件）
    await page.locator('input[placeholder="输入昵称"]').fill('演出验证员');
    const selects = page.locator('select');
    await selects.nth(2).selectOption('2');
    await page.getByRole('button', { name: /单人开局/ }).click();
    await page.getByText(/行动坞/).waitFor({ timeout: 20000 });

    const evidence = {
      hitcut: 0, dmgFloat: 0, hpbar: 0, battleCtl: 0, zoneAlert: 0, moveBanner: 0, deathStamp: 0,
    };
    const sample = async () => {
      const s = await page.evaluate(() => ({
        hitcut: document.querySelectorAll('.hitcut').length,
        dmgFloat: document.querySelectorAll('.dmg-float').length,
        // HP 条：2D 牌桌 = .ccard-hpbar；3D 战场 = .b3-hpbar（名牌）——双模式兼容
        hpbar: document.querySelectorAll('.ccard-hpbar, .b3-hpbar').length,
        ctl: !!document.querySelector('.battle-ctl'),
        zoneAlert: document.querySelectorAll('.zone-alert').length,
        moveBanner: document.querySelectorAll('.move-banner').length,
        deathStamp: document.querySelectorAll('.death-stamp').length,
      })).catch(() => null);
      if (!s) return;
      evidence.hitcut = Math.max(evidence.hitcut, s.hitcut);
      evidence.dmgFloat = Math.max(evidence.dmgFloat, s.dmgFloat);
      evidence.hpbar = Math.max(evidence.hpbar, s.hpbar);
      evidence.zoneAlert = Math.max(evidence.zoneAlert, s.zoneAlert);
      evidence.moveBanner = Math.max(evidence.moveBanner, s.moveBanner);
      evidence.deathStamp = Math.max(evidence.deathStamp, s.deathStamp);
      if (s.ctl) evidence.battleCtl++;

    };

    // 自驱动若干回合（出拳 + 轮到时跳过），高频采样演出层
    // 点击用原生 DOM click：React 高频重渲染下 Playwright actionability 检查会超时
    // （"waiting for element to be stable"）导致驱动静默停滞 → 对局无事件可采样。
    const t0 = Date.now();
    while (Date.now() - t0 < 28000) {
      await sample();
      await page.evaluate(() => {
        const click = (el: Element | null | undefined) => { if (el) (el as HTMLElement).click(); };
        const q = (s: string) => document.querySelector(s);
        click(q('.pv-actions button'));
        click(q('.throw-card'));
        const cards = Array.from(document.querySelectorAll('.scard'));
        const skip = cards.find((c) => (c.textContent || '').includes('跳过'));
        if (skip) {
          click(skip);
          const confirm = Array.from(document.querySelectorAll('.confirm-bar button'))
            .find((b) => (b.textContent || '').includes('确认发动') && !(b as HTMLButtonElement).disabled);
          click(confirm);
        }
      }).catch(() => {});
      await page.waitForTimeout(280);
    }
    await sample();

    // 主断言：HP 条随卡面渲染（演出体系挂载）；观察到战场演出痕迹；全程无未捕获 JS 错误
    expect(evidence.hpbar).toBeGreaterThanOrEqual(1);
    const anyFx = evidence.hitcut + evidence.dmgFloat + evidence.battleCtl + evidence.moveBanner + evidence.zoneAlert;
    expect(anyFx).toBeGreaterThan(0);
    expect(jsErrors).toEqual([]);
    await page.close();
  });

  it('2D 对局不下载 Three.js，切换 3D 后再加载战场', async () => {
    const page = await newPage(browser);
    try {
      const threeRequests = new Set<string>();
      page.on('request', (request) => {
        const asset = new URL(request.url()).pathname;
        if (/\/assets\/three-(?:core-|webgl-)?[^/]+\.js$/.test(asset)) threeRequests.add(asset);
      });
      await page.goto(baseUrl + '/?entrance=classic&r=2d', { waitUntil: 'domcontentloaded' });
      await page.locator('input[placeholder="输入昵称"]').fill('渲染切换测试');
      await page.locator('select').nth(2).selectOption('1');
      await page.getByRole('button', { name: /单人开局/ }).click();

      const switchTo3d = page.getByRole('button', { name: '3D', exact: true });
      await expect(switchTo3d).toBeVisible();
      expect(threeRequests.size).toBe(0);

      await switchTo3d.click();
      await expect(page.getByTestId('battle3d').locator('canvas')).toBeVisible({ timeout: 15000 });
      expect(Array.from(threeRequests)).toEqual(expect.arrayContaining([
        expect.stringContaining('/three-core-'), expect.stringContaining('/three-webgl-'),
      ]));
      await expect(page.locator('.b3-roomlabel').first()).toBeVisible();

      await page.getByRole('button', { name: '2D', exact: true }).click();
      await expect(page.getByTestId('battle3d')).toHaveCount(0);
      await expect(switchTo3d).toBeVisible();
    } finally {
      await page.close();
    }
  });

  it('2D/3D 血条显示数值并打开相同的角色状态详情', async () => {
    const page = await newPage(browser);
    const jsErrors: string[] = [];
    page.on('pageerror', (error) => jsErrors.push(String(error)));
    try {
      await page.goto(baseUrl + '/?entrance=classic&r=2d', { waitUntil: 'domcontentloaded' });
      await page.locator('input[placeholder="输入昵称"]').fill('血条状态测试');
      await page.locator('select').nth(2).selectOption('2');
      await page.getByRole('button', { name: /单人开局/ }).click();
      await page.getByText(/行动坞/).waitFor({ timeout: 20000 });

      const hp2d = page.locator('.ccard-hpbar').first();
      await expect(hp2d).toBeVisible();
      await expect(hp2d).toHaveText(/\d+(?:\.\d+)?\/\d+(?:\.\d+)?/);
      await hp2d.click();
      await expect(page.getByRole('dialog', { name: /血条状态测试|AI/ })).toBeVisible();
      await expect(page.getByText('仅显示当前公开快照，不包含未揭示出拳或判定历史。')).toBeVisible();
      await page.getByRole('button', { name: '关闭状态详情' }).click();

      await page.getByRole('button', { name: '3D', exact: true }).click();
      const hp3d = page.locator('.b3-hpbar').first();
      await expect(hp3d).toBeVisible({ timeout: 15000 });
      await expect(hp3d).toHaveText(/\d+(?:\.\d+)?\/\d+(?:\.\d+)?/);
      await hp3d.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByLabel('角色状态')).toBeVisible();
      await page.getByRole('button', { name: '关闭状态详情' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(jsErrors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('双鬼影在 3D 播报实际移动者，附身名牌跟随宿主', async () => {
    const host = await newPage(browser);
    const guest = await newPage(browser);
    try {
      await host.goto(baseUrl + '/?entrance=classic&r=3d');
      await host.getByPlaceholder('输入昵称').fill('移动鬼影');
      await host.getByLabel('选择角色卡').selectOption('ghost');
      await host.getByRole('button', { name: '仅创建（邀请好友）' }).click();
      await host.getByText(/玩家卡位/).waitFor();
      const code = (await host.locator('.tcg-panel').first().innerText()).match(/\b[A-Z2-9]{4}\b/)?.[0];
      expect(code).toBeTruthy();
      await guest.goto(baseUrl + '/?entrance=classic&r=2d');
      await guest.getByPlaceholder('输入昵称').fill('宿主鬼影');
      await guest.getByLabel('选择角色卡').selectOption('ghost');
      await guest.locator('.room-item').filter({ hasText: code! }).getByRole('button', { name: '加入', exact: true }).click();
      await expect(host.locator('.seat-slot')).toHaveCount(2);
      await host.getByRole('button', { name: /开始对局/ }).click();
      await expect(host.getByTestId('battle3d').locator('canvas')).toBeVisible({ timeout: 20000 });

      const { rooms } = await import('../../server/src/index.js');
      const room = rooms.get(code!)!;
      const game = room.game!;
      const [a, b] = game.playerIds;
      expect(game.playerIds.map(id => game.players[id].charId)).toEqual(['ghost', 'ghost']);
      const from = game.players[a].room;
      const to = game.players[b].room;
      expect(from).not.toBe(to);
      expect(room.submitThrow(a, 'rock').ok).toBe(true);
      expect(room.submitThrow(b, 'scissors').ok).toBe(true);
      expect(room.submitAction(a, { type: 'possess', targetId: b }).ok).toBe(true);

      const aPlate = host.locator(`.b3-plate[data-pid="${a}"]`);
      const bPlate = host.locator(`.b3-plate[data-pid="${b}"]`);
      await expect(host.locator('.battle-movement')).toContainText(`移动鬼影 ${from} → ${to}`);
      await expect(aPlate).toHaveAttribute('data-room', to);
      await expect(aPlate).toContainText('附身中');
      await expect(bPlate).toContainText('被附身');

      expect(room.submitThrow(a, 'scissors').ok).toBe(true);
      expect(room.submitThrow(b, 'rock').ok).toBe(true);
      expect(room.submitAction(b, { type: 'move', room: from }).ok).toBe(true);
      await expect(host.locator('.battle-movement')).toContainText(`宿主鬼影 ${to} → ${from}`);
      await expect(host.locator('.battle-movement')).toContainText(`移动鬼影 ${to} → ${from}`);
      await expect(aPlate).toHaveAttribute('data-room', from);
      await expect(bPlate).toHaveAttribute('data-room', from);

      expect(room.submitThrow(a, 'rock').ok).toBe(true);
      expect(room.submitThrow(b, 'scissors').ok).toBe(true);
      const detach = host.locator('.scard').filter({ hasText: '主动脱离' });
      await expect(detach).toBeVisible();
      await expect(host.locator('.scard-name').filter({ hasText: /^攻击$/ })).toHaveCount(0);
      await detach.click();
      await host.getByRole('button', { name: '确认发动' }).click();
      await expect(aPlate).not.toContainText('附身中');
      await expect(bPlate).not.toContainText('被附身');
      await expect(aPlate).toHaveAttribute('data-room', from);
    } finally {
      await guest.close();
      await host.close();
    }
  });

  it('3D 终局返回同一房间，各自选角后由房主开下一局', async () => {
    const host = await newPage(browser);
    const guest = await newPage(browser);
    try {
      await host.goto(baseUrl + '/?entrance=classic&r=3d');
      await host.getByPlaceholder('输入昵称').fill('重赛房主');
      await host.getByLabel('选择角色卡').selectOption('default');
      await host.getByRole('button', { name: '仅创建（邀请好友）' }).click();
      await host.getByText(/玩家卡位/).waitFor();
      const code = (await host.locator('.tcg-panel').first().innerText()).match(/\b[A-Z2-9]{4}\b/)?.[0];
      expect(code).toBeTruthy();
      await guest.goto(baseUrl + '/?entrance=classic&r=2d');
      await guest.getByPlaceholder('输入昵称').fill('重赛客人');
      await guest.getByLabel('选择角色卡').selectOption('default');
      await guest.locator('.room-item').filter({ hasText: code! }).getByRole('button', { name: '加入', exact: true }).click();
      const start = host.getByRole('button', { name: /开始对局/ });
      await start.click();
      await expect(host.getByTestId('battle3d').locator('canvas')).toBeVisible({ timeout: 20000 });
      const { rooms } = await import('../../server/src/index.js');
      const room = rooms.get(code!)!;
      const [a, b] = room.game!.playerIds;
      room.game!.players[b].hp = 1;
      room.game!.relocatePlayer(b, room.game!.players[a].room);
      expect(room.submitThrow(a, 'rock').ok).toBe(true);
      expect(room.submitThrow(b, 'scissors').ok).toBe(true);
      expect(room.submitAction(a, { type: 'attack', targetId: b }).ok).toBe(true);

      await host.locator('.win-modal').getByRole('button', { name: /再来一局/ }).click({ timeout: 25000 });
      await expect(host.getByText('下一局选角。', { exact: false })).toBeVisible();
      await expect(guest.getByText('下一局选角。', { exact: false })).toBeVisible();
      expect(room.game).toBeNull();
      expect(room.gameNo).toBe(1);
      expect(room.seats.map(seat => seat.playerId)).toEqual([a, b]);

      await host.getByLabel('重赛房主的角色').selectOption('ghost');
      await guest.getByLabel('重赛客人的角色').selectOption('gojo');
      await expect(host.locator('.seat-slot').filter({ hasText: '重赛客人' })).toContainText('五条悟');
      await start.click();
      await expect(host.getByTestId('battle3d').locator('canvas')).toBeVisible({ timeout: 20000 });
      expect(room.gameNo).toBe(2);
      expect(room.game?.playerIds.map(pid => room.game?.players[pid].charId)).toEqual(['ghost', 'gojo']);
      await expect(guest.locator('.battlefield')).toBeVisible();
    } finally {
      await guest.close();
      await host.close();
    }
  });

  it('老虎机侠在 2D 和 3D 显示持有物、落点和落地模型', async () => {
    const page = await newPage(browser);
    const jsErrors: string[] = [];
    page.on('pageerror', error => jsErrors.push(String(error)));
    try {
      await page.goto(baseUrl + '/?entrance=classic&r=2d', { waitUntil: 'domcontentloaded' });
      await page.getByPlaceholder('输入昵称').fill('老虎机落点测试');
      await page.getByLabel('选择角色卡').selectOption('slot-hero');
      await page.locator('select').nth(2).selectOption('1');
      await page.getByRole('button', { name: /单人开局/ }).click();
      const inventory = page.locator('.player-inventory');
      await expect(inventory).toContainText('余额 5 块');
      await expect(inventory).toContainText('钥匙 0 把');

      const { rooms } = await import('../../server/src/index.js');
      const room = [...rooms.values()].find(room => room.game?.playerIds.some(id => room.game?.players[id].name === '老虎机落点测试'))!;
      const game = room.game!;
      const player = game.playerIds.find(id => game.players[id].name === '老虎机落点测试')!;
      const destination = game.roomIds.find(id => id !== game.players[player].room)!;
      const state = game.charState(player) as unknown as SlotState;
      state.keys = 2;
      state.machine = { thrown: true, landed: false, room: destination, at: 4, invested: 5 };
      room.onBroadcast(room);
      await expect(inventory).toContainText('钥匙 2 把');
      const target = page.locator(`[data-room="${destination}"]`);
      await expect(target.locator('.room-slot-machine')).toHaveText(/第 4 回合末落地/);
      const location = page.locator('.tcg-header .slot-machine-location');
      await expect(location).toContainText(`${destination} · 老虎机`);

      await page.getByRole('button', { name: '3D', exact: true }).click();
      const label = page.locator(`.b3-roomlabel[data-room="${destination}"]`);
      await expect(label).toContainText('第 4 回合末落地', { timeout: 20000 });
      await expect.poll(() => page.evaluate(() => {
        const probe = window as unknown as { __b3scene?: { scene: { getObjectByName(name: string): unknown } } };
        return !!probe.__b3scene?.scene.getObjectByName('slot-hero-v1');
      })).toBe(true);

      state.machine.landed = true;
      state.machine.at = null;
      room.onBroadcast(room);
      await expect(label).toContainText('老虎机已落地');
      await expect(location).toContainText(`${destination} · 老虎机已落地`);
      await expect.poll(() => page.evaluate(() => {
        const probe = window as unknown as { __b3scene?: { scene: { getObjectByName(name: string): { parent: { userData: { room?: string } } } | undefined } } };
        return probe.__b3scene?.scene.getObjectByName('landed-slot-machine')?.parent.userData.room;
      })).toBe(destination);

      await page.getByRole('button', { name: '2D', exact: true }).click();
      await expect(target.locator('.room-slot-machine')).toHaveText(/老虎机已落地/);
      await page.reload();
      await expect(location).toContainText('老虎机已落地', { timeout: 20000 });
      expect(jsErrors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('大厅：添加指定角色AI + 房主改AI角色 + 聊天', async () => {
    const page = await newPage(browser);
    await page.goto(baseUrl + '/?entrance=classic', { waitUntil: 'domcontentloaded' });
    await page.getByText(/拔 典/).waitFor({ timeout: 15000 });

    await page.locator('input[placeholder="输入昵称"]').fill('大厅测试员');
    await page.getByRole('button', { name: '⚔ 创建房间' }).click();

    // 大厅页
    await page.getByText(/玩家卡位/).waitFor({ timeout: 20000 });
    // 添加指定角色 AI（五条悟）
    const aiSelect = page.locator('select').filter({ hasText: 'AI 角色' }).first();
    await aiSelect.selectOption({ label: 'AI 角色：五条悟' });
    await page.getByRole('button', { name: '+ 添加 AI' }).click();
    await page.waitForTimeout(800);
    // 座位上出现 AI 且可选角色下拉存在（房主可为 AI 改角色）
    const aiSelects = await page.locator('.seat-slot select').count();
    expect(aiSelects).toBeGreaterThanOrEqual(1);
    // 房主改 AI 角色 → 伍六七
    await page.locator('.seat-slot select').first().selectOption({ label: '伍六七' });
    await page.waitForTimeout(800);
    const seatText = await page.locator('.seat-slot').first().innerText();
    expect(seatText).toContain('伍六七');

    // 聊天
    await page.getByPlaceholder('输入消息…').fill('一起玩拔典！');
    await page.getByRole('button', { name: '发送' }).click();
    await page.waitForTimeout(800);
    const chatText = await page.locator('.chat-log').innerText();
    expect(chatText).toContain('一起玩拔典！');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/玩家卡位/)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.chat-log')).toContainText('一起玩拔典！');
    await expect(page.locator('.seat-slot').first()).toContainText('伍六七');
    await page.close();
  });

  it('机制测试场：全部用例运行且全 PASS', async () => {
    const page = await newPage(browser);
    await page.goto(baseUrl + '/?entrance=classic', { waitUntil: 'domcontentloaded' });
    await page.getByText(/拔 典/).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /机制测试场/ }).click();
    await page.getByRole('button', { name: /运行全部/ }).waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: /运行全部/ }).click();
    await page.getByText(/PASS \d+/).waitFor({ timeout: 60000 });
    const text = await page.locator('body').innerText();
    const passMatch = text.match(/PASS (\d+)/);
    const failMatch = text.match(/FAIL (\d+)/);
    expect(Number(passMatch![1])).toBe(ALL_CASES.length);
    expect(Number(failMatch?.[1] || 0)).toBe(0);
    await page.close();
  });
});
