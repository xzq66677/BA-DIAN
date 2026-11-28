/**
 * 狂猎（Issue #71，本地实现）规则回归
 *
 * 覆盖：
 *  - 血 4 / 攻 1；受到攻击时猜拳判定（平局重掷）：
 *    赢 → 抵消伤害并反击（未骑乘反击 1 伤 + 上马 1 回合；已骑乘反击 6 伤、用后下马）；
 *    输 → 正常受伤；
 *  - 骑乘期间攻击无视距离 + 位移 + 伤害×2；骑乘最后一回合攻击 6 伤单体；
 *  - 主动上马 2 回合；击杀后攻击 ×1.5（可叠加）；
 *  - 受击判定只响应普通攻击（燃烧/爆炸/精神攻击不触发）。
 */

import { describe, it, expect } from 'vitest';
import { Game } from '../shared/src/engine.js';
import { CHARACTERS } from '../shared/src/characters/index.js';
import { aiDecideAction } from '../server/src/room.js';
import type { Throw } from '../shared/src/types.js';

function makeGame(
  specs: { id: string; char?: string }[],
  seed = 31,
  rules?: Record<string, unknown>,
): Game {
  return new Game({
    seed,
    chars: CHARACTERS,
    // 测试默认用即时判定（serverRoll）；player 模式用例显式覆盖
    rules: { skillJudgeMode: 'serverRoll', ...(rules ?? {}) } as never,
    players: specs.map((s) => ({ id: s.id, name: s.id, charId: s.char ?? 'default', type: 'local' as const })),
  });
}

function throws(g: Game, m: Record<string, Throw>): void {
  for (const pid of g.aliveIds()) if (m[pid]) g.submitThrow(pid, m[pid]);
}

/**
 * 固定猜拳结果：0=石头 1=剪刀 2=布。
 * `rollJudgeThrows(a,b)` 先掷 a 再掷 b（狂猎判定中 a=狂猎、b=攻击者）。
 */
function forceThrows(g: Game, seq: number[]): void {
  const original = g.rng.int.bind(g.rng);
  let i = 0;
  (g.rng as unknown as { int: (n: number) => number }).int = (n: number) => {
    if (i < seq.length) return Math.min(seq[i++], n - 1);
    return original(n);
  };
}

/** A（狂猎）与 B 同房间，B 先手攻击 A；返回判定前状态 */
function setBAboutToAttackA(g: Game): void {
  g.players.A.room = 'R1';
  g.players.B.room = 'R1';
  throws(g, { B: 'rock', A: 'scissors' }); // B 获得行动资格
  expect(g.phase).toBe('act');
}

describe('狂猎：受击猜拳判定', () => {
  it('猜拳胜利 → 抵消伤害并反击 1 伤、上马 1 回合', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'B' }]);
    setBAboutToAttackA(g);
    forceThrows(g, [0, 1]); // 狂猎石头 vs B 剪刀 → 狂猎胜
    const r = g.submitAction('B', { type: 'attack', targetId: 'A' });
    expect(r.ok).toBe(true);
    expect(g.players.A.hp).toBe(4); // 伤害被抵消
    expect(g.players.B.hp).toBe(1); // 反击 1 伤
    expect(g.hasStatus('A', 'mounted')).toBe(true);
    expect(g.charState('A').mounted).toBe(true);
  });

  it('猜拳失败 → 正常受伤，不上马', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'B' }]);
    setBAboutToAttackA(g);
    forceThrows(g, [1, 0]); // 狂猎剪刀 vs B 石头 → 狂猎败
    g.submitAction('B', { type: 'attack', targetId: 'A' });
    expect(g.players.A.hp).toBe(3);
    expect(g.hasStatus('A', 'mounted')).toBe(false);
  });

  it('平局重掷，直到分出胜负', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'B' }]);
    setBAboutToAttackA(g);
    forceThrows(g, [0, 0, 0, 1]); // 平局 → 再掷 → 狂猎胜
    g.submitAction('B', { type: 'attack', targetId: 'A' });
    expect(g.players.A.hp).toBe(4);
    expect(g.players.B.hp).toBe(1);
    const log = g.logs.map((l) => l.text).join('\n');
    expect(log).toContain('平局重掷');
  });

  it('已骑乘时反击改为 6 伤，使用后下马', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'B' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R1';
    throws(g, { A: 'rock', B: 'scissors' }); // A 先手：主动上马
    expect(g.submitAction('A', { type: 'mount' }).ok).toBe(true);
    expect(g.charState('A').mounted).toBe(true);

    throws(g, { B: 'rock', A: 'scissors' }); // 下一回合 B 攻击骑乘中的 A
    forceThrows(g, [0, 1]);
    g.submitAction('B', { type: 'attack', targetId: 'A' });
    expect(g.players.B.alive).toBe(false); // 2 血被 6 伤反击击杀
    expect(g.hasStatus('A', 'mounted')).toBe(false); // 用后下马
  });

  it('受击判定只响应普通攻击：燃烧/爆炸/精神攻击不触发', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'B' }]);
    g.applyDamage({ target: 'A', amount: 2, source: 'B', dtype: 'special' });
    expect(g.players.A.hp).toBe(2); // 没有判定、正常受伤
    expect(g.hasStatus('A', 'mounted')).toBe(false);
  });
});

