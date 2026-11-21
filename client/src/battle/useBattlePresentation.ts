/**
 * 拔典 · 战斗演出 Hook（React 绑定层）
 *
 * BattleEventQueue 的 React 绑定：
 *  - 订阅队列事件 → 生成带唯一 key 的演出叠加状态（fx / 受击 / 回复 / 移动 / 淘汰 / 复活 / 房间告警）；
 *  - 每个叠加状态带自动过期定时器，动画播完即清理，不残留动画属性；
 *  - 局号变化 / 队列冲刷时清空全部叠加层，保证演出不跨局、可跳过；
 *  - 快照（game.players）始终是显示权威：叠加层只做视觉表现，不篡改状态语义；
 *  - StrictMode 兼容：effect 双调用（setup→cleanup→setup）不会让队列失效。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { BattleEventQueue, type QueueState, type Speed } from './queue.js';
import type { BattleEvent, LogLike } from './events.js';

/** 行动者卡 fx（⚔️/💊/🚶/✨ 弹出动画） */
export interface FxView { kind: string; key: number }

/** 受击斩击演出（伤害数字与 HP 流程全部来自服务端结构化字段） */
export interface HitView {
  key: number;
  amount: number;
  hpBefore?: number;
  hpAfter?: number;
  lethal?: boolean;
  instakill?: boolean;
  dtype?: string;
  tag?: string;
  segment?: { index: number; total: number };
  sourceId?: string;
}

export interface HealView { key: number; amount?: number; hpBefore?: number; hpAfter?: number }
export interface DeathView { key: number; cause?: string }
export interface ReviveView { key: number; livesLeft: number }
export interface ZoneAlertView { key: number; groupId?: string; room: string; kind: 'aoe' | 'ivan' }
export interface MoveBannerView { key: number; pid: string; from: string; to: string }

export interface PresentationState {
  fx: Record<string, FxView>;
  hits: Record<string, HitView>;
  heals: Record<string, HealView>;
  misses: Record<string, { key: number; sourceId?: string }>;
  deaths: Record<string, DeathView>;
  revives: Record<string, ReviveView>;
  zoneAlert: ZoneAlertView | null;
  moveBanner: MoveBannerView | null;
}

export const EMPTY_PRESENTATION: PresentationState = {
  fx: {}, hits: {}, heals: {}, misses: {}, deaths: {}, revives: {}, zoneAlert: null, moveBanner: null,
};

/** 叠加层展示时长（ms，覆盖 CSS 动画全长）；reduced-motion 时缩短 */
const FX_MS = 1400;
const HIT_MS = 1250;
const HEAL_MS = 1200;
const MISS_MS = 900;
const DEATH_MS = 1400;
const REVIVE_MS = 1400;
const ZONE_MS = 1000;
const BANNER_MS = 1300;

export interface BattlePresentationApi {
  setSpeed: (s: Speed) => void;
  skipCurrent: () => void;
  skipAll: () => void;
}

export interface BattlePresentation {
  pres: PresentationState;
  queue: QueueState;
  api: BattlePresentationApi;
}

