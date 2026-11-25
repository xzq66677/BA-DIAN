import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createCharacterAsset, dedicatedCharIds, setCharacterHairStyle } from '../../client/src/battle3d/characters/index.js';
import { HAIR_STYLES } from '../../client/src/battle3d/characters/hair-style.js';

// 发型增强层契约：全员挂接、幂等、复用材质、随 rig 释放、可整体显隐。
const dedicated = dedicatedCharIds();

function hairMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse(node => {
    if ((node as THREE.Mesh).isMesh && node.name === 'hairStyleV2Mesh') out.push(node as THREE.Mesh);
  });
  return out;
}

describe('low-poly hair style layer', () => {
  it('has a style entry for every dedicated character', () => {
    for (const id of dedicated) expect(HAIR_STYLES[id], `missing hair style for ${id}`).toBeTruthy();
  });

  it.each(dedicated)('%s mounts non-empty hair geometry on head/headTop', (id) => {
    const asset = createCharacterAsset(id);
    try {
      const root = asset.rig.root;
      expect(root.getObjectByName('hairStyleV2_head')).toBeTruthy();
      const meshes = hairMeshes(root);
      expect(meshes.length).toBeGreaterThan(0);
      for (const mesh of meshes) {
        const pos = mesh.geometry.getAttribute('position');
        expect(pos.count).toBeGreaterThan(0);
        expect(mesh.geometry.getAttribute('color')).toBeTruthy();
      }
    } finally {
      asset.dispose();
    }
  });

  it('reuses the rig solid material so opacity and disposal apply', () => {
    const asset = createCharacterAsset('chuixiao');
    try {
      const solid = asset.rig.materials()[0];
      const meshes = hairMeshes(asset.rig.root);
      expect(meshes.length).toBeGreaterThan(0);
      expect(meshes.every(m => m.material === solid)).toBe(true);
    } finally {
      asset.dispose();
    }
  });

  it('toggles all hair meshes on and off together', () => {
    const asset = createCharacterAsset('bagun');
    try {
      const groups = ['hairStyleV2_head', 'hairStyleV2_top'].map(n => asset.rig.root.getObjectByName(n)!).filter(Boolean);
      expect(groups.length).toBeGreaterThan(0);
      setCharacterHairStyle(asset.rig, false);
      expect(groups.every(g => !g.visible)).toBe(true);
      setCharacterHairStyle(asset.rig, true);
      expect(groups.every(g => g.visible)).toBe(true);
    } finally {
      asset.dispose();
    }
  });

  it('does not break pose animation or feet-on-ground contract', () => {
    const asset = createCharacterAsset('ivan-girl');
    try {
      expect(() => {
        asset.rig.resetPose();
        asset.rig.idle(1.25);
        asset.rig.walk(0.8);
        asset.rig.attackSwing(0.5);
        asset.rig.dead(1);
        asset.rig.reviveRise(0.4);
      }).not.toThrow();
      asset.rig.resetPose();
      const box = new THREE.Box3().setFromObject(asset.rig.root, true);
      expect(box.min.y).toBeGreaterThan(-0.06); // 脚底仍锁在台面
    } finally {
      asset.dispose();
    }
  });

  it('creates independent hair instances for separate assets', () => {
    const a = createCharacterAsset('chuixiao');
    const b = createCharacterAsset('chuixiao');
    try {
      const ma = hairMeshes(a.rig.root), mb = hairMeshes(b.rig.root);
      expect(ma.length).toBeGreaterThan(0);
      expect(ma.length).toBe(mb.length);
      expect(ma[0].geometry).not.toBe(mb[0].geometry);
    } finally {
      a.dispose(); b.dispose();
    }
  });
});
