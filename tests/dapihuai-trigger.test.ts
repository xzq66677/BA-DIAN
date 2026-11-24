/**
 * 大屁孩「回合前触发」回归（2026-11-24 规则调整）
 *
 *  - 暴走/自爆不再在判定结算里当场执行，而是标记后统一在「回合最前」结算；
 *  - 暴走由持有者指定任意一名其他存活玩家（任意房间）；
 *  - 多名大屁孩同时暴走时，先做二次判定决定暴走权顺序（输者先）。
 */

import { describe, it, expect } from 'vitest';
import { Game } from '../shared/src/engine.js';
import { CHARACTERS } from '../shared/src/characters/index.js';
import { serializeSnapshot } from '../shared/src/snapshot.js';
import { aiBerserkTarget } from '../server/src/ai.js';
import type { RuleConfig, Throw } from '../shared/src/types.js';

const PLAYER_RULES: Partial<RuleConfig> = { skillJudgeMode: 'player', secondJudgeMode: 'player' };

function game2(specs: { id: string; char?: string }[], seed: number, rules: Partial<RuleConfig> = PLAYER_RULES) {
  return new Game({
    seed,
    chars: CHARACTERS,
    rules,
    players: specs.map((s) => ({ id: s.id, name: s.id, charId: s.char ?? 'default', type: 'human' as const })),
  });
}

function throws(g: Game, m: Record<string, Throw>): void {
  for (const pid of g.aliveIds()) if (m[pid]) g.submitThrow(pid, m[pid]);
}

describe('大屁孩：回合前触发（暴走 / 自爆）', () => {
  it('多名大屁孩同时暴走：先二次判定（亲自出拳）决定顺序，再依次指定目标', () => {
    const g = game2([{ id: 'P1', char: 'dapihuai' }, { id: 'P2', char: 'dapihuai' }, { id: 'A' }], 901);
    g.judgeHistory('P1').push('win', 'lose');
    g.judgeHistory('P2').push('win', 'lose');
    throws(g, { P1: 'rock', P2: 'rock', A: 'rock' }); // 三人同拳 → 两人同时三不同

    // 二次判定：即使不是行动阶段，也走 rps2 亲自出拳，并标注用途
    expect(g.phase).toBe('rps2');
    expect(serializeSnapshot(g).orderPurpose).toBe('berserk');
    g.submitOrderThrow('P1', 'scissors');
    g.submitOrderThrow('P2', 'rock'); // P1 输 → P1 先获得暴走权

    expect(g.phase).toBe('trigger');
    expect(g.triggerView()?.actor).toBe('P1');
    g.submitBerserk('P1', 'A');
    expect(g.players.A.alive).toBe(false);

    expect(g.triggerView()?.actor).toBe('P2');
    g.submitBerserk('P2', 'P1');
    expect(g.players.P1.alive).toBe(false);
  });

  it('快照下发触发阶段信息，且不泄露未结算拳种', () => {
    const g = game2([{ id: 'P', char: 'dapihuai' }, { id: 'A' }], 902);
    g.judgeHistory('P').push('win', 'lose');
    throws(g, { P: 'rock', A: 'rock' });
    const snap = serializeSnapshot(g);
    expect(snap.phase).toBe('trigger');
    expect(snap.trigger).toEqual({ kind: 'berserk', actor: 'P', queue: [] });
    // 判定已结算 → 揭示是公开信息；但内部 pendingThrows 不应出现
    expect(JSON.stringify(snap)).not.toContain('pendingThrows');
  });

  it('AI 选目标：优先血量最低的其他存活玩家', () => {
    const g = game2([{ id: 'P', char: 'dapihuai' }, { id: 'A' }, { id: 'B' }], 903);
    g.players.A.hp = 2;
    g.players.B.hp = 1;
    expect(aiBerserkTarget(g, 'P')).toBe('B');
    expect(aiBerserkTarget(g, 'A')).toBe('B');
    g.eliminate('A', 'test');
    expect(aiBerserkTarget(g, 'B')).toBe('P');
  });

  it('自爆在回合最前结算：不进入本回合行动阶段', () => {
    const g = game2([{ id: 'P', char: 'dapihuai' }, { id: 'A' }], 904);
    g.judgeHistory('P').push('tie', 'tie');
    throws(g, { P: 'rock', A: 'rock' }); // 平 → P 三同 → 自爆
    expect(g.players.P.alive).toBe(false);
    expect(g.phase).toBe('over');
    expect(g.winner).toBe('A');
  });
});
