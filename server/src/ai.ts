import type { Game } from '../../shared/src/engine.js';
import { randomThrow } from '../../shared/src/rng.js';
import type { ActionRequest, AiDifficulty, PlayerId, Throw } from '../../shared/src/types.js';

// ═══════════════════ AI 决策（与规则引擎分离，只提交合法行动） ═══════════════════

/** 某出拳的克制拳（用于硬核 AI 反制） */
const COUNTER: Record<Throw, Throw> = { rock: 'paper', scissors: 'rock', paper: 'scissors' };

/**
 * AI 出拳。
 *  - easy / normal：随机（引擎种子流，可复现）
 *  - hard：统计对手历史出拳频率反制（30% 随机扰动，避免被读牌）
 */
export function aiThrow(g: Game, pid: PlayerId, difficulty: AiDifficulty = 'normal'): Throw {
  if (difficulty !== 'hard') return randomThrow(g.rng);
  const counts: Record<Throw, number> = { rock: 0, scissors: 0, paper: 0 };
  for (const [other, list] of Object.entries(g.throwHistory ?? {})) {
    if (other === pid) continue;
    for (const t of list.slice(-4)) counts[t] = (counts[t] ?? 0) + 1;
  }
  const total = counts.rock + counts.scissors + counts.paper;
  if (total < 3) return randomThrow(g.rng);
  if (g.rng.next() < 0.3) return randomThrow(g.rng);
  const mostCommon = (Object.keys(counts) as Throw[]).sort((a, b) => counts[b] - counts[a])[0];
  return COUNTER[mostCommon];
}

/** 威胁评分：攻击力 + 血量（硬核 AI 用来挑「最危险的对手」） */
function threatOf(g: Game, pid: PlayerId): number {
  const p = g.players[pid];
  const cd = g.charDef(pid);
  const atk = cd.meleeDamage ?? cd.attack ?? g.rules.defaultAttack;
  return atk * 2 + p.hp;
}

/** 同房间可被「找出来」的躲藏目标；隐身无法靠 seek 解除，不浪费行动。 */
function seekTargets(g: Game, pid: PlayerId): PlayerId[] {
  if (!g.rules.allowSeek) return [];
  const me = g.players[pid];
  return g.roomMembers(me.room).filter((id) =>
    id !== pid && g.players[id].alive && g.players[id].hidden && !g.players[id].invisible);
}

/** 可无视躲藏、AOE/辱骂接管攻击、纯远程或零攻击角色不需要找出来。 */
function shouldSeekHidden(g: Game, pid: PlayerId): boolean {
  const cd = g.charDef(pid);
  if (cd.ignoreHide || cd.onAttackAction) return false;
  if (cd.attackType === 'ranged' || cd.attackType === 'none') return false;
  const atk = cd.meleeDamage ?? cd.attack ?? g.rules.defaultAttack;
  if (atk <= 0) return false;
  return seekTargets(g, pid).length > 0;
}

/** 简单可解释的 AI 行动策略（普通难度，保留原行为以便回归） */
export function aiDecideAction(g: Game, pid: PlayerId, difficulty: AiDifficulty = 'normal'): ActionRequest {
  return aiDecideActions(g, pid, difficulty)[0];
}

/**
 * 返回按优先级排列的候选行动。
 * 调用方（Room.kickAI）依次尝试，第一份被引擎接受的即为 AI 本回合行动 ——
 * 这样即使某个角色有额外限制，AI 也不会卡住对局。
 */
export function aiDecideActions(g: Game, pid: PlayerId, difficulty: AiDifficulty = 'normal'): ActionRequest[] {
  const primary = difficulty === 'easy' ? easyDecide(g, pid)
    : difficulty === 'hard' ? hardDecide(g, pid)
      : normalDecide(g, pid);
  const chain: ActionRequest[] = [primary];
  const push = (a: ActionRequest) => {
    if (!chain.some((x) => JSON.stringify(x) === JSON.stringify(a))) chain.push(a);
  };
  // 回退链：保证一定有一个能被接受的行动（最差为跳过）
  const me = g.players[pid];
  const sameRoom = g.roomMembers(me.room).filter((p) => p !== pid && !g.players[p].hidden && !g.players[p].invisible);
  for (const t of sameRoom) push({ type: 'attack', targetId: t });
  if (shouldSeekHidden(g, pid)) {
    for (const t of seekTargets(g, pid)) push({ type: 'seek', targetId: t });
  }
  if (me.hp < me.maxHp) push({ type: 'heal' });
  const otherRoom = g.roomIds.find((r) => r !== me.room && !g.isMoveBlocked(pid, r) && g.roomMembers(r).length > 0);
  if (otherRoom) push({ type: 'move', room: otherRoom });
  if (g.rules.allowHide && !me.hidden) push({ type: 'hide' });
  push({ type: 'skip' });
  return chain;
}

