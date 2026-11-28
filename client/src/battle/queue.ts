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
import { actionPresentationDuration, isMajorActionPresentation } from './action-presentation.js';
import { isOverlayFx } from './fx-overlays.js';

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
  pace: PaceId;
}

/**
 * 拥堵判定：按「待播内容的预计播放时长」而非簇数。
 * AI 局的一次广播天然携带多个行动（服务端 kickAI 批量驱动），簇数多≠拥堵；
 * 只有积压的演出时长超过预算才压缩。过载时**丢弃最旧的簇**（快照始终呈现真实状态），
 * 新到的事件（往往是刚发生的行动/淘汰）永不丢弃。
 */
/**
 * 演出节奏档位（Pace）。
 *
 * 为什么单独成表：AI 由服务端 `kickAI()` 同步批量驱动，一次广播就可能带来
 * 「一整个 AI 回合」的事件；客户端只能靠时长预算（backlog）决定是否压缩。
 * 时长与阈值散落在代码里时，调一次「AI 太快」要改十几处，还会牵动拥堵判定。
 * 现在所有数字集中在 `PACE_PROFILES`，一处改档即可整体变快/变慢。
 *
 * 切换方式：URL 加 `?pace=relaxed`（或 cinematic / slow / current），
 * 也可以直接改 `DEFAULT_PACE`。默认值即线上表现，改默认 = 改默认手感。
 */
export type PaceId = 'current' | 'relaxed' | 'cinematic' | 'slow';

export interface PaceProfile {
  id: PaceId;
  label: string;
  /** 面板/文档用的口径说明 */
  note: string;
  /** normal 模式各事件基础时长（ms），实际再按 speed 缩放 */
  base: Record<string, number>;
  /** fast（拥堵压缩）模式下的时长 */
  fastMs: number;
  fastMajorMs: number;
  fastReducedMs: number;
  /** prefers-reduced-motion 下的时长上限 */
  reducedCapMs: number;
  /** 多段伤害的段间时长 */
  damageSegmentMs: number;
  /** 致命伤害停留（衔接淘汰演出） */
  damageLethalMs: number;
  /** 簇之间的呼吸间隔 */
  gapMs: number;
  fastGapMs: number;
  /** 积压超过该值 → 压缩为 fast（次要判据：主要看待播条数） */
  fastBacklogMs: number;
  /** 积压超过该值 → 丢弃旧积压 */
  turboBacklogMs: number;
  /**
   * 待播事件数达到该值 → 压缩为 fast。
   *
   * 为什么用「条数」而不是「时长」当主判据：AI 由服务端批量驱动，一次广播就带来
   * 一整轮 AI 行动（十几到几十条），按用户人数不同本就该有不同体量。用时长判据时，
   * 6~10 人的 AI 回合天然超过 9s 预算，于是**每一批 AI 动作都被判为积压**、一律压到
   * 260ms/条 —— 这正是「AI 演出太快、看不清」的根因。改看条数后，正常回合按原速播，
   * 只有真正的洪水（重连补发/整局回放）才压缩。
   */
  fastPendingEvents: number;
  turboPendingEvents: number;
}

const BASE_CURRENT: Record<string, number> = {
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

/** 按比例放大基础时长（阈值也要同步放宽，否则更慢的时长会更容易触发压缩） */
function scaleBase(base: Record<string, number>, k: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k2, v] of Object.entries(base)) out[k2] = Math.round(v * k);
  return out;
}

export const PACE_PROFILES: Record<PaceId, PaceProfile> = {
  current: {
    id: 'current',
    label: '现有速度（1×）',
    note: 'V2 线上表现，未改动基线。',
    base: BASE_CURRENT,
    fastMs: 260,
    fastMajorMs: 320,
    fastReducedMs: 155,
    reducedCapMs: 240,
    damageSegmentMs: 430,
    damageLethalMs: 900,
    gapMs: 160,
    fastGapMs: 60,
    fastBacklogMs: 30000,
    turboBacklogMs: 60000,
    fastPendingEvents: 60,
    turboPendingEvents: 160,
  },
  relaxed: {
    id: 'relaxed',
    label: '舒缓（1.45×）',
    note: '一次攻击 ≈1.7s，够看清「谁打谁、掉多少血」；推荐默认。',
    base: scaleBase(BASE_CURRENT, 1.45),
    fastMs: 380,
    fastMajorMs: 480,
    fastReducedMs: 200,
    reducedCapMs: 300,
    damageSegmentMs: 600,
    damageLethalMs: 1200,
    gapMs: 220,
    fastGapMs: 90,
    fastBacklogMs: 34000,
    turboBacklogMs: 68000,
    fastPendingEvents: 60,
    turboPendingEvents: 160,
  },
  cinematic: {
    id: 'cinematic',
    label: '从容（1.85×）',
    note: '一次攻击 ≈2.2s，带明显停顿，适合大屏/观战。',
    base: scaleBase(BASE_CURRENT, 1.85),
    fastMs: 460,
    fastMajorMs: 600,
    fastReducedMs: 240,
    reducedCapMs: 380,
    damageSegmentMs: 780,
    damageLethalMs: 1550,
    gapMs: 280,
    fastGapMs: 120,
    fastBacklogMs: 38000,
    turboBacklogMs: 76000,
    fastPendingEvents: 56,
    turboPendingEvents: 150,
  },
  slow: {
    id: 'slow',
    label: '慢速（2.3×）',
    note: '一次攻击 ≈2.7s，逐帧可读，回合会明显变长。',
    base: scaleBase(BASE_CURRENT, 2.3),
    fastMs: 560,
    fastMajorMs: 760,
    fastReducedMs: 300,
    reducedCapMs: 460,
    damageSegmentMs: 1000,
    damageLethalMs: 1950,
    gapMs: 360,
    fastGapMs: 150,
    fastBacklogMs: 44000,
    turboBacklogMs: 88000,
    fastPendingEvents: 50,
    turboPendingEvents: 140,
  },
};

