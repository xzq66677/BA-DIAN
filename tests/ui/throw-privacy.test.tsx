// @vitest-environment jsdom
/**
 * 回归：单设备多人「交设备出拳」遮罩在待出拳名单收缩时不能崩。
 *
 * 缺陷（2026-11-21 用户反馈「二次判定点出拳按钮有概率所有面板消失」）：
 * 旧实现用数组下标追踪当前出拳身份（activeIdx）。提交后该身份会从 myIds 中移除，
 * 数组收缩；若选中的下标 >= 新长度，渲染里 `myIds[activeIdx].name` 抛 TypeError，
 * React 卸载整棵树 → 所有面板消失。是否触发取决于「广播先到还是 ack 先到」的时序，
 * 因此在真实网络下表现为「有概率」。
 *
 * 现在按 playerId 追踪，并在身份消失时回退到选择遮罩。
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ThrowPrivacy } from '../../client/src/pages/Game.js';
import ErrorBoundary from '../../client/src/ErrorBoundary.js';
import type { GameSnapshot, LobbyState } from '../../client/src/net.js';

afterEach(cleanup);

const identities = [
  { playerId: 'P1', name: '甲', token: 't1' },
  { playerId: 'P2', name: '乙', token: 't2' },
  { playerId: 'P3', name: '丙', token: 't3' },
];

const game = {
  players: identities.map((i) => ({ id: i.playerId, name: i.name, charId: 'default', charName: '无业游民', room: 'R1', alive: true })),
} as unknown as GameSnapshot;

const lobby = { code: 'TEST' } as unknown as LobbyState;

describe('单设备多人：出拳遮罩的身份追踪', () => {
  it('选中第 3 人后该身份从名单移除（提交完成）→ 回到遮罩，不崩溃', () => {
    const { rerender } = render(<ThrowPrivacy myIds={identities} game={game} lobby={lobby} stage="rps2" />);
    fireEvent.click(screen.getByText('我是 丙，开始出拳'));
    expect(screen.getByText(/请/)).toBeTruthy(); // 已进入出拳面板

    // 模拟「丙」已提交：父组件把丙从待出拳名单里移除（旧实现在这里必然崩）
    rerender(<ThrowPrivacy myIds={identities.slice(0, 2)} game={game} lobby={lobby} stage="rps2" />);

    expect(screen.getByText('我是 甲，开始出拳')).toBeTruthy();
    expect(screen.getByText('我是 乙，开始出拳')).toBeTruthy();
    expect(screen.queryByText('我是 丙，开始出拳')).toBeNull();
  });

  it('只剩 1 人时同样安全（2 人名单里选第 2 人，随后名单收缩为 1）', () => {
    const two = identities.slice(0, 2);
    const { rerender } = render(<ThrowPrivacy myIds={two} game={game} lobby={lobby} stage="rps2" />);
    fireEvent.click(screen.getByText('我是 乙，开始出拳'));
    rerender(<ThrowPrivacy myIds={[identities[0]]} game={game} lobby={lobby} stage="rps2" />);
    expect(screen.getByText('我是 甲，开始出拳')).toBeTruthy();
  });

  it('正常流程：选身份 → 出现三张拳卡 → 点返回回到遮罩', () => {
    render(<ThrowPrivacy myIds={identities} game={game} lobby={lobby} stage="rps1" />);
    fireEvent.click(screen.getByText('我是 乙，开始出拳'));
    expect(screen.getByText(/请/)).toBeTruthy();
    expect(screen.getAllByText('石头').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText('返回（暂不出拳）'));
    expect(screen.getByText('我是 甲，开始出拳')).toBeTruthy();
  });
});

describe('错误边界：渲染异常不再白屏', () => {
  it('子组件抛错时展示兜底提示而不是整页消失', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Boom = () => {
      throw new Error('测试用渲染异常');
    };
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/界面遇到了一个错误/)).toBeTruthy();
    expect(screen.getByText(/测试用渲染异常/)).toBeTruthy();
    expect(screen.getByText('重新载入')).toBeTruthy();
    spy.mockRestore();
  });
});
