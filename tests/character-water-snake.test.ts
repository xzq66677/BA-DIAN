/**
 * 飞天水螅（Issue #71，本地实现）规则回归
 *
 * 覆盖：
 *  - 造塔（2 次行动）、塔内外隔绝（算作新房间、房间级效果不穿透）；
 *  - 塔内压制：敌人行动前判定（胜=正常、平=行动无效、负=攻击自己）；
 *  - 吸/吹：只移动一格（其他房间↔自己房间↔塔内）；
 *  - 亡魂：死后不可被攻击、仍参与猜拳、只能使用吸/吹。
 */

import { describe, it, expect } from 'vitest';
import { Game } from '../shared/src/engine.js';
import { CHARACTERS } from '../shared/src/characters/index.js';
import type { Throw } from '../shared/src/types.js';

function makeGame(
  specs: { id: string; char?: string }[],
  seed = 51,
  rules?: Record<string, unknown>,
): Game {
  return new Game({
    seed,
    chars: CHARACTERS,
    rules: { skillJudgeMode: 'serverRoll', ...(rules ?? {}) } as never,
    players: specs.map((s) => ({ id: s.id, name: s.id, charId: s.char ?? 'default', type: 'local' as const })),
  });
}

function throws(g: Game, m: Record<string, Throw>): void {
  for (const pid of g.aliveIds()) if (m[pid]) g.submitThrow(pid, m[pid]);
}

/** 固定猜拳结果：0=石头 1=剪刀 2=布（先 a 后 b） */
function forceThrows(g: Game, seq: number[]): void {
  const original = g.rng.int.bind(g.rng);
  let i = 0;
  (g.rng as unknown as { int: (n: number) => number }).int = (n: number) => {
    if (i < seq.length) return Math.min(seq[i++], n - 1);
    return original(n);
  };
}

/** 直接把高塔设为建成状态（A 为飞天水螅） */
function buildTowerDirectly(g: Game, baseRoom = 'R1', owner = 'A'): void {
  const st = g.charState(owner);
  st.towerBaseRoom = baseRoom;
  st.buildProgress = 2;
  st.inTower = true;
}

