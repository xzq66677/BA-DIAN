// @vitest-environment jsdom
/**
 * 全局播报 UI（Issue #39 / T-6.0.1）
 *
 * 覆盖：
 *  - 战场横幅：图标 + 文本 + 服务端时间戳（HH:MM:SS），停留时长通过内联 animationDuration 生效
 *  - 播报抽屉：按时间倒序、「只看重点」过滤掉 low、空态提示、收起回调
 *  - 游戏页集成：顶栏「📣 播报」可打开抽屉，未读徽标随新增播报出现
 *
 * 只验证展示层；播报内容与优先级由 tests/announce.test.ts 覆盖（规则表同源）。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AnnounceDrawer, GlobalAnnounceBanner } from '../../client/src/battle/announce-view.js';
import GamePage from '../../client/src/pages/Game.js';
import type { AnnounceItem, GameSnapshot } from '../../client/src/net.js';
import { makeGame, playThrows } from '../../shared/src/testcases/helpers.js';

afterEach(cleanup);

const TS = new Date(2026, 10, 22, 9, 5, 3).getTime();

function item(over: Partial<AnnounceItem> = {}): AnnounceItem {
  return {
    id: 'a-1',
    seq: 1,
    ts: TS,
    round: 1,
    sub: 0,
    icon: '⚔️',
    text: '张三 → 李四 受到 1 点伤害（HP 3→2）',
    tone: 'combat',
    kind: 'attack',
    priority: 'normal',
    ttlMs: 1700,
    rule: 'damage',
    ...over,
  };
}

describe('全局播报 · 战场横幅', () => {
  it('渲染图标、文本与服务端时间戳，停留时长写入内联 animationDuration', () => {
    render(<GlobalAnnounceBanner item={item({ ttlMs: 2400 })} />);
    const el = screen.getByTestId('global-announce');
    expect(el.textContent).toContain('张三 → 李四 受到 1 点伤害');
    expect(el.textContent).toContain('09:05:03');
    expect(el.className).toContain('tone-combat');
    expect(el.className).toContain('prio-normal');
    expect(el.className).toContain('kind-attack');
    expect(el.getAttribute('data-announce-seq')).toBe('1');
    expect(el.getAttribute('data-announce-rule')).toBe('damage');
    expect(el.getAttribute('data-announce-kind')).toBe('attack');
    expect(el.textContent).toContain('战斗');
    expect((el as HTMLElement).style.animationDuration).toBe('2400ms');
  });

  it('重大事件使用 danger 色调 + high 优先级（横幅样式可区分）', () => {
    render(<GlobalAnnounceBanner item={item({ icon: '☠', text: '李四 被淘汰', tone: 'danger', priority: 'high' })} />);
    const el = screen.getByTestId('global-announce');
    expect(el.className).toContain('tone-danger');
    expect(el.className).toContain('prio-high');
    expect(el.textContent).toContain('李四 被淘汰');
  });

  it('八种信息类型输出不同的 kind class、类型标签与 data 属性', () => {
    const kinds = ['move', 'attack', 'skill', 'heal', 'hide', 'outcome', 'round', 'system'] as const;
    const labels = ['移动', '战斗', '技能', '回复', '潜行', '战果', '回合', '系统'];
    const { container } = render(
      <div>
        {kinds.map((k, i) => (
          <GlobalAnnounceBanner key={k} item={item({ id: `a-${i}`, seq: i + 1, kind: k })} />
        ))}
      </div>,
    );
    const bars = container.querySelectorAll('[data-testid="global-announce"]');
    expect(bars).toHaveLength(kinds.length);
    kinds.forEach((k, i) => {
      expect(bars[i].className).toContain(`kind-${k}`);
      expect(bars[i].getAttribute('data-announce-kind')).toBe(k);
      expect(bars[i].textContent).toContain(labels[i]);
    });
  });
});

describe('全局播报 · 播报抽屉', () => {
  it('按时间倒序（最新在上），每行显示时间、文本与停留时长', () => {
    const items = [
      item({ id: 'a-1', seq: 1, text: '第一条', ts: TS }),
      item({ id: 'a-2', seq: 2, text: '第二条', ts: TS + 5000, ttlMs: 2400 }),
    ];
    render(<AnnounceDrawer items={items} onClose={() => {}} />);
    const lines = screen.getAllByTestId('announce-line');
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toContain('第二条'); // 最新在上
    expect(lines[0].textContent).toContain('09:05:08');
    expect(lines[0].textContent).toContain('2.4s');
    expect(lines[0].className).toContain('kind-attack');
    expect(lines[0].getAttribute('data-announce-kind')).toBe('attack');
    expect(lines[1].textContent).toContain('第一条');
    expect(lines[1].textContent).toContain('1.7s');
  });

  it('「只看重点」过滤 low（阶段提示类不抢视线），「全部」恢复', () => {
    const items = [
      item({ id: 'a-1', seq: 1, text: '阶段提示：等待张三行动', priority: 'low', tone: 'system' }),
      item({ id: 'a-2', seq: 2, text: '李四 被淘汰', priority: 'high', tone: 'danger' }),
    ];
    render(<AnnounceDrawer items={items} onClose={() => {}} />);
    expect(screen.getAllByTestId('announce-line')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '⭐ 重点' }));
    const keyOnly = screen.getAllByTestId('announce-line');
    expect(keyOnly).toHaveLength(1);
    expect(keyOnly[0].textContent).toContain('李四 被淘汰');
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    expect(screen.getAllByTestId('announce-line')).toHaveLength(2);
  });

  it('空态给出「不用翻日志」的引导文案', () => {
    render(<AnnounceDrawer items={[]} onClose={() => {}} />);
    expect(screen.queryAllByTestId('announce-line')).toHaveLength(0);
    expect(screen.getByText(/不用再翻日志/)).toBeTruthy();
  });

  it('「收起」触发 onClose（顶栏按钮同步切换状态）', () => {
    let closed = false;
    render(<AnnounceDrawer items={[item()]} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(closed).toBe(true);
  });
});

describe('全局播报 · 游戏页集成', () => {
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

  function buildSnapshot() {
    const g = makeGame([{ id: 'A', char: 'bagun' }, 'B', 'C'], 4242);
    playThrows(g, [
      { A: 'rock', B: 'scissors', C: 'paper' },
      { A: 'rock', B: 'rock', C: 'rock' },
      { A: 'rock', B: 'scissors', C: 'scissors' },
    ]);
    return g.snapshot() as unknown as GameSnapshot;
  }

  function renderGame(announces: AnnounceItem[]) {
    const snap = buildSnapshot();
    return render(
      <GamePage
        lobby={LOBBY}
        game={snap}
        session={{ code: 'TEST', identities: [{ playerId: 'A', name: 'A', token: 't' }] }}
        logs={[]}
        announces={announces}
        onExit={() => {}}
      />,
    );
  }

  it('顶栏有「📣 播报」入口，点击打开抽屉并列出播报', () => {
    renderGame([
      item({ id: 'a-1', seq: 1, text: 'A 喝了一口牛奶，向全场发出嘲讽！', icon: '🥛', tone: 'action' }),
      item({ id: 'a-2', seq: 2, text: 'B 被淘汰', icon: '☠', tone: 'danger', priority: 'high' }),
    ]);
    const btn = screen.getByRole('button', { name: /播报/ });
    expect(btn).toBeTruthy();
    expect(screen.queryByTestId('announce-drawer')).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByTestId('announce-drawer')).toBeTruthy();
    const lines = screen.getAllByTestId('announce-line');
    expect(lines).toHaveLength(2);
    expect(document.body.textContent).toContain('喝了一口牛奶');
  });

  it('没有播报时按钮仍可用，抽屉显示空态（不误报错误）', () => {
    renderGame([]);
    fireEvent.click(screen.getByRole('button', { name: /播报/ }));
    expect(screen.getByTestId('announce-drawer')).toBeTruthy();
    expect(screen.getByText(/暂无播报/)).toBeTruthy();
  });
});
