import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createCharacterAsset, type CharacterRig, releaseMeshes, dedicatedCharIds, registerCharacterRig } from '../../client/src/battle3d/characters/index.js';
import { charVisual } from '../../client/src/battle3d/palette.js';
import { Humanoid } from '../../client/src/battle3d/rig.js';

// 专属 3D 视觉的通用资产契约（gojo-v1 另有 tests/ui/gojo-asset.test.ts）。
// 每接入一个新角色，追加到 rigs 表：名称、期望视觉 ID、剪影断言。
type Extra = (rig: CharacterRig) => void;
const rigs: Record<string, { id: string; extra?: Extra }> = {
  laodaye: { id: 'laodaye-v1', extra: r => { expect(r.root.getObjectByName('jade')).toBeTruthy(); } },
  bagun: { id: 'bagun-v1', extra: r => { expect(r.root.getObjectByName('stick')).toBeTruthy(); } },
  chuixiao: { id: 'chuixiao-v1', extra: r => { expect(r.root.getObjectByName('flute')).toBeTruthy(); } },
  wuliuqi: { id: 'wuliuqi-v1', extra: r => { expect(r.root.getObjectByName('scissors')).toBeTruthy(); } },
  mabaoguo: { id: 'mabaoguo-v1', extra: r => { expect(r.root.getObjectByName('spin')).toBeTruthy(); } },
  'ivan-girl': { id: 'ivan-girl-v1', extra: r => { expect(r.root.getObjectByName('bomb')).toBeTruthy(); } },
  'hero-today': { id: 'hero-today-v1', extra: r => { expect(r.root.getObjectByName('spin')).toBeTruthy(); } },
  dajianke: { id: 'dajianke-v1', extra: r => { expect(r.root.getObjectByName('spin')).toBeTruthy(); } },
  dapihuai: { id: 'dapihuai-v1', extra: r => { expect(new THREE.Box3().setFromObject(r.root, true).max.y).toBeLessThan(1.1); } },
  default: { id: 'nobody-v1' },
};

const dedicated = dedicatedCharIds().filter(id => id !== 'gojo' && rigs[id]);

// Inspect transforms of actual meshes, not just the existence of animation methods or joints.
function meshPose(rig: CharacterRig) {
  const transforms: number[][] = [];
  rig.root.updateMatrixWorld(true);
  rig.root.traverseVisible(node => {
    if (node instanceof THREE.Mesh) transforms.push([...node.matrixWorld.elements]);
  });
  expect(transforms.length).toBeGreaterThan(0);
  expect(transforms.every(m => m.every(Number.isFinite))).toBe(true);
  return transforms;
}

describe('dedicated character assets', () => {
  it.each(dedicated)('%s mounts the dedicated factory model with feet on the ground', (id) => {
    const asset = createCharacterAsset(id);
    try {
      expect(asset.id).toBe(rigs[id].id);
      const box = new THREE.Box3().setFromObject(asset.rig.root, true);
      const size = box.getSize(new THREE.Vector3());
      const scale = charVisual(id).scale;
      expect(size.y).toBeGreaterThan(0.85 * scale); // 站姿身高按角色视觉缩放归一（矮个角色如大屁孩 0.74）
      expect(size.y).toBeLessThan(1.85 * scale); // 上限放宽到含头饰（斗笠/光环/磁环）；缩放一致性由专项用例覆盖
      expect(box.min.y).toBeGreaterThan(-0.02); // 脚底不穿地
      expect(box.min.y).toBeLessThan(0.06); // 脚底不漂浮
      expect(asset.rig.headHeight()).toBeGreaterThan(0);
      rigs[id].extra?.(asset.rig);
    } finally {
      asset.dispose();
    }
  });

  it.each(dedicated)('%s applies the requested scale consistently', (id) => {
    const asset = createCharacterAsset(id);
    const half = createCharacterAsset(id);
    try {
      asset.rig.root.scale.setScalar(asset.rig.root.scale.x * 0.5);
      const bounds = (root: THREE.Object3D) => new THREE.Box3().setFromObject(root, true).getSize(new THREE.Vector3());
      const fullSize = bounds(half.rig.root);
      const halfSize = bounds(asset.rig.root);
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(halfSize[axis]).toBeGreaterThan(0);
        expect(halfSize[axis]).toBeCloseTo(fullSize[axis] * 0.5);
      }
      expect(asset.rig.headHeight()).toBeCloseTo(half.rig.headHeight() * 0.5);
    } finally {
      asset.dispose();
      half.dispose();
    }
  });

  const poses: [string, (rig: CharacterRig) => void][] = [
    ['idle', r => r.idle(0.7, 0)], ['walk', r => r.walk(0.2, 1)],
    ['attack', r => r.attackSwing(0.4)], ['flinch', r => r.flinch(0.5)],
    ['cast', r => r.cast(0.5)], ['drink', r => r.drink(0.8)], ['crouch', r => r.crouch(0.8)],
    ['cheer', r => r.cheer(0.8)], ['dead', r => r.dead(1)], ['revive', r => r.reviveRise(0.5)],
    ['signal', r => r.signalActor?.(0.4)],
  ];
  it.each(dedicated.flatMap(id => poses.map(([name, pose]) => [`${id} ${name}`, id, pose] as const)))(
    '%s moves meshes, leaves a second instance alone, and resets', (_name, id, pose) => {
      const a = createCharacterAsset(id);
      const b = createCharacterAsset(id);
      try {
        a.rig.resetPose();
        b.rig.resetPose();
        const start = meshPose(a.rig);
        const peer = meshPose(b.rig);
        pose(a.rig);
        expect(meshPose(a.rig)).not.toEqual(start);
        expect(meshPose(b.rig)).toEqual(peer);
        a.rig.resetPose();
        expect(meshPose(a.rig)).toEqual(start);
      } finally {
        a.dispose();
        b.dispose();
      }
    });

  it.each(dedicated)('%s instances own disjoint geometry and materials', (id) => {
    const a = createCharacterAsset(id);
    const b = createCharacterAsset(id);
    try {
      const owned = (root: THREE.Object3D) => {
        const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
        root.traverse(node => {
          const mesh = node as THREE.Mesh;
          if (mesh.geometry) geos.add(mesh.geometry);
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            if (m) mats.add(m);
          }
        });
        return { geos, mats };
      };
      const oa = owned(a.rig.root), ob = owned(b.rig.root);
      expect(oa.geos.size).toBeGreaterThan(0);
      for (const g of oa.geos) expect(ob.geos.has(g)).toBe(false);
      for (const m of oa.mats) expect(ob.mats.has(m)).toBe(false);
      // 死亡灰化/闪白走 materials()：两实例材质互不共享，互不串色
      const flash = (r: CharacterRig) => r.materials().map(m => m.emissive.getHex());
      const before = flash(b.rig);
      for (const m of a.rig.materials()) m.emissive.setRGB(1, 0, 0);
      expect(flash(b.rig)).toEqual(before);
    } finally {
      a.dispose();
      b.dispose();
    }
  });

  it.each(dedicated)('%s dispose detaches and is idempotent', (id) => {
    const asset = createCharacterAsset(id);
    const disposals: number[] = [];
    const probe = new Set<THREE.BufferGeometry | THREE.Material>();
    asset.rig.root.traverse(node => {
      const mesh = node as THREE.Mesh;
      if (mesh.geometry) probe.add(mesh.geometry);
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m) probe.add(m);
    });
    for (const res of probe) res.addEventListener('dispose', () => disposals.push(1));
    asset.dispose();
    asset.dispose();
    expect(asset.rig.root.parent).toBeNull();
    expect(disposals.length).toBe(probe.size);
    expect(disposals.length).toBeGreaterThan(0);
  });
});

