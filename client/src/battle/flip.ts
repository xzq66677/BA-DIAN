/**
 * 移动演出：卡片跨房间 FLIP 飞行动画（与演出队列解耦的布局动画）。
 *
 * 快照到达时房间成员已经重排（React 直接把卡渲染进新 zone）。
 * 本 hook 在布局提交后测量新旧位置差，用 transform 把卡片从旧位置"放回"再过渡到新位置。
 * 与演出队列解耦：即使队列处于快进/清空状态，移动落位动画依然正确、不会错位。
 */

import { useLayoutEffect, useRef } from 'react';
import type { SnapPlayer } from '../net.js';

const FLIP_MS = 560;

/** @param cardSelector 卡片元素选择器（须带 data-pid 属性）；@param flyingClass 飞行中的样式类 */
export function useCardRoomFlip(
  players: SnapPlayer[],
  reduced: boolean,
  cardSelector = '.zone-cards .ccard[data-pid]',
  flyingClass = 'flip-flying',
): void {
  const prevRef = useRef<Map<string, { x: number; y: number; room: string }>>(new Map());
  useLayoutEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>(cardSelector);
    const next = new Map<string, { x: number; y: number; room: string }>();
    for (const el of cards) {
      const pid = el.getAttribute('data-pid');
      if (!pid) continue;
      const r = el.getBoundingClientRect();
      next.set(pid, { x: r.left + r.width / 2, y: r.top + r.height / 2, room: players.find((p) => p.id === pid)?.room ?? '' });
    }
    const prev = prevRef.current;
    if (!reduced) {
      for (const el of cards) {
        const pid = el.getAttribute('data-pid');
        if (!pid) continue;
        const p = players.find((x) => x.id === pid);
        const old = prev.get(pid);
        if (!old || !p || p.room === old.room || !p.alive) continue;
        const cur = next.get(pid);
        if (!cur) continue;
        const dx = old.x - cur.x;
        const dy = old.y - cur.y;
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
        el.classList.add(flyingClass);
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.style.transition = `transform ${FLIP_MS}ms cubic-bezier(0.22, 0.9, 0.3, 1)`;
            el.style.transform = '';
            setTimeout(() => {
              el.style.transition = '';
              el.style.transform = '';
              el.classList.remove(flyingClass);
            }, FLIP_MS + 60);
          });
        });
      }
    }
    prevRef.current = next;
  }, [players, reduced, cardSelector, flyingClass]);
}
