/**
 * 拔典 3D 战场 · 演出适配层（纯函数，可在 jsdom 单测）
 *
 * 把 useBattlePresentation 的演出叠加状态（pres）在两次渲染间的 diff
 * 转换为有序的场景命令（SceneCommand）。规则：
 *  - 以 key（= 日志 seq）为幂等依据：同一桶同一 key 不重复下发；
 *  - 输出顺序保持桶的语义顺序（宣告 → 行动 → 命中/回复 → 移动 → 淘汰/复活 → 伊万链）；
 *  - 不携带任何规则状态：纯视觉指令，场景层绝不改写游戏状态。
 */

import type { PresentationState } from '../battle/useBattlePresentation.js';

export type SceneCommand =
  | { c: 'attackDecl'; seq: number; sourceId: string; targetId: string; amount?: number; room?: string }
  | { c: 'action'; seq: number; pid: string; fx: string; targetId?: string }
  | { c: 'hit'; seq: number; pid: string; amount: number; hpBefore?: number; hpAfter?: number; lethal?: boolean; segment?: { index: number; total: number }; sourceId?: string; room?: string; tag?: string }
  | { c: 'heal'; seq: number; pid: string; amount?: number }
  | { c: 'miss'; seq: number; pid: string }
  | { c: 'death'; seq: number; pid: string }
  | { c: 'revive'; seq: number; pid: string; livesLeft: number }
  | { c: 'move'; seq: number; pid: string; from: string; to: string }
  | { c: 'ivanThrow'; seq: number; pid: string; room: string }
  | { c: 'ivanBoom'; seq: number; room: string }
  | { c: 'zoneAlert'; seq: number; room: string; kind: 'aoe' | 'ivan' }
  | { c: 'domain'; seq: number; pid: string }
  | { c: 'trigger'; seq: number; pid: string };

function diffBucket<T extends { key: number }>(
  prev: Record<string, T> | undefined,
  next: Record<string, T> | undefined,
  emit: (id: string, v: T) => SceneCommand | null,
  out: SceneCommand[],
): void {
  if (!next) return;
  for (const id of Object.keys(next)) {
    const v = next[id];
    const old = prev?.[id];
    if (old && old.key === v.key) continue;
    const cmd = emit(id, v);
    if (cmd) out.push(cmd);
  }
}

/** pres diff → 场景命令（prev 为上一次渲染的叠加状态） */
export function presToCommands(prev: PresentationState, next: PresentationState): SceneCommand[] {
  const out: SceneCommand[] = [];
  // 1. 攻击宣告（扣血前的出手意向）
  diffBucket(prev.decls, next.decls, (pid, v) => ({
    c: 'attackDecl', seq: v.key, sourceId: pid, targetId: v.targetId, amount: v.amount, room: v.room,
  }), out);
  // 2. 行动姿态
  diffBucket(prev.fx, next.fx, (pid, v) => ({
    c: 'action', seq: v.key, pid, fx: v.kind, targetId: v.targetId,
  }), out);
  // 3. 实际命中 / 回复 / 未命中
  diffBucket(prev.hits, next.hits, (pid, v) => ({
    c: 'hit', seq: v.key, pid, amount: v.amount, hpBefore: v.hpBefore, hpAfter: v.hpAfter,
    lethal: v.lethal, segment: v.segment, sourceId: v.sourceId,
  }), out);
  diffBucket(prev.heals, next.heals, (pid, v) => ({
    c: 'heal', seq: v.key, pid, amount: v.amount,
  }), out);
  diffBucket(prev.misses, next.misses, (pid, v) => ({
    c: 'miss', seq: v.key, pid,
  }), out);
  // 4. 淘汰 / 复活
  diffBucket(prev.deaths, next.deaths, (pid, v) => ({
    c: 'death', seq: v.key, pid,
  }), out);
  diffBucket(prev.revives, next.revives, (pid, v) => ({
    c: 'revive', seq: v.key, pid, livesLeft: v.livesLeft,
  }), out);
  // 5. 移动
  if (next.moveBanner && next.moveBanner.key !== prev.moveBanner?.key) {
    out.push({ c: 'move', seq: next.moveBanner.key, pid: next.moveBanner.pid, from: next.moveBanner.from, to: next.moveBanner.to });
  }
  // 6. 大伊万链（投掷 → 爆炸）
  if (next.ivanThrow && next.ivanThrow.key !== prev.ivanThrow?.key) {
    out.push({ c: 'ivanThrow', seq: next.ivanThrow.key, pid: next.ivanThrow.pid, room: next.ivanThrow.room });
  }
  if (next.ivanBoom && next.ivanBoom.key !== prev.ivanBoom?.key) {
    out.push({ c: 'ivanBoom', seq: next.ivanBoom.key, room: next.ivanBoom.room });
  }
  // 7. 房间告警（AOE 组首目标；ivan 告警由 ivanBoom 覆盖，不重复）
  if (next.zoneAlert && next.zoneAlert.kind === 'aoe' && next.zoneAlert.key !== prev.zoneAlert?.key) {
    out.push({ c: 'zoneAlert', seq: next.zoneAlert.key, room: next.zoneAlert.room, kind: 'aoe' });
  }
  // 8. 领域展开（重大事件：爆发 + 聚焦；穹顶由快照 domainHolder 持续驱动）
  if (next.domainDecl && next.domainDecl.key !== prev.domainDecl?.key) {
    out.push({ c: 'domain', seq: next.domainDecl.key, pid: next.domainDecl.pid });
  }
  return out;
}

/** 命令 → 场景方法调用（场景接口的最小形状，便于测试用录制器替代） */
export interface SceneLike {
  playAttackDecl(sourceId: string, targetId: string): void;
  playAction(pid: string, fx: string, targetId?: string): void;
  playHit(pid: string, o: { amount: number; lethal?: boolean; segment?: { index: number; total: number }; sourceId?: string; room?: string; tag?: string }): void;
  playHeal(pid: string, o: { amount?: number }): void;
  playMiss(pid: string): void;
  playEliminate(pid: string): void;
  playRevive(pid: string, livesLeft: number): void;
  playWalk(pid: string, from: string, to: string): void;
  playIvanThrow(pid: string, room: string): void;
  playIvanBoom(room: string): void;
  playRoomAlert(room: string, kind: 'aoe' | 'ivan'): void;
  playTrigger(pid: string): void;
  playDomain(pid: string): void;
}

export function applyCommands(scene: SceneLike, cmds: SceneCommand[]): void {
  for (const c of cmds) {
    switch (c.c) {
      case 'attackDecl': scene.playAttackDecl(c.sourceId, c.targetId); break;
      case 'action':
        if (c.fx === 'skill') scene.playTrigger(c.pid);
        else scene.playAction(c.pid, c.fx, c.targetId);
        break;
      case 'hit': scene.playHit(c.pid, c); break;
      case 'heal': scene.playHeal(c.pid, c); break;
      case 'miss': scene.playMiss(c.pid); break;
      case 'death': scene.playEliminate(c.pid); break;
      case 'revive': scene.playRevive(c.pid, c.livesLeft); break;
      case 'move': scene.playWalk(c.pid, c.from, c.to); break;
      case 'ivanThrow': scene.playIvanThrow(c.pid, c.room); break;
      case 'ivanBoom': scene.playIvanBoom(c.room); break;
      case 'zoneAlert': scene.playRoomAlert(c.room, c.kind); break;
      case 'domain': scene.playDomain(c.pid); break;
      case 'trigger': scene.playTrigger(c.pid); break;
    }
  }
}