describe('fallback contract for characters without a dedicated rig yet', () => {
  // 新角色只加进 shared/src/characters 时（无 palette、无 rig），必须仍能正常入局：
  // 自动回退 legacy Humanoid（默认调色板 + 无道具），完整姿态接口可用。
  const futureChar = 'future-hero';

  it('unknown roster id falls back to a working legacy humanoid with default palette', () => {
    const asset = createCharacterAsset(futureChar);
    try {
      expect(asset.id).toBe('humanoid');
      expect(asset.rig).toBeInstanceOf(Humanoid);
      const box = new THREE.Box3().setFromObject(asset.rig.root, true);
      expect(box.min.y).toBeGreaterThanOrEqual(-0.02);
      expect(box.max.y).toBeGreaterThan(1.0);
      // 未收录进 CHAR_VISUALS → 使用 default 视觉（灰蓝、无专属道具）
      expect(asset.rig.materials()[0].color.getHex()).toBe(charVisual(futureChar).color);
      expect(charVisual(futureChar).prop).toBe('none');
      expect(asset.stick).toBeNull();
      // 姿态接口完整（场景驱动所需的方法全部存在且可用）
      for (const m of ['idle', 'walk', 'attackSwing', 'flinch', 'cast', 'drink', 'crouch', 'cheer', 'dead', 'reviveRise', 'resetPose'] as const) {
        expect(typeof asset.rig[m]).toBe('function');
      }
      asset.rig.idle(0.3, 0);
      expect(new THREE.Box3().setFromObject(asset.rig.root, true).isEmpty()).toBe(false);
    } finally {
      asset.dispose();
    }
  });

  it('registerCharacterRig upgrades the fallback to a dedicated rig without touching the legacy path', () => {
    const legacy = createCharacterAsset(futureChar);
    try {
      expect(legacy.id).toBe('humanoid');
    } finally {
      legacy.dispose();
    }
    // 新角色 3D 化 = 一行注册（未来接入只需这一步）
    registerCharacterRig(futureChar, 'future-hero-v1', (scale) =>
      new Humanoid({ main: 0x2468ac, accent: 0x86b4dc, skin: 0xe8c49a, dark: 0x2e2822 }, { scale }));
    const upgraded = createCharacterAsset(futureChar);
    try {
      expect(upgraded.id).toBe('future-hero-v1');
      expect(dedicatedCharIds()).toContain(futureChar);
      expect(upgraded.rig.materials()[0].color.getHex()).toBe(0x2468ac);
    } finally {
      upgraded.dispose();
    }
    // 其他未注册角色不受影响，仍走 legacy 回退
    const other = createCharacterAsset('another-future-char');
    try {
      expect(other.id).toBe('humanoid');
    } finally {
      other.dispose();
    }
  });
});
