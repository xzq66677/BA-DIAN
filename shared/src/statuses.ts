/**
 * 状态效果注册表（持续效果统一入口）。
 *
 * 新增负面状态（燃烧 / 中毒 / 减速…）时：
 *  1. 在本文件注册 `StatusDef`（回合末结算、可提供的行动、清理）；
 *  2. 引擎负责生命周期：施加（`Game.addStatus`）、回合末推进（`tickStatuses`）、
 *     到期移除、死亡清理；
 *  3. `snapshot.ts` 只下发公开字段（`publicStatusEffects`），客户端通过
 *     `client/src/battle/status-readers.ts` 注册读取器。
 *
 * 约束：引擎与 UI 主流程不得为具体状态名写分支；状态差异只允许出现在本注册表
 * 与客户端读取器注册表里。
 */

import type { CharActionDef, GameLike } from './chardef.js';
import { fmtNum, type ActiveStatusEffect, type PlayerId, type PublicStatusEffect } from './types.js';

export interface StatusTickCtx {
  game: GameLike;
  owner: PlayerId;
  effect: ActiveStatusEffect;
}

export interface StatusActionCtx {
  game: GameLike;
  owner: PlayerId;
  effect: ActiveStatusEffect;
}

export interface StatusDef {
  kind: string;
  label: string;
  icon: string;
  immuneTraits?: readonly string[];
  blockedActions?: readonly string[];
  endsOnDefeat?: boolean;
  roomFollower?(game: GameLike, owner: PlayerId, effect: ActiveStatusEffect): PlayerId | undefined;
  /** 回合末结算（所有回合，含平局回合）；引擎在每个回合的回合末调用 */
  tick?(ctx: StatusTickCtx): void;
  /** 状态拥有者可用的附加行动 */
  actions?(ctx: StatusActionCtx): CharActionDef[];
  /** 状态移除/持有者淘汰时的清理（引擎调用；`effect` 在移除前传入，仍含 source/data） */
  cleanup?(ctx: { game: GameLike; owner: PlayerId; effect: ActiveStatusEffect }): void;
}

export const BURNING_KIND = 'burning';
export const POSSESSED_KIND = 'possessed';
export const POSSESSING_KIND = 'possessing';
export const MOUNTED_KIND = 'mounted';

export function statusBlockedActions(effects?: readonly Pick<PublicStatusEffect, 'kind'>[]): string[] {
  return effects?.flatMap(effect => statusDef(effect.kind)?.blockedActions ?? []) ?? [];
}

/** A player can be defeated even when a character rule restores their life. */
export function clearDefeatStatusEffects(game: GameLike, player: PlayerId): void {
  for (const { kind } of [...(game.players[player]?.effects ?? [])]) {
    if (statusDef(kind)?.endsOnDefeat) game.removeStatus(player, kind);
  }
}

function possessionHost(effect?: ActiveStatusEffect): PlayerId | undefined {
  return (effect?.data as { host?: PlayerId } | undefined)?.host;
}

export function acceptsStatuses(game: GameLike, player: PlayerId): boolean {
  return !!game.players[player]?.alive && game.charDef(player).ignoresStatuses?.({ game, player }) !== true;
}

export function acceptsStatusEffect(game: GameLike, player: PlayerId, kind: string): boolean {
  return acceptsStatuses(game, player) &&
    !statusDef(kind)?.immuneTraits?.some(trait => game.charDef(player).traits?.includes(trait));
}

/** 同一房间内、带指定标签的存活角色（状态/环境行动用，避免写死角色 id） */
export function findTraitInRoom(
  game: GameLike,
  room: string,
  trait: string,
  exclude?: PlayerId,
): PlayerId | undefined {
  return game.aliveIds().find((pid) => pid !== exclude
    && game.players[pid].room === room
    && (game.charDef(pid).traits ?? []).includes(trait));
}

/**
 * 燃烧：每回合 0.5 伤害（含平局回合），无限持续，直到目标消耗一次行动扑灭。
 * - 点燃当回合与扑灭当回合不结算（`appliedRound` 保护 + 移除即不发生结算）；
 * - 由状态持有者主动「扑灭」，或同房间燃烧者「引燃骷髅」施加给骷髅躯壳。
 */
