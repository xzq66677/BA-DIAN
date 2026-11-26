/**
 * 鬼影（Issue #71，本地实现）规则回归
 *
 * 覆盖：
 *  - 血 2 / 攻 1.5；单次受伤上限 0.5（含秒杀）；无法主动回复；
 *  - 消耗一次行动无视距离移动并附身（不能锁定躲藏/隐身者）；
 *  - 宿主每回合 1 点伤害（含平局回合；附身当回合与驱赶当回合不结算）；
 *  - 附身造成的伤害等量回血给鬼影；
 *  - 赢下判定后可折磨宿主（+1 伤害）或操控宿主攻击；
 *  - 附身期间鬼影无法被锁定（AOE 仍可命中）；宿主可消耗一次行动驱逐；
 *  - 宿主死亡 / 鬼影死亡都会解除附身。
 */

import { describe, it, expect } from 'vitest';
import { Game } from '../shared/src/engine.js';
import { CHARACTERS } from '../shared/src/characters/index.js';
import type { Throw } from '../shared/src/types.js';

function makeGame(
  specs: { id: string; char?: string }[],
  seed = 21,
  rules?: Record<string, unknown>,
): Game {
  return new Game({
    seed,
    chars: CHARACTERS,
    ...(rules ? { rules: rules as never } : {}),
    players: specs.map((s) => ({ id: s.id, name: s.id, charId: s.char ?? 'default', type: 'local' as const })),
  });
}

function throws(g: Game, m: Record<string, Throw>): void {
  for (const pid of g.aliveIds()) if (m[pid]) g.submitThrow(pid, m[pid]);
}

/** A（鬼影）先手并附身同局中的 B */
function ghostPossessingB(): Game {
  const g = makeGame([{ id: 'A', char: 'ghost' }, { id: 'B' }]);
  g.players.A.room = 'R1';
  g.players.B.room = 'R2';
  throws(g, { A: 'rock', B: 'scissors' }); // A 获得行动资格
  expect(g.phase).toBe('act');
  const r = g.submitAction('A', { type: 'possess', targetId: 'B' });
  expect(r.ok).toBe(true);
  return g;
}

describe('鬼影：数值与受伤上限', () => {
  it('血量 2 / 攻击 1.5，单次受伤上限 0.5（含秒杀）', () => {
    const g = makeGame([{ id: 'A', char: 'ghost' }, { id: 'B' }]);
    expect(g.players.A.maxHp).toBe(2);
    expect(g.charDef('A').attack).toBe(1.5);
    g.applyDamage({ target: 'A', amount: 5, source: 'B', dtype: 'physical' });
    expect(g.players.A.hp).toBe(1.5);
    g.applyDamage({ target: 'A', amount: 999, source: 'B', dtype: 'mental', instakill: true, ignoreLives: true });
    expect(g.players.A.hp).toBe(1); // 秒杀也被压到 0.5
  });

  it('无法主动「回复」回满血', () => {
    const g = makeGame([{ id: 'A', char: 'ghost' }, { id: 'B' }]);
    g.players.A.hp = 1;
    throws(g, { A: 'rock', B: 'scissors' });
    const r = g.submitAction('A', { type: 'heal' });
    expect(r.ok).toBe(false);
    expect(g.players.A.hp).toBe(1);
  });
});

