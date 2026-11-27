import type { GameLike } from './chardef.js';
import type { BattleMap } from './maps.js';
import {
  fmtNum, type ActionRequest, type ActionResult, type AttackDeclEventData,
  type HealEventData, type MoveEventData, type PlayerId,
} from './types.js';

export const BASE_ACTIONS = new Map<string, {
  label: (game: GameLike, req: ActionRequest) => string;
  execute: (game: GameLike, pid: PlayerId, req: ActionRequest, map: BattleMap) => ActionResult;
}>([
  ['move', {
    label: (_, req) => `移动到 ${req.room}`,
    execute: actMove,
  }],
  ['attack', {
    label: (game, req) => `攻击 ${req.targetId ? game.players[req.targetId].name : '?'}`,
    execute: actAttack,
  }],
  ['heal', { label: () => '回复', execute: actHeal }],
  ['hide', { label: () => '躲藏', execute: actHide }],
  ['seek', {
    label: (game, req) => `找出来（${req.targetId ? game.players[req.targetId].name : '?'}）`,
    execute: actSeek,
  }],
  ['aim', {
    label: (game, req) => `瞄准（${req.targetId ? game.players[req.targetId].name : '?'}）`,
    execute: actAim,
  }],
  ['milk', { label: () => '喝牛奶（嘲讽）', execute: actMilk }],
  ['skip', {
    label: () => '跳过',
    execute: (game) => game.rules.allowSkip ? { ok: true } : { ok: false, error: '本局不允许跳过' },
  }],
]);

function actMove(game: GameLike, pid: PlayerId, req: ActionRequest, map: BattleMap): ActionResult {
  const p = game.players[pid];
  const room = req.room;
  if (!room || !game.roomIds.includes(room)) return { ok: false, error: `非法目标房间：${room}` };
  const movementError = map.movementError?.(p.room, room);
  if (movementError) return { ok: false, error: movementError };
  const from = p.room;
  const wasInTower = game.isInTower(pid);
  const moves = game.relocatePlayer(pid, room);
  // 离开高塔内部：恢复为普通房间状态（塔仍留在原房间）
  if (wasInTower) {
    game.log('state', `${p.name} 离开高塔内部`);
  }
  if (p.hidden) {
    p.hidden = false;
    game.log('state', `${p.name} 移动后现身（离开躲藏）`);
  }
  const moveData: MoveEventData = { pid, from, to: room, ...(moves.length ? { presentation: { moves } } : {}) };
  game.log('move', `${p.name} 从 ${from} 移动到 ${room}`, { ...moveData }, true);
  return { ok: true };
}

function actAttack(game: GameLike, pid: PlayerId, req: ActionRequest, map: BattleMap): ActionResult {
  const cd = game.charDef(pid);

  // 指定房间的攻击（伍六七）：立刻移动到目标房间，并在下一回合末于该房间砍出三刀。
  // 刀落结算在回合末（见 engine.endRound），先于大伊万爆炸；蓄力回合本人不能行动。
  if (cd.attackRoomHint) {
    const room = req.room;
    if (!room || !game.roomIds.includes(room)) return { ok: false, error: `非法目标房间：${room}` };
    const p = game.getPlayer(pid);
    if (p.room !== room) {
      const movementError = map.movementError?.(p.room, room);
      if (movementError) return { ok: false, error: movementError };
      const from = p.room;
      const moves = game.relocatePlayer(pid, room);
      if (p.hidden) {
        p.hidden = false;
        game.log('state', `${p.name} 移动后现身（离开躲藏）`);
      }
      game.log('move', `${p.name} 从 ${from} 移动到 ${room}（准备三刀）`, { pid, from, to: room, presentation: { moves } }, true);
    }
    game.addDeferred({
      kind: 'wuliuqi-slash', room, source: pid,
      explodeRound: game.roundNo + 1, createdAtRound: game.roundNo,
    });
    game.log('action', `🗡️ ${p.name} 在 ${room} 蓄力：下一回合末将在此房间砍出三刀`, { pid, room }, true);
    return { ok: true };
  }

  const targetId = req.targetId;
  if (!targetId || !game.players[targetId]) return { ok: false, error: '目标不存在' };
  const tp = game.players[targetId];
  if (!tp.alive) return { ok: false, error: '目标已淘汰' };
  if (targetId === pid && !cd.allowSelfAttack) return { ok: false, error: '默认不允许攻击自己' };

  // 角色完全接管攻击（如伍六七AOE、大贱客辱骂）
  if (cd.onAttackAction) {
    return cd.onAttackAction({ game, actor: pid, params: req }, targetId, !!req.ranged);
  }

  const sameRoom = game.isSameRoom(pid, targetId);
  const ranged = req.ranged ?? !sameRoom;
  // 高塔内外隔绝：塔内与塔外不能直接互相攻击（只能靠吸/吹改变位置）
  if (!sameRoom && (game.isInTower(pid) || game.isInTower(targetId))) {
    return { ok: false, error: '高塔内外隔绝，无法直接攻击' };
  }
  const at = cd.attackType || 'both';
  // 远程能力：默认角色仅近战；远程需要角色具备 rangedCapable（吹箫哥/五条悟/老大爷等）
  if (ranged && !cd.rangedCapable) return { ok: false, error: '该角色无法远程攻击' };
  if (!ranged && (at === 'ranged' || at === 'none')) return { ok: false, error: '该角色无法近战攻击' };
  // 房间约束（用户确认规则：远程=异房间、近战=同房间）。不校验时，客户端直接提交 ranged:true
  // 就能对同房间目标造成远程伤害——吹箫哥可绕过「无法近战」，五条悟可把 1 伤的近战换成 2 伤的远程。
  // 例外：rangedSameRoom（如佝偻弓箭手）允许远程打同房间目标。
  if (ranged && sameRoom && !cd.rangedSameRoom) return { ok: false, error: '远程攻击只能针对异房间目标（同房间请用近战）' };

  // 瞄准要求
  if (ranged && cd.rangedNeedsAim && !(cd.aimExemptWhenDomain && game.charState(pid).domain === true)) {
    const aim = game.charState(pid).aim;
    if (aim !== targetId) return { ok: false, error: '需要先瞄准该目标（使用「瞄准」行动）' };
    game.charState(pid).aim = undefined;
  }

  if (cd.validateAttack) {
    const err = cd.validateAttack({ game, actor: pid, target: targetId, ranged });
    if (err) return { ok: false, error: err };
  }

  // 躲藏目标校验（指向性攻击无法锁定躲藏者）
  if ((tp.hidden || tp.invisible) && !cd.ignoreHide) {
    return { ok: false, error: '目标正在躲藏/隐身，无法锁定（AOE 或无视躲避的攻击除外）' };
  }

  const amount = cd.dynamicDamage?.({ game, actor: pid, ranged })
    ?? (ranged
      ? (cd.rangedDamage ?? cd.attack ?? game.rules.defaultAttack)
      : (cd.meleeDamage ?? cd.attack ?? game.rules.defaultAttack));
  const decl: AttackDeclEventData = { declared: true, source: pid, target: targetId, amount, ranged, room: tp.room };
  game.log('damage', `${game.players[pid].name} ${ranged ? '远程' : '近战'}攻击 ${tp.name}（伤害 ${fmtNum(amount)}）`, { ...decl }, true);
  const applied = game.applyDamage({
    target: targetId,
    amount,
    source: pid,
    dtype: cd.attackDtype || 'physical',
    ignoreHide: cd.ignoreHide,
    isAttack: true,
    ...(cd.attackEffects && cd.attackEffects.length > 0 ? { effects: cd.attackEffects } : {}),
  });
  // 命中后的角色回调（如骷髅弓箭手打断对方取箭）；反弹/未命中不触发
  if (!applied.missed && !applied.deferred && applied.finalTarget !== pid) {
    cd.onAttackLanded?.({ game, actor: pid, target: applied.finalTarget });
  }
  return { ok: true };
}

