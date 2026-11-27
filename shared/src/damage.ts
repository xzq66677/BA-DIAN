import type { CharDef, GameLike } from './chardef.js';
import { clearDefeatStatusEffects, statusDef } from './statuses.js';
import {
  fmtNum, type AppliedDamage, type DamageEventData, type DamageRequest, type PlayerId, type PlayerStats,
} from './types.js';

/** Resolve damage inside the current action, or queue a judge before settling it. */
export function resolveDamage(game: GameLike, stats: Record<PlayerId, PlayerStats>, req: DamageRequest): AppliedDamage {
  const applied: AppliedDamage = {
    target: req.target, finalTarget: req.target, amount: req.amount,
    lethal: false, missed: false, reflected: false, transferred: false,
  };

  function cancelDamage(): AppliedDamage {
    const data: DamageEventData = {
      target: req.target, source: req.source, missed: true,
      dtype: req.dtype, tag: req.tag, aoe: req.aoe,
      ...(req.groupId ? { groupId: req.groupId } : {}),
    };
    game.log('state', `伤害被完全抵消（目标 ${game.players[req.target]?.name}）`, { ...data });
    applied.missed = true;
    return applied;
  }

  let deferred = false;
  const runHook = (owner: PlayerId, cd: CharDef) => {
    const result = cd.onBeforeDamage?.({ game, req, owner });
    if (typeof result === 'object' && 'deferTo' in result) {
      // Keep hooks and judge requests in seat order, including later defenses.
      game.requestJudge(result.deferTo);
      deferred = true;
    }
    return result;
  };

  // 1. 转移阶段钩子（大贱客吸引全场伤害）
  // 转移阶段钩子不按存活预过滤（如大贱客阵亡后在回合末结算窗口内继续吸收同批爆发伤害），
  // 阵亡语义由钩子自行处理；防御阶段钩子仍仅分发存活角色
  const transferHooks = game.playerIds
    .map((pid) => ({ pid, cd: game.charDef(pid) }))
    .filter(({ cd }) => cd.onBeforeDamage && cd.damageHookStage === 'transfer');
  for (const { pid, cd } of transferHooks) {
    const r = runHook(pid, cd);
    if (r === 'skip') return cancelDamage();
  }

  let tp = game.players[req.target];
  if (!tp || !tp.alive) {
    applied.missed = true;
    return applied;
  }
  applied.transferred = !!req.transferred;
  applied.finalTarget = req.target;

  // 2. 躲避判定：指向性攻击无法命中躲藏/隐身目标
  if ((tp.hidden || tp.invisible) && !req.aoe && !req.ignoreHide && !req.bypassHide) {
    const missData: DamageEventData = {
      target: tp.id, source: req.source, missed: true,
      dtype: req.dtype, tag: req.tag, aoe: req.aoe, room: tp.room,
      ...(req.groupId ? { groupId: req.groupId } : {}),
    };
    game.log('state', `${tp.name} 处于躲藏/隐身，${req.source ? game.players[req.source].name + ' 的' : ''}攻击未命中`, { ...missData });
    applied.missed = true;
    return applied;
  }

  // 3. 防御阶段钩子（马保国太极反弹等）——按座次顺序分派全部存活角色的防御钩子
  const defenseHooks = game.aliveIds()
    .map((pid) => ({ pid, cd: game.charDef(pid) }))
    .filter(({ cd }) => cd.onBeforeDamage && (!cd.damageHookStage || cd.damageHookStage === 'defense'));
  for (const { pid, cd } of defenseHooks) {
    const r = runHook(pid, cd);
    if (r === 'skip') return cancelDamage();
    tp = game.players[req.target];
    if (!tp || !tp.alive) {
      applied.missed = true;
      return applied;
    }
  }
  // 判定挂起（太极）：本次伤害暂不结算，等双方出拳后由角色回调补结算
  if (deferred) {
    applied.deferred = true;
    applied.finalTarget = req.target;
    game.log('state', `${game.players[req.target]?.name ?? req.target} 的伤害结算挂起，等待判定出拳`,
      { pendingJudge: true, target: req.target, source: req.source ?? null }, true);
    return applied;
  }
  applied.reflected = !!req.reflected;
  applied.finalTarget = req.target;

  // 4. 结算
  const before = tp.hp;
  // 秒杀（instakill）：结算时按目标当前血量，避免判定挂起期间回血抵消（精神攻击）
  const amount = req.instakill ? tp.hp : req.amount;
  applied.amount = amount;
  tp.hp = Math.max(0, Math.round((tp.hp - amount) * 10000) / 10000);
  const dmgData: DamageEventData = {
    target: tp.id, source: req.source, amount,
    hpBefore: before, hpAfter: tp.hp, lethal: tp.hp <= 0,
    dtype: req.dtype, tag: req.tag, segment: req.segment,
    aoe: req.aoe, room: tp.room,
    reflected: !!req.reflected, transferred: !!req.transferred,
    ...(req.instakill ? { instakill: true } : {}),
    ...(req.groupId ? { groupId: req.groupId } : {}),
  };
  game.log('damage', `${tp.name} 受到 ${fmtNum(amount)} 伤害（${req.dtype === 'mental' ? '精神' : req.dtype === 'special' ? '特殊' : '物理'}${req.tag ? `·${req.tag}` : ''}${req.instakill ? '·秒杀' : ''}${req.segment ? `·第${req.segment.index}/${req.segment.total}段` : ''}）：${fmtNum(before)} → ${fmtNum(tp.hp)}${req.source ? `（来源 ${game.players[req.source].name}）` : ''}`, { ...dmgData }, true);

  // 战绩：实际掉血量
  const dealt = Math.max(0, before - tp.hp);
  if (stats[tp.id]) stats[tp.id].damageTaken += dealt;
  if (req.source && req.source !== tp.id && stats[req.source]) stats[req.source].damageDealt += dealt;

  // 5. 附加效果（转移伤害不随转移）：状态类效果走状态注册表，未知效果安全降级为日志
  if (req.effects && req.effects.length > 0 && !req.transferred) {
    for (const effect of req.effects) {
      const def = statusDef(effect.kind);
      if (!def) {
        game.log('state', `${tp.name} 获得效果：${effect.kind}`);
        continue;
      }
      game.addStatus(tp.id, {
        kind: effect.kind,
        ...(typeof effect.severity === 'number' ? { severity: effect.severity } : {}),
        remainingRounds: typeof effect.remainingRounds === 'number' ? effect.remainingRounds : null,
        ...(req.source ? { source: req.source } : {}),
      });
    }
  }

  // 6. 淘汰判定：角色可拦截（倒地/复活），否则正常淘汰
  if (tp.hp <= 0) {
    applied.lethal = true;
    const cause = req.tag || 'damage';
    const verdict = game.charDef(tp.id).onLethalDamage?.({ game, player: tp.id, req, cause });
    if (verdict !== 'prevent') {
      // ignoreLives：秒杀类精神攻击无视命数（不触发五条悟式「消耗一条命复活」）
      game.eliminate(tp.id, cause, req.source, { ignoreLives: req.ignoreLives });
    } else {
      clearDefeatStatusEffects(game, tp.id);
      game.checkWin();
    }
  }
  return applied;
}