describe('飞天水螅：造塔', () => {
  it('消耗两次行动造完；建成后进入塔内并算作新房间', () => {
    const g = makeGame([{ id: 'A', char: 'water-snake' }, { id: 'B' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R2';

    throws(g, { A: 'rock', B: 'scissors' });
    expect(g.submitAction('A', { type: 'buildTower' }).ok).toBe(true);
    expect(g.charState('A').buildProgress).toBe(1);
    expect(g.charState('A').towerBaseRoom).toBeNull();

    throws(g, { A: 'rock', B: 'scissors' });
    expect(g.submitAction('A', { type: 'buildTower' }).ok).toBe(true);
    expect(g.charState('A').buildProgress).toBe(2);
    expect(g.charState('A').towerBaseRoom).toBe('R1');
    expect(g.charState('A').inTower).toBe(true);
  });

  it('塔内外隔绝：塔内玩家不计入房间成员，也不能被塔外直接攻击', () => {
    const g = makeGame([{ id: 'A', char: 'water-snake' }, { id: 'B' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R1';
    buildTowerDirectly(g, 'R1');
    g.charState('B').inTower = true;

    // 塔内玩家不计入原房间成员（AOE/三刀等房间级效果不穿透塔壁）
    expect(g.roomMembers('R1')).toEqual([]);
    // 一人塔内、一人塔外：不算同房间
    g.charState('B').inTower = false;
    expect(g.isSameRoom('A', 'B')).toBe(false);
    // 塔外不能攻击塔内
    throws(g, { B: 'rock', A: 'scissors' });
    const r = g.submitAction('B', { type: 'attack', targetId: 'A' });
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('隔绝');
  });

  it('离开高塔后恢复普通房间状态', () => {
    const g = makeGame([{ id: 'A', char: 'water-snake' }, { id: 'B' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R2';
    buildTowerDirectly(g, 'R1');
    throws(g, { A: 'rock', B: 'scissors' });
    expect(g.submitAction('A', { type: 'move', room: 'R2' }).ok).toBe(true);
    expect(g.charState('A').inTower).toBe(false);
    expect(g.players.A.room).toBe('R2');
  });
});

describe('飞天水螅：塔内压制判定', () => {
  function towerFight(): Game {
    const g = makeGame([{ id: 'A', char: 'water-snake' }, { id: 'B' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R1';
    buildTowerDirectly(g, 'R1');
    g.charState('B').inTower = true;
    throws(g, { B: 'rock', A: 'scissors' }); // B 获得行动资格
    return g;
  }

  it('判定胜利 → 正常行动', () => {
    const g = towerFight();
    forceThrows(g, [0, 1]); // B 石头 vs A 剪刀 → B 胜
    const r = g.submitAction('B', { type: 'attack', targetId: 'A' });
    expect(r.ok).toBe(true);
    expect(g.players.A.hp).toBe(2); // 3 - 1
  });

  it('平局 → 本次行动无效（仍消耗行动）', () => {
    const g = towerFight();
    forceThrows(g, [0, 0]); // 平局
    const r = g.submitAction('B', { type: 'attack', targetId: 'A' });
    expect(r.ok).toBe(true);
    expect(g.players.A.hp).toBe(3); // 没有造成伤害
    expect(g.roundNo).toBe(2); // 行动已消耗，回合推进
    expect(g.logs.map((l) => l.text).join('\n')).toContain('本次行动无效');
  });

  it('判定失败 → 攻击自己', () => {
    const g = towerFight();
    forceThrows(g, [1, 0]); // B 剪刀 vs A 石头 → B 败
    const r = g.submitAction('B', { type: 'attack', targetId: 'A' });
    expect(r.ok).toBe(true);
    expect(g.players.A.hp).toBe(3); // 原目标没受伤
    expect(g.players.B.hp).toBe(1); // 自伤 1（默认角色 2 血）
    expect(g.logs.map((l) => l.text).join('\n')).toContain('攻击自己');
  });
});

describe('飞天水螅：吸 / 吹', () => {
  it('吸：其他房间 → 自己房间，再吸 → 塔内', () => {
    const g = makeGame([{ id: 'A', char: 'water-snake' }, { id: 'B' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R2';
    buildTowerDirectly(g, 'R1');

    throws(g, { A: 'rock', B: 'scissors' });
    expect(g.submitAction('A', { type: 'inhale', targetId: 'B' }).ok).toBe(true);
    expect(g.players.B.room).toBe('R1');
    expect(g.charState('B').inTower === true).toBe(false);

    throws(g, { A: 'rock', B: 'scissors' });
    expect(g.submitAction('A', { type: 'inhale', targetId: 'B' }).ok).toBe(true);
    expect(g.charState('B').inTower).toBe(true);
  });

  it('吹：塔内 → 自己房间，再吹 → 其他房间', () => {
    const g = makeGame([{ id: 'A', char: 'water-snake' }, { id: 'B' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R1';
    g.players.B.originRoom = 'R2';
    buildTowerDirectly(g, 'R1');
    g.charState('B').inTower = true;

    throws(g, { A: 'rock', B: 'scissors' });
    expect(g.submitAction('A', { type: 'blow', targetId: 'B' }).ok).toBe(true);
    expect(g.charState('B').inTower).toBe(false);
    expect(g.players.B.room).toBe('R1');

    throws(g, { A: 'rock', B: 'scissors' });
    expect(g.submitAction('A', { type: 'blow', targetId: 'B' }).ok).toBe(true);
    expect(g.players.B.room).toBe('R2'); // 吹到其他房间（一格）
  });
});

describe('飞天水螅：亡魂（死后继续参与）', () => {
  it('致死 → 化为亡魂：hp 0、不可被攻击、仍参与猜拳、只能吸/吹', () => {
    const g = makeGame([{ id: 'A', char: 'water-snake' }, { id: 'B' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R1';
    g.players.A.hp = 1;
    throws(g, { B: 'rock', A: 'scissors' });
    expect(g.submitAction('B', { type: 'attack', targetId: 'A' }).ok).toBe(true);
    expect(g.players.A.alive).toBe(true); // 没有真正死亡
    expect(g.players.A.hp).toBe(0);
    expect(g.charState('A').posthumous).toBe(true);
    expect(g.players.A.invisible).toBe(true);

    // 亡魂免疫伤害（AOE 也不掉血）
    g.applyDamage({ target: 'A', amount: 9, source: 'B', dtype: 'special', aoe: true });
    expect(g.players.A.hp).toBe(0);
    expect(g.players.A.alive).toBe(true);

    // 亡魂仍参与猜拳；不能用普通攻击，但可以吸
    g.players.B.room = 'R2';
    throws(g, { A: 'rock', B: 'scissors' });
    expect(g.phase).toBe('act');
    expect(g.submitAction('A', { type: 'attack', targetId: 'B' }).ok).toBe(false);
    expect(g.submitAction('A', { type: 'inhale', targetId: 'B' }).ok).toBe(true);
    expect(g.players.B.room).toBe('R1');
  });
});
