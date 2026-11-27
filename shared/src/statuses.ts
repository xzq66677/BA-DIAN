/**
 * 拔典 · 通用玩家状态（公开状态层）
 *
 * 与角色 `char` 私有状态的区别：这里的状态**可以施加在任何玩家身上**（不论角色），
 * 并且必须遵循 AGENTS.md 的生命周期要求：施加 → 生效 → 到期/移除 → 死亡清理。
 *
 * 状态本身不知道任何业务细节；「状态在什么时机做什么」由注册的处理器决定
 * （见 `registerStatusJudgeHandler`），引擎只负责在对应时机遍历分发，
 * 因此新增状态不需要改引擎，也不需要在引擎里写状态名分支。
 */

import type { GameLike } from './chardef.js';
import type { JudgeStep, PlayerId, PlayerStatus } from './types.js';

/** 状态在「判定追加」时机的处理器 */
export type StatusJudgeHandler = (
  game: GameLike,
  pid: PlayerId,
  ctx: { step: JudgeStep; stage: 'rps1' | 'rps2'; sub: number },
) => void;

const judgeHandlers = new Map<string, StatusJudgeHandler>();

/** 注册某状态在判定结算后的行为 */
export function registerStatusJudgeHandler(kind: string, handler: StatusJudgeHandler): void {
  judgeHandlers.set(kind, handler);
}

function listOf(game: GameLike, pid: PlayerId): PlayerStatus[] {
  const p = game.players[pid];
  if (!p) return [];
  if (!Array.isArray(p.statuses)) p.statuses = [];
  return p.statuses;
}

export function statusesOf(game: GameLike, pid: PlayerId): PlayerStatus[] {
  return listOf(game, pid);
}

export function hasStatus(game: GameLike, pid: PlayerId, kind: string): boolean {
  return listOf(game, pid).some((s) => s.kind === kind);
}

/** 施加状态（同一 kind 默认不重复叠加；`stackable` 时追加） */
export function addStatus(
  game: GameLike,
  pid: PlayerId,
  status: Omit<PlayerStatus, 'round'> & { round?: number },
): PlayerStatus | null {
  const p = game.players[pid];
  if (!p || !p.alive) return null;
  const list = listOf(game, pid);
  if (!status.stackable && list.some((s) => s.kind === status.kind)) return null;
  const entry: PlayerStatus = { ...status, round: status.round ?? game.roundNo };
  list.push(entry);
  return entry;
}

export function removeStatus(game: GameLike, pid: PlayerId, kind: string): void {
  const p = game.players[pid];
  if (!p) return;
  p.statuses = listOf(game, pid).filter((s) => s.kind !== kind);
}

/** 回合末递减限时状态（当前状态均为永久，保留到期路径） */
export function tickStatuses(game: GameLike, pid: PlayerId): void {
  const p = game.players[pid];
  if (!p || !Array.isArray(p.statuses) || p.statuses.length === 0) return;
  const kept: PlayerStatus[] = [];
  for (const s of p.statuses) {
    if (typeof s.remainingRounds !== 'number') { kept.push(s); continue; }
    const left = s.remainingRounds - 1;
    if (left > 0) kept.push({ ...s, remainingRounds: left });
    else game.log('state', `${game.getPlayer(pid).name} 的「${s.label ?? s.kind}」已到期`, undefined, true);
  }
  p.statuses = kept;
}

/** 死亡清理 */
export function clearStatuses(game: GameLike, pid: PlayerId): void {
  const p = game.players[pid];
  if (p) p.statuses = [];
}

/** 判定追加后的统一分发（引擎调用；无处理器时静默跳过） */
export function dispatchStatusJudge(
  game: GameLike,
  pid: PlayerId,
  ctx: { step: JudgeStep; stage: 'rps1' | 'rps2'; sub: number },
): void {
  for (const s of [...listOf(game, pid)]) {
    judgeHandlers.get(s.kind)?.(game, pid, ctx);
  }
}
