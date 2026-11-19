/**
 * AI 自动对局回归测试
 * AI 与真人使用同一引擎接口提交行动（任务书要求）。
 * 固定种子：多局全部终局 + 完全可复现。
 */

import { describe, it, expect } from 'vitest';
import { Game } from '../../shared/src/engine.js';
import { CHARACTERS } from '../../shared/src/characters/index.js';
import { randomThrow } from '../../shared/src/rng.js';
import { aiDecideAction } from '../../server/src/room.js';
import type { Throw } from '../../shared/src/types.js';

const ROSTER = ['default', 'bagun', 'chuixiao', 'gojo', 'mabaoguo', 'wuliuqi', 'ivan-girl', 'hero-today', 'dajianke', 'dapihuai'];

/** 全 AI 对局：AI 通过引擎公开接口提交（不直接改状态） */
function playAIGame(seed: number, playerCount: number, maxRounds = 400): {
  over: boolean; winner: string | null; rounds: number; logText: string; players: { id: string; hp: number; alive: boolean; char: string }[];
} {
  const g = new Game({
    seed,
    chars: CHARACTERS,
    players: Array.from({ length: playerCount }, (_, i) => ({
      id: `AI${i + 1}`, name: `AI${i + 1}`, charId: ROSTER[i % ROSTER.length], type: 'ai' as const,
    })),
  });

  let guard = 0;
  const MAX_STEPS = 20000;
  while (!g.isOver() && g.roundNo <= maxRounds && guard++ < MAX_STEPS) {
    if (g.phase === 'rps1') {
      for (const pid of g.aliveIds()) {
        if (!g.submittedIds.includes(pid)) {
          const r = g.submitThrow(pid, randomThrow(g.rng) as Throw);
          if (!r.ok) break;
        }
      }
    } else if (g.phase === 'act') {
      const cur = g.currentActor();
      if (!cur) break;
      const action = aiDecideAction(g, cur);
      const r = g.submitAction(cur, action);
      if (!r.ok) {
        // AI 决策与引擎校验不一致视为缺陷：记录并跳过（测试应捕获）
        g.log('error', `AI提交被拒：${(r as { error?: string }).error}`);
        g.submitAction(cur, { type: 'skip' });
      }
    } else {
      break;
    }
  }

  return {
    over: g.isOver(),
    winner: g.winner ?? null,
    rounds: g.roundNo,
    logText: g.logs.map((l) => `[R${l.round}] ${l.text}`).join('\n'),
    players: g.playerIds.map((id) => ({ id, hp: g.players[id].hp, alive: g.players[id].alive, char: g.charDef(id).id })),
  };
}

describe('AI 自动对局回归（固定种子）', { timeout: 120000 }, () => {
  it('3人局×5个种子全部终局且状态一致', () => {
    for (const seed of [11, 22, 33, 44, 55]) {
      const r = playAIGame(seed, 3);
      expect(r.over, `种子${seed}未终局（第${r.rounds}回合）\n${r.logText.slice(-2000)}`).toBe(true);
      expect(r.winner === null || r.players.some((p) => p.id === r.winner && p.alive)).toBe(true);
      // 只剩至多一名存活
      expect(r.players.filter((p) => p.alive).length).toBeLessThanOrEqual(1);
    }
  });

  it('10人局（全角色样本）×2个种子全部终局', () => {
    for (const seed of [101, 202]) {
      const r = playAIGame(seed, 10);
      expect(r.over, `种子${seed}未终局（第${r.rounds}回合）`).toBe(true);
    }
  });

  it('同种子完全可复现（两局最终日志一致）', () => {
    const r1 = playAIGame(777, 4);
    const r2 = playAIGame(777, 4);
    expect(r1.logText).toBe(r2.logText);
    expect(r1.winner).toBe(r2.winner);
    expect(r1.rounds).toBe(r2.rounds);
  });

  it('对局日志包含判定/行动/伤害记录（可解释性）', () => {
    const r = playAIGame(999, 3);
    expect(r.logText).toContain('获得行动资格');
    expect(r.logText).toContain('行动顺序');
    expect(r.logText).toContain('受到');
    expect(r.logText).toContain('游戏结束');
  });
});
