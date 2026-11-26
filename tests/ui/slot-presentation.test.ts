import { describe, expect, it, vi } from 'vitest';
import {
  SLOT_DROP_FX,
  SLOT_PULL_FX,
  isMajorActionPresentation,
  registerActionPresentation,
  resolveActionPresentation,
} from '../../client/src/battle/action-presentation.js';
import { eventMs, PACE_PROFILES } from '../../client/src/battle/queue.js';
import { parseBattleEvent } from '../../client/src/battle/events.js';
import { registerActionPresenter } from '../../client/src/battle3d/action-presenters.js';
import { playMapEvent, type MapPlaybackScene } from '../../client/src/battle3d/map-playback.js';

describe('老虎机演出注册表', () => {
  it('保留 manual/automatic、时长与重大事件标记', () => {
    expect(resolveActionPresentation(SLOT_PULL_FX)).toMatchObject({ mode: 'manual', durationMs: 2600, major: true });
    expect(resolveActionPresentation(SLOT_DROP_FX)).toMatchObject({ mode: 'automatic', durationMs: 2200, major: true });
    expect(isMajorActionPresentation(SLOT_PULL_FX)).toBe(true);
    expect(isMajorActionPresentation(SLOT_DROP_FX)).toBe(true);
    expect(isMajorActionPresentation('unknown')).toBe(false);
  });

  it('支持注册新行动且未知行动安全降级', () => {
    registerActionPresentation('futureAction', { fx: 'futureFx', mode: 'automatic', durationMs: 1800 });
    expect(resolveActionPresentation('futureAction')?.fx).toBe('futureFx');
    expect(resolveActionPresentation('missing')).toBeUndefined();
  });

  it('队列按 pace 缩放演出时长并尊重 reduced-motion', () => {
    const event = { kind: 'action' as const, seq: 1, pid: 'A', fx: SLOT_PULL_FX };
    expect(eventMs(event, 'normal', 1, false, PACE_PROFILES.current)).toBe(2600);
    expect(eventMs(event, 'normal', 1, false, PACE_PROFILES.relaxed)).toBe(3770);
    expect(eventMs(event, 'normal', 1, true, PACE_PROFILES.current)).toBe(240);
    expect(eventMs(event, 'fast', 1, false, PACE_PROFILES.current)).toBe(320);
  });

  it('结构化日志保留 fx、目标与房间，不依赖文本', () => {
    expect(parseBattleEvent({
      seq: 9,
      type: 'action',
      text: '任意文本',
      data: { pid: 'A', fx: SLOT_DROP_FX, targetId: 'B', room: '东房' },
    })).toEqual({ kind: 'action', seq: 9, pid: 'A', fx: SLOT_DROP_FX, label: undefined, targetId: 'B', room: '东房', important: undefined });
  });

  it('已注册 presenter 接管动作，未知 fx 回退原场景动作', () => {
    const presenter = vi.fn();
    registerActionPresenter('unit-test-fx', presenter);
    const scene = { playAction: vi.fn() } as unknown as MapPlaybackScene;
    playMapEvent(scene, { kind: 'action', seq: 1, pid: 'A', fx: 'unit-test-fx', targetId: 'B' }, 2200);
    expect(presenter).toHaveBeenCalledWith(scene, 'A', 'B', 2200);
    expect(scene.playAction).not.toHaveBeenCalled();

    playMapEvent(scene, { kind: 'action', seq: 2, pid: 'A', fx: 'unknown', targetId: 'B' }, 600);
    expect(scene.playAction).toHaveBeenCalledWith('A', 'unknown', 'B');
  });
});
