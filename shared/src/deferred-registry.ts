/**
 * 拔典 · 延迟事件注册表
 *
 * 引擎只内置历史事件（大伊万 `ivan`、伍六七三刀 `wuliuqi-slash`、通用 `damage`）；
 * 新增角色需要「N 回合后结算」的效果时，通过本注册表登记自己的 kind，
 * 不在 engine.ts 里堆角色分支（AGENTS.md「功能扩展性通用要求」）。
 *
 * priority 与引擎内置顺序同一量纲：0 = 伍六七三刀（最前）、1 = 通用延迟伤害、2 = 大伊万。
 */

import type { GameLike } from './chardef.js';
import type { DeferredEvent } from './types.js';

export type DeferredKindHandler = (game: GameLike, ev: DeferredEvent) => void;

interface RegistryEntry {
  handler: DeferredKindHandler;
  priority: number;
}

const registry = new Map<string, RegistryEntry>();

export function registerDeferredKind(kind: string, handler: DeferredKindHandler, priority = 1): void {
  registry.set(kind, { handler, priority });
}

export function deferredHandler(kind: string): DeferredKindHandler | undefined {
  return registry.get(kind)?.handler;
}

export function deferredPriority(kind: string): number | undefined {
  return registry.get(kind)?.priority;
}
