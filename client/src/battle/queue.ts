/**
 * 拔典 · 战斗演出队列（BattleEventQueue）
 *
 * 职责（任务书 §5）：
 *  1. 消费可见、已去重、具有序号的结构化事件；
 *  2. 类型化事件路由与分簇演出（行动日志作为簇首，其伤害/回复/移动等按序播放）；
 *  3. 顺序演出 + 分组演出（AOE/多段同 groupId 顺序呈现）；
 *  4. 可配置播放速度（1×/2×/4×）、跳过当前簇、跳过全部；
 *  5. 拥堵按「积压时长」自动聚合降级（fast），过载丢弃最旧簇（最新事件永不丢）；
 *  6. 事件幂等：每个日志 seq 最多演出一次；只做视觉呈现，不触发任何规则效果；
 *  7. 快照随时可以反映真实状态，队列只控制演出节奏；
 *  8. 重连/局切换时 initFromLogs / clear 安全清理，不把旧事件演到新局；
 *  9. StrictMode 兼容：dispose 后 revive 可恢复（幂等游标保留）。
 *
 * 与 React 解耦：纯类实现，通过回调通知 UI。
 */

import { parseBattleEvent, type BattleEvent, type LogLike } from './events.js';

export type Speed = 1 | 2 | 4;
/** normal：按事件语义节奏播放；fast：拥堵压缩（跳过低重要度） */
export type QueueMode = 'normal' | 'fast';

/** 一簇 = 一次行动（或一组无行动日志的事件）：簇首为行动卡 fx，其余按序播放 */
export interface EventCluster {
  lead?: BattleEvent;
  events: BattleEvent[];
  /** 入队时确定的播放模式（批次粘滞：不会随队列变浅而变慢） */
  mode: QueueMode;
}

export interface QueueState {
  playing: boolean;
  /** 剩余待播簇数 */
  depth: number;
  mode: QueueMode;
  speed: Speed;
}

/**
 * 拥堵判定：按「待播内容的预计播放时长」而非簇数。
 * AI 局的一次广播天然携带多个行动（服务端 kickAI 批量驱动），簇数多≠拥堵；
 * 只有积压的演出时长超过预算才压缩。过载时**丢弃最旧的簇**（快照始终呈现真实状态），
 * 新到的事件（往往是刚发生的行动/淘汰）永不丢弃。
 */
const FAST_BACKLOG_MS = 9000;
const TURBO_BACKLOG_MS = 22000;

/** normal 模式下的基础演出时长（ms），实际按 speed 缩放 */
const BASE_MS: Record<string, number> = {
  action: 340,
  area: 380,
  attackDecl: 200,
  damage: 640,
  heal: 620,
  move: 600,
  eliminate: 850,
  // S 级演出（Phase D 分级）：关键复活给足金色爆发 + 起身的可读时长
  revive: 820,
  // 今日勇者运势（全局播报一次）：掷点结果需要可读
  fortune: 900,
  miss: 340,
  trigger: 460,
  domain: 850,
  // 重大事件（V3）：投掷飞行与爆炸落点需要可辨认的过程时间
  ivanThrow: 1000,
  ivanBoom: 1100,
};

/** fast 模式下的压缩时长（ms，与速度无关，保证跟上节奏；仍可辨识） */
const FAST_MS = 260;

function eventMs(e: BattleEvent, mode: QueueMode, speed: Speed, reduced: boolean): number {
  if (mode === 'fast') return reduced ? 155 : isMajorEvent(e) ? 320 : FAST_MS;
  let base = BASE_MS[e.kind] ?? 300;
  // 多段伤害段间紧凑（总时长仍覆盖斩击动画）
  if (e.kind === 'damage' && e.segment && e.segment.total > 1) base = 430;
  // 致命伤害衔接淘汰演出，停留更久
  if (e.kind === 'damage' && e.lethal) base = 900;
  if (reduced) base = Math.min(base, 240);
  return Math.round(base / speed);
}