const burning: StatusDef = {
  kind: BURNING_KIND,
  label: '燃烧',
  icon: '🔥',
  immuneTraits: ['undead'],
  tick: ({ game, owner, effect }) => {
    const p = game.players[owner];
    if (!p || !p.alive) return;
    if (effect.appliedRound >= game.roundNo) {
      game.log('state', `🔥 ${p.name} 本回合刚被点燃，回合末不结算燃烧伤害`, { pid: owner, effect: BURNING_KIND });
      return;
    }
    const amount = effect.severity ?? 0.5;
    game.log('state', `🔥 ${p.name} 燃烧结算：每回合 ${fmtNum(amount)} 伤害`, { pid: owner, effect: BURNING_KIND, amount }, true);
    // 燃烧不是攻击：不触发反弹/转移类判定
    game.applyDamage({
      target: owner,
      amount,
      source: effect.source,
      dtype: 'special',
      tag: 'burn',
      noReflect: true,
    });
  },
  actions: ({ game, owner, effect }) => {
    const p = game.players[owner];
    if (!p || !p.alive) return [];
    const list: CharActionDef[] = [
      {
        name: 'extinguish',
        label: '扑灭火焰',
        desc: '消耗本次行动熄灭身上的燃烧（本回合不再受到燃烧伤害）。',
        typeLabel: '状态',
        targetHint: 'none',
        validate: (ctx) => (ctx.game.getStatus(ctx.actor, BURNING_KIND) ? null : '当前没有燃烧状态'),
        execute: (ctx) => {
          const removed = ctx.game.removeStatus(ctx.actor, BURNING_KIND);
          if (removed) {
            ctx.game.log('action', `💧 ${ctx.game.players[ctx.actor].name} 扑灭了身上的火焰`, { pid: ctx.actor, effect: BURNING_KIND }, true);
          }
        },
      },
    ];
    // 燃烧的敌人与骷髅躯壳同房间时，可消耗一次行动把火引到骷髅身上
    const skeleton = findTraitInRoom(game, p.room, 'skeleton', owner);
    if (skeleton) {
      list.push({
        name: 'igniteSkeleton',
        label: '引燃骷髅',
        desc: `消耗本次行动，用身上的火焰引燃同房间的 ${game.players[skeleton].name}（使其开始燃烧，每回合受到 ${fmtNum(effect.severity ?? 0.5)} 伤害）。`,
        typeLabel: '状态',
        targetHint: 'sameRoomPlayer',
        validate: (ctx) => {
          const targetId = ctx.params.targetId;
          if (!targetId || !ctx.game.players[targetId]?.alive) return '目标不存在或已淘汰';
          if (!ctx.game.isSameRoom(ctx.actor, targetId)) return '需要与目标同房间';
          if (!(ctx.game.charDef(targetId).traits ?? []).includes('skeleton')) return '只能引燃骷髅躯壳';
          return null;
        },
        execute: (ctx) => {
          const targetId = ctx.params.targetId!;
          ctx.game.addStatus(targetId, {
            kind: BURNING_KIND,
            severity: effect.severity ?? 0.5,
            remainingRounds: null,
            source: ctx.actor,
          });
          ctx.game.log('trigger', `🔥 ${ctx.game.players[ctx.actor].name} 把身上的火焰引到了 ${ctx.game.players[targetId].name} 身上`, { pid: targetId, source: ctx.actor, effect: BURNING_KIND }, true);
        },
      });
    }
    return list;
  },
  cleanup: ({ game, owner }) => {
    game.log('state', `💧 ${game.players[owner]?.name ?? owner} 身上的燃烧消失`, { pid: owner, effect: BURNING_KIND }, false);
  },
};

/**
 * 被附身：每回合 1 点伤害（含平局回合），附身当回合与驱赶当回合不结算；
 * 被附身者可用一次行动「驱逐鬼影」解除。
 */