describe('鬼影：附身', () => {
  it('消耗一次行动无视距离移动并附身；附身期间不可被锁定', () => {
    const g = ghostPossessingB();
    expect(g.players.A.room).toBe(g.players.B.room); // 已移动到目标房间
    expect(g.players.A.invisible).toBe(true);
    expect(g.getStatus('B', 'possessed')?.source).toBe('A');
    expect(g.hasStatus('A', 'possessing')).toBe(true);

    // 附身期间无法被锁定：指向性伤害直接未命中
    g.applyDamage({ target: 'A', amount: 1, source: 'B', dtype: 'physical' });
    expect(g.players.A.hp).toBe(2);
    // AOE 仍可命中，且单次仍受 0.5 上限
    g.applyDamage({ target: 'A', amount: 1, source: 'B', dtype: 'special', aoe: true });
    expect(g.players.A.hp).toBe(1.5);
  });

  it('不能附身躲藏/隐身者，也不能重复附身', () => {
    const g = makeGame([{ id: 'A', char: 'ghost' }, { id: 'B' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R1';
    g.players.B.hidden = true;
    throws(g, { A: 'rock', B: 'scissors' });
    const r1 = g.submitAction('A', { type: 'possess', targetId: 'B' });
    expect(r1.ok).toBe(false);
    expect(String(r1.error)).toContain('躲藏');
    g.players.B.hidden = false;
    expect(g.submitAction('A', { type: 'possess', targetId: 'B' }).ok).toBe(true);
    // 已附身时再次附身被拒绝
    throws(g, { A: 'rock', B: 'scissors' });
    const r2 = g.submitAction('A', { type: 'possess', targetId: 'B' });
    expect(r2.ok).toBe(false);
    expect(String(r2.error)).toContain('已经处于附身中');
  });

  it('宿主每回合受到 1 点伤害（平局也结算）；附身当回合不结算；伤害等量回血', () => {
    const g = ghostPossessingB();
    expect(g.players.B.hp).toBe(2); // 附身当回合不结算
    expect(g.players.A.hp).toBe(2);
    g.players.A.hp = 1; // 便于观察回血
    throws(g, { A: 'rock', B: 'rock' }); // 平局回合仍结算附身伤害
    expect(g.players.B.hp).toBe(1);
    expect(g.players.A.hp).toBe(2); // 伤害 1 等量回血（上限 2）
  });

  it('被附身者可消耗一次行动驱逐；驱赶当回合不造成伤害', () => {
    const g = ghostPossessingB();
    throws(g, { B: 'rock', A: 'scissors' }); // B 获得行动资格
    expect(g.phase).toBe('act');
    const snap = g.snapshot() as unknown as { extraActions: { key: string }[] };
    expect(snap.extraActions.map((a) => a.key)).toContain('expelGhost');
    const r = g.submitAction('B', { type: 'expelGhost' });
    expect(r.ok).toBe(true);
    expect(g.getStatus('B', 'possessed')).toBeUndefined();
    expect(g.hasStatus('A', 'possessing')).toBe(false);
    expect(g.players.A.invisible).toBe(false);
    expect(g.players.B.hp).toBe(2); // 驱赶当回合不结算
  });
});

describe('鬼影：赢下判定后的额外行动', () => {
  it('可额外折磨宿主 +1 伤害（并等量回血）', () => {
    const g = ghostPossessingB();
    throws(g, { A: 'rock', B: 'scissors' }); // A 赢下判定获得行动资格
    const snap = g.snapshot() as unknown as { extraActions: { key: string }[] };
    expect(snap.extraActions.map((a) => a.key)).toEqual(expect.arrayContaining(['possessStrike', 'possessControl']));
    const before = g.players.B.hp;
    g.players.A.hp = 1;
    const r = g.submitAction('A', { type: 'possessStrike' });
    expect(r.ok).toBe(true);
    // 折磨：额外 1 点伤害（日志证据；随后回合末还会结算附身 1 点，B 可能因此死亡）
    const strikeLog = g.logs.filter((l) => l.type === 'damage' && l.data?.tag === 'possess-extra').pop();
    expect(String(strikeLog?.data?.amount)).toBe('1');
    expect(g.players.B.hp).toBeLessThan(before);
    expect(g.players.A.hp).toBe(2); // 伤害等量回血
  });

  it('可操控宿主攻击其同房间目标（使用宿主攻击力）', () => {
    const g = makeGame([{ id: 'A', char: 'ghost' }, { id: 'B' }, { id: 'C' }]);
    g.players.A.room = 'R1';
    g.players.B.room = 'R2';
    g.players.C.room = 'R2';
    throws(g, { A: 'rock', B: 'scissors', C: 'scissors' }); // 只有 A 有资格
    expect(g.submitAction('A', { type: 'possess', targetId: 'B' }).ok).toBe(true);

    throws(g, { A: 'rock', B: 'scissors', C: 'scissors' });
    const before = g.players.C.hp;
    const r = g.submitAction('A', { type: 'possessControl', targetId: 'C' });
    expect(r.ok).toBe(true);
    expect(g.players.C.hp).toBe(before - 1); // 宿主（无业游民）攻击 1
  });
});

describe('鬼影：附身解除', () => {
  it('宿主死亡 → 附身解除、鬼影现形', () => {
    const g = ghostPossessingB();
    g.players.B.hp = 1;
    throws(g, { A: 'rock', B: 'rock' }); // 平局回合末附身伤害致死
    expect(g.players.B.alive).toBe(false);
    expect(g.hasStatus('A', 'possessing')).toBe(false);
    expect(g.players.A.invisible).toBe(false);
  });

  it('鬼影死亡 → 宿主恢复、附身状态清理', () => {
    const g = ghostPossessingB();
    // 附身期间无法被指向性锁定，用 AOE 击杀（4 × 0.5 上限）
    for (let i = 0; i < 4; i++) {
      g.applyDamage({ target: 'A', amount: 5, source: 'B', dtype: 'special', aoe: true });
    }
    expect(g.players.A.alive).toBe(false);
    expect(g.getStatus('B', 'possessed')).toBeUndefined();
    expect(g.players.B.alive).toBe(true);
  });
});