/** 休闲：随性而为，常常做些没用的事 */
function easyDecide(g: Game, pid: PlayerId): ActionRequest {
  const me = g.players[pid];
  const members = g.roomMembers(me.room).filter((p) => p !== pid);
  const visible = members.filter((m) => !(g.players[m].hidden || g.players[m].invisible));
  const hidden = seekTargets(g, pid);
  const roll = g.rng.next();
  if (roll < 0.18 && g.rules.allowHide && !me.hidden) return { type: 'hide' };
  if (roll < 0.28) return { type: 'skip' };
  if (roll < 0.4 && me.hp < me.maxHp) return { type: 'heal' };
  if (visible.length > 0 && roll < 0.8) {
    return { type: 'attack', targetId: g.rng.pick(visible) };
  }
  if (visible.length > 0) return { type: 'attack', targetId: visible[0] };
  if (hidden.length > 0 && shouldSeekHidden(g, pid) && roll < 0.65) {
    return { type: 'seek', targetId: g.rng.pick(hidden) };
  }
  const rooms = g.roomIds.filter((r) => r !== me.room && !g.isMoveBlocked(pid, r));
  if (rooms.length > 0) return { type: 'move', room: g.rng.pick(rooms) };
  return { type: 'skip' };
}

/** 普通：原策略（残血回复 → 角色特化 → 击杀优先 → 补给/移动 → 躲藏） */
function normalDecide(g: Game, pid: PlayerId): ActionRequest {
  const me = g.players[pid];
  const cd = g.charDef(pid);
  const members = g.roomMembers(me.room).filter((p) => p !== pid);
  const alive = g.aliveIds().filter((p) => p !== pid);

  // 血量低且同房间有威胁 → 优先回复
  if (me.hp < me.maxHp && me.hp <= 1 && members.length > 0) {
    return { type: 'heal' };
  }

  const specialized = cd.aiStrategy?.({
    game: g, difficulty: 'normal', pid, me, st: g.charState(pid), members, alive,
  });
  if (specialized) return specialized;

  // 通用策略：同房间有可见目标 → 优先攻击可击杀目标，否则攻击血量最低者；
  // 只剩躲藏者 → 找出来；满血且无目标 → 移向人多房间；否则回复/躲藏
  const visible = members.filter((m) => !(g.players[m].hidden || g.players[m].invisible));
  if (visible.length > 0) {
    const myAtk = cd.meleeDamage ?? cd.attack ?? g.rules.defaultAttack;
    const killable = visible
      .filter((m) => g.players[m].hp <= myAtk)
      .sort((a, b) => g.players[a].hp - g.players[b].hp)[0];
    const target = killable || visible.sort((a, b) => g.players[a].hp - g.players[b].hp)[0];
    if (target) return { type: 'attack', targetId: target };
  }
  const hidden = seekTargets(g, pid);
  if (visible.length === 0 && hidden.length > 0 && shouldSeekHidden(g, pid)) {
    const target = hidden.sort((a, b) => g.players[a].hp - g.players[b].hp)[0];
    return { type: 'seek', targetId: target };
  }
  if (me.hp < me.maxHp) return { type: 'heal' };
  const roomScores = g.roomIds
    .filter((r) => r !== me.room && !g.isMoveBlocked(pid, r))
    .map((r) => ({ r, n: g.roomMembers(r).length }))
    .sort((a, b) => b.n - a.n);
  if (roomScores.length > 0 && roomScores[0].n > 0) {
    return { type: 'move', room: roomScores[0].r };
  }
  if (g.rules.allowHide && !me.hidden) return { type: 'hide' };
  return { type: 'skip' };
}

