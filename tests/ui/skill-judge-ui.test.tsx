// @vitest-environment jsdom
/**
 * 技能内判定（马保国系）的出拳 UI：
 * 用真实引擎快照把对局推到 judge 阶段，验证游戏页渲染出「技能判定」出拳面板，
 * 并验证「等待对方出拳」的只读态。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import GamePage from '../../client/src/pages/Game.js';
import { Game } from '../../shared/src/engine.js';
import { CHARACTERS } from '../../shared/src/characters/index.js';
import type { GameSnapshot, LobbyState } from '../../client/src/net.js';

afterEach(cleanup);

const LOBBY = {
  code: 'TEST',
  state: 'playing' as const,
  hostSeat: 'A',
  seats: [
    { playerId: 'A', name: 'A', charId: 'mabaoguo', type: 'local' as const, connected: true },
    { playerId: 'B', name: 'B', charId: 'default', type: 'local' as const, connected: true },
  ],
  config: { submitTimeoutMs: 30000, turnTimeoutMs: 30000 },
} as unknown as LobbyState;

/** 造一局并推进到「五连鞭 judge 阶段」 */
function buildJudgeGame(): Game {
  const g = new Game({
    seed: 7,
    chars: CHARACTERS,
    rules: { skillJudgeMode: 'player', secondJudgeMode: 'serverRoll' },
    players: [
      { id: 'A', name: 'A', charId: 'mabaoguo', type: 'local' },
      { id: 'B', name: 'B', charId: 'default', type: 'local' },
    ],
  });
  g.players.B.room = g.players.A.room;
  g.submitThrow('A', 'rock');
  g.submitThrow('B', 'scissors');
  g.submitAction('A', { type: 'whip5', targetId: 'B' });
  return g;
}

function renderGame(g: Game, identities: { playerId: string; name: string; token: string }[]) {
  return render(
    <GamePage
      lobby={LOBBY}
      game={g.snapshot() as unknown as GameSnapshot}
      session={{ code: 'TEST', identities }}
      logs={g.logs.map((l) => ({ seq: l.seq, text: `[R${l.round}] ${l.text}`, important: l.important }))}
      onExit={() => {}}
    />,
  );
}

describe('技能判定出拳 UI（马保国五连鞭）', () => {
  it('本机身份在等待名单里 → 显示技能判定出拳面板，点身份后出现拳卡', () => {
    const g = buildJudgeGame();
    expect(g.phase).toBe('judge');
    renderGame(g, [{ playerId: 'A', name: 'A', token: 'tA' }]);
    const text = document.body.textContent || '';
    expect(text).toContain('闪电五连鞭'); // 判定标题
    expect(text).toContain('第 1/5 局'); // 局数
    expect(screen.getByText('我是 A，开始出拳')).toBeTruthy();

    fireEvent.click(screen.getByText('我是 A，开始出拳'));
    expect(screen.getAllByText('石头').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/双方各自出拳/).length).toBeGreaterThan(0);
  });

  it('本机身份都已出拳 / 不在名单 → 显示等待对方的只读提示', () => {
    const g = buildJudgeGame();
    g.submitJudgeThrow('A', 'rock'); // 本机出完，只剩 B
    renderGame(g, [{ playerId: 'A', name: 'A', token: 'tA' }]);
    const text = document.body.textContent || '';
    expect(text).toMatch(/等待\s*B\s*出拳/);
    expect(text).toContain('闪电五连鞭');
  });
});
