/**
 * AI 难度分级测试
 * - easy / normal / hard 三档都必须只提交合法行动，且能打完一局；
 * - hard 会反制对手历史出拳、优先补刀、远程角色先瞄准；
 * - 同难度 + 同种子完全可复现（随机性统一走引擎种子流）。
 */

import { describe, it, expect } from 'vitest';
import { Game } from '../../shared/src/engine.js';
import { CHARACTERS } from '../../shared/src/characters/index.js';
import { aiDecideAction, aiDecideActions, aiThrow } from '../../server/src/room.js';
import type { AiDifficulty, Throw } from '../../shared/src/types.js';

const ROSTER = ['default', 'bagun', 'chuixiao', 'gojo', 'mabaoguo', 'wuliuqi', 'ivan-girl', 'hero-today', 'dajianke', 'dapihuai'];

function makeAiGame(seed: number, count: number, chars: string[] = ROSTER): Game {
  return new Game({
    seed,
    rules: { secondJudgeMode: 'serverRoll', skillJudgeMode: 'serverRoll' },
    chars: CHARACTERS,
    players: Array.from({ length: count }, (_, i) => ({
      id: `AI${i + 1}`, name: `AI${i + 1}`, charId: chars[i % chars.length], type: 'ai' as const,
    })),
  });
}

function playGame(seed: number, difficulty: AiDifficulty, count = 4, maxRounds = 300) {
  const g = makeAiGame(seed, count);
  let guard = 0;
  while (!g.isOver() && g.roundNo <= maxRounds && guard++ < 40000) {
    if (g.phase === 'rps1') {
      for (const pid of g.aliveIds()) {
        if (!g.submittedIds.includes(pid)) g.submitThrow(pid, aiThrow(g, pid, difficulty));
      }
    } else if (g.phase === 'act') {
      const cur = g.currentActor();
      if (!cur) break;
      let accepted = false;
      for (const act of aiDecideActions(g, cur, difficulty)) {
        if (g.submitAction(cur, act).ok) { accepted = true; break; }
      }
      // 候选链必须至少有一个能落地（最差是 skip）
      expect(accepted, `难度 ${difficulty} 在第 ${g.roundNo} 回合无可落地行动`).toBe(true);
    } else {
      break;
    }
  }
  return { over: g.isOver(), winner: g.winner ?? null, rounds: g.roundNo, log: g.logs.map((l) => l.text).join('\n') };
}

describe('AI 难度：出拳策略', () => {
  it('三档出拳都是合法拳种', () => {
    for (const d of ['easy', 'normal', 'hard'] as AiDifficulty[]) {
      for (let seed = 1; seed <= 10; seed++) {
        const g = makeAiGame(seed, 3);
        const t = aiThrow(g, 'AI1', d);
        expect(['rock', 'scissors', 'paper']).toContain(t);
      }
    }
  });

  it('硬核 AI 会反制：对手多出石头时倾向出布', () => {
    const counter: Record<string, number> = { rock: 0, scissors: 0, paper: 0 };
    for (let seed = 1; seed <= 40; seed++) {
      const g = makeAiGame(seed, 3);
      g.throwHistory['AI2'] = ['rock', 'rock', 'rock', 'scissors'];
      g.throwHistory['AI3'] = ['rock', 'rock'];
      counter[aiThrow(g, 'AI1', 'hard')]++;
    }
    // 克石头的是布：硬核应明显偏向布
    expect(counter.paper).toBeGreaterThan(counter.rock + counter.scissors);
  });

  it('普通/休闲 AI 不做反制（分布仍随机）', () => {
    const count: Record<string, number> = { rock: 0, scissors: 0, paper: 0 };
    for (let seed = 1; seed <= 60; seed++) {
      const g = makeAiGame(seed, 3);
      g.throwHistory['AI2'] = ['rock', 'rock', 'rock', 'rock'];
      count[aiThrow(g, 'AI1', 'normal')]++;
    }
    // 随机流下不该一边倒（允许波动，只要出现过至少两种）
    expect(Object.values(count).filter((n) => n > 0).length).toBeGreaterThanOrEqual(2);
  });
});

describe('AI 难度：行动策略', () => {
  it('硬核优先补刀（同房间残血目标）', () => {
    const g = makeAiGame(5555, 3);
    g.players.AI2.room = 'R1';
    g.players.AI3.room = 'R1';
    g.players.AI2.hp = 1;
    const act = aiDecideAction(g, 'AI1', 'hard');
    expect(act.type).toBe('attack');
    expect(act.targetId).toBe('AI2');
  });

  it('硬核远程角色会为残血远程目标先瞄准', () => {
    const g = makeAiGame(9, 3, ['gojo', 'default', 'default']);
    g.players.AI1.char.domain = true; // 已开领域（跳过开领域这一步）
    g.players.AI2.room = 'R2';
    g.players.AI2.hp = 1;
    g.players.AI3.hp = 3; // 只有 AI2 落在远程一击范围内
    const act = aiDecideAction(g, 'AI1', 'hard');
    // 五条悟领域生效时远程免瞄准 → 直接攻击；否则先瞄准
    expect(['attack', 'aim']).toContain(act.type);
    expect(act.targetId).toBe('AI2');
  });

  it('休闲 AI 决策也在合法集合内（含跳过/躲藏等随意行为）', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const g = makeAiGame(seed, 3);
      // 固定进入行动阶段前不做判定，直接看决策类型集合
      const act = aiDecideAction(g, 'AI1', 'easy');
      seen.add(act.type);
      expect(['attack', 'heal', 'move', 'hide', 'skip']).toContain(act.type);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  it('候选链最后一档是跳过（保证不会卡住对局）', () => {
    const g = makeAiGame(3, 3);
    const chain = aiDecideActions(g, 'AI1', 'hard');
    expect(chain[chain.length - 1]).toEqual({ type: 'skip' });
  });
});

describe('AI 难度：整局回归', { timeout: 180000 }, () => {
  it('三档难度各自能打完多局', () => {
    for (const d of ['easy', 'normal', 'hard'] as AiDifficulty[]) {
      for (const seed of [11, 22, 33]) {
        const r = playGame(seed, d, 4);
        expect(r.over, `难度 ${d} 种子 ${seed} 未终局（第 ${r.rounds} 回合）\n${r.log.slice(-1200)}`).toBe(true);
      }
    }
  });

  it('同难度同种子完全可复现', () => {
    for (const d of ['easy', 'normal', 'hard'] as AiDifficulty[]) {
      const a = playGame(777, d, 3);
      const b = playGame(777, d, 3);
      expect(a.log).toBe(b.log);
      expect(a.winner).toBe(b.winner);
    }
  });

  it('硬核 AI 在多人混战中仍能保持合法行动（10人局）', () => {
    const r = playGame(2024, 'hard', 10);
    expect(r.over).toBe(true);
  });
});