/**
 * 硬核：
 *  - 先算「能不能杀人」：同房间可击杀者优先，远程可击杀者也优先（必要时先瞄准）；
 *  - 残血且本房间有人能一击带走自己 → 先把自己救回来（回复/撤离）；
 *  - 无击杀机会时挑威胁最高的目标打，而不是随手打第一个；
 *  - 满血无事可做才移动/躲藏，绝不空过有输出机会的回合。
 */
function hardDecide(g: Game, pid: PlayerId): ActionRequest {
  const me = g.players[pid];
  const cd = g.charDef(pid);
  const st = g.charState(pid);
  const sameRoom = g.roomMembers(me.room).filter((p) => p !== pid);
  const aliveOthers = g.aliveIds().filter((p) => p !== pid);
  const visibleSame = sameRoom.filter((p) => !(g.players[p].hidden || g.players[p].invisible));
  const myAtk = cd.meleeDamage ?? cd.attack ?? g.rules.defaultAttack;
  const domainExempt = cd.aimExemptWhenDomain && st.domain === true;

  const specialized = cd.aiStrategy?.({
    game: g, difficulty: 'hard', pid, me, st, members: sameRoom, alive: aliveOthers,
  });
  if (specialized) return specialized;

  // 1) 能一击带走的目标（同房间）
  const killableNow = visibleSame.filter((m) => g.players[m].hp <= myAtk);
  if (killableNow.length > 0) {
    const target = killableNow.sort((a, b) => threatOf(g, b) - threatOf(g, a))[0];
    return { type: 'attack', targetId: target };
  }

  // 2) 自身危险：同房间有人能一击带走我 → 先保命
  const danger = visibleSame.some((m) => {
    const mcd = g.charDef(m);
    const atk = mcd.meleeDamage ?? mcd.attack ?? g.rules.defaultAttack;
    return atk >= me.hp;
  });
  if (danger && me.hp < me.maxHp) return { type: 'heal' };
  if (danger && sameRoom.length > 0) {
    const safe = g.roomIds.find((r) => r !== me.room && !g.isMoveBlocked(pid, r) && g.roomMembers(r).length === 0);
    if (safe) return { type: 'move', room: safe };
  }

  // 3) 远程击杀（吹箫哥/五条悟等）：能立刻杀掉异房间残血目标则出手
  if (cd.rangedCapable) {
    const rangedDamage = cd.rangedDamage ?? cd.attack ?? g.rules.defaultAttack;
    const rangedTargets = aliveOthers.filter((p) => !g.isSameRoom(pid, p) && !(g.players[p].hidden || g.players[p].invisible));
    const remoteKill = rangedTargets.filter((p) => g.players[p].hp <= rangedDamage);
    const pickRemote = remoteKill.sort((a, b) => threatOf(g, b) - threatOf(g, a))[0];
    if (pickRemote) {
      if (cd.rangedNeedsAim && !domainExempt && st.aim !== pickRemote) {
        return { type: 'aim', targetId: pickRemote };
      }
      return { type: 'attack', targetId: pickRemote, ranged: true };
    }
  }

  // 4) 打房间里威胁最高的目标
  if (visibleSame.length > 0) {
    const target = visibleSame.sort((a, b) => threatOf(g, b) - threatOf(g, a))[0];
    return { type: 'attack', targetId: target };
  }

  // 4b) 同房间只剩躲藏者：找出来解锁下一回合攻击（隐身/无视躲藏角色除外）
  const hidden = seekTargets(g, pid);
  if (hidden.length > 0 && shouldSeekHidden(g, pid)) {
    const target = hidden.sort((a, b) => threatOf(g, b) - threatOf(g, a))[0];
    return { type: 'seek', targetId: target };
  }

  // 5) 房间空了：补血后主动找人（优先人多且有残血的房间）
  if (me.hp < me.maxHp) return { type: 'heal' };
  const rooms = g.roomIds
    .filter((r) => r !== me.room && !g.isMoveBlocked(pid, r))
    .map((r) => {
      const mem = g.roomMembers(r);
      const weak = mem.filter((m) => g.players[m].hp <= myAtk).length;
      return { r, n: mem.length, weak };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => (b.weak - a.weak) || (b.n - a.n));
  if (rooms.length > 0) return { type: 'move', room: rooms[0].r };
  if (g.rules.allowHide && !me.hidden) return { type: 'hide' };
  return { type: 'skip' };
}
