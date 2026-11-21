// @vitest-environment jsdom
/**
 * 终局延迟呈现（finale gate）回归测试：
 *  - 规则终局（phase='over'）到达时若队列仍有演出 → finaleWaiting=true，终局 UI 不抢断；
 *  - 队列播完 → 驻留后放行（finaleWaiting=false）；
 *  - skipFinaleWait 立即放行（并清空演出叠加层）；
 *  - 兜底上限：演出链异常不清空时，终局 UI 最迟 FINALE_WAIT_MAX_MS 登场（不死锁）；
 *  - 新一局（gameNo 变化）复位等待状态；
 *  - 重连/页面恢复（over 时队列本就空闲）不等待。
 *  注：useBattlePresentation 首包日志只推进游标不演出（重连不回放），测试先引导游标再推增量。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useEffect } from 'react';
import { useBattlePresentation, FINALE_WAIT_MAX_MS } from '../../client/src/battle/useBattlePresentation.js';
import type { BattlePresentation } from '../../client/src/battle/useBattlePresentation.js';
import type { LogLike } from '../../client/src/battle/events.js';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.restoreAllMocks(); cleanup(); });

function log(seq: number, type: string, data?: Record<string, unknown>): LogLike {
  return { seq, type, text: `t${seq}`, important: false, data };
}

let latest: BattlePresentation | null = null;

function Harness(props: { logs: LogLike[]; gameNo: number; phase?: 'rps1' | 'act' | 'roundEnd' | 'over'; kick?: (b: BattlePresentation) => void }) {
  const bp = useBattlePresentation(props.logs, props.gameNo, props.phase);
  latest = bp;
  useEffect(() => { props.kick?.(bp); });
  return null;
}

/** 引导游标的填充日志（不产生演出事件）；首个非空包仅推进游标不演出 */
const BOOT = [log(1, 'judge')];

describe('终局延迟呈现（规则立即结算，终局 UI 等关键演出播完）', () => {
  it('over 到达时队列空闲 → 不等待，终局 UI 立即登场（重连场景）', () => {
    render(<Harness logs={BOOT} gameNo={1} phase="over" />);
    act(() => { vi.advanceTimersByTime(50); });
    expect(latest!.finaleWaiting).toBe(false);
  });

  it('over 到达时队列仍有致命演出链 → 等待；播完+驻留后放行', () => {
    const logs: LogLike[] = [...BOOT];
    let seq = 1;
    for (const t of ['B', 'C']) {
      logs.push(log(++seq, 'damage', { target: t, source: 'A', amount: 3, hpBefore: 3, hpAfter: 0, lethal: true, tag: 'ivan', room: 'R2' }));
    }
    const { rerender } = render(<Harness logs={BOOT} gameNo={1} phase="act" />);
    act(() => { vi.advanceTimersByTime(30); });
    // 推入伤害事件增量（入队后队列开始播放）
    rerender(<Harness logs={logs} gameNo={1} phase="act" />);
    act(() => { vi.advanceTimersByTime(120); });
    expect(latest!.queue.playing || latest!.queue.depth > 0).toBe(true);
    // phase 变 over：应进入终局等待（队列还在播）
    rerender(<Harness logs={logs} gameNo={1} phase="over" />);
    act(() => { vi.advanceTimersByTime(30); });
    expect(latest!.finaleWaiting).toBe(true);
    // 播完（2×致命伤害 900ms+调度间隙 + 驻留 620ms ≈ 2.8s，留足余量）。
    // 注意：advanceTimersByTime 的宏任务循环不让步于 React 微任务调度——effects 在每次
    // advance 结束后才运行，因此必须分步推进，让「驻留放行」定时器有机会被调度并触发。
    for (let i = 0; i < 14; i++) act(() => { vi.advanceTimersByTime(400); });
    expect(latest!.finaleWaiting).toBe(false);
    expect(latest!.queue.playing).toBe(false);
  });

  it('skipFinaleWait 立即放行并清空演出', () => {
    let bp: BattlePresentation | null = null;
    const kick = (b: BattlePresentation) => { bp = b; };
    const logs: LogLike[] = [...BOOT, log(2, 'damage', { target: 'B', source: 'A', amount: 3, hpBefore: 3, hpAfter: 0, lethal: true })];
    const { rerender } = render(<Harness logs={BOOT} gameNo={1} phase="over" kick={kick} />);
    act(() => { vi.advanceTimersByTime(30); });
    rerender(<Harness logs={logs} gameNo={1} phase="over" kick={kick} />);
    act(() => { vi.advanceTimersByTime(80); });
    expect(bp!.finaleWaiting).toBe(true);
    act(() => { bp!.api.skipFinaleWait(); });
    expect(bp!.finaleWaiting).toBe(false);
    expect(bp!.pres.hits['B']).toBeUndefined();
  });

  it('兜底上限：演出链不清空时最迟 FINALE_WAIT_MAX_MS 放行（不死锁）', () => {
    const logs: LogLike[] = [...BOOT, log(2, 'eliminate', { pid: 'B', cause: 'damage' })];
    const { rerender } = render(<Harness logs={BOOT} gameNo={1} phase="over" />);
    act(() => { vi.advanceTimersByTime(30); });
    rerender(<Harness logs={logs} gameNo={1} phase="over" />);
    act(() => { vi.advanceTimersByTime(120); });
    expect(latest!.finaleWaiting).toBe(true);
    act(() => { vi.advanceTimersByTime(FINALE_WAIT_MAX_MS + 300); });
    expect(latest!.finaleWaiting).toBe(false);
  });

  it('新一局（gameNo 变化）复位终局等待', () => {
    const logs: LogLike[] = [...BOOT, log(2, 'eliminate', { pid: 'B', cause: 'damage' })];
    const { rerender } = render(<Harness logs={BOOT} gameNo={1} phase="over" />);
    act(() => { vi.advanceTimersByTime(30); });
    rerender(<Harness logs={logs} gameNo={1} phase="over" />);
    act(() => { vi.advanceTimersByTime(100); });
    expect(latest!.finaleWaiting).toBe(true);
    // 同房间开新局：gameNo+1，队列清空
    rerender(<Harness logs={[]} gameNo={2} phase="rps1" />);
    act(() => { vi.advanceTimersByTime(30); });
    expect(latest!.finaleWaiting).toBe(false);
  });

  it('over 前的正常对局不触发等待', () => {
    const logs: LogLike[] = [...BOOT, log(2, 'damage', { target: 'B', source: 'A', amount: 1, hpBefore: 3, hpAfter: 2 })];
    const { rerender } = render(<Harness logs={BOOT} gameNo={1} phase="act" />);
    act(() => { vi.advanceTimersByTime(30); });
    rerender(<Harness logs={logs} gameNo={1} phase="act" />);
    act(() => { vi.advanceTimersByTime(120); });
    expect(latest!.finaleWaiting).toBe(false);
  });
});
