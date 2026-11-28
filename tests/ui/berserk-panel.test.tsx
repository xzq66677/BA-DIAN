// @vitest-environment jsdom
/**
 * Issue #110 回归：大屁孩暴走（爆发）目标选择面板。
 *
 * 根因：battle3d.css 对 `.s3d-mode .action-dock.is-waiting .hand-layout` 施加 display:none，
 * 而暴走触发阶段不在行动坞「需要本机输入」的判定清单里——3D 战场下持有者
 * 看不到也点不到目标按钮。修复后：
 *  - dockNeedsLocalInput 把「本机身份为暴走权持有者」纳入 is-my-turn（本文件纯函数断言）；
 *  - 触发阶段快照真实渲染出可点击的目标面板（本文件 UI 断言）。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

afterEach(cleanup);

import GamePage from '../../client/src/pages/Game.js';
import { dockNeedsLocalInput } from '../../client/src/battle/game-hooks.js';
import { CHARACTERS } from '../../shared/src/characters/index.js';
import { Game } from '../../shared/src/engine.js';
import type { GameSnapshot, LobbyState } from '../../client/src/net.js';
import type { RuleConfig, Throw } from '../../shared/src/types.js';

describe('行动坞「需要本机输入」判定（Issue #110）', () => {
  it('暴走持有者是本机身份时必须判为需要输入；他人/AI 持有时不算', () => {
    expect(dockNeedsLocalInput({
      myTurn: false, rps1: false, orderPendingLocal: false, judgePendingLocal: false, triggerLocalActor: true,
    })).toBe(true);
    expect(dockNeedsLocalInput({
      myTurn: false, rps1: false, orderPendingLocal: false, judgePendingLocal: false, triggerLocalActor: false,
    })).toBe(false);
    // 原有四个入口不回退
    expect(dockNeedsLocalInput({
      myTurn: true, rps1: false, orderPendingLocal: false, judgePendingLocal: false, triggerLocalActor: false,
    })).toBe(true);
    expect(dockNeedsLocalInput({
      myTurn: false, rps1: true, orderPendingLocal: false, judgePendingLocal: false, triggerLocalActor: false,
    })).toBe(true);
    expect(dockNeedsLocalInput({
      myTurn: false, rps1: false, orderPendingLocal: true, judgePendingLocal: false, triggerLocalActor: false,
    })).toBe(true);
    expect(dockNeedsLocalInput({
      myTurn: false, rps1: false, orderPendingLocal: false, judgePendingLocal: true, triggerLocalActor: false,
    })).toBe(true);
  });
});

/** 真实引擎驱动到暴走触发阶段：大屁孩判定史 win/lose → 三人同拳第三次判定 → 暴走 */
function buildTriggerSnapshot(): { snap: GameSnapshot; actorId: string; targetId: string } {
  const g = new Game({
    seed: 902,
    chars: CHARACTERS,
    rules: { skillJudgeMode: 'player', secondJudgeMode: 'player' } as Partial<RuleConfig>,
    players: [
      { id: 'P', name: '屁孩', charId: 'dapihuai', type: 'human' },
      { id: 'Q', name: '阿Q', charId: 'default', type: 'human' },
    ],
  });
  g.judgeHistory('P').push('win', 'lose');
  const throws: Record<string, Throw> = { P: 'rock', Q: 'rock' };
  for (const pid of g.aliveIds()) if (throws[pid]) g.submitThrow(pid, throws[pid]);
  const snap = g.snapshot() as unknown as GameSnapshot;
  expect(snap.phase).toBe('trigger');
  expect(snap.trigger?.actor).toBe('P');
  return { snap, actorId: 'P', targetId: 'Q' };
}

const LOBBY: LobbyState = {
  code: 'BERSK',
  state: 'playing',
  hostSeat: 'P',
  seats: [
    { playerId: 'P', name: '屁孩', charId: 'dapihuai', type: 'human', connected: true },
    { playerId: 'Q', name: '阿Q', charId: 'default', type: 'human', connected: true },
  ],
  config: { submitTimeoutMs: 30000, turnTimeoutMs: 30000 },
};

describe('暴走目标选择面板（Issue #110）', () => {
  it('触发阶段渲染目标按钮，持有者是本机身份时按钮可点且不含自己', () => {
    const { snap, actorId, targetId } = buildTriggerSnapshot();
    render(
      <GamePage
        lobby={LOBBY}
        game={snap}
        session={{ code: 'BERSK', identities: [{ playerId: actorId, name: '屁孩', token: 't' }] }}
        logs={[]}
        onExit={() => {}}
      />,
    );
    const text = document.body.textContent || '';
    expect(text).toContain('指定目标');
    const buttons = screen.getAllByRole('button').map((b) => b.textContent || '');
    const targetButtons = buttons.filter((t) => t.includes('阿Q'));
    expect(targetButtons.length).toBeGreaterThan(0); // 敌人可选
    expect(buttons.some((t) => t.startsWith('屁孩（'))).toBe(false); // 不能选自己
    expect(targetId).toBe('Q');
  });

  it('持有者不是本机身份时渲染等待提示而非目标按钮', () => {
    const { snap } = buildTriggerSnapshot();
    render(
      <GamePage
        lobby={LOBBY}
        game={snap}
        session={{ code: 'BERSK', identities: [{ playerId: 'Q', name: '阿Q', token: 't' }] }}
        logs={[]}
        onExit={() => {}}
      />,
    );
    const text = document.body.textContent || '';
    expect(text).toContain('选择暴走目标');
    const buttons = screen.getAllByRole('button').map((b) => b.textContent || '');
    expect(buttons.some((t) => t.includes('阿Q（'))).toBe(false);
  });
});
