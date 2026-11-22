import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createCharacterAsset, type CharacterRig, releaseMeshes } from '../../client/src/battle3d/characters/index.js';
import { createGojoRig } from '../../client/src/battle3d/characters/gojo.js';

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

describe('Gojo asset', () => {
  it('loads the dedicated factory model and applies its requested scale', () => {
    const mounted = createCharacterAsset('gojo');
    const half = createGojoRig(0.5);
    try {
      expect(mounted.id).toBe('gojo-v1');
      const bounds = (root: THREE.Object3D) => new THREE.Box3().setFromObject(root, true).getSize(new THREE.Vector3());
      const fullSize = bounds(mounted.rig.root);
      const halfSize = bounds(half.root);
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(fullSize[axis]).toBeGreaterThan(0);
        expect(halfSize[axis]).toBeCloseTo(fullSize[axis] * 0.5);
      }
      expect(mounted.rig.headHeight()).toBeGreaterThan(0);
      expect(half.headHeight()).toBeCloseTo(mounted.rig.headHeight() * 0.5);
    } finally {
      mounted.dispose();
      releaseMeshes(half.root);
    }
  });

  const poses: [string, (rig: CharacterRig) => void][] = [
    ['idle', r => r.idle(0.7, 0)], ['walk', r => r.walk(0.2, 1)],
    ['attack', r => r.attackSwing(0.4)], ['flinch', r => r.flinch(0.5)],
    ['cast', r => r.cast(0.5)], ['drink', r => r.drink(0.8)], ['crouch', r => r.crouch(0.8)],
    ['cheer', r => r.cheer(0.8)], ['dead', r => r.dead(1)], ['revive', r => r.reviveRise(0.5)],
  ];
  it.each(poses)('%s moves meshes, leaves a second instance alone, and resets', (_name, pose) => {
    const a = createCharacterAsset('gojo');
    const b = createCharacterAsset('gojo');
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
});

// 2026-11-21：全部 11 名角色均已专属化，legacy Humanoid 仅剩未知 ID 回退路径，
// 由 gojo-lifecycle.test.ts 的 unknown-character 用例覆盖。
