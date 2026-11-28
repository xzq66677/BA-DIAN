import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraDirector } from '../../client/src/battle3d/camera-director.js';
import { defaultPose } from '../../client/src/battle3d/layout.js';
import { playMapEvent, projectMapSnapshot, type MapPlaybackScene } from '../../client/src/battle3d/map-playback.js';
import type { SnapLite } from '../../client/src/battle3d/scene.js';
import { parseBattleEvent, type BattleEvent } from '../../client/src/battle/events.js';
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
  it('holds public charge and multi-target wind positions until their own queue beats', () => {
    const authority = {
      ...state,
      players: [{ ...player, id: 'rider', room: 'far' },
        { ...player, id: 'pulled', room: 'far' }, { ...player, id: 'inside', char: { inTower: true } }],
    };
    const charge = parseBattleEvent({ seq: 12, type: 'damage', data: {
      declared: true, source: 'rider', target: 'pulled',
      presentation: { mounted: true, fromRoom: 'origin', toRoom: 'far' },
    } })!;
    const wind = parseBattleEvent({ seq: 13, type: 'action', data: { pid: 'water', actionName: 'inhale', presentation: {
      moves: [{ pid: 'pulled', fromRoom: 'origin', toRoom: 'far' },
        { pid: 'inside', fromRoom: 'far', toRoom: 'far', tower: 'enter' }, { pid: 'rider' }],
    } } })!;

    const pending = projectMapSnapshot(authority, [charge, wind], null);
    expect(pending.players.map(p => p.room)).toEqual(['origin', 'origin', 'far']);
    expect(pending.players[2].char.inTower).toBe(false);
    const afterCharge = projectMapSnapshot(authority, [wind], pending, charge);
    expect(afterCharge.players.map(p => p.room)).toEqual(['far', 'origin', 'far']);
    expect(projectMapSnapshot(authority, [], afterCharge, wind).players).toEqual(authority.players);
  });

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

  it('parses tower hit and collapse logs into dedicated scene events', () => {
    const towerHit = parseBattleEvent({ seq: 20, type: 'trigger', data: {
      tower: 'far', towerHit: true, amount: 6, hpBefore: 6, hpAfter: 0, tag: 'ivan',
    } });
    const towerCollapse = parseBattleEvent({ seq: 21, type: 'trigger', data: {
      tower: 'far', towerCollapse: true, source: 'p',
    } });
    expect(towerHit).toMatchObject({ kind: 'towerHit', room: 'far', amount: 6, hpBefore: 6, hpAfter: 0 });
    expect(towerCollapse).toMatchObject({ kind: 'towerCollapse', room: 'far' });
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

// ═══ MAP-105 · 自动化边角案例测试 ═════════════════════════════
// 四类边角案例中的三类（未命中 / 同归于尽平局 / 重复播报与倍速）在本文件用真实
// 生产单元（parseBattleEvent / projectMapSnapshot / BattleEventQueue）验证行为；
// WebGL 上下文恢复属浏览器行为，在 scripts/map-match.ts 用 WEBGL_lose_context 驱动验证。
// 日志形状均取自引擎真实输出（shared/src/engine.ts），不是测试自造形状。

describe('MAP-105 边角案例 · 实际未命中（攻击目标已离开原房间）', () => {
  const missLog = {
    seq: 6, type: 'state', text: '未命中',
    data: { target: 'tgt', source: 'att', missed: true, dtype: 'attack', tag: 'wuliuqi-aoe', room: 'far' },
  };
  const move = { seq: 4, kind: 'move' as const, pid: 'tgt', fromRoom: 'origin', toRoom: 'far' };
  const decl = { seq: 5, kind: 'attackDecl' as const, sourceId: 'att', targetId: 'tgt', room: 'far' };
  const at = (view: SnapLite, id: string) => view.players.find(p => p.id === id)!;

  it('state+missed 日志解析为 miss 事件：无 hp 字段（不改写投影），携带目标实际房间', () => {
    const e = parseBattleEvent(missLog);
    expect(e).toMatchObject({ kind: 'miss', seq: 6, targetId: 'tgt', sourceId: 'att', room: 'far' });
    expect(e?.hpBefore).toBeUndefined();
    expect(e?.hpAfter).toBeUndefined();
    expect(e?.kind).not.toBe('damage'); // 未命中不产生受击演出的事件形态
  });

  it('move → 攻击宣告 → 未命中：目标始终显示在新房间，HP 与权威一致，无虚假受击', () => {
    const authority: SnapLite = {
      players: [
        { id: 'att', name: '甲', charId: 'ivan-girl', charName: '伊万', hp: 3, maxHp: 3, room: 'origin', alive: true, char: {}, hidden: false, invisible: false },
        { id: 'tgt', name: '乙', charId: 'default', charName: '默认', hp: 3, maxHp: 3, room: 'far', alive: true, char: {}, hidden: false, invisible: false },
      ],
      roomIds: ['origin', 'far'], currentActor: null, winner: null, phase: 'act',
    };
    const events = [move, decl, parseBattleEvent(missLog)!];
    let view = projectMapSnapshot(authority, events, null);
    for (const [index, beat] of events.entries()) {
      view = projectMapSnapshot(authority, events.slice(index + 1), view, beat);
      const tgt = at(view, 'tgt');
      expect(tgt.room).toBe('far');        // 目标已在新房间（移动先行，未命中不打回原点）
      expect(tgt.hp).toBe(3);              // 未命中不改 HP
      expect(tgt.alive).toBe(true);        // 不淘汰
      expect(at(view, 'att').room).toBe('origin');
    }
    expect(view.players).toEqual(authority.players); // 播放结束与权威终态完全一致
  });

  it('未命中不触碰延迟炸弹与淘汰状态', () => {
    const armed = { id: 'DEF-1', room: 'far', kind: 'ivan' as const, explodeRound: 2 };
    const authority: SnapLite = {
      players: [{ ...player, hp: 3, alive: true, room: 'far' }],
      roomIds: ['origin', 'far'], currentActor: null, winner: null, phase: 'act', deferred: [armed],
    };
    const miss = parseBattleEvent({ seq: 8, type: 'state', data: { target: 'p', missed: true, room: 'far' } })!;
    const view = projectMapSnapshot(authority, [], authority, miss);
    expect(view.deferred).toEqual([armed]);   // 炸弹不被未命中误清
    expect(view.players[0]).toMatchObject({ alive: true, hp: 3 });
  });
});

describe('MAP-105 边角案例 · 同归于尽平局', () => {
  // 引擎真实行为（shared/src/engine.ts:1090-1133 + settlingDeferred）：同一发大伊万
  // 对房内成员逐个 applyDamage（同 groupId）→ alive=0 → winner=null 平局。
  const authority: SnapLite = {
    players: [
      { id: 'a', name: '甲', charId: 'ivan-girl', charName: '伊万', hp: 0, maxHp: 3, room: 'doom', alive: false, char: {}, hidden: false, invisible: false },
      { id: 'b', name: '乙', charId: 'wuliuqi', charName: '伍六七', hp: 0, maxHp: 3, room: 'doom', alive: false, char: {}, hidden: false, invisible: false },
    ],
    roomIds: ['doom', 'safe'], currentActor: null, winner: null, phase: 'over',
  };
  const events: BattleEvent[] = [
    { seq: 9, kind: 'ivanBoom', room: 'doom', sourceId: 'a' },
    { seq: 10, kind: 'damage', targetId: 'a', sourceId: 'a', amount: 999999, hpBefore: 1, hpAfter: 0, lethal: true, aoe: true, tag: 'ivan', groupId: 'G1', room: 'doom' },
    { seq: 11, kind: 'damage', targetId: 'b', sourceId: 'a', amount: 999999, hpBefore: 1, hpAfter: 0, lethal: true, aoe: true, tag: 'ivan', groupId: 'G1', room: 'doom' },
    { seq: 12, kind: 'eliminate', targetId: 'a', cause: '大伊万' },
    { seq: 13, kind: 'eliminate', targetId: 'b', cause: '大伊万' },
  ];
  const at = (view: SnapLite, id: string) => view.players.find(p => p.id === id)!;

  it('同一发爆炸连杀两人：播放全程不显示胜者，双方按日志顺序归零、淘汰，揭示后仍为平局', () => {
    let view = projectMapSnapshot(authority, events, null);
    expect(view.players.map(p => p.hp)).toEqual([1, 1]); // 爆炸前双双 1 HP（回放重建）
    for (const [index, beat] of events.entries()) {
      view = projectMapSnapshot(authority, events.slice(index + 1), view, beat);
      expect(view.winner).toBeNull();                    // 全程不错误显示胜者
      expect(view.phase).toBe('roundEnd');               // 揭示前维持回合末呈现
      const [a, b] = [at(view, 'a'), at(view, 'b')];
      expect(a.hp).toBe(index >= 1 ? 0 : 1);             // damage(a) 后归零
      expect(b.hp).toBe(index >= 2 ? 0 : 1);             // damage(b) 后归零
      expect(a.alive).toBe(index < 3);                   // eliminate(a) 后淘汰
      expect(b.alive).toBe(index < 4);                   // eliminate(b) 后淘汰
    }
    const revealed = projectMapSnapshot(authority, [], view, undefined, true);
    expect(revealed.phase).toBe('over');
    expect(revealed.winner).toBeNull();                  // 揭示终局后依然是平局
    expect(revealed.players.every(p => !p.alive)).toBe(true);
  });

  it('演出队列按权威日志顺序完整播放伊万链，且 tag=ivan 不做房间预警合并', () => {
    vi.useFakeTimers();
    const beats: BattleEvent[] = [];
    const q = new BattleEventQueue({ onEventStart: b => beats.push(b) });
    q.pushLogs([
      { seq: 9, type: 'deferred', data: { room: 'doom', source: 'a' } },
      { seq: 10, type: 'damage', data: { target: 'a', source: 'a', amount: 999999, hpBefore: 1, hpAfter: 0, lethal: true, aoe: true, tag: 'ivan', groupId: 'G1', room: 'doom' } },
      { seq: 11, type: 'damage', data: { target: 'b', source: 'a', amount: 999999, hpBefore: 1, hpAfter: 0, lethal: true, aoe: true, tag: 'ivan', groupId: 'G1', room: 'doom' } },
      { seq: 12, type: 'eliminate', data: { pid: 'a', cause: '大伊万' } },
      { seq: 13, type: 'eliminate', data: { pid: 'b', cause: '大伊万' } },
    ]);
    vi.runAllTimers();
    // 顺序 = 权威日志顺序（爆炸 → 甲扣血 → 乙扣血 → 甲淘汰 → 乙淘汰）
    expect(beats.map(b => [b.kind, b.seq])).toEqual([
      ['ivanBoom', 9], ['damage', 10], ['damage', 11], ['eliminate', 12], ['eliminate', 13],
    ]);
    expect(beats.filter(b => b.kind === 'area')).toHaveLength(0); // 伊万链不做 AOE 预警合并
  });
});

describe('MAP-105 边角案例 · 重复播报与倍速', () => {
  afterEach(() => vi.useRealTimers());

  const damageLog = (seq: number) => ({
    seq, type: 'damage', data: { target: 'p', source: 'att', amount: 1, hpBefore: 3, hpAfter: 2, room: 'far' },
  });

  it('同一 seq 连续下发 2 次（同批）与 4 次（跨批重发）都只演出一次', () => {
    vi.useFakeTimers();
    const beats: BattleEvent[] = [];
    const q = new BattleEventQueue({ onEventStart: b => beats.push(b) });
    q.pushLogs([damageLog(5), damageLog(5)]);
    vi.runAllTimers();
    expect(beats.filter(b => b.seq === 5)).toHaveLength(1);

    const q2 = new BattleEventQueue({ onEventStart: b => beats.push(b) });
    q2.pushLogs([damageLog(8), damageLog(8)]);
    q2.pushLogs([damageLog(8)]);
    q2.pushLogs([damageLog(8)]);
    vi.runAllTimers();
    expect(beats.filter(b => b.seq === 8)).toHaveLength(1);
  });

  it('同一伤害事件重复播放 4 次不叠加扣血（绝对 hpBefore/hpAfter），不同 seq 的同内容重发也不叠加', () => {
    const dmg: BattleEvent = { seq: 5, kind: 'damage', targetId: 'p', amount: 1, hpBefore: 3, hpAfter: 2, room: 'far' };
    const actState = { ...state, phase: 'act' as const };
    let view = projectMapSnapshot(actState, [dmg], null);
    for (let i = 0; i < 4; i++) {
      view = projectMapSnapshot(actState, [dmg], view, dmg);
      expect(view.players[0].hp).toBe(2);                // 恒等于 hpAfter，不累加
    }
    const quad = [1, 2, 3, 4].map(seq => ({ ...dmg, seq }));
    let v2 = projectMapSnapshot(actState, quad, null);
    for (const beat of quad) {
      v2 = projectMapSnapshot(actState, quad.filter(x => x.seq > beat.seq), v2, beat);
      expect(v2.players[0].hp).toBe(2);                  // 重发也不叠加
    }
    expect(projectMapSnapshot(actState, [], v2).players[0].hp).toBe(state.players[0].hp); // 播完收敛到权威快照
  });

  it('4× 倍速下的演出顺序与 1× 完全一致（顺序正确、无丢失）', () => {
    vi.useFakeTimers();
    const chain = [
      { seq: 1, type: 'damage', data: { declared: true, source: 'att', target: 'p', amount: 1, room: 'far' } },
      { seq: 2, type: 'damage', data: { target: 'p', source: 'att', amount: 1, hpBefore: 3, hpAfter: 2, room: 'far' } },
      { seq: 3, type: 'eliminate', data: { pid: 'p', cause: '测试' } },
    ];
    const beats: BattleEvent[] = [];
    const q1 = new BattleEventQueue({ onEventStart: b => beats.push(b) });
    q1.pushLogs(chain);
    vi.runAllTimers();
    const order1x = beats.map(b => [b.kind, b.seq]);

    beats.length = 0;
    const q4 = new BattleEventQueue({ onEventStart: b => beats.push(b) });
    q4.setSpeed(4);
    expect(q4.getSpeed()).toBe(4);
    q4.pushLogs(chain);
    vi.runAllTimers();
    expect(beats.map(b => [b.kind, b.seq])).toEqual(order1x);
    expect(beats.map(b => b.kind)).toEqual(['attackDecl', 'damage', 'eliminate']);
  });

  it('严重积压触发 fast 压缩：低重要度事件可丢，关键事件（爆炸/致命伤/淘汰）不丢且顺序保持', () => {
    vi.useFakeTimers();
    const beats: BattleEvent[] = [];
    const q = new BattleEventQueue({ onEventStart: b => beats.push(b) });
    const flood = Array.from({ length: 70 }, (_, i) => ({
      seq: i + 1, type: 'action', data: { pid: 'a', fx: 'skill' },
    }));
    q.pushLogs(flood);                                   // 70 簇 ≈ 23.8s ≥ TURBO 22s
    expect(q.getState().mode).toBe('fast');
    q.pushLogs([
      { seq: 71, type: 'damage', data: { declared: true, source: 'a', target: 'p', amount: 1, room: 'far' } },
      { seq: 72, type: 'deferred', data: { room: 'far', source: 'a' } },
      { seq: 73, type: 'damage', data: { target: 'p', source: 'a', amount: 999999, hpBefore: 3, hpAfter: 0, lethal: true, tag: 'ivan', room: 'far', groupId: 'G9' } },
      { seq: 74, type: 'eliminate', data: { pid: 'p', cause: '大伊万' } },
    ]);
    vi.runAllTimers();
    const kinds = beats.map(b => b.kind);
    expect(kinds).toContain('ivanBoom');                 // 关键事件不丢
    expect(kinds).toContain('damage');                   // 致命伤在 fast 下保留
    expect(kinds).toContain('eliminate');
    expect(kinds).not.toContain('attackDecl');           // 低重要度宣告被压缩丢弃
    // 关键事件顺序与权威日志一致：爆炸 → 致命伤 → 淘汰
    expect(kinds.indexOf('ivanBoom')).toBeLessThan(kinds.indexOf('damage'));
    expect(kinds.indexOf('damage')).toBeLessThan(kinds.indexOf('eliminate'));
  });
});


it('routes the authoritative queue events to production scene methods with playback timing', () => {
  const scene: MapPlaybackScene = {
    playAttackDecl: vi.fn(), playAction: vi.fn(), playAreaAlert: vi.fn(), playHit: vi.fn(),
    playHeal: vi.fn(), playMiss: vi.fn(), playEliminate: vi.fn(), playRevive: vi.fn(), playWalk: vi.fn(),
    playIvanThrow: vi.fn(), playIvanBoom: vi.fn(), playTowerHit: vi.fn(), playTowerCollapse: vi.fn(),
    playTrigger: vi.fn(), playDomain: vi.fn(),
  };
  const events: BattleEvent[] = [
    { seq: 10, kind: 'attackDecl', sourceId: 'a', targetId: 'p' },
    { seq: 11, kind: 'area', areaRooms: ['far', 'origin'] },
    move, { seq: 12, kind: 'ivanThrow', pid: 'p', room: 'far' }, boom, hit, death,
    { seq: 13, kind: 'revive', targetId: 'p', livesLeft: 2 },
    { seq: 14, kind: 'towerHit', room: 'far', amount: 6, hpAfter: 0 },
    { seq: 15, kind: 'towerCollapse', room: 'far' },
  ];
  events.forEach((event) => playMapEvent(scene, event, 1000));
  expect(scene.playAttackDecl).toHaveBeenCalledWith('a', 'p');
  expect(scene.playAreaAlert).toHaveBeenCalledTimes(1);
  expect(scene.playAreaAlert).toHaveBeenCalledWith(['far', 'origin']);
  expect(scene.playWalk).toHaveBeenCalledWith('p', 'origin', 'far');
  expect(scene.playIvanThrow).toHaveBeenCalledWith('p', 'far', expect.any(Number));
  expect(vi.mocked(scene.playIvanThrow).mock.calls[0][2]).toBeCloseTo(0.97);
  expect(scene.playIvanBoom).toHaveBeenCalledWith('far');
  expect(scene.playHit).toHaveBeenCalledWith('p', expect.objectContaining({ hpBefore: 3, hpAfter: 0, lethal: true }));
  expect(scene.playEliminate).toHaveBeenCalledWith('p', undefined); // 无死因的淘汰按通用演出传 undefined
  expect(scene.playRevive).toHaveBeenCalledWith('p', 2);
  expect(scene.playTowerHit).toHaveBeenCalledWith('far', 6, 0);
  expect(scene.playTowerCollapse).toHaveBeenCalledWith('far');
  expect(vi.mocked(scene.playIvanBoom).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(scene.playEliminate).mock.invocationCallOrder[0],
  );
});