function reducedMotionPreferred(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * @param logs 全量日志（App 增量合并后的列表）
 * @param gameNo 局号：变化即新一局，清空队列与叠加层（旧事件不演到新局）
 */
export function useBattlePresentation(logs: LogLike[], gameNo?: number): BattlePresentation {
  const [pres, setPres] = useState<PresentationState>(EMPTY_PRESENTATION);
  const [queueState, setQueueState] = useState<QueueState>({ playing: false, depth: 0, mode: 'normal', speed: 1 });
  const queueRef = useRef<BattleEventQueue | null>(null);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  /** 首次收到日志时只推进游标不演出（重连补发/页面恢复不回放历史特效） */
  const bootstrappedRef = useRef(false);
  const gameNoRef = useRef<number | undefined>(undefined);

  // 回调经由 ref 转发，保证队列持有的一直是最新闭包
  const applyEventRef = useRef<(e: BattleEvent) => void>(() => {});
  const flushRef = useRef<() => void>(() => {});

  // 每个组件实例恰好一个队列（懒初始化；不用 useMemo 工厂 —— 其在并发渲染下可能被
  // 重复调用并丢弃结果，会让 effect 的 cleanup dispose 掉仍在使用的实例）
  if (!queueRef.current) {
    queueRef.current = new BattleEventQueue({
      onEventStart: (e) => applyEventRef.current(e),
      onFlush: () => flushRef.current(),
      onState: (s) => setQueueState(s),
    });
  }
  const queue = queueRef.current;

  function clearAllTimers(): void {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current.clear();
  }

  function scheduleExpiry(key: 'fx' | 'hits' | 'heals' | 'misses' | 'deaths' | 'revives' | 'zoneAlert' | 'moveBanner', id: string, ms: number): void {
    const t = setTimeout(() => {
      timersRef.current.delete(t);
      setPres((prev) => {
        if (key === 'zoneAlert') {
          return prev.zoneAlert && id === 'zone' ? { ...prev, zoneAlert: null } : prev;
        }
        if (key === 'moveBanner') {
          return prev.moveBanner && id === 'banner' ? { ...prev, moveBanner: null } : prev;
        }
        const bucket = prev[key] as Record<string, unknown>;
        if (!(id in bucket)) return prev;
        const next = { ...bucket };
        delete next[id];
        return { ...prev, [key]: next };
      });
    }, ms);
    timersRef.current.add(t);
  }

  /** 事件 → 演出叠加状态（key=seq，幂等；同类新事件覆盖旧事件并重播动画） */
  function applyEvent(e: BattleEvent): void {
    setPres((prev) => {
      const next = { ...prev };
      switch (e.kind) {
        case 'action':
        case 'attackDecl': {
          const pid = e.pid ?? e.sourceId;
          if (!pid) break;
          next.fx = { ...prev.fx, [pid]: { kind: e.fx ?? (e.kind === 'attackDecl' ? 'attack' : 'skill'), key: e.seq } };
          scheduleExpiry('fx', pid, e.kind === 'attackDecl' ? 420 : FX_MS);
          break;
        }
        case 'damage': {
          const t = e.targetId!;
          next.hits = { ...prev.hits, [t]: {
            key: e.seq, amount: e.amount ?? 0, hpBefore: e.hpBefore, hpAfter: e.hpAfter,
            lethal: e.lethal, instakill: e.instakill, dtype: e.dtype, tag: e.tag,
            segment: e.segment, sourceId: e.sourceId,
          } };
          scheduleExpiry('hits', t, e.lethal || e.instakill ? HIT_MS + 400 : HIT_MS);
          // AOE/延迟事件组：同组只在首个事件时触发房间告警（不逐目标重播）
          if (e.groupId && e.room && prev.zoneAlert?.groupId !== e.groupId) {
            next.zoneAlert = { key: e.seq, groupId: e.groupId, room: e.room, kind: e.tag === 'ivan' ? 'ivan' : 'aoe' };
            scheduleExpiry('zoneAlert', 'zone', ZONE_MS);
          }
          break;
        }
        case 'heal': {
          const t = e.targetId!;
          next.heals = { ...prev.heals, [t]: { key: e.seq, amount: e.amount, hpBefore: e.hpBefore, hpAfter: e.hpAfter } };
          scheduleExpiry('heals', t, HEAL_MS);
          break;
        }
        case 'miss': {
          const t = e.targetId!;
          next.misses = { ...prev.misses, [t]: { key: e.seq, sourceId: e.sourceId } };
          scheduleExpiry('misses', t, MISS_MS);
          break;
        }
        case 'move': {
          const pid = e.pid!;
          next.moveBanner = { key: e.seq, pid, from: e.fromRoom!, to: e.toRoom! };
          scheduleExpiry('moveBanner', 'banner', BANNER_MS);
          break;
        }
        case 'eliminate': {
          const t = e.targetId!;
          next.deaths = { ...prev.deaths, [t]: { key: e.seq, cause: e.cause } };
          scheduleExpiry('deaths', t, DEATH_MS);
          break;
        }
        case 'revive': {
          const t = e.targetId!;
          next.revives = { ...prev.revives, [t]: { key: e.seq, livesLeft: e.livesLeft ?? 1 } };
          scheduleExpiry('revives', t, REVIVE_MS);
          break;
        }
        case 'trigger':
          // 触发：日志面板有完整信息，战场层不额外阻挡
          break;
      }
      return next;
    });
  }

  applyEventRef.current = applyEvent;
  flushRef.current = () => {
    clearAllTimers();
    setPres({ ...EMPTY_PRESENTATION });
  };

  // 挂载/StrictMode 双调用兼容：每次 setup 先确保队列可用
  useEffect(() => {
    queue.revive();
    const q = queue;
    return () => {
      q.dispose();
      clearAllTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reduced-motion 跟随系统设置
  useEffect(() => {
    queue.setReducedMotion(reducedMotionPreferred());
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = () => queue.setReducedMotion(mq.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, [queue]);

  // 局号变化（重开新局）：清空队列与全部叠加层
  useEffect(() => {
    if (gameNoRef.current !== undefined && gameNo !== undefined && gameNo !== gameNoRef.current) {
      queue.clear();
      clearAllTimers();
      setPres({ ...EMPTY_PRESENTATION });
      bootstrappedRef.current = false;
    }
    if (gameNo !== undefined) gameNoRef.current = gameNo;
  }, [gameNo, queue]);

  // 日志增量 → 队列（首包仅推进游标，不回放历史）
  const lastLenRef = useRef(0);
  useEffect(() => {
    if (!bootstrappedRef.current && logs.length > 0) {
      queue.initFromLogs(logs);
      bootstrappedRef.current = true;
      lastLenRef.current = logs.length;
      return;
    }
    if (logs.length > lastLenRef.current) {
      queue.pushLogs(logs.slice(lastLenRef.current));
      lastLenRef.current = logs.length;
    }
  }, [logs, queue]);

  const api: BattlePresentationApi = useMemo(() => ({
    setSpeed: (s) => queue.setSpeed(s),
    skipCurrent: () => queue.skipCurrent(),
    skipAll: () => queue.skipAll(),
  }), [queue]);

  return { pres, queue: queueState, api };
}
