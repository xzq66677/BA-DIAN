/**
 * 拔典 · 战斗演出事件解析层
 *
 * 把服务端下发的结构化日志（SnapLog）解析为类型化演出事件（BattleEvent）。
 * 硬约束：
 *  - 只信任日志里的结构化 data 字段，不通过快照 HP 差分或日志文本猜测事件；
 *  - 旧格式/字段缺失时安全降级（返回 null 跳过演出，或退化为行动者提示），
 *    绝不因缺字段抛错或演出错误内容。
 */

import type { SnapLog } from '../net.js';
import { resolveActionPresentation } from './action-presentation.js';

export type PresentationData = Readonly<Record<string, unknown>>;

export interface PresentationMove {
  pid: string;
  fromRoom: string;
  toRoom: string;
  tower?: 'enter' | 'exit';
}

export function presentationMoves(data: PresentationData | undefined): PresentationMove[] {
  if (!Array.isArray(data?.moves)) return [];
  return data.moves.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const { pid, fromRoom, toRoom, tower } = entry as Record<string, unknown>;
    if (typeof pid !== 'string' || typeof fromRoom !== 'string' || typeof toRoom !== 'string') return [];
    return [{ pid, fromRoom, toRoom, tower: tower === 'enter' || tower === 'exit' ? tower : undefined }];
  });
}

/** 最小日志形状（net.ts 的 SnapLog 与测试构造的日志都满足；type 可缺省=旧数据） */
export interface LogLike {
  seq: number;
  type?: string;
  text?: string;
  important?: boolean;
  data?: Record<string, unknown>;
}

export type BattleEventKind =
  | 'action'      // 行动演出前置（行动者卡 fx）
  | 'attackDecl'  // 攻击宣告（出手意向：来源卡短暂攻击姿态）
  | 'area'        // 播报由结构化 AOE 房间衍生的预警
  | 'damage'      // 实际扣血（受击斩击演出）
  | 'heal'        // 回复
  | 'move'        // 移动（from → to）
  | 'eliminate'   // 淘汰
  | 'revive'      // 命数复活
  | 'miss'        // 未命中 / 被抵消
  | 'ivanThrow'   // 大伊万投掷：投掷物从来源飞向目标房间
  | 'ivanBoom'    // 大伊万爆炸：目标房间落点冲击
  | 'towerHit'    // 高塔承受伤害
  | 'towerCollapse' // 高塔耐久归零坍塌
  | 'domain'      // 领域展开（重大事件：爆发 + 聚焦，引擎日志 data.domain=true 标记）
  | 'fortune'     // 今日勇者抽取运势（全局播报；引擎日志 data.fortune=true + roll）
  | 'trigger';    // 技能 / 被动触发

export interface BattleEvent {
  kind: BattleEventKind;
  seq: number;
  /** 演出分组：AOE/多段/延迟伤害共享，同组顺序播放并先突出房间 */
  groupId?: string;
  areaRooms?: string[];
  aoe?: boolean;
  explodeRound?: number;
  /** 行动者 / 移动者 */
  pid?: string;
  /** 服务端权威行动名；由角色注册表解析为视觉 fx。 */
  actionName?: string;
  /** 受击 / 回复 / 淘汰目标 */
  targetId?: string;
  /** 伤害来源 */
  sourceId?: string;
  fx?: string;
  label?: string;
  amount?: number;
  hpBefore?: number;
  hpAfter?: number;
  lethal?: boolean;
  dtype?: string;
  tag?: string;
  segment?: { index: number; total: number };
  /** 事件房间（AOE 房间高亮） */
  room?: string;
  /** 角色演出插件专用的公开数据；各插件自行校验字段 */
  presentation?: PresentationData;
  fromRoom?: string;
  toRoom?: string;
  cause?: string;
  livesLeft?: number;
  /** 今日运势掷点（fortune 事件） */
  roll?: number;
  important?: boolean;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function presentationData(v: unknown): PresentationData | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  return Object.freeze({ ...v as Record<string, unknown> });
}

/**
 * 日志 → 演出事件。返回 null 表示该日志不参与演出
 * （判定/阶段/回合小结等由揭示台与日志面板呈现，不属于战场演出）。
 */
