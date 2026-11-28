/**
 * 视口/偏好检测 hooks（自 pages/Game.tsx 拆分，Issue #107）。
 */
import { useEffect, useState } from 'react';

// ── 横屏紧凑模式检测（手机横放：高度很小） ────────────────

const COMPACT_QUERY = '(orientation: landscape) and (max-height: 560px)';

// ── reduced-motion 检测（系统减少动态效果） ────────────────

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

export function useReducedMotion(): boolean {
  const [on, setOn] = useState(() => matchMediaSafe(REDUCED_QUERY));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(REDUCED_QUERY);
    const handler = () => setOn(mq.matches);
    handler();
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', handler);
    else if (typeof mq.addListener === 'function') mq.addListener(handler);
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', handler);
      else if (typeof mq.removeListener === 'function') mq.removeListener(handler);
    };
  }, []);
  return on;
}

function matchMediaSafe(q: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(q).matches;
}

export function useCompactLandscape(): boolean {
  const [on, setOn] = useState(() => matchMediaSafe(COMPACT_QUERY));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(COMPACT_QUERY);
    const handler = () => setOn(mq.matches);
    handler();
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', handler);
    else if (typeof mq.addListener === 'function') mq.addListener(handler);
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', handler);
      else if (typeof mq.removeListener === 'function') mq.removeListener(handler);
    };
  }, []);
  return on;
}

const NARROW_QUERY = '(max-width: 900px)';

export function useNarrowScreen(): boolean {
  const [on, setOn] = useState(() => matchMediaSafe(NARROW_QUERY));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(NARROW_QUERY);
    const handler = () => setOn(mq.matches);
    handler();
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', handler);
    else if (typeof mq.addListener === 'function') mq.addListener(handler);
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', handler);
      else if (typeof mq.removeListener === 'function') mq.removeListener(handler);
    };
  }, []);
  return on;
}

/**
 * 3D 模式行动坞「需要本机输入」判定（Issue #110 回归锁定）。
 *
 * battle3d.css 对 `.s3d-mode .action-dock.is-waiting .hand-layout` 施加 display:none——
 * 凡本机需要操作的面板（出拳/排序/判定/暴走选目标）所属阶段必须判为 is-my-turn，
 * 否则面板被整体隐藏。暴走触发阶段此前不在清单内，大屁孩持有者看不到目标按钮。
 */
export function dockNeedsLocalInput(input: {
  /** 行动阶段且轮到本机（myTurnId 非空） */
  myTurn: boolean;
  /** rps1 全员出拳 */
  rps1: boolean;
  /** rps2 排序子轮：本机身份在当前等待组且未提交 */
  orderPendingLocal: boolean;
  /** 技能内判定：本机身份在等待出拳 */
  judgePendingLocal: boolean;
  /** 暴走触发：本机身份是当前暴走权持有者（Issue #110） */
  triggerLocalActor: boolean;
}): boolean {
  return input.myTurn || input.rps1 || input.orderPendingLocal || input.judgePendingLocal || input.triggerLocalActor;
}
