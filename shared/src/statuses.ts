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
  /** 回合末结算（所有回合，含平局回合）；引擎在每个回合的回合末调用 */
  tick?(ctx: StatusTickCtx): void;
  /** 状态拥有者可用的附加行动 */
  actions?(ctx: StatusActionCtx): CharActionDef[];
  /** 状态移除/持有者淘汰时的清理（引擎调用） */
  cleanup?(ctx: { game: GameLike; owner: PlayerId }): void;
}

export const BURNING_KIND = 'burning';

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

export const STATUS_REGISTRY: Record<string, StatusDef> = {
  [BURNING_KIND]: burning,
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