export function parseBattleEvent(log: LogLike): BattleEvent | null {
  const d = (log.data ?? {}) as Record<string, unknown>;
  switch (log.type) {
    case 'action': {
      const pid = str(d.pid);
      if (!pid) return null; // 旧格式无 pid：不演出（日志面板照常显示）
      const actionName = str(d.actionName);
      const registeredFx = actionName ? resolveActionPresentation(actionName)?.fx : undefined;
      return {
        kind: 'action', seq: log.seq, pid,
        actionName,
        fx: registeredFx ?? str(d.fx) ?? 'skill',
        label: str(d.label),
        targetId: str(d.targetId),
        room: str(d.room),
        presentation: presentationData(d.presentation),
        important: log.important,
      };
    }
    case 'damage': {
      // 攻击宣告：扣血事件之前的「出手意向」
      if (d.declared === true) {
        const source = str(d.source);
        const target = str(d.target);
        if (!source || !target) return null;
        return {
          kind: 'attackDecl', seq: log.seq,
          sourceId: source, targetId: target,
          amount: num(d.amount), room: str(d.room),
          presentation: presentationData(d.presentation),
          important: log.important,
        };
      }
      const target = str(d.target);
      // 未命中 / 被抵消：不触发受击演出
      if (d.missed === true) {
        if (!target) return null;
        return {
          kind: 'miss', seq: log.seq, targetId: target,
          sourceId: str(d.source), room: str(d.room),
          dtype: str(d.dtype), tag: str(d.tag),
          groupId: str(d.groupId),
          important: log.important,
        };
      }
      // 结构化扣血事件（演出主体）
      const amount = num(d.amount);
      if (target && amount !== undefined) {
        const hpAfter = num(d.hpAfter);
        return {
          kind: 'damage', seq: log.seq, targetId: target,
          sourceId: str(d.source), amount,
          hpBefore: num(d.hpBefore), hpAfter,
          lethal: d.lethal === true || hpAfter === 0,
          dtype: str(d.dtype), tag: str(d.tag),
          aoe: d.aoe === true,
          segment: (d.segment as { index: number; total: number } | undefined) ?? undefined,
          room: str(d.room),
          groupId: str(d.groupId),
          important: log.important,
        };
      }
      // 旧格式降级：只有 {target, source} 没有数值 → 退化为来源卡的攻击提示（与旧行为一致）
      const source = str(d.source);
      if (source) return { kind: 'action', seq: log.seq, pid: source, fx: 'attack', important: log.important };
      return null;
    }
    case 'heal': {
      const target = str(d.target);
      if (!target) return null; // 旧格式无结构化字段：跳过演出
      return {
        kind: 'heal', seq: log.seq, targetId: target,
        amount: num(d.amount), hpBefore: num(d.hpBefore), hpAfter: num(d.hpAfter),
        important: log.important,
      };
    }
    case 'move': {
      const pid = str(d.pid);
      const to = str(d.to);
      const from = str(d.from);
      if (pid && to && from) {
        return { kind: 'move', seq: log.seq, pid, fromRoom: from, toRoom: to, important: log.important };
      }
      // 旧格式降级：只有 {pid} → 移动者卡提示
      if (pid) return { kind: 'action', seq: log.seq, pid, fx: 'move', important: log.important };
      return null;
    }
    case 'eliminate': {
      const pid = str(d.pid);
      if (!pid) return null;
      return {
        kind: 'eliminate', seq: log.seq, targetId: pid,
        cause: str(d.cause),
        important: true,
      };
    }
    case 'trigger': {
      const pid = str(d.pid);
      const livesLeft = num(d.livesLeft);
      const towerRoom = str(d.tower);
      if (towerRoom && d.towerCollapse === true) {
        return { kind: 'towerCollapse', seq: log.seq, room: towerRoom, important: true };
      }
      if (towerRoom && d.towerHit === true) {
        return {
          kind: 'towerHit', seq: log.seq, room: towerRoom,
          amount: num(d.amount), hpBefore: num(d.hpBefore), hpAfter: num(d.hpAfter),
          important: log.important,
        };
      }
      // 命数复活（ReviveEventData 独有 livesLeft 字段，如五条悟 2 条命）
      if (pid && livesLeft !== undefined) {
        return { kind: 'revive', seq: log.seq, targetId: pid, livesLeft, important: true };
      }
      // 领域展开（引擎 data.domain=true 结构化标记；重大事件，独立于普通技能触发）
      if (pid && d.domain === true) {
        return { kind: 'domain', seq: log.seq, targetId: pid, important: true };
      }
      // 今日勇者抽取运势（引擎 data.fortune=true + roll；全局播报一次）
      if (pid && d.fortune === true) {
        return { kind: 'fortune', seq: log.seq, targetId: pid, roll: num(d.roll), important: true };
      }
      if (pid) return { kind: 'trigger', seq: log.seq, pid, important: log.important };
      return null;
    }
    case 'deferred': {
      // 大伊万演出链（V3）：投掷（pid+room+explodeRound）/ 爆炸（room+source）。
      // 旧格式无 data → 跳过演出（日志面板照常显示），不猜测。
      const room = str(d.room);
      const pid = str(d.pid);
      if (pid && room) {
        return { kind: 'ivanThrow', seq: log.seq, pid, room, explodeRound: num(d.explodeRound), important: true };
      }
      if (room && d.pid === undefined) {
        // 爆炸日志只有 room/source：旧数据若带 source 也只在有 room 时演出落点
        return { kind: 'ivanBoom', seq: log.seq, room, sourceId: str(d.source), important: true };
      }
      return null;
    }
    case 'state': {
      // 未命中/抵消（引擎把 DamageEventData 放在 state 日志上）
      const target = str(d.target);
      if (d.missed === true && target) {
        return {
          kind: 'miss', seq: log.seq, targetId: target,
          sourceId: str(d.source), room: str(d.room),
          dtype: str(d.dtype), tag: str(d.tag),
          groupId: str(d.groupId),
        };
      }
      return null;
    }
    default:
      // judge / phase / order / result / info / deferred / error：不进入战场演出
      return null;
  }
}
