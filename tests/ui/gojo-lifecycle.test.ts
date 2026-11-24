// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { BattleScene3D, type SnapPlayerLite } from '../../client/src/battle3d/scene.js';
import { Humanoid } from '../../client/src/battle3d/rig.js';
import { createCharacterAsset } from '../../client/src/battle3d/characters/index.js';
import { CHAR_VISUALS } from '../../client/src/battle3d/palette.js';

// jsdom has no GPU. No pixels, draw counts or renderer memory statistics are simulated.
vi.mock('three', async (importOriginal) => ({
  ...await importOriginal<typeof import('three')>(),
  WebGLRenderer: class {
    domElement = document.createElement('canvas');
    setClearColor() {}
    setPixelRatio() {}
    getPixelRatio() { return 1; }
    setSize() {}
    render() {}
    dispose() {}
  },
}));

function player(id: string, charId = 'gojo'): SnapPlayerLite {
  return { id, charId, charName: charId, name: id, room: 'R1', hp: 3, maxHp: 3,
    alive: true, invisible: false, hidden: false, char: {} };
}

function resources(root: THREE.Object3D) {
  const owned = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    owned.add(obj.geometry);
    for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) {
      owned.add(mat);
      for (const value of Object.values(mat)) if (value instanceof THREE.Texture) owned.add(value);
    }
  });
  expect(owned.size).toBeGreaterThan(0);
  // Three dispatches this event from the real resource's dispose(), even without WebGL.
  const counts = [...owned].map((resource) => {
    let count = 0;
    resource.addEventListener('dispose', () => { count++; });
    return () => count;
  });
  return () => [...new Set(counts.map((getCount) => getCount()))];
}

let host: HTMLDivElement;
let scene: BattleScene3D;
let pickPlayer: ReturnType<typeof vi.fn>;
let showStatus: ReturnType<typeof vi.fn>;
const sync = (...players: SnapPlayerLite[]) => scene.syncSnapshot({ players, roomIds: ['R1', 'R2'],
  phase: 'act', currentActor: null, winner: null });
// Read the entity created by syncSnapshot; never construct one or advance its pose by hand.
const entity = (id: string) => scene['entities'].get(id)!;
const frame = (ms = 160) => vi.advanceTimersByTime(ms);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  host = document.createElement('div');
  document.body.append(host);
  pickPlayer = vi.fn();
  showStatus = vi.fn();
  scene = new BattleScene3D(host, { onPickPlayer: pickPlayer, onShowStatus: showStatus, onPickRoom() {} });
});

