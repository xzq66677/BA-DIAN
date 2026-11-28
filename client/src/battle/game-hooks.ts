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