/** 估算一批簇按正常节奏播完所需时长（拥堵判定用；1× 全速估算） */
function estimateMs(clusters: EventCluster[]): number {
  let total = 0;
  for (const c of clusters) {
    if (c.lead) total += BASE_MS[c.lead.kind] ?? 300;
    for (const e of c.events) {
      if (c.mode === 'fast' && droppableInFast(e)) continue;
      total += BASE_MS[e.kind] ?? 300;
      if (e.kind === 'damage' && e.lethal) total += 260;
    }
  }
  return total;
}

/** fast 模式下丢弃的低重要度事件（日志面板仍有完整信息） */
function droppableInFast(e: BattleEvent): boolean {
  return e.kind === 'attackDecl' || e.kind === 'trigger' || e.kind === 'miss';
}

/**
 * 重大演出簇（Phase D 演出分级：S/A 级）。
 * 拥堵丢弃与 fast 压缩时保留：大伊万链 / 淘汰 / 复活 / 领域 / 致命一击是
 * 玩家理解「这局怎么赢的」的关键演出，快照只能呈现结果、无法呈现过程。
 */
function isMajorEvent(e: BattleEvent): boolean {
  return e.kind === 'eliminate' || e.kind === 'revive' || e.kind === 'domain'
    || e.kind === 'ivanThrow' || e.kind === 'ivanBoom' || e.kind === 'fortune'
    || (e.kind === 'damage' && !!e.lethal);
}

function clusterHasMajor(c: EventCluster): boolean {
  const list = c.lead ? [c.lead, ...c.events] : c.events;
  return list.some(isMajorEvent);
}

export interface QueueCallbacks {
  /** 事件演出开始（UI 据此挂载视觉状态；幂等键 = 事件 seq） */
  onEventStart?: (e: BattleEvent, durationMs: number) => void;
  /** 队列被整体清空（跳过全部/局切换）：UI 应清掉全部演出叠加层，直接呈现快照状态 */
  onFlush?: () => void;
  /** 队列状态变化（playing/depth/mode/speed） */
  onState?: (s: QueueState) => void;
}

export class BattleEventQueue {
  private clusters: EventCluster[] = [];
  /** 正在播放中的簇（playNext 时移出队列；skipCurrent 据此丢弃其剩余事件） */
  private current: EventCluster | null = null;
  private nextIndex = 0;
  /** 已消费的最大日志 seq（幂等游标） */
  private seqCursor = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private speed: Speed = 1;
  private reduced = false;
  private disposed = false;
  private cb: QueueCallbacks;
  private state: QueueState = { playing: false, depth: 0, mode: 'normal', speed: 1 };

  constructor(cb: QueueCallbacks = {}) {
    this.cb = cb;
  }

  /** 是否仍有演出进行中（含正在播放的簇与待播队列） */
  isBusy(): boolean {
    return this.clusters.length > 0 || this.current !== null || this.timer !== null;
  }

  /** 当前状态快照（调试/测试观察） */
  getState(): QueueState {
    return { ...this.state };
  }

  /** 系统减少动态效果（prefers-reduced-motion）：时长收敛到最小反馈 */
  setReducedMotion(on: boolean): void {
    this.reduced = on;
  }

  setSpeed(s: Speed): void {
    if (s !== 1 && s !== 2 && s !== 4) return;
    this.speed = s;
    this.emitState();
  }

  getSpeed(): Speed {
    return this.speed;
  }

  /**
   * 以已有日志初始化游标（不演出）：用于组件挂载时已有历史（重连补发/页面恢复），
   * 保证「重连后不重复播放历史演出」。必须先于 pushLogs 调用。
   */
  initFromLogs(logs: LogLike[]): void {
    for (const l of logs) {
      if (l.seq > this.seqCursor) this.seqCursor = l.seq;
    }
  }