describe('狂猎：双方亲自出拳的受击判定（player 模式）', () => {
  it('进入 judge 阶段；胜利则抵消伤害、反击并上马', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'B' }], 41, { skillJudgeMode: 'player' });
    setBAboutToAttackA(g);
    g.submitAction('B', { type: 'attack', targetId: 'A' });
    expect(g.phase).toBe('judge');
    expect(g.skillJudgeView()?.label).toBe('狂猎受击判定');
    expect(g.submitJudgeThrow('A', 'rock').ok).toBe(true);
    expect(g.submitJudgeThrow('B', 'scissors').ok).toBe(true);
    expect(g.players.A.hp).toBe(4);
    expect(g.players.B.hp).toBe(1);
    expect(g.hasStatus('A', 'mounted')).toBe(true);
  });

  it('平局「再来一把」：同一局继续出拳，直到分出胜负', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'B' }], 42, { skillJudgeMode: 'player' });
    setBAboutToAttackA(g);
    g.submitAction('B', { type: 'attack', targetId: 'A' });
    expect(g.phase).toBe('judge');
    g.submitJudgeThrow('A', 'rock');
    g.submitJudgeThrow('B', 'rock'); // 平局
    expect(g.phase).toBe('judge');
    expect(g.skillJudgeView()?.round).toBe(1); // 不推进局数
    g.submitJudgeThrow('A', 'rock');
    g.submitJudgeThrow('B', 'scissors'); // 狂猎胜
    expect(g.players.A.hp).toBe(4);
    expect(g.players.B.hp).toBe(1);
  });

  it('失败则正常受伤', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'B' }], 43, { skillJudgeMode: 'player' });
    setBAboutToAttackA(g);
    g.submitAction('B', { type: 'attack', targetId: 'A' });
    g.submitJudgeThrow('A', 'scissors');
    g.submitJudgeThrow('B', 'rock');
    expect(g.players.A.hp).toBe(3);
    expect(g.hasStatus('A', 'mounted')).toBe(false);
  });
});

