import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraDirector } from '../../client/src/battle3d/camera-director.js';
import { defaultPose } from '../../client/src/battle3d/layout.js';
import { projectMapSnapshot } from '../../client/src/battle3d/map-playback.js';
import type { SnapLite } from '../../client/src/battle3d/scene.js';
import type { BattleEvent } from '../../client/src/battle/events.js';
import { BattleEventQueue } from '../../client/src/battle/queue.js';

const player = {
  id: 'p', name: 'P', charId: 'default', charName: '默认',
  hp: 0, maxHp: 3, room: 'far', alive: false, char: {}, hidden: false, invisible: false,
};
const state: SnapLite = {
  players: [player], roomIds: ['origin', 'far'], currentActor: null, winner: null, phase: 'over',
};
const move: BattleEvent = { seq: 1, kind: 'move', pid: 'p', fromRoom: 'origin', toRoom: 'far' };
const boom: BattleEvent = { seq: 2, kind: 'ivanBoom', room: 'far' };
const hit: BattleEvent = {
  seq: 3, kind: 'damage', targetId: 'p', room: 'far', tag: 'ivan', hpBefore: 3, hpAfter: 0, lethal: true,
};
const death: BattleEvent = { seq: 4, kind: 'eliminate', targetId: 'p' };

describe('Map playback', () => {
  it('reveals movement, blast, damage, elimination and finale in order from one terminal snapshot', () => {
    const armed = { id: 'DEF-1', room: 'far', kind: 'ivan', explodeRound: 2 };
    let s = projectMapSnapshot(state, [move, boom, hit, death], { ...state, deferred: [armed] });
    expect(s.players[0]).toMatchObject({ room: 'origin', alive: true, hp: 3 });
    expect(s.deferred).toEqual([armed]);
    s = projectMapSnapshot(state, [boom, hit, death], s, move);
    expect(s.players[0]).toMatchObject({ room: 'far', alive: true, hp: 3 });
    s = projectMapSnapshot(state, [hit, death], s, boom);
    expect(s.deferred).toEqual([]);
    expect(s.players[0].hp).toBe(3);
    s = projectMapSnapshot(state, [death], s, hit);
    expect(s.players[0]).toMatchObject({ alive: true, hp: 0 });
    s = projectMapSnapshot(state, [], s, death);
    expect(s.players[0]).toMatchObject({ alive: false, hp: 0 });
    expect(s.phase).toBe('roundEnd');
    expect(projectMapSnapshot(state, [], s, undefined, true).phase).toBe('over');
    expect(state.players).toEqual([player]);
  });

  it('gets pending danger from the snapshot or throw log and clears it on skip or reconnect', () => {
    const pending: BattleEvent = { seq: 1, kind: 'ivanThrow', room: 'far', pid: 'p', explodeRound: 2 };
    const armed = { id: 'DEF-1', kind: 'ivan', room: 'far', explodeRound: 2 };
    const authority = { ...state, phase: 'act' as const, deferred: [armed] };
    expect(projectMapSnapshot(authority, [pending], null).deferred).toEqual([]);
    expect(projectMapSnapshot(authority, [], null).deferred).toEqual([armed]);
    const placed = projectMapSnapshot(state, [boom, hit, death], null, pending);
    expect(placed.deferred).toMatchObject([{ kind: 'ivan', room: 'far', explodeRound: 2 }]);
    expect(projectMapSnapshot(state, [], placed).deferred).toEqual([]);
  });

  it('uses actual segment HP and converges on fast-forward', () => {
    const first = { ...hit, seq: 10, hpBefore: 3, hpAfter: 2, lethal: false };
    const second = { ...hit, seq: 11, hpBefore: 2, hpAfter: 1, lethal: false };
    const third = { ...hit, seq: 12, hpBefore: 1, hpAfter: 0 };
    let view = projectMapSnapshot(state, [first, second, third, death], null);
    for (const [index, beat] of [first, second, third].entries()) {
      view = projectMapSnapshot(state, [first, second, third, death].slice(index + 1), view, beat);
      expect(view.players[0]).toMatchObject({ hp: 2 - index, alive: true });
    }
    expect(projectMapSnapshot(state, [], view).players).toEqual(state.players);
  });
});

describe('Map camera director', () => {
  const base = defaultPose(1.6, 4);
  it('coalesces repeated requests and serializes priority holds', () => {
    const director = new CameraDirector();
    director.request('major', 'far', 0, () => ({ x: 3, z: -3 }));
    director.request('major', 'far', 1, () => ({ x: 8, z: 8 }));
    director.request('target', 'p', 1.2);
    expect(director.frame(base, 1.3, false)).toMatchObject({ shot: 'major', look: { x: 1.92 } });
    expect(director.frame(base, 1.51, false).shot).toBe('overview');
    director.request('winner', 'p', 2, () => ({ x: -3, z: 4 }));
    expect(director.frame(base, 3, false).shot).toBe('winner');
    expect(director.frame(base, 3, true).shot).toBe('overview');
  });

  it('respects manual control until reset, with limits on elevation and zoom', () => {
    const director = new CameraDirector();
    const original = director.frame(base, 0, false);
    director.drag(9000, 9000);
    for (let i = 0; i < 100; i++) director.zoom(-1);
    director.request('winner', 'p', 1, () => ({ x: 1, z: 1 }));
    const manual = director.frame(base, 1, false);
    expect(manual.position.y).toBeGreaterThan(4);
    expect(manual).not.toEqual(original);
    expect(manual.shot).toBe('overview');
    director.reset();
    expect(director.frame(base, 2, false)).toEqual(original);
    director.request('draw', '1', 3);
    expect(director.frame(base, 3, false).shot).toBe('draw');
  });
});

describe('Map presentation queue', () => {
  afterEach(() => vi.useRealTimers());
  it('deduplicates a burst and emits ranged warning before ordered targets', () => {
    vi.useFakeTimers();
    const beats: BattleEvent[] = [];
    const q = new BattleEventQueue({ onEventStart: b => beats.push(b) });
    const damage = (seq: number, room: string) => ({
      seq, type: 'damage', data: { target: room, amount: 1, room, groupId: 'G', aoe: true },
    });
    q.pushLogs([damage(3, 'far'), damage(2, 'origin'), damage(2, 'origin')]);
    vi.runAllTimers();
    expect(beats.map(b => [b.kind, b.seq])).toEqual([['area', 2], ['damage', 2], ['damage', 3]]);
    expect(beats[0].areaRooms).toEqual(['origin', 'far']);
  });

  it('keeps end-of-round explosion before a following action in the same broadcast', () => {
    vi.useFakeTimers();
    const beats: BattleEvent[] = [];
    const q = new BattleEventQueue({ onEventStart: b => beats.push(b) });
    q.pushLogs([
      { seq: 1, type: 'deferred', data: { room: 'far', source: 'p' } },
      { seq: 2, type: 'phase' },
      { seq: 3, type: 'action', data: { pid: 'p', fx: 'heal' } },
    ]);
    vi.runAllTimers();
    expect(beats.map(b => b.kind)).toEqual(['ivanBoom', 'action']);
  });
});