/** 默认档位（改这一行 = 改全局手感） */
export const DEFAULT_PACE: PaceId = 'slow';

/** 从 `?pace=` 读取档位（未知值回退默认；SSR/测试环境安全） */
export function resolvePace(raw?: string | null): PaceProfile {
  const id = (raw ?? '').trim() as PaceId;
  return PACE_PROFILES[id] ?? PACE_PROFILES[DEFAULT_PACE];
}

export function paceFromLocation(): PaceProfile {
  if (typeof window === 'undefined' || !window.location) return PACE_PROFILES[DEFAULT_PACE];
  try {
    return resolvePace(new URLSearchParams(window.location.search).get('pace'));
  } catch {
    return PACE_PROFILES[DEFAULT_PACE];
  }
}

export function eventMs(e: BattleEvent, mode: QueueMode, speed: Speed, reduced: boolean, pace: PaceProfile): number {
  if (mode === 'fast') {
    return reduced ? pace.fastReducedMs : isMajorEvent(e) ? pace.fastMajorMs : pace.fastMs;
  }
  let base = pace.base[e.kind] ?? Math.round(300 * (pace.base.action / BASE_CURRENT.action));
  if (e.kind === 'action') {
    const presentationMs = actionPresentationDuration(e.fx);
    if (presentationMs !== undefined) {
      base = Math.round(presentationMs * (pace.base.action / BASE_CURRENT.action));
    }
  }
  // 多段伤害段间紧凑（总时长仍覆盖斩击动画）
  if (e.kind === 'damage' && e.segment && e.segment.total > 1) base = pace.damageSegmentMs;
  // 致命伤害衔接淘汰演出，停留更久
  if (e.kind === 'damage' && e.lethal) base = pace.damageLethalMs;
  if (reduced) base = Math.min(base, pace.reducedCapMs);
  return Math.round(base / speed);
}

/** 估算一批簇按正常节奏播完所需时长（拥堵判定用；1× 全速估算） */
export function estimateMs(clusters: EventCluster[], pace: PaceProfile): number {
  let total = 0;
  for (const c of clusters) {
    if (c.lead) total += pace.base[c.lead.kind] ?? 300;
    for (const e of c.events) {
      if (c.mode === 'fast' && droppableInFast(e)) continue;
      total += pace.base[e.kind] ?? 300;
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
    || (e.kind === 'action' && isMajorActionPresentation(e.fx))
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
  private pace: PaceProfile;
  private cb: QueueCallbacks;
  private state: QueueState = { playing: false, depth: 0, mode: 'normal', speed: 1, pace: 'current' };

  constructor(cb: QueueCallbacks = {}, pace: PaceProfile = PACE_PROFILES.current) {
    this.cb = cb;
    this.pace = pace;
    this.state = { ...this.state, pace: pace.id };
  }

  /** 切换节奏档位（局内可即时生效：只影响后续事件，已在播的这条走完） */
  setPace(pace: PaceProfile): void {
    this.pace = pace;
    this.emitState();
  }

  getPace(): PaceProfile {
    return this.pace;
  }

  /** 是否仍有演出进行中（含正在播放的簇与待播队列） */
  isBusy(): boolean {
    return this.clusters.length > 0 || this.current !== null || this.timer !== null;
  }

  /**
   * 队列中是否存在待播/播放中的 modal 叠加演出（老虎机转轮等，Issue #104）。
   * 同步可见：同批到达的横幅在 overlay 开始前就要让位，不能等 fx 视图出现。
   */
  overlayPending(): boolean {
    for (const cluster of [this.current, ...this.clusters]) {
      if (!cluster) continue;
      if (cluster.lead?.fx && isOverlayFx(cluster.lead.fx)) return true;
      if (cluster.events.some((e) => e.kind === 'action' && !!e.fx && isOverlayFx(e.fx))) return true;
    }
    return false;
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
    const backlog = estimateMs(this.current ? [this.current, ...this.clusters] : this.clusters, this.pace) + estimateMs(batch, this.pace);
    // 待播条数：与房间人数无关的「东西太多」判据（主判据，见 fastPendingEvents 注释）
    const pendingCount = this.pendingEvents() + batch.reduce((n, c) => n + c.events.length + (c.lead ? 1 : 0), 0);
    let mode: QueueMode = 'normal';
    if (pendingCount >= this.pace.turboPendingEvents || backlog >= this.pace.turboBacklogMs) {
      // 严重积压（如整局快速打完、慢设备跟不上）：丢弃全部旧积压，
      // 只保留正在播放的簇，新批次以 fast 压缩入队 —— 最新事件仍然有演出，
      // 被丢弃的旧事件其结果已由快照呈现，无信息丢失。
      // Phase D：丢弃旧积压时保留重大簇（大伊万/淘汰/领域/复活/致命）——
      // 被丢弃的普通事件其结果已由快照呈现，但重大事件的过程演出不可再现
      this.clusters = this.clusters.filter(clusterHasMajor);
      mode = 'fast';
    } else if (pendingCount >= this.pace.fastPendingEvents || backlog > this.pace.fastBacklogMs) {
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
    while (this.clusters.length > 1 && estimateMs(this.clusters, this.pace) > this.pace.turboBacklogMs * 0.5) {
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
      pace: this.pace.id,
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
        const gap = this.reduced ? 30 : Math.round((mode === 'fast' ? this.pace.fastGapMs : this.pace.gapMs) / this.speed);
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
    const wait = eventMs(e, mode, this.speed, this.reduced, this.pace);
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
