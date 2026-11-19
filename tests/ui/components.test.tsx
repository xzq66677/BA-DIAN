// @vitest-environment jsdom
/**
 * UI 组件级测试（jsdom + Testing Library）
 * 真实渲染 React 组件：
 *  - 首页渲染与交互元素
 *  - 机制测试场：在浏览器环境内运行全部共享测试用例（与 vitest 同源数据）
 *  - 游戏页：给定引擎真实快照的完整渲染（玩家/房间/行动面板/日志）
 *
 * 注：真实 Chromium 测试因服务器缺少系统图形库（无 sudo 安装权限）不可用，
 * 本测试为替代验证；网络与构建管线另由 socket 集成测试与 vite build 覆盖。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

afterEach(cleanup);
import Home from '../../client/src/pages/Home.js';
import Arena from '../../client/src/pages/Arena.js';
import GamePage from '../../client/src/pages/Game.js';
import { ALL_CASES } from '../../shared/src/testcases/index.js';
import { makeGame, playThrows } from '../../shared/src/testcases/helpers.js';
import type { GameSnapshot } from '../../client/src/net.js';

describe('首页 UI（TCG风格）', () => {
  it('渲染标题、角色卡池、开局按钮、房间列表与测试场入口', () => {
    render(<Home onEnter={() => {}} onArena={() => {}} />);
    expect(screen.getByText(/拔 典/)).toBeTruthy();
    expect(screen.getByText(/角色卡池/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /创建房间/ })).toBeTruthy();
    // 设置 AI 数量后按钮变为单人开局
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[2], { target: { value: '2' } });
    expect(screen.getByRole('button', { name: /单人开局/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '加入房间' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /机制测试场/ })).toBeTruthy();
    expect(screen.getByPlaceholderText('4位邀请码')).toBeTruthy();
    // 房间列表容器
    expect(screen.getByText(/房间列表/)).toBeTruthy();
  });

  it('点击「机制测试场」触发回调', () => {
    let called = false;
    render(<Home onEnter={() => {}} onArena={() => { called = true; }} />);
    fireEvent.click(screen.getByRole('button', { name: /机制测试场/ }));
    expect(called).toBe(true);
  });
});

describe('机制测试场 UI（真实运行全部共享用例）', () => {
  it('运行全部用例后出现 PASS/FAIL 统计且全部 PASS', { timeout: 60000 }, async () => {
    render(<Arena onBack={() => {}} />);
    const runBtn = screen.getByRole('button', { name: /运行全部/ }) as HTMLButtonElement;
    expect(runBtn).toBeTruthy();
    expect(runBtn.disabled).toBe(false);

    fireEvent.click(runBtn);
    await waitFor(() => {
      expect(/PASS \d+/.test(document.body.textContent || '')).toBe(true);
    }, { timeout: 50000 });

    const text = document.body.textContent || '';
    const passMatch = text.match(/PASS (\d+)/);
    const failMatch = text.match(/FAIL (\d+)/);
    expect(Number(passMatch![1])).toBe(ALL_CASES.length);
    expect(Number(failMatch?.[1] || 0)).toBe(0);
  });
});

// ─── 用真实引擎生成快照用于游戏页渲染 ─────────────────────

function buildSnapshot(): GameSnapshot {
  const g = makeGame([{ id: 'A', char: 'bagun' }, 'B', 'C'], 4242);
  playThrows(g, [
    { A: 'rock', B: 'scissors', C: 'paper' },
    { A: 'rock', B: 'rock', C: 'rock' },
    { A: 'rock', B: 'scissors', C: 'scissors' },
  ]);
  return g.snapshot() as unknown as GameSnapshot;
}

const LOBBY = {
  code: 'TEST',
  state: 'playing' as const,
  hostSeat: 'A',
  seats: [
    { playerId: 'A', name: 'A', charId: 'bagun', type: 'human' as const, connected: true },
    { playerId: 'B', name: 'B', charId: 'default', type: 'human' as const, connected: true },
    { playerId: 'C', name: 'C', charId: 'default', type: 'ai' as const, connected: true },
  ],
  config: { submitTimeoutMs: 30000, turnTimeoutMs: 30000 },
};

describe('游戏页 UI（TCG战场·真实引擎快照渲染）', () => {
  it('渲染战场场地/角色卡/行动坞/战斗日志', () => {
    const snap = buildSnapshot();
    render(
      <GamePage
        lobby={LOBBY}
        game={snap}
        session={{ code: 'TEST', identities: [{ playerId: 'A', name: 'A', token: 't' }] }}
        logs={snap.logs.map((l) => ({ seq: l.seq, text: `[R${l.round}] ${l.text}`, important: l.important }))}
        onExit={() => {}}
      />,
    );
    const text = document.body.textContent || '';
    expect(text).toContain('战斗日志'); // 日志面板
    expect(text).toContain('行动坞'); // 行动坞
    expect(text).toContain('◈ R1'); // 房间场地
    expect(text).toContain('回合'); // 回合指示
    expect(text).toContain('A'); // 玩家名（卡面铭牌）
  });
});