describe('狂猎：骑乘突进与爆发', () => {
  it('骑乘攻击可跨房间突进：伤害×2 并移动到目标房间', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'B' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R2';
    g.players.B.maxHp = 20;
    g.players.B.hp = 20;
    throws(g, { A: 'rock', B: 'scissors' });
    g.submitAction('A', { type: 'mount' });
    throws(g, { A: 'rock', B: 'scissors' });
    expect(g.submitAction('A', { type: 'attack', targetId: 'B' }).ok).toBe(true);
    expect(g.players.A.room).toBe('R2'); // 攻击带位移
    expect(g.players.B.hp).toBe(18); // 1 × 2
  });

  it('主动上马 2 回合：第 1 回合×2，最后一回合 6 伤单体，结束下马', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'B' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R2';
    g.players.B.maxHp = 30;
    g.players.B.hp = 30;
    throws(g, { A: 'rock', B: 'scissors' });
    g.submitAction('A', { type: 'mount' });

    throws(g, { A: 'rock', B: 'scissors' });
    g.submitAction('A', { type: 'attack', targetId: 'B' });
    expect(g.players.B.hp).toBe(28); // 第 1 个骑乘回合：1×2

    throws(g, { A: 'rock', B: 'scissors' });
    expect(g.submitAction('A', { type: 'attack', targetId: 'B' }).ok).toBe(true);
    expect(g.players.B.hp).toBe(22); // 最后一回合：6 伤单体
    expect(g.hasStatus('A', 'mounted')).toBe(false); // 两回合结束自动下马
  });

  it('未骑乘时不能攻击异房间目标', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'B' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R2';
    throws(g, { A: 'rock', B: 'scissors' });
    const r = g.submitAction('A', { type: 'attack', targetId: 'B' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('同房间');
  });
});

describe('狂猎：击杀成长', () => {
  it('击杀敌人后攻击 ×1.5（可叠加）', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'B' }, { id: 'C' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R1';
    g.players.C.room = 'R1';
    g.players.B.hp = 1;
    g.players.C.maxHp = 30;
    g.players.C.hp = 30;

    throws(g, { A: 'rock', B: 'scissors', C: 'scissors' });
    expect(g.submitAction('A', { type: 'attack', targetId: 'B' }).ok).toBe(true);
    expect(g.players.B.alive).toBe(false);
    expect(g.charState('A').kills).toBe(1);

    throws(g, { A: 'rock', B: 'scissors', C: 'scissors' });
    g.submitAction('A', { type: 'attack', targetId: 'C' });
    expect(g.players.C.hp).toBe(28.5); // 1 × 1.5
  });

  it('骑乘最后一回合的 6 伤单体同样叠加击杀加成（1 杀 → 9 伤）', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'B' }, { id: 'C' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R1';
    g.players.C.room = 'R1';
    g.players.B.hp = 1;
    g.players.C.maxHp = 40;
    g.players.C.hp = 40;

    // 第 1 回合：击杀 B（攻击 ×1.5）
    throws(g, { A: 'rock', B: 'scissors', C: 'scissors' });
    g.submitAction('A', { type: 'attack', targetId: 'B' });
    expect(g.charState('A').kills).toBe(1);

    // 第 2 回合：主动上马
    throws(g, { A: 'rock', B: 'scissors', C: 'scissors' });
    expect(g.submitAction('A', { type: 'mount' }).ok).toBe(true);

    // 第 3 回合：骑乘普通攻击 1×2×1.5 = 3
    throws(g, { A: 'rock', B: 'scissors', C: 'scissors' });
    g.submitAction('A', { type: 'attack', targetId: 'C' });
    expect(g.players.C.hp).toBe(37);

    // 第 4 回合：骑乘最后一回合 6×1.5 = 9
    throws(g, { A: 'rock', B: 'scissors', C: 'scissors' });
    g.submitAction('A', { type: 'attack', targetId: 'C' });
    expect(g.players.C.hp).toBe(28);
    expect(g.hasStatus('A', 'mounted')).toBe(false);
  });
});

describe('狂猎：状态快照', () => {
  it('骑乘状态公开（kind/remainingRounds），不含私有字段', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'B' }]);
    throws(g, { A: 'rock', B: 'scissors' });
    g.submitAction('A', { type: 'mount' });
    const snap = g.snapshot() as unknown as { players: { id: string; effects?: Record<string, unknown>[] }[] };
    const a = snap.players.find((p) => p.id === 'A')!;
    const mounted = a.effects?.find((e) => e.kind === 'mounted');
    expect(mounted).toBeTruthy();
    expect(mounted).not.toHaveProperty('appliedRound');
    expect(JSON.stringify(a.effects)).not.toContain('mountExpiresRound');
  });
});