const possessed: StatusDef = {
  kind: POSSESSED_KIND,
  label: '被附身',
  icon: '👻',
  endsOnDefeat: true,
  roomFollower: (game, owner, effect) => {
    const ghost = effect.source;
    return ghost && possessionHost(game.getStatus(ghost, POSSESSING_KIND)) === owner ? ghost : undefined;
  },
  tick: ({ game, owner, effect }) => {
    const host = game.players[owner];
    if (!host || !host.alive) return;
    const ghost = effect.source;
    if (!ghost || !game.players[ghost]?.alive) {
      // 鬼影已不在场：附身自然消失
      game.removeStatus(owner, POSSESSED_KIND);
      return;
    }
    if (effect.appliedRound >= game.roundNo) {
      game.log('state', `👻 ${host.name} 本回合刚被附身，回合末不结算附身伤害`, { pid: owner, effect: POSSESSED_KIND });
      return;
    }
    const amount = effect.severity ?? 1;
    game.log('state', `👻 ${host.name} 被 ${game.players[ghost].name} 附身，受到 ${fmtNum(amount)} 点伤害`, { pid: owner, source: ghost, effect: POSSESSED_KIND, amount }, true);
    game.log('action', '鬼影吸取', { pid: ghost, targetId: owner, actionName: 'ghostSiphon', fx: 'skill' });
    const applied = game.applyDamage({
      target: owner,
      amount,
      source: ghost,
      dtype: 'special',
      tag: 'possess',
      noReflect: true,
      ignoreHide: true,
    });
    // 附身期间造成的伤害等量给鬼影回血
    if (!applied.missed && !applied.deferred) game.heal(ghost, applied.amount);
  },
  actions: ({ game, owner }) => [{
    name: 'expelGhost',
    label: '驱逐鬼影',
    desc: '消耗本次行动解除附身（本回合不再受到附身伤害）。',
    typeLabel: '状态',
    targetHint: 'none',
    validate: (ctx) => (ctx.game.getStatus(ctx.actor, POSSESSED_KIND) ? null : '当前没有被附身'),
    execute: (ctx) => {
      if (ctx.game.removeStatus(ctx.actor, POSSESSED_KIND)) {
        ctx.game.log('action', `🌫 ${ctx.game.players[ctx.actor].name} 花费一次行动驱散了附身的鬼影`, { pid: ctx.actor, effect: POSSESSED_KIND }, true);
      }
    },
  }],
  cleanup: ({ game, owner, effect }) => {
    // 解除附身：鬼影现形并清除它的「附身中」状态
    const ghost = effect.source;
    if (!ghost || !game.players[ghost]) return;
    const host = possessionHost(game.getStatus(ghost, POSSESSING_KIND));
    if (host && host !== owner) return;
    const gst = game.charState(ghost);
    gst.possessing = null;
    if (game.players[ghost].alive) game.players[ghost].invisible = false;
    game.removeStatus(ghost, POSSESSING_KIND);
    game.log('trigger', `🌫 鬼影 ${game.players[ghost].name} 从 ${game.players[owner]?.name ?? owner} 身上脱离，重新现形`,
      { ghost, host: owner, effect: POSSESSED_KIND }, true);
  },
};

