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
    const weather = screen.getByLabelText('悬浮遗迹：天气与泥潭') as HTMLSelectElement;
    expect(weather.value).toBe('on');
    fireEvent.change(weather, { target: { value: 'off' } });
    expect(weather.value).toBe('off');
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

function buildSnapshot(): { snap: GameSnapshot; logs: { seq: number; text: string; important?: boolean }[] } {
  const g = makeGame([{ id: 'A', char: 'bagun' }, 'B', 'C'], 4242);
  playThrows(g, [
    { A: 'rock', B: 'scissors', C: 'paper' },
    { A: 'rock', B: 'rock', C: 'rock' },
    { A: 'rock', B: 'scissors', C: 'scissors' },
  ]);
  return {
    snap: g.snapshot() as unknown as GameSnapshot,
    logs: g.logs.map((l) => ({ seq: l.seq, text: `[R${l.round}] ${l.text}`, important: l.important })),
  };
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
    const { snap, logs } = buildSnapshot();
    render(
      <GamePage
        lobby={LOBBY}
        game={snap}
        session={{ code: 'TEST', identities: [{ playerId: 'A', name: 'A', token: 't' }] }}
        logs={logs}
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

  it('血条显示数值，点击后查看实时公开状态且不显示判定历史', () => {
    const { snap, logs } = buildSnapshot();
    const target = snap.players.find((p) => p.id === 'B')!;
    Object.assign(target, {
      hidden: true,
      invisible: true,
      char: { ...target.char, domain: true, livesLeft: 2, attackOverride: 4, history: ['rock'] },
    });
    render(
      <GamePage
        lobby={LOBBY}
        game={snap}
        session={{ code: 'TEST', identities: [{ playerId: 'A', name: 'A', token: 't' }] }}
        logs={logs}
        onExit={() => {}}
      />,
    );
    const hpBar = screen.getByRole('button', { name: /查看 B 的生命与状态/ });
    expect(hpBar.textContent).toContain(`${target.hp}/${target.maxHp}`);
    fireEvent.click(hpBar);
    const dialog = screen.getByRole('dialog', { name: /B/ });
    expect(dialog.textContent).toContain('躲藏');
    expect(dialog.textContent).toContain('隐身');
    expect(dialog.textContent).toContain('领域');
    expect(dialog.textContent).toContain('剩余 2 条');
    expect(dialog.textContent).toContain('攻击力 4');
    expect(dialog.textContent).not.toContain('rock');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('出拳揭示台：判定结算后全员可见彼此出拳（斗地主式牌桌）', () => {
    // 三人循环平局回合翻页后：完整揭示台（上一轮拳种全员可见，跨回合保留）
    const g = makeGame([{ id: 'A', char: 'bagun' }, 'B', 'C'], 4242);
    playThrows(g, [{ A: 'rock', B: 'scissors', C: 'paper' }]);
    const snap = g.snapshot() as unknown as GameSnapshot;
    render(
      <GamePage
        lobby={LOBBY}
        game={snap}
        session={{ code: 'TEST', identities: [{ playerId: 'A', name: 'A', token: 't' }] }}
        logs={g.logs.map((l) => ({ seq: l.seq, text: `[R${l.round}] ${l.text}`, important: l.important }))}
        onExit={() => {}}
      />,
    );
    const text = document.body.textContent || '';
    expect(text).toContain('出拳揭示'); // 中央揭示台
    expect(text).toContain('石头'); // A 出的拳
    expect(text).toContain('剪刀'); // B/C 出的拳
    expect(document.querySelectorAll('.rb-card').length).toBeGreaterThanOrEqual(3);
  });

  it('行动阶段揭示台收缩为紧凑状态条（判定结果 + 出牌顺序，空间让给战场）', () => {
    const { snap, logs } = buildSnapshot();
    expect(snap.phase).toBe('act');
    render(
      <GamePage
        lobby={LOBBY}
        game={snap}
        session={{ code: 'TEST', identities: [{ playerId: 'A', name: 'A', token: 't' }] }}
        logs={logs}
        onExit={() => {}}
      />,
    );
    expect(document.querySelector('.reveal-board.compact')).toBeTruthy();
    const text = document.body.textContent || '';
    expect(text).toContain('获得行动资格'); // 判定结论保留
    expect(document.querySelectorAll('.rb-order-chip').length).toBeGreaterThanOrEqual(1); // 出牌顺序保留
  });

  it('大伊万待爆警示：快照 deferred 含 ivan 时目标房间显示待爆标记与空房提示', () => {
    const { snap } = buildSnapshot();
    const withIvan = { ...snap, deferred: [{ id: 'DEF-1', kind: 'ivan', room: 'R2', explodeRound: 3 }] };
    render(
      <GamePage
        lobby={LOBBY}
        game={withIvan}
        session={{ code: 'TEST', identities: [{ playerId: 'A', name: 'A', token: 't' }] }}
        logs={[]}
        onExit={() => {}}
      />,
    );
    expect(document.querySelector('.zone-pending-ivan')).toBeTruthy();
    expect(document.querySelector('.ivan-pending')?.textContent).toContain('第 3 回合末爆炸');
    // R2 房间容器带 data-room（沉浸牌桌架构：.bt-room）
    const r2Empty = Array.from(document.querySelectorAll('[data-room]')).find((z) => z.getAttribute('data-room') === 'R2');
    expect(r2Empty).toBeTruthy();
  });

  it('终局战场：胜者卡获得 is-winner 光环且空房间轻量化', () => {
    const { snap } = buildSnapshot();
    const over = { ...snap, phase: 'over' as const, winner: 'A', aliveCount: 1 };
    render(
      <GamePage
        lobby={LOBBY}
        game={over}
        session={{ code: 'TEST', identities: [{ playerId: 'A', name: 'A', token: 't' }] }}
        logs={[]}
        onExit={() => {}}
      />,
    );
    expect(document.querySelector('.ccard.is-winner')).toBeTruthy();
    expect(document.querySelector('.cbadge-winner')?.textContent).toContain('胜者');
    expect(document.querySelector('.battlefield.is-over')).toBeTruthy();
    // 胜负弹层出现且包含结果摘要
    const text = document.body.textContent || '';
    expect(text).toContain('胜 负 判 定');
    expect(text).toContain('回合终局');
  });
});

// ─── 自身技能（引擎里 targetHint: 'none'）不需要选目标 ─────────────

function buildActSnapshot(charId: string): GameSnapshot {
  const g = makeGame([{ id: 'A', char: charId }, 'B'], 7);
  // A 出石头赢 B 的剪刀 → A 获得行动资格，成为当前行动者
  playThrows(g, [{ A: 'rock', B: 'scissors' }]);
  return g.snapshot() as unknown as GameSnapshot;
}

const lobbyFor = (charId: string) => ({
  code: 'TEST',
  state: 'playing' as const,
  hostSeat: 'A',
  seats: [
    { playerId: 'A', name: 'A', charId, type: 'human' as const, connected: true },
    { playerId: 'B', name: 'B', charId: 'default', type: 'ai' as const, connected: true },
  ],
  config: { submitTimeoutMs: 30000, turnTimeoutMs: 30000 },
});

describe('自身技能不需要选目标（领域展开 / 抽取今日运势）', () => {
  it.each([
    ['hero-today', '抽取今日运势'],
    ['gojo', '领域展开'],
  ])('%s 的「%s」选中后可直接确认发动，不出现目标提示', (charId, label) => {
    const snap = buildActSnapshot(charId);
    expect(snap.phase).toBe('act');
    expect(snap.currentActor).toBe('A');

    render(
      <GamePage
        lobby={lobbyFor(charId)}
        game={snap}
        session={{ code: 'TEST', identities: [{ playerId: 'A', name: 'A', token: 't' }] }}
        logs={[]}
        onExit={() => {}}
      />,
    );

    const card = Array.from(document.querySelectorAll('.scard')).find((el) =>
      el.textContent?.includes(label),
    ) as HTMLElement | undefined;
    expect(card).toBeTruthy();
    // 技能卡上不应标「需选择目标」
    expect(card!.textContent).not.toContain('需选择目标');

    fireEvent.click(card!);
    const bar = document.querySelector('.confirm-bar') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.textContent).toContain(label);
    expect(bar.textContent).not.toContain('目标'); // 不再要求「点击战场高亮卡牌」

    const okBtn = Array.from(bar.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('确认发动'),
    ) as HTMLButtonElement;
    expect(okBtn).toBeTruthy();
    expect(okBtn.disabled).toBe(false); // 无需选目标 → 直接可发动
  });
});
