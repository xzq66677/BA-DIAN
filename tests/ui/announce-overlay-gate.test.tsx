// @vitest-environment jsdom
/**
 * 播报闸门回归（Issue #104）：老虎机等 modal 叠加演出进行中，全局播报横幅让位；
 * overlay 退场后按序放行。普通战斗 fx 不拦横幅。
 *
 * 关键时序：同批 room:update 里日志先入队、fx 视图要等队列定时器触发 onEventStart
 * 才出现——闸门用「队列待播 overlay 事件」（overlayPending，同步可见）兜住这个窗口。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useEffect } from 'react';
import { useBattlePresentation } from '../../client/src/battle/useBattlePresentation.js';
import type { BattlePresentation } from '../../client/src/battle/useBattlePresentation.js';
import { isOverlayFx } from '../../client/src/battle/fx-overlays.js';
import { PACE_PROFILES } from '../../client/src/battle/queue.js';
// overlay 注册表由 Game 页的副作用模块填充（老虎机等 modal 演出）
import '../../client/src/battle/presentation-plugins.js';
import type { LogLike } from '../../client/src/battle/events.js';
import type { AnnounceItem } from '../../../shared/src/announce.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); cleanup(); });

function log(seq: number, type: string, data?: Record<string, unknown>): LogLike {
  return { seq, type, text: `t${seq}`, important: false, data };
}

function announce(seq: number, text: string): AnnounceItem {
  return {
    id: `a-${seq}`, seq, ts: Date.now(), round: 1, sub: 0,
    icon: '✨', text, tone: 'action', kind: 'skill', priority: 'normal',
    ttlMs: 1000, rule: 'trigger',
  };
}

let latest: BattlePresentation | null = null;

function Harness(props: { logs: LogLike[]; announces?: AnnounceItem[]; gameNo: number; phase?: 'rps1' | 'act' | 'roundEnd' | 'over' }) {
  const bp = useBattlePresentation(props.logs, props.gameNo, props.phase, undefined, props.announces, PACE_PROFILES.current);
  latest = bp;
  useEffect(() => { void bp; });
  return null;
}

/** 引导游标的填充日志（不产生演出事件）；首个非空包仅推进游标不演出 */
const BOOT = [log(1, 'judge')];

describe('播报闸门：modal 叠加演出期间横幅让位（Issue #104）', () => {
  it('overlay 注册表谓词：老虎机 fx 命中，普通战斗 fx 不命中', () => {
    expect(isOverlayFx('slotPull3')).toBe(true);
    expect(isOverlayFx('slotPull4')).toBe(true);
    expect(isOverlayFx('slotDrop')).toBe(true);
    expect(isOverlayFx('slotPull')).toBe(true);
    expect(isOverlayFx('attack')).toBe(false);
    expect(isOverlayFx('skill')).toBe(false);
    expect(isOverlayFx('unknown')).toBe(false);
  });

  it('同批到达：转轮待播/播放中横幅让位，转轮结束后放行', () => {
    const { rerender } = render(<Harness logs={BOOT} gameNo={1} phase="act" />);
    act(() => { vi.advanceTimersByTime(30); });
    // spin 行动事件 + 结果播报同批到达（真实时序：同一 room:update）
    const logs = [...BOOT, log(2, 'action', { pid: 'A', actionName: 'slotSpin3', fx: 'skill' })];
    const items = [announce(2, '老虎机侠抽到小炸弹')];
    rerender(<Harness logs={logs} announces={items} gameNo={1} phase="act" />);
    // fx 视图尚未出现的窗口（队列已排队 overlay）：横幅不得抢跑
    expect(latest!.pres.globalAnnounce).toBeNull();
    act(() => { vi.advanceTimersByTime(120); });
    // overlay 已开播（fx=slotPull3，由行动注册表解析）
    expect(latest!.pres.fx['A']?.kind).toBe('slotPull3');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(latest!.pres.fx['A']).toBeTruthy(); // 转轮仍在
    expect(latest!.pres.globalAnnounce).toBeNull(); // 播报让位
    // 越过 fx 过期（2200ms）→ overlay 退场 → 横幅放行
    act(() => { vi.advanceTimersByTime(1500); });
    expect(latest!.pres.fx['A']).toBeUndefined();
    expect(latest!.pres.globalAnnounce?.text).toBe('老虎机侠抽到小炸弹');
  });

  it('普通战斗 fx 不拦横幅：行动与播报同批到达时横幅照常即时出现', () => {
    const { rerender } = render(<Harness logs={BOOT} gameNo={1} phase="act" />);
    act(() => { vi.advanceTimersByTime(30); });
    const logs = [...BOOT, log(2, 'action', { pid: 'A', fx: 'attack' })];
    const items = [announce(2, '张三发动攻击')];
    rerender(<Harness logs={logs} announces={items} gameNo={1} phase="act" />);
    act(() => { vi.advanceTimersByTime(60); });
    expect(latest!.pres.fx['A']?.kind).toBe('attack');
    expect(latest!.pres.globalAnnounce?.text).toBe('张三发动攻击');
  });

  it('闸门只推迟不吞横幅：连发多条播报在 overlay 退场后按序播出', () => {
    const { rerender } = render(<Harness logs={BOOT} gameNo={1} phase="act" />);
    act(() => { vi.advanceTimersByTime(30); });
    const logs = [...BOOT, log(2, 'action', { pid: 'A', actionName: 'slotSpin4', fx: 'skill' })];
    const items = [announce(2, '第一条：抽奖'), announce(3, '第二条：炸弹落地')];
    rerender(<Harness logs={logs} announces={items} gameNo={1} phase="act" />);
    act(() => { vi.advanceTimersByTime(3000); }); // 4 格转轮 2800ms 放完
    expect(latest!.pres.fx['A']).toBeUndefined();
    expect(latest!.pres.globalAnnounce?.text).toBe('第一条：抽奖');
    act(() => { vi.advanceTimersByTime(1000); }); // 第一条 ttl 结束
    expect(latest!.pres.globalAnnounce?.text).toBe('第二条：炸弹落地');
    act(() => { vi.advanceTimersByTime(1000); }); // 第二条 ttl 结束
    expect(latest!.pres.globalAnnounce).toBeNull();
  });
});