describe('狂猎 × 高塔墙（Issue #97）', () => {
  /** 直接把高塔设为建成状态（与飞天水螅测试同款；ownerInside=false 时蛇在塔外） */
  function buildTowerDirectly(g: Game, baseRoom: string, owner: string, ownerInside = true): void {
    const st = g.charState(owner);
    st.towerBaseRoom = baseRoom;
    st.towerHp = 6;
    st.buildProgress = 2;
    st.inTower = ownerInside;
  }

  it('骑乘冲锋不可穿墙命中塔内目标', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'S', char: 'water-snake' }]);
    g.players.A.room = 'R1';
    g.players.S.room = 'R2';
    buildTowerDirectly(g, 'R2', 'S'); // S 在塔内
    throws(g, { A: 'rock', S: 'scissors' });
    g.submitAction('A', { type: 'mount' });
    throws(g, { A: 'rock', S: 'scissors' });
    const r = g.submitAction('A', { type: 'attack', targetId: 'S' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('高塔内外隔绝');
    expect(g.players.S.hp).toBe(3); // 未受伤
    expect(g.charState('S').towerHp).toBe(6); // 高塔无损
    expect(g.players.A.room).toBe('R1'); // 未位移
  });

  it('塔内骑乘冲锋塔外目标：拒绝且不残留塔内标记', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'S', char: 'water-snake' }, { id: 'X' }]);
    g.players.A.room = 'R2';
    g.players.S.room = 'R2';
    g.players.X.room = 'R3';
    buildTowerDirectly(g, 'R2', 'S', false); // 蛇在塔外：不触发塔内压制判定
    throws(g, { A: 'scissors', S: 'rock', X: 'scissors' }); // S 先手，把 A 吸进塔
    expect(g.submitAction('S', { type: 'inhale', targetId: 'A' }).ok).toBe(true);
    expect(g.charState('A').inTower).toBe(true);
    throws(g, { A: 'rock', S: 'scissors', X: 'scissors' });
    expect(g.submitAction('A', { type: 'mount' }).ok).toBe(true);
    throws(g, { A: 'rock', S: 'scissors', X: 'scissors' });
    const r = g.submitAction('A', { type: 'attack', targetId: 'X' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('高塔内外隔绝');
    expect(g.players.X.hp).toBe(2); // 目标无伤
    expect(g.players.A.room).toBe('R2'); // 未位移
    expect(g.charState('A').inTower).toBe(true); // 人未离开塔，标记正确保持
    expect(g.charState('A').mounted).toBe(true); // 被拒行动不消耗骑乘
  });

  it('塔内骑乘不能攻击同房间塔外目标（跨塔墙同房间）', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'S', char: 'water-snake' }, { id: 'B' }]);
    g.players.A.room = 'R2';
    g.players.S.room = 'R2';
    g.players.B.room = 'R2';
    buildTowerDirectly(g, 'R2', 'S', false);
    throws(g, { A: 'scissors', S: 'rock', B: 'scissors' });
    expect(g.submitAction('S', { type: 'inhale', targetId: 'A' }).ok).toBe(true);
    throws(g, { A: 'rock', S: 'scissors', B: 'scissors' });
    expect(g.submitAction('A', { type: 'mount' }).ok).toBe(true);
    throws(g, { A: 'rock', S: 'scissors', B: 'scissors' });
    const r = g.submitAction('A', { type: 'attack', targetId: 'B' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('高塔内外隔绝');
    expect(g.players.B.hp).toBe(2);
  });

  it('AI 骑乘时不把塔墙隔绝的目标列为候选', () => {
    const g = makeGame([{ id: 'A', char: 'wild-hunt' }, { id: 'S', char: 'water-snake' }, { id: 'X' }]);
    g.players.A.room = 'R1';
    g.players.S.room = 'R2';
    g.players.X.room = 'R3';
    buildTowerDirectly(g, 'R2', 'S'); // S 塔内：A 与 S 被塔墙隔绝
    throws(g, { A: 'rock', S: 'scissors', X: 'scissors' });
    g.submitAction('A', { type: 'mount' });
    throws(g, { A: 'rock', S: 'scissors', X: 'scissors' });
    const req = aiDecideAction(g, 'A', 'hard');
    expect(req?.type).toBe('attack');
    expect(req?.targetId).toBe('X');
  });
});