function actHeal(game: GameLike, pid: PlayerId): ActionResult {
  const p = game.players[pid];
  const before = p.hp;
  p.hp = p.maxHp;
  const data: HealEventData = {
    target: pid,
    amount: Math.round((p.hp - before) * 10000) / 10000,
    hpBefore: before, hpAfter: p.hp,
  };
  game.log('heal', `${p.name} 回复：${fmtNum(before)} → ${fmtNum(p.hp)}（满血）`, { ...data }, true);
  return { ok: true };
}

function actHide(game: GameLike, pid: PlayerId): ActionResult {
  const p = game.players[pid];
  if (!game.rules.allowHide) return { ok: false, error: '本局不允许躲藏' };
  if (p.hidden) return { ok: false, error: '已在躲藏状态' };
  p.hidden = true;
  game.log('state', `${p.name} 进入躲藏（指向性攻击无法锁定，AOE 与无视躲避攻击仍可命中）`);
  return { ok: true };
}

function actSeek(game: GameLike, pid: PlayerId, req: ActionRequest): ActionResult {
  const targetId = req.targetId;
  if (!game.rules.allowSeek) return { ok: false, error: '本局不允许找出来' };
  if (!targetId || !game.players[targetId] || !game.players[targetId].alive) return { ok: false, error: '目标不存在或已淘汰' };
  if (!game.isSameRoom(pid, targetId)) return { ok: false, error: '只能找出同房间内躲藏的玩家' };
  const tp = game.players[targetId];
  if (!tp.hidden) return { ok: false, error: '目标未躲藏' };
  tp.hidden = false;
  game.log('state', `${game.players[pid].name} 将 ${tp.name} 找了出来（现身）`);
  return { ok: true };
}

/** 瞄准（基础行动）：远程需瞄准的角色使用 */
function actAim(game: GameLike, pid: PlayerId, req: ActionRequest): ActionResult {
  const cd = game.charDef(pid);
  if (!cd.rangedNeedsAim) return { ok: false, error: '该角色无需瞄准' };
  const targetId = req.targetId;
  if (!targetId || !game.players[targetId] || !game.players[targetId].alive) return { ok: false, error: '瞄准目标不存在或已淘汰' };
  if (targetId === pid) return { ok: false, error: '不能瞄准自己' };
  game.charState(pid).aim = targetId;
  game.log('state', `${game.players[pid].name} 瞄准了 ${game.players[targetId].name}`);
  return { ok: true };
}

/** 喝牛奶：嘲讽性质，无实际作用（用户确认） */
function actMilk(game: GameLike, pid: PlayerId): ActionResult {
  game.log('action', `${game.players[pid].name} 喝了一口牛奶，向在场所有人发出嘲讽 🥛（无实际效果）`, undefined, true);
  return { ok: true };
}
