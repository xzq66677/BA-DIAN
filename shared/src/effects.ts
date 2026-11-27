/**
 * 拔典 · 通用状态效果：行动封印
 *
 * 层位置（AGENTS.md「角色公开状态与后续负面状态接口」）：
 *   规则层（本文件：施加 / 查询 / 清理） → 引擎（执行前统一拦截） → 快照（公开投影） → UI（置灰）
 *
 * 设计约束：
 *  - 封印是**跨角色**的通用能力（钥匙等来源），不得在角色定义里写死行动名分支；
 *  - 攻击永远不可封印（规则硬约束）；
 *  - 超时兜底的强制跳过属于引擎行为，不受封印影响（避免对局无限等待）；
 *  - 生命周期：施加 → 生效 → 到期/移除 → 死亡清理。当前规则为永久，见 `ActionLock`。
 */

import type { GameLike } from './chardef.js';
import { acceptsStatuses } from './statuses.js';
import type { ActionLock, ActionResult, PlayerId } from './types.js';

/** 不可封印的行动：攻击（规则硬约束） */
const UNSEALABLE = new Set<string>(['attack']);

/** 基础行动的中文标签（封印菜单展示用，不依赖 label() 的参数） */
const BASE_LABELS: Record<string, string> = {
  move: '移动',
  attack: '攻击',
  heal: '回复',
  hide: '躲藏',
  seek: '找出来',
  aim: '瞄准',
  milk: '喝牛奶',
  skip: '跳过',
};

export interface SealableAction {
  action: string;
  label: string;
}

function locksOf(game: GameLike, pid: PlayerId): ActionLock[] {
  const p = game.players[pid];
  if (!p) return [];
  if (!Array.isArray(p.actionLocks)) p.actionLocks = [];
  return p.actionLocks;
}

/**
 * 该玩家当前**可被封印**的行动清单（只包含此刻确实能用的行动）。
 * UI 用它渲染封印菜单；规则层用它校验合法性，避免封一个该角色根本没有的行动。
 */
export function sealableActions(game: GameLike, pid: PlayerId): SealableAction[] {
  if (!acceptsStatuses(game, pid)) return [];
  const out: SealableAction[] = [];
  const push = (action: string, label: string): void => {
    if (UNSEALABLE.has(action)) return;
    if (out.some((x) => x.action === action)) return;
    out.push({ action, label });
  };

  if (game.rules.allowHide) push('hide', BASE_LABELS.hide);
  if (game.rules.allowSeek) push('seek', BASE_LABELS.seek);
  if (game.rules.allowSkip) push('skip', BASE_LABELS.skip);
  push('move', BASE_LABELS.move);
  push('heal', BASE_LABELS.heal);
  push('milk', BASE_LABELS.milk);

  const cd = game.charDef?.(pid);
  if (cd?.rangedNeedsAim) push('aim', BASE_LABELS.aim);
  // 地图行动（如悬浮遗迹的房间交互）
  const mapActions = (game as GameLike & { map?: { actions?: Map<string, { label: string }> } }).map?.actions;
  if (mapActions) for (const [name, def] of mapActions) push(name, def.label);
  // 角色专属技能
  for (const a of cd?.actions ?? []) push(a.name, a.label);
  return out;
}

/** 查询某人某行动是否已被封印（引擎执行前调用） */
export function sealedAction(game: GameLike, pid: PlayerId, action: string): ActionLock | undefined {
  if (UNSEALABLE.has(action)) return undefined;
  return locksOf(game, pid).find((l) => l.action === action);
}

/**
 * 施加封印。返回 `{ ok: false, error }` 时不修改任何状态（调用方的行动不消耗）。
 */
export function sealAction(
  game: GameLike,
  target: PlayerId,
  action: string,
  source?: PlayerId,
): ActionResult {
  const p = game.players[target];
  if (!p) return { ok: false, error: '目标不存在' };
  if (!p.alive) return { ok: false, error: '目标已淘汰' };
  if (UNSEALABLE.has(action)) return { ok: false, error: '攻击不可封印' };

  const allowed = sealableActions(game, target);
  const entry = allowed.find((a) => a.action === action);
  if (!entry) return { ok: false, error: '该目标无法被封印此行动' };
  if (sealedAction(game, target, action)) return { ok: false, error: `「${entry.label}」已被封印` };

  locksOf(game, target).push({
    action,
    label: entry.label,
    ...(source ? { source } : {}),
    round: game.roundNo,
  });
  return { ok: true };
}

/** 死亡 / 离场清理：封印随持有人退场一并移除（快照不再下发） */
export function clearActionLocks(game: GameLike, pid: PlayerId): void {
  const p = game.players[pid];
  if (p) p.actionLocks = [];
}

/** 回合末递减限时封印（当前规则为永久，保留到期路径供后续扩展） */
export function tickActionLocks(game: GameLike, pid: PlayerId): void {
  const p = game.players[pid];
  if (!p || !Array.isArray(p.actionLocks) || p.actionLocks.length === 0) return;
  const kept: ActionLock[] = [];
  for (const lock of p.actionLocks) {
    if (typeof lock.remainingRounds !== 'number') { kept.push(lock); continue; }
    const left = lock.remainingRounds - 1;
    if (left > 0) kept.push({ ...lock, remainingRounds: left });
    else game.log('state', `${game.getPlayer(pid).name} 的「${lock.label}」封印已到期解除`, undefined, true);
  }
  p.actionLocks = kept;
}