  /**
   * 追加日志（增量）。按 seq 去重后解析、分簇、入队并调度播放。
   * 只做演出，不触碰任何游戏状态。
   */
  pushLogs(logs: LogLike[]): void {
    if (this.disposed) return;
    const fresh = Array.from(new Map(logs.filter(l => l.seq > this.seqCursor).map(l => [l.seq, l])).values())
      .sort((a, b) => a.seq - b.seq);
    if (fresh.length === 0) return;
    this.seqCursor = fresh[fresh.length - 1].seq;

    const batch: EventCluster[] = [];
    let events: BattleEvent[] = [];
    for (const l of fresh) {
      if (l.type === 'phase' && events.length) {
        batch.push(...assembleClusters(events));
        events = [];
      }
      const e = parseBattleEvent(l);
      if (e) events.push(e);
    }
    batch.push(...assembleClusters(events));
    if (!batch.length) return;
    // 积压时长（按 1× 正常节奏估算，含正在播放的簇剩余部分）
    const backlog = estimateMs(this.current ? [this.current, ...this.clusters] : this.clusters) + estimateMs(batch);
    let mode: QueueMode = 'normal';
    if (backlog >= TURBO_BACKLOG_MS) {
      // 严重积压（如整局快速打完、慢设备跟不上）：丢弃全部旧积压，
      // 只保留正在播放的簇，新批次以 fast 压缩入队 —— 最新事件仍然有演出，
      // 被丢弃的旧事件其结果已由快照呈现，无信息丢失。
      // Phase D：丢弃旧积压时保留重大簇（大伊万/淘汰/领域/复活/致命）——
      // 被丢弃的普通事件其结果已由快照呈现，但重大事件的过程演出不可再现
      this.clusters = this.clusters.filter(clusterHasMajor);
      mode = 'fast';
    } else if (backlog > FAST_BACKLOG_MS) {
      mode = 'fast';
    }
    for (const c of batch) {
      c.mode = mode;
      if (c.events.length > 160) {
        const opener = c.events.find(event => event.kind === 'area' || event.kind === 'ivanBoom');
        const recent = c.events.slice(-159);
        c.events = opener && !recent.includes(opener) ? [opener, ...recent] : recent;
      }
    }
    this.clusters.push(...batch);
    // 保留上限：入队后积压仍然过大（如一次性收到整局日志）→ 继续丢，保证能追上；
    // 丢弃顺序：优先非重大簇，重大簇耗尽后才丢最旧（避免 S 级演出被积压挤掉）
    while (this.clusters.length > 1 && estimateMs(this.clusters) > TURBO_BACKLOG_MS * 0.5) {
      const dropIdx = this.clusters.findIndex((c) => !clusterHasMajor(c));
      if (dropIdx >= 0) {
        this.clusters.splice(dropIdx, 1);
      } else {
        // Keep major chains compressed and retain a hard ceiling under sustained bursts.
        for (const cluster of this.clusters) cluster.mode = 'fast';
        if (this.remainingEvents().length <= 160) break;
        this.clusters.shift();
      }
    }
    this.emitState();
    if (!this.current && this.timer === null) this.schedule(0);
  }

  /** 跳过当前演出：丢弃播放中簇的剩余事件，立即进入下一簇 */
  skipCurrent(): void {
    this.stopTimer();
    if (this.current) {
      this.current = null;
    } else if (this.clusters.length > 0) {
      this.clusters.shift();
    }
    this.emitState();
    this.cb.onFlush?.();
    this.schedule(0);
  }

  /** 跳过/清空全部剩余演出，立即回到真实状态 */
  skipAll(): void {
    this.stopTimer();
    this.clusters = [];
    this.current = null;
    this.emitState();
    this.cb.onFlush?.();
  }

  /** 局切换/退出时清空（含游标）：不把旧事件演到新局 */
  clear(): void {
    this.stopTimer();
    this.clusters = [];
    this.current = null;
    this.seqCursor = 0;
    this.emitState();
    this.cb.onFlush?.();
  }

  dispose(): void {
    this.disposed = true;
    this.stopTimer();
    this.clusters = [];
    this.current = null;
  }

  /**
   * 重新启用（StrictMode 兼容）：React StrictMode（开发模式）对 effect 的
   * setup → cleanup → setup 双调用会让 cleanup 里的 dispose 标记实例失效，
   * 而随后的 setup 复用同一实例。revive 恢复可用性（幂等游标保留，不回放历史）。
   */
  revive(): void {
    if (!this.disposed) return;
    this.disposed = false;
    this.emitState();
  }