/** 附身中的鬼影随宿主移动，可折磨、操控或主动脱离。 */
const possessing: StatusDef = {
  kind: POSSESSING_KIND,
  label: '附身中',
  icon: '👻',
  endsOnDefeat: true,
  blockedActions: ['attack', 'move', 'hide'],
  actions: ({ game, owner, effect }) => {
    const hostId = (effect.data as { host?: PlayerId } | undefined)?.host;
    if (!hostId || !game.players[hostId]?.alive) return [];
    const host = game.players[hostId];
    return [
      {
        name: 'leavePossession',
        label: '主动脱离',
        desc: '消耗本次行动，解除附身并在宿主所在房间现形。',
        typeLabel: '状态',
        targetHint: 'none',
        execute: (ctx) => { ctx.game.removeStatus(ctx.actor, POSSESSING_KIND); },
      },
      {
        name: 'possessStrike',
        label: '折磨宿主',
        desc: `消耗本次行动：对被附身的 ${host.name} 额外造成 1 点伤害（等量回血给鬼影）。`,
        typeLabel: '状态',
        targetHint: 'none',
        validate: (ctx) => {
          const hid = (ctx.game.getStatus(ctx.actor, POSSESSING_KIND)?.data as { host?: PlayerId } | undefined)?.host;
          if (!hid || !ctx.game.players[hid]?.alive) return '没有可折磨的宿主';
          return null;
        },
        execute: (ctx) => {
          const hid = (ctx.game.getStatus(ctx.actor, POSSESSING_KIND)?.data as { host?: PlayerId } | undefined)?.host;
          if (!hid) return;
          ctx.game.log('damage', `🌫 鬼影折磨 ${ctx.game.players[hid].name}（额外 1 点伤害）`, { pid: hid, source: ctx.actor, effect: POSSESSING_KIND }, true);
          const applied = ctx.game.applyDamage({ target: hid, amount: 1, source: ctx.actor, dtype: 'special', tag: 'possess-extra', noReflect: true, ignoreHide: true });
          if (!applied.missed && !applied.deferred) ctx.game.heal(ctx.actor, applied.amount);
        },
      },
      {
        name: 'possessControl',
        label: '操控宿主',
        desc: `消耗本次行动：操控被附身的 ${host.name} 攻击其同房间的一名玩家（使用宿主自身的攻击力）。`,
        typeLabel: '状态',
        targetHint: 'sameRoomPlayer',
        validate: (ctx) => {
          const hid = (ctx.game.getStatus(ctx.actor, POSSESSING_KIND)?.data as { host?: PlayerId } | undefined)?.host;
          if (!hid || !ctx.game.players[hid]?.alive) return '没有可操控的宿主';
          if (statusBlockedActions(ctx.game.players[hid].effects).includes('attack')) return '宿主当前无法攻击';
          const targetId = ctx.params.targetId;
          if (!targetId || !ctx.game.players[targetId]?.alive) return '目标不存在或已淘汰';
          if (targetId === hid) return '不能操控宿主攻击自己';
          if (targetId === ctx.actor) return '不能操控宿主攻击鬼影自己';
          if (!ctx.game.isSameRoom(hid, targetId)) return '只能操控宿主攻击其同房间目标';
          return null;
        },
        execute: (ctx) => {
          const hid = (ctx.game.getStatus(ctx.actor, POSSESSING_KIND)?.data as { host?: PlayerId } | undefined)?.host;
          const targetId = ctx.params.targetId;
          if (!hid || !targetId) return;
          const hostDef = ctx.game.charDef(hid);
          const amount = hostDef.meleeDamage ?? hostDef.rangedDamage ?? hostDef.attack ?? ctx.game.rules.defaultAttack;
          ctx.game.log('damage', `🌫 鬼影操控 ${ctx.game.players[hid].name} 攻击 ${ctx.game.players[targetId].name}（伤害 ${fmtNum(amount)}）`,
            { pid: targetId, host: hid, source: ctx.actor, effect: POSSESSING_KIND }, true);
          ctx.game.applyDamage({
            target: targetId,
            amount,
            source: hid,
            dtype: hostDef.attackDtype || 'physical',
            tag: 'controlled',
            isAttack: true,
            ...(hostDef.attackEffects && hostDef.attackEffects.length > 0 ? { effects: hostDef.attackEffects } : {}),
          });
        },
      },
    ];
  },
  cleanup: ({ game, owner, effect }) => {
    // 鬼影侧清理：宿主仍有附身状态时一并解除（removeStatus 先行移除，互不递归）
    const hostId = (effect.data as { host?: PlayerId } | undefined)?.host;
    if (!hostId) return;
    if (game.getStatus(hostId, POSSESSED_KIND)?.source === owner) game.removeStatus(hostId, POSSESSED_KIND);
    const gst = game.charState(owner);
    gst.possessing = null;
    if (game.players[owner]?.alive) game.players[owner].invisible = false;
  },
};

/** 骑乘中（狂猎）：攻击强化与位移由角色攻击钩子读取；剩余回合由引擎统一递减 */
const mounted: StatusDef = {
  kind: MOUNTED_KIND,
  label: '骑乘中',
  icon: '🐎',
  cleanup: ({ game, owner }) => {
    const st = game.charState(owner);
    st.mounted = false;
    st.mountExpiresRound = 0;
    if (game.players[owner]?.alive) {
      game.log('trigger', `🐎 ${game.players[owner].name} 结束骑乘，下马`, { pid: owner, effect: MOUNTED_KIND }, true);
    }
  },
};

export const STATUS_REGISTRY: Record<string, StatusDef> = {
  [BURNING_KIND]: burning,
  [POSSESSED_KIND]: possessed,
  [POSSESSING_KIND]: possessing,
  [MOUNTED_KIND]: mounted,
};

export function statusDef(kind: string): StatusDef | undefined {
  return STATUS_REGISTRY[kind];
}

/** 只投影公开字段（快照用）；未知状态安全降级为 kind 本身 */
export function publicStatusEffects(effects?: ActiveStatusEffect[]): PublicStatusEffect[] {
  if (!effects || effects.length === 0) return [];
  return effects.map((effect) => {
    const view: PublicStatusEffect = { kind: effect.kind };
    if (typeof effect.severity === 'number') view.severity = effect.severity;
    if (effect.remainingRounds !== undefined) view.remainingRounds = effect.remainingRounds;
    if (typeof effect.stacks === 'number') view.stacks = effect.stacks;
    if (effect.source) view.source = effect.source;
    return view;
  });
}
