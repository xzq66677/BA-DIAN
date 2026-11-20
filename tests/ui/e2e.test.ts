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
import { chromium, type Browser, type Page } from 'playwright';
import { expect } from '@playwright/test';
import { ALL_CASES } from '../../shared/src/testcases/index.js';

let browser: Browser;
let baseUrl = '';

beforeAll(async () => {
  // B-014 教训：E2E 前强制重建客户端，防止 dist 陈旧（服务端走 vitest 实时转换，无需构建）
  execSync('npx vite build client', { cwd: path.resolve(import.meta.dirname, '../..'), stdio: 'pipe' });
  const mod = await import('../../server/src/index.js');
  const httpServer = (mod as unknown as { httpServer: import('node:http').Server }).httpServer;
  (mod as unknown as { startServer: (port?: number) => void }).startServer(0);
  await new Promise<void>((resolve) => httpServer.once('listening', () => resolve()));
  const addr = httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 3100;
  baseUrl = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ headless: true });
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
    // 角色卡在场上（AI 已有随机角色 → 卡面 img）
    await page.waitForTimeout(1500);
    const cardImgs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.ccard-art img')).filter((i) => (i as HTMLImageElement).naturalWidth > 0).length,
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