  /** 剩余（待播+播放中）事件数（调试/测试观察） */
  pendingEvents(): number {
    const inFlight = this.current ? this.current.events.length + (this.current.lead ? 1 : 0) : 0;
    return inFlight + this.clusters.reduce((n, c) => n + c.events.length + (c.lead ? 1 : 0), 0);
  }

  /** Ordered events still waiting to be revealed, excluding the beat that already started. */
  remainingEvents(): BattleEvent[] {
    const list = (c: EventCluster) => c.lead ? [c.lead, ...c.events] : c.events;
    const pending = this.current ? list(this.current).slice(this.nextIndex) : [];
    for (const cluster of this.clusters) pending.push(...list(cluster));
    return pending;
  }

  private emitState(): void {
    const mode = this.current ? this.current.mode : this.clusters[0]?.mode ?? 'normal';
    this.state = {
      playing: this.clusters.length > 0 || this.current !== null,
      depth: this.clusters.length,
      mode,
      speed: this.speed,
    };
    this.cb.onState?.(this.state);
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(delay: number): void {
    this.stopTimer();
    if (this.clusters.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null; // 触发后清句柄，isBusy 才能正确归位
      this.playNext();
    }, delay);
  }

  private playNext(): void {
    if (this.disposed || this.clusters.length === 0) {
      this.emitState();
      return;
    }
    const cluster = this.clusters.shift()!;
    this.current = cluster;
    this.nextIndex = 0;
    this.emitState();
    this.playCluster(cluster, cluster.mode, 0);
  }

  /** 顺序播放一簇内的事件，播完调度下一簇 */
  private playCluster(cluster: EventCluster, mode: QueueMode, index: number): void {
    // 簇已被跳过/清空（current 不再指向它）→ 终止递归
    if (this.disposed || this.current !== cluster) return;
    // 簇首（行动 fx）+ 其余事件，构成完整播放序列
    const list = cluster.lead ? [cluster.lead, ...cluster.events] : cluster.events;
    const e = list[index];
    if (!e) {
      // 本簇播完 → 下一簇（微小间隔让两组动作有呼吸感）
      this.current = null;
      if (this.clusters.length > 0) {
        const gap = this.reduced ? 30 : Math.round((mode === 'fast' ? 60 : 160) / this.speed);
        this.schedule(gap);
      } else {
        this.emitState();
      }
      return;
    }
    this.nextIndex = index + 1;
    if (mode === 'fast' && droppableInFast(e)) {
      this.playCluster(cluster, mode, index + 1);
      return;
    }
    const wait = eventMs(e, mode, this.speed, this.reduced);
    this.cb.onEventStart?.(e, wait);
    this.stopTimer();
    this.timer = setTimeout(() => {
      this.timer = null; // 触发后清句柄
      this.playCluster(cluster, mode, index + 1);
    }, wait);
  }
}

/**
 * 分簇：引擎的一次行动按 [事件..., action 日志] 的顺序产出日志，
 * action 事件作为簇首（先播行动者 fx），其余事件按原顺序随后播放。
 * 判定阶段的伤害/淘汰等没有 action 日志，单独成簇。
 */
export function assembleClusters(events: BattleEvent[]): EventCluster[] {
  const clusters: EventCluster[] = [];
  let cur: EventCluster | null = null;
  for (const e of events) {
    if (e.kind === 'action') {
      if (!cur) cur = { events: [], mode: 'normal' };
      cur.lead = e;
      clusters.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { events: [], mode: 'normal' };
    cur.events.push(e);
  }
  if (cur) clusters.push(cur);
  for (const cluster of clusters) {
    const groups = new Map<string, Set<string>>();
    for (const event of cluster.events) {
      if (!event.aoe || !event.room || !event.groupId || event.tag === 'ivan') continue;
      const rooms = groups.get(event.groupId) ?? new Set<string>();
      rooms.add(event.room);
      groups.set(event.groupId, rooms);
    }
    cluster.events = cluster.events.flatMap(event => {
      const rooms = event.groupId && groups.get(event.groupId);
      if (!rooms) return [event];
      groups.delete(event.groupId!);
      return [{ kind: 'area', seq: event.seq, areaRooms: Array.from(rooms) }, event];
    });
  }
  return clusters;
}
