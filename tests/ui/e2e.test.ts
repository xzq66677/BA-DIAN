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
import { ALL_CASES } from '../../shared/src/testcases/index.js';

let browser: Browser;
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
  const mod = await import('../../server/src/index.js');
  const httpServer = (mod as unknown as { httpServer: import('node:http').Server }).httpServer;
  (mod as unknown as { startServer: (port?: number) => void }).startServer(0);
  await new Promise<void>((resolve) => httpServer.once('listening', () => resolve()));
  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 3100;
  baseUrl = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  });
}, 90000);

afterAll(async () => {
  await browser?.close();
});

function newPage(browser: Browser): Promise<Page> {
  return browser.newPage();
}

describe('真实浏览器端到端', { timeout: 120000 }, () => {
  it('首页渲染：卡池立绘真实加载 + 房间列表容器', async () => {
    const page = await newPage(browser);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
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
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByText(/拔 典/).waitFor({ timeout: 15000 });

    await page.locator('input[placeholder="输入昵称"]').fill('E2E勇者');
    const selects = page.locator('select');
    await selects.nth(2).selectOption('2'); // AI 数量 2
    await page.getByRole('button', { name: /单人开局/ }).click();

    // 战场出现
    await page.getByText(/行动坞/).waitFor({ timeout: 20000 });
    await expect(page.locator('.battlefield')).toBeVisible();
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

  it('战斗演出：结构化事件驱动受击斩击 / 演出控制条 / HP条 / 无JS错误', async () => {
    const page = await newPage(browser);
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(String(e)));
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
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

  it('大厅：添加指定角色AI + 房主改AI角色 + 聊天', async () => {
    const page = await newPage(browser);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
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
    await page.close();
  });

  it('机制测试场：全部用例运行且全 PASS', async () => {
    const page = await newPage(browser);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
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
