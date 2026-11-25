/**
 * 拔典 · 精神攻击（独立词条）
 *
 * 精神攻击不是「普通攻击的某一种伤害值」，而是一类**独立结算**：
 *  - 直接按目标**当前血量**造成致死伤害（秒杀）。走普通扣血管线，以便复用伤害事件、
 *    战绩统计、演出与淘汰链；但词条语义由本模块统一，不在角色里各写各的。
 *  - **无视躲藏/隐身**（`bypassHide`）：躲起来也躲不掉。
 *  - **无视命数**（`ignoreLives`）：五条悟式「消耗一条命满血复活」不触发，直接淘汰。
 *  - **不被大贱客转移**（伤害管线对 `dtype === 'mental'` 跳过 transfer 阶段）。
 *  - **可被马保国太极判定反弹并反杀**；`noReflect` 的明确不可反弹（如「不讲武德」）。
 *    已被反弹过的伤害带 `reflected` 标记，不再进入太极判定（反弹链终止）。
 *
 * 持有者（截至 2026-11-24）：
 *  - 大贱客·辱骂：同一目标累计 3 次 → 精神致死（tag `insult`）
 *  - 马保国·不讲武德：被击杀后 5 局赢 ≥3 → 带走击杀者（tag `bujiangwude`，noReflect）
 *  - 大屁孩·暴走：判定历史三不同 → 随机一人（tag `berserk`）
 */

import type { GameLike } from './chardef.js';
import type { AppliedDamage, DamageRequest, PlayerId } from './types.js';

/** 精神攻击的固定词条（除目标/来源/标签外的全部字段） */
export const MENTAL_KILL_FLAGS = {
  dtype: 'mental',
  bypassHide: true,
  ignoreLives: true,
  instakill: true, // 结算时按目标当前血量 → 判定挂起期间回血也救不回来
} as const;

export interface MentalKillInput {
  target: PlayerId;
  /** 来源（用于日志 / 战绩 / 太极判定；可为空，如自爆类精神攻击） */
  source?: PlayerId;
  /** 来源标签：`insult` / `bujiangwude` / `berserk` …（写入伤害事件 data.tag） */
  tag: string;
  /** 不可被太极反弹（如「不讲武德」：否则会与自身判定互相抵消） */
  noReflect?: boolean;
  /** 可选叙事日志：结算前写一条 trigger，如「大屁孩暴走：对随机玩家 X 发动精神攻击」 */
  note?: string;
}

/**
 * 精神攻击的唯一入口：伤害 = 目标当前血量（秒杀），并带上完整词条。
 * 角色实现只调用这个函数，不要自己拼 `applyDamage` 字段或直接 `eliminate`。
 */
export function mentalKill(game: GameLike, input: MentalKillInput): AppliedDamage {
  const target = game.players[input.target];
  const amount = target ? Math.max(0, target.hp) : 0;
  if (input.note) {
    game.log('trigger', input.note, {
      mentalKill: true, tag: input.tag, target: input.target, source: input.source ?? null,
    }, true);
  }
  const req: DamageRequest = {
    target: input.target,
    amount,
    source: input.source,
    tag: input.tag,
    ...MENTAL_KILL_FLAGS,
    ...(input.noReflect ? { noReflect: true } : {}),
  };
  return game.applyDamage(req);
}