afterEach(() => {
  scene?.dispose();
  host?.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Gojo entity lifecycle', () => {
  it('shows live HP values and routes nameplate and health-bar clicks separately', () => {
    const p = player('G');
    sync(p);
    const plate = entity('G').plate;
    const hpBar = plate.querySelector('.b3-hpbar') as HTMLButtonElement;
    const pick = plate.querySelector('.b3-pick') as HTMLButtonElement;
    expect(hpBar.textContent).toContain('3/3');
    expect(hpBar.getAttribute('aria-label')).toContain('查看 G 的生命与状态（3/3）');

    sync({ ...p, hp: 1 });
    expect(hpBar.textContent).toContain('1/3');
    hpBar.click();
    expect(showStatus).toHaveBeenCalledWith('G');
    expect(pickPlayer).not.toHaveBeenCalled();

    pick.click();
    expect(pickPlayer).toHaveBeenCalledWith('G');
    expect(showStatus).toHaveBeenCalledTimes(1);
  });

  // 核心生命周期在每名专属角色上跑一遍（gojo 是基线，其余按 DEDICATED 扩展）
  it.each(['gojo', 'laodaye'] as const)('%s: drives attacks and room movement on the mounted rig, returning to idle', (char) => {
    const p = player('G', char);
    sync(p);
    const e = entity('G');
    expect(e.asset.id).toBe(`${char}-v1`);
    expect(e.group.getObjectById(e.rig.root.id)).toBe(e.rig.root);
    const attack = vi.spyOn(e.rig, 'attackSwing');
    const walk = vi.spyOn(e.rig, 'walk');
    const idle = vi.spyOn(e.rig, 'idle');
    const home = e.group.parent;
    const origin = e.group.position.clone();
    scene.playAction(p.id, 'attack');
    frame();
    expect(attack).toHaveBeenCalled();
    expect(e.group.position.distanceTo(origin)).toBeGreaterThan(0);
    frame(640);
    expect(idle).toHaveBeenCalled();
    expect(e.group.position.distanceTo(origin)).toBeCloseTo(0);

    sync({ ...p, room: 'R2' });
    expect(entity('G').rig).toBe(e.rig);
    expect(e.group.parent).not.toBe(home);
    frame();
    expect(walk).toHaveBeenCalled();
    const enRoute = e.group.getWorldPosition(new THREE.Vector3());
    frame(1000);
    expect(e.walk).toBeNull();
    expect(e.group.getWorldPosition(new THREE.Vector3()).distanceTo(enRoute)).toBeGreaterThan(0.1);
  });

  it.each(['gojo', 'laodaye'] as const)('%s: isolates hit flash, hiding and death; revival restores the asset palette', (char) => {
    const p = player('G1', char);
    const q = player('G2', char);
    sync(p, q);
    const rig = entity(p.id).rig;
    const other = entity(q.id).rig;
    const palette = (r: typeof rig) => r.materials().map((m) => [m.color.getHex(), m.emissive.getHex()]);
    const original = palette(rig);
    const factory = createCharacterAsset(char);
    try {
      expect(original).toEqual(palette(factory.rig));
    } finally {
      factory.dispose();
    }
    expect(original.length).toBeGreaterThan(0);
    expect(palette(other)).toEqual(original);
    expect(rig.root).not.toBe(other.root);
    scene.playHit(p.id, { amount: 1 });
    frame(96);
    expect(palette(rig)).not.toEqual(original);
    expect(palette(other)).toEqual(original);
    frame(640);
    expect(palette(rig)).toEqual(original);

    sync({ ...p, hidden: true }, q);
    expect(rig.materials().every((m) => m.opacity < 1)).toBe(true);
    expect(other.materials().every((m) => m.opacity === 1)).toBe(true);
    sync({ ...p, alive: false, hp: 0 }, q);
    frame(3800);
    expect(rig.root.visible).toBe(false);
    expect(other.root.visible).toBe(true);
    expect(palette(other)).toEqual(original);
    sync(p, q);
    expect(entity(p.id).rig).toBe(rig);
    expect(rig.root.visible).toBe(true);
    expect(palette(rig)).toEqual(original);
    expect(rig.materials().every((m) => m.opacity === 1)).toBe(true);
  });

  it('keeps death and revival clocks through late presentation commands and room updates', () => {
    const p = player('G');
    const q = player('peer');
    sync({ ...p, alive: false }, q);
    const e = entity(p.id);
    frame(2300);
    scene.playHeal(p.id, { amount: 1 });
    scene.playIvanThrow(p.id, 'R2');
    scene.playWalk(p.id, 'R1', 'R2');
    expect(e.pose.kind).toBe('dead');
    frame(1200);
    expect(e.rig.root.visible).toBe(false);

    sync(p, q);
    scene.playRevive(p.id, 1);
    const rise = vi.spyOn(e.rig, 'reviveRise');
    frame(160);
    const clock = e.pose;
    scene.playAction(p.id, 'attack', q.id);
    scene.playAttackDecl(p.id, q.id);
    scene.playHit(p.id, { amount: 1, sourceId: q.id });
    scene.playHeal(p.id, {});
    sync({ ...p, room: 'R2' }, q);
    expect(e.pose).toBe(clock);
    expect(e.lunge).toBeNull();
    frame(560);
    expect(rise).toHaveBeenLastCalledWith(1);
    expect(e.curRoom).toBe('R2');
    frame(500);
    expect(e.pose.kind).toBe('idle');
    scene.playAction(p.id, 'attack');
    expect(e.pose.kind).toBe('attack');
  });

  it('does not animate a released model after an in-flight hit and miss', () => {
    const p = player('G');
    sync(p);
    const old = entity(p.id);
    scene.playHit(p.id, { amount: 1 });
    scene.playMiss(p.id);
    frame(64);
    sync({ ...p, charId: 'default' });
    const color = old.rig.materials()[0].emissive.clone();
    const pos = old.group.position.clone();
    frame(500);
    expect(old.rig.materials()[0].emissive).toEqual(color);
    expect(old.group.position).toEqual(pos);
  });

  it('reuses unchanged assets, releases only the leaver, and releases the re-entry on teardown', () => {
    const p = player('G1');
    const q = player('G2');
    sync(p, q);
    const first = entity(p.id);
    const peer = entity(q.id);
    const firstDisposals = resources(first.group);
    const peerDisposals = resources(peer.group);
    sync({ ...p, hp: 1 }, q);
    expect(entity(p.id).rig).toBe(first.rig);
    expect(firstDisposals()).toEqual([0]);
    sync(q);
    expect(scene['entities'].has(p.id)).toBe(false);
    expect(first.group.parent).toBeNull();
    expect(host.contains(first.plate)).toBe(false);
    expect(firstDisposals()).toEqual([1]);
    expect(peerDisposals()).toEqual([0]);
    expect(entity(q.id)).toBe(peer);

    sync(p, q);
    const again = entity(p.id);
    expect(again.rig.root).not.toBe(first.rig.root);
    expect(host.contains(again.plate)).toBe(true);
    const againDisposals = resources(again.group);
    scene.dispose();
    scene.dispose();
    expect(againDisposals()).toEqual([1]);
    expect(peerDisposals()).toEqual([1]);
    expect(firstDisposals()).toEqual([1]);
    expect(host.querySelector('.b3-plate')).toBeNull();
  });

  it('replaces the model on a charId change and preserves the original stick and unknown fallback', () => {
    const p = player('same-id');
    sync(p);
    const old = entity(p.id);
    const released = resources(old.rig.root);
    sync({ ...p, charId: 'bagun', char: { stickDrawn: true } });
    const bagun = entity(p.id);
    expect(released()).toEqual([1]);
    expect(bagun.asset.id).toBe('bagun-v1');
    expect(bagun.rig).not.toBe(old.rig);
    expect(bagun.stick?.visible).toBe(true); // 快照 stickDrawn 驱动专用 rig 的棍
    sync({ ...p, charId: 'bagun' });
    expect(bagun.stick?.visible).toBe(false);

    const stickDisposals = resources(bagun.stick!);
    sync({ ...p, charId: 'unknown-character' });
    expect(stickDisposals()).toEqual([1]);
    const fallback = entity(p.id);
    expect(fallback.rig).toBeInstanceOf(Humanoid);
    expect(fallback.rig.materials()[0].color.getHex()).toBe(CHAR_VISUALS.default.color);
    expect(fallback.stick).toBeNull();
    expect(host.querySelectorAll('.b3-plate')).toHaveLength(1);
  });
});
