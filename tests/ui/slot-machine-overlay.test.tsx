// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FxOverlayHost, fxOverlayView, type FxOverlayView } from '../../client/src/battle/fx-overlays.js';
import { parseBattleEvent } from '../../client/src/battle/events.js';
import {
  normalizeSlotReels,
  previewSlotReels,
  SLOT_SYMBOLS,
  slotSymbolForDigit,
  type SlotReels,
} from '../../client/src/battle/slot-machine-reels.js';
import '../../client/src/battle/slot-machine-overlay.js';

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => true) });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function view(kind = 'slotPull', key = 7, reels?: SlotReels): FxOverlayView {
  return { key, kind, pid: 'A', playerName: '阿机', room: '东房', durationMs: kind === 'slotPull' ? 2600 : 2200, reels };
}

function host(overrides: Partial<Parameters<typeof FxOverlayHost>[0]> = {}) {
  const props: Parameters<typeof FxOverlayHost>[0] = {
    views: [view()],
    mode: '2d',
    interactive: true,
    reducedMotion: false,
    ...overrides,
  };
  return render(<FxOverlayHost {...props} />);
}

function pointer(type: string, clientY = 0, pointerId = 1) {
  const button = screen.getByRole('button', { name: '拉动老虎机拉杆' });
  fireEvent[type as 'pointerDown'](button, { pointerId, clientY, button: 0 });
}

describe('老虎机数字与符号', () => {
  it('按 0、1–3、4–7、8–9 映射钥匙、金钱、炸弹和攻击', () => {
    const expected = ['key', 'money', 'money', 'money', 'bomb', 'bomb', 'bomb', 'bomb', 'attack', 'attack'];
    expect(Array.from({ length: 10 }, (_, digit) => slotSymbolForDigit(digit).kind)).toEqual(expected);
    expect(SLOT_SYMBOLS.map((symbol) => symbol.label)).toEqual(['钥匙', '金钱', '炸弹', '攻击']);
  });

  it('校验服务端三位数字并拒绝旧格式或越界数据', () => {
    expect(normalizeSlotReels([0, 3, 9])).toEqual([0, 3, 9]);
    expect(normalizeSlotReels([0, 3])).toBeNull();
    expect(normalizeSlotReels([0, 10, 9])).toBeNull();
    expect(normalizeSlotReels([0, 3.5, 9])).toBeNull();
    expect(normalizeSlotReels('039')).toBeNull();
  });

  it('预览数字保持 0–9 且同一事件可复现', () => {
    expect(previewSlotReels(42)).toEqual(previewSlotReels(42));
    for (let key = 0; key < 100; key += 1) {
      expect(previewSlotReels(key).every((digit) => digit >= 0 && digit <= 9)).toBe(true);
    }
  });

  it('每个卷轴同时显示权威数字、对应图标和图例', () => {
    host({ views: [view('slotPull', 1, [0, 3, 8])] });
    const reels = [...document.querySelectorAll<HTMLElement>('.slot-reel')];
    expect(reels.map((reel) => reel.dataset.digit)).toEqual(['0', '3', '8']);
    expect(reels.map((reel) => reel.dataset.symbol)).toEqual(['key', 'money', 'attack']);
    reels.forEach((reel) => {
      expect(reel.querySelector('.slot-reel-cell:nth-child(2) strong')?.textContent).toBe(reel.dataset.digit);
      expect(reel.querySelector('.slot-reel-cell:nth-child(2) .slot-symbol-icon')?.getAttribute('data-symbol')).toBe(reel.dataset.symbol);
    });
    expect(screen.getByRole('list', { name: '老虎机数字符号对照' }).textContent).toContain('1–3金钱');
    expect(screen.getByTestId('slot-pull-overlay').dataset.reelSource).toBe('event');
  });

  it('结构化日志传递 reels，缺失时安全使用预览数字', () => {
    const event = parseBattleEvent({ seq: 9, type: 'action', data: { pid: 'A', fx: 'slotPull', reels: [1, 4, 9] } });
    expect(event?.reels).toEqual([1, 4, 9]);
    expect(fxOverlayView({ kind: 'slotPull', key: 9, reels: event?.reels }).reels).toEqual([1, 4, 9]);

    cleanup();
    host({ views: [view('slotPull', 42)] });
    expect(screen.getByTestId('slot-pull-overlay').dataset.reelSource).toBe('preview');
    expect([...document.querySelectorAll<HTMLElement>('.slot-reel')].map((reel) => Number(reel.dataset.digit))).toEqual(previewSlotReels(42));
  });
});

describe('中央老虎机手动拉杆', () => {
  it('点击拉杆只提交一次并进入卷轴演出', () => {
    const onPull = vi.fn();
    host({ onPull });
    expect(screen.getByTestId('slot-pull-overlay').dataset.phase).toBe('idle');
    pointer('pointerDown', 100);
    pointer('pointerUp', 100);
    expect(onPull).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('slot-pull-overlay').dataset.phase).toBe('spinning');
    expect((screen.getByRole('button', { name: '拉动老虎机拉杆' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('足够距离的拖动完成，短拖动回弹且不提交', () => {
    const onPull = vi.fn();
    host({ onPull });
    pointer('pointerDown', 20);
    pointer('pointerMove', 60);
    pointer('pointerUp', 60);
    expect(onPull).toHaveBeenCalledTimes(1);

    cleanup();
    onPull.mockClear();
    host({ onPull });
    pointer('pointerDown', 20);
    pointer('pointerMove', 30);
    pointer('pointerUp', 30);
    expect(onPull).not.toHaveBeenCalled();
    expect(screen.getByTestId('slot-pull-overlay').dataset.phase).toBe('idle');
  });

  it('pointer cancel、窗口失焦和取消按钮都不会提交', () => {
    const onPull = vi.fn();
    const onCancel = vi.fn();
    const first = host({ onPull, onCancel });
    pointer('pointerDown', 10);
    pointer('pointerCancel', 20);
    expect(onPull).not.toHaveBeenCalled();
    pointer('pointerDown', 10);
    fireEvent.blur(window);
    expect(onPull).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消演出' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    first.unmount();
  });

  it('普通卷轴演出在结果阶段后仍按注册时长完成', () => {
    const onComplete = vi.fn();
    host({ onComplete });
    pointer('pointerDown', 100);
    pointer('pointerUp', 100);
    act(() => { vi.advanceTimersByTime(1900); });
    expect(screen.getByTestId('slot-pull-overlay').dataset.phase).toBe('result');
    expect(onComplete).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(700); });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('键盘激活与 reduced-motion 完成后清理', () => {
    const onPull = vi.fn();
    const onComplete = vi.fn();
    host({ onPull, onComplete, reducedMotion: true });
    const button = screen.getByRole('button', { name: '拉动老虎机拉杆' });
    fireEvent.click(button, { detail: 0 });
    expect(onPull).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(520); });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('老虎机从天而降', () => {
  it('自动播放并在 reduced-motion 下缩短停留', () => {
    const onComplete = vi.fn();
    host({ views: [view('slotDrop')], interactive: false, reducedMotion: true, onComplete });
    const overlay = screen.getByTestId('slot-drop-overlay');
    expect(overlay.dataset.reducedMotion).toBe('1');
    expect(overlay.textContent).toContain('东房');
    act(() => { vi.advanceTimersByTime(700); });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('未知 FX 安全忽略', () => {
    host({ views: [view('future-unknown-fx')] });
    expect(screen.queryByTestId('slot-pull-overlay')).toBeNull();
    expect(screen.queryByTestId('slot-drop-overlay')).toBeNull();
  });
});
