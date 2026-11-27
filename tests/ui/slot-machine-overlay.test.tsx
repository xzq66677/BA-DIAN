// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FxOverlayHost, fxOverlayView, registerFxOverlay, type FxOverlayView } from '../../client/src/battle/fx-overlays.js';
import { parseBattleEvent } from '../../client/src/battle/events.js';
import {
  normalizeSlotReels,
  previewSlotReels,
  SLOT_SYMBOLS,
  slotSymbolForDigit,
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

function view(kind = 'slotPull', key = 7, presentation?: FxOverlayView['presentation']): FxOverlayView {
  return { key, kind, pid: 'A', playerName: '阿机', room: '东房', durationMs: kind === 'slotPull' ? 2600 : 2200, presentation };
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

describe('通用角色演出插件', () => {
  it('任意角色只需注册 fx 组件并接收公开数据', () => {
    registerFxOverlay('future-character-fx', ({ view, onSubmit }) => (
      <button type="button" onClick={onSubmit}>{String(view.presentation?.label)}</button>
    ));
    const onSubmit = vi.fn();
    host({ views: [view('future-character-fx', 1, { label: '新角色技能' })], onSubmit });
    fireEvent.click(screen.getByRole('button', { name: '新角色技能' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});

describe('老虎机数字与符号', () => {
  it('按 0、1–3、4–7、8–9 映射钥匙、金钱、炸弹和攻击', () => {
    const expected = ['key', 'money', 'money', 'money', 'bomb', 'bomb', 'bomb', 'bomb', 'attack', 'attack'];
    expect(Array.from({ length: 10 }, (_, digit) => slotSymbolForDigit(digit).kind)).toEqual(expected);
    expect(SLOT_SYMBOLS.map((symbol) => symbol.label)).toEqual(['钥匙', '金钱', '炸弹', '攻击']);
  });

  it('校验服务端三位或四位数字并拒绝旧格式或越界数据', () => {
    expect(normalizeSlotReels([0, 3, 9])).toEqual([0, 3, 9]);
    expect(normalizeSlotReels([0, 3, 8, 9])).toEqual([0, 3, 8, 9]);
    expect(normalizeSlotReels([0, 3])).toBeNull();
    expect(normalizeSlotReels([0, 3, 8, 9, 1])).toBeNull();
    expect(normalizeSlotReels([0, 10, 9])).toBeNull();
    expect(normalizeSlotReels([0, 3.5, 9])).toBeNull();
    expect(normalizeSlotReels('039')).toBeNull();
  });

  it('预览数字保持 0–9、指定卷轴数且同一事件可复现', () => {
    for (const count of [3, 4] as const) {
      expect(previewSlotReels(42, count)).toHaveLength(count);
      expect(previewSlotReels(42, count)).toEqual(previewSlotReels(42, count));
      for (let key = 0; key < 100; key += 1) {
        expect(previewSlotReels(key, count).every((digit) => digit >= 0 && digit <= 9)).toBe(true);
      }
    }
    expect(previewSlotReels(42, 4).slice(0, 3)).toEqual(previewSlotReels(42, 3));
  });

  it.each([[0, 3, 8], [0, 3, 8, 9]])('每个卷轴同时显示权威数字、对应图标和图例：%j', (...reels) => {
    host({ views: [view('slotPull', 1, { reels })] });
    const displayed = [...document.querySelectorAll<HTMLElement>('.slot-reel')];
    expect(displayed.map((reel) => reel.dataset.digit)).toEqual(reels.map(String));
    expect(displayed.map((reel) => reel.dataset.symbol)).toEqual(['key', 'money', 'attack', ...(reels.length === 4 ? ['attack'] : [])]);
    displayed.forEach((reel) => {
      expect(reel.querySelector('.slot-reel-cell:nth-child(2) strong')?.textContent).toBe(reel.dataset.digit);
      expect(reel.querySelector('.slot-reel-cell:nth-child(2) .slot-symbol-icon')?.getAttribute('data-symbol')).toBe(reel.dataset.symbol);
    });
    expect(screen.getByRole('list', { name: '老虎机数字符号对照' }).textContent).toContain('1–3金钱');
    expect(screen.getByTestId('slot-pull-overlay').dataset.reelSource).toBe('event');
    expect((screen.getByRole('button', { name: '3 数字' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '4 数字' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('预览可切换三位与四位模式，非法卷轴数安全降级', () => {
    host();
    fireEvent.click(screen.getByRole('button', { name: '4 数字' }));
    expect(document.querySelectorAll('.slot-reel')).toHaveLength(4);
    expect(screen.getByTestId('slot-pull-overlay').dataset.reelCount).toBe('4');
    fireEvent.click(screen.getByRole('button', { name: '3 数字' }));
    expect(document.querySelectorAll('.slot-reel')).toHaveLength(3);
    cleanup();
    host({ views: [view('slotPull', 42, { reelCount: 99 })] });
    expect(document.querySelectorAll('.slot-reel')).toHaveLength(3);
  });

  it('结构化日志传递角色公开数据，缺失时安全使用预览数字', () => {
    const event = parseBattleEvent({ seq: 9, type: 'action', data: { pid: 'A', fx: 'slotPull', presentation: { reels: [1, 4, 9] } } });
    expect(event?.presentation?.reels).toEqual([1, 4, 9]);
    expect(fxOverlayView({ kind: 'slotPull', key: 9, presentation: event?.presentation }).presentation?.reels).toEqual([1, 4, 9]);

    cleanup();
    host({ views: [view('slotPull', 42)] });
    expect(screen.getByTestId('slot-pull-overlay').dataset.reelSource).toBe('preview');
    expect([...document.querySelectorAll<HTMLElement>('.slot-reel')].map((reel) => Number(reel.dataset.digit))).toEqual(previewSlotReels(42));
  });
});

describe('中央老虎机手动拉杆', () => {
  it.each([3, 4])('真实 %i 格行动在拉杆前就锁定格数，等待服务端结果', (count) => {
    const event = parseBattleEvent({ seq: 9, type: 'action', data: { pid: 'A', actionName: `slotSpin${count}` } });
    const onSubmit = vi.fn();
    host({ views: [view(event!.fx)], onSubmit });
    expect(screen.getByTestId('slot-pull-overlay').dataset.reelCount).toBe(String(count));
    expect(screen.queryByRole('button', { name: /数字/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '拉动老虎机拉杆' }));
    act(() => { vi.advanceTimersByTime(4000); });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByText('等待结算')).toBeTruthy();
    expect(screen.queryByText(/卷轴结果/)).toBeNull();
  });

  it('点击拉杆只提交一次并进入卷轴演出', () => {
    const onSubmit = vi.fn();
    host({ onSubmit });
    expect(screen.getByTestId('slot-pull-overlay').dataset.phase).toBe('idle');
    pointer('pointerDown', 100);
    pointer('pointerUp', 100);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('slot-pull-overlay').dataset.phase).toBe('spinning');
    expect((screen.getByRole('button', { name: '拉动老虎机拉杆' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('足够距离的拖动完成，短拖动回弹且不提交', () => {
    const onSubmit = vi.fn();
    host({ onSubmit });
    pointer('pointerDown', 20);
    pointer('pointerMove', 60);
    pointer('pointerUp', 60);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    cleanup();
    onSubmit.mockClear();
    host({ onSubmit });
    pointer('pointerDown', 20);
    pointer('pointerMove', 30);
    pointer('pointerUp', 30);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('slot-pull-overlay').dataset.phase).toBe('idle');
  });

  it('pointer cancel、窗口失焦和取消按钮都不会提交', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const first = host({ onSubmit, onCancel });
    pointer('pointerDown', 10);
    pointer('pointerCancel', 20);
    expect(onSubmit).not.toHaveBeenCalled();
    pointer('pointerDown', 10);
    fireEvent.blur(window);
    expect(onSubmit).not.toHaveBeenCalled();
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
    const onSubmit = vi.fn();
    const onComplete = vi.fn();
    host({ onSubmit, onComplete, reducedMotion: true });
    const button = screen.getByRole('button', { name: '拉动老虎机拉杆' });
    fireEvent.click(button, { detail: 0 });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(520); });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('老虎机从天而降', () => {
  it.each([3, 4])('落地演出保留 %i 个权威数字', (count) => {
    host({ views: [view('slotDrop', 1, { reels: Array.from({ length: count }, () => 8) })], interactive: false });
    expect(document.querySelectorAll('.slot-reel')).toHaveLength(count);
    expect(screen.getByTestId('slot-drop-overlay').dataset.reelCount).toBe(String(count));
  });

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
