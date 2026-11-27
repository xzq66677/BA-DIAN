import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSlotMachineModel } from '../../client/src/battle3d/slot-machine-model.js';
import { RoomDecorations } from '../../client/src/battle3d/collaboration-props.js';
import {
  SLOT_DROP_FX_KIND,
  slotMachineDropFx,
  type SlotDropFx,
} from '../../client/src/battle3d/slot-drop-fx.js';

const DEFAULT_DURATION = 2.2;

it('keeps a landed slot machine in the room when a tower is hit or collapses', () => {
  const room = new THREE.Group();
  const decorations = new RoomDecorations();
  decorations.sync(new Map([['owner', { room: 'R2', asset: 'slot-machine', progress: 1 }]]),
    id => id === 'R2' ? room : undefined, .3, true);
  const machine = decorations.objectFor('owner')!;
  const position = machine.position.clone();
  decorations.hit('R2');
  decorations.update(.2);
  expect(decorations.collapse('R2')).toBe(false);
  decorations.update(1);
  expect(machine.position.equals(position)).toBe(true);
  expect(machine.parent).toBe(room);
  decorations.dispose();
});

function resourcesOf(root: THREE.Object3D): {
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  textures: THREE.Texture[];
} {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (!mesh.material) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) {
        for (const entry of Array.isArray(value) ? value : [value]) {
          if (entry && typeof entry === 'object' && (entry as { isTexture?: boolean }).isTexture) {
            textures.add(entry as THREE.Texture);
          }
        }
      }
    }
  });
  return { geometries: [...geometries], materials: [...materials], textures: [...textures] };
}

function expectResourcesDisposedOnce(fx: SlotDropFx): void {
  const resources = resourcesOf(fx.object);
  const geometryCalls = new Map<THREE.BufferGeometry, number>();
  const materialCalls = new Map<THREE.Material, number>();
  const textureCalls = new Map<THREE.Texture, number>();
  for (const geometry of resources.geometries) {
    geometryCalls.set(geometry, 0);
    geometry.addEventListener('dispose', () => geometryCalls.set(geometry, (geometryCalls.get(geometry) ?? 0) + 1));
  }
  for (const material of resources.materials) {
    materialCalls.set(material, 0);
    material.addEventListener('dispose', () => materialCalls.set(material, (materialCalls.get(material) ?? 0) + 1));
  }
  for (const texture of resources.textures) {
    textureCalls.set(texture, 0);
    texture.addEventListener('dispose', () => textureCalls.set(texture, (textureCalls.get(texture) ?? 0) + 1));
  }

  fx.dispose();
  fx.dispose();

  expect(resources.geometries.length).toBeGreaterThan(0);
  expect(resources.materials.length).toBeGreaterThan(0);
  expect([...geometryCalls.values()].every((count) => count === 1)).toBe(true);
  expect([...materialCalls.values()].every((count) => count === 1)).toBe(true);
  expect([...textureCalls.values()].every((count) => count === 1)).toBe(true);
  expect(fx.update(1 / 60, DEFAULT_DURATION)).toBe(false);
}

function debrisMatrices(fx: SlotDropFx): number[] {
  const debris = fx.object.getObjectByName('slot-debris') as THREE.InstancedMesh | undefined;
  expect(debris).toBeDefined();
  const matrix = new THREE.Matrix4();
  const values: number[] = [];
  for (let i = 0; i < debris!.count; i += 1) {
    debris!.getMatrixAt(i, matrix);
    values.push(...matrix.elements);
  }
  return values;
}

function countPointLights(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((object) => { if ((object as THREE.PointLight).isPointLight) count += 1; });
  return count;
}

describe('slot machine model', () => {
  it('exposes stable authored parts and stays inside the mobile asset budget', () => {
    const model = createSlotMachineModel();
    try {
      expect(model.root.position.toArray()).toEqual([0, 0, 0]);
      expect(model.lever).toBe(model.root.getObjectByName('slot-lever'));
      expect(model.lever.isGroup).toBe(true);
      expect(model.reels).toHaveLength(3);
      model.reels.forEach((reel, index) => {
        expect(reel.isGroup).toBe(true);
        expect(reel.name).toBe(`slot-reel-${index}`);
        expect(model.root.getObjectByName(reel.name)).toBe(reel);
      });
      expect(model.root.getObjectByName('marquee-gold-crown')).toBeDefined();
      expect(model.root.getObjectByName('reel-window-bezel')).toBeDefined();
      expect(model.root.getObjectByName('slot-bulbs')).toBeDefined();

      const bounds = new THREE.Box3().setFromObject(model.root);
      const size = bounds.getSize(new THREE.Vector3());
      expect(size.x).toBeGreaterThan(1.25);
      expect(size.x).toBeLessThan(1.55);
      expect(size.y).toBeGreaterThan(1.70);
      expect(size.y).toBeLessThan(1.90);
      expect(size.z).toBeGreaterThan(0.78);
      expect(size.z).toBeLessThan(1.02);
      expect(bounds.min.y).toBeGreaterThanOrEqual(-0.001);

      expect(model.stats.meshes).toBeLessThanOrEqual(45);
      expect(model.stats.meshes).toBeGreaterThan(30);
      expect(model.stats.triangles).toBeLessThanOrEqual(18_000);
      expect(model.stats.geometries).toBeLessThanOrEqual(35);
      expect(model.stats.materials).toBeLessThanOrEqual(12);
      expect(resourcesOf(model.root).textures).toHaveLength(0);

      let shadowCasters = 0;
      let shadowReceivers = 0;
      model.root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (mesh.castShadow) shadowCasters += 1;
        if (mesh.receiveShadow) shadowReceivers += 1;
      });
      expect(shadowCasters).toBe(0);
      expect(shadowReceivers).toBe(0);
    } finally {
      model.dispose();
    }
  });

  it('disposes shared geometries and materials only once', () => {
    const model = createSlotMachineModel();
    const resources = resourcesOf(model.root);
    const geometryCalls = new Map<THREE.BufferGeometry, number>();
    const materialCalls = new Map<THREE.Material, number>();
    resources.geometries.forEach((geometry) => {
      geometryCalls.set(geometry, 0);
      geometry.addEventListener('dispose', () => geometryCalls.set(geometry, (geometryCalls.get(geometry) ?? 0) + 1));
    });
    resources.materials.forEach((material) => {
      materialCalls.set(material, 0);
      material.addEventListener('dispose', () => materialCalls.set(material, (materialCalls.get(material) ?? 0) + 1));
    });
    model.dispose();
    model.dispose();
    expect([...geometryCalls.values()].every((count) => count === 1)).toBe(true);
    expect([...materialCalls.values()].every((count) => count === 1)).toBe(true);
  });
});

describe('slot machine drop lifecycle', () => {
  it('follows warning, accelerated fall, impact, settle and duration boundaries', () => {
    const target = new THREE.Vector3(3, 0, -2);
    const fx = slotMachineDropFx(target, { seed: 42 });
    try {
      expect(fx.kind).toBe(SLOT_DROP_FX_KIND);
      expect(fx.object.position.toArray()).toEqual(target.toArray());
      expect(fx.debugState()).toEqual({ phase: 'warning', progress: 0, height: 7.5, impactCount: 0 });

      fx.update(1 / 60, 0);
      expect(fx.debugState().phase).toBe('warning');
      expect(fx.object.getObjectByName('slot-warning-ring')?.visible).toBe(true);

      fx.update(1 / 60, DEFAULT_DURATION * 0.12);
      expect(fx.debugState().phase).toBe('falling');
      expect(fx.debugState().height).toBeCloseTo(7.5, 5);

      fx.update(1 / 60, DEFAULT_DURATION * 0.14);
      const earlyHeight = fx.debugState().height;
      expect(earlyHeight).toBeLessThan(7.5);
      expect(earlyHeight).toBeGreaterThan(5);

      fx.update(1 / 60, DEFAULT_DURATION * 0.40);
      expect(fx.debugState().phase).toBe('falling');
      expect(fx.debugState().height).toBeLessThan(earlyHeight);

      fx.update(1 / 60, DEFAULT_DURATION * 0.619);
      expect(fx.debugState().height).toBeGreaterThan(0);
      expect(fx.debugState().impactCount).toBe(0);

      fx.update(1 / 60, DEFAULT_DURATION * 0.62);
      expect(fx.debugState().phase).toBe('impact');
      expect(fx.debugState().height).toBeCloseTo(0, 5);
      expect(fx.debugState().impactCount).toBe(1);
      expect(fx.object.getObjectByName('slot-impact-ring')?.visible).toBe(true);
      expect(fx.object.getObjectByName('slot-debris')?.visible).toBe(true);

      fx.update(1 / 60, DEFAULT_DURATION * 0.70);
      expect(fx.debugState().impactCount).toBe(1);
      fx.update(1 / 60, DEFAULT_DURATION * 0.82);
      expect(fx.debugState().phase).toBe('settled');
      expect(fx.debugState().height).toBe(0);
      expect(fx.debugState().impactCount).toBe(1);

      expect(fx.update(1 / 60, DEFAULT_DURATION + 0.01)).toBe(false);
      expect(fx.debugState()).toEqual({ phase: 'settled', progress: 1, height: 0, impactCount: 1 });
    } finally {
      fx.dispose();
    }
  });

  it('triggers impact at most once even when a frame skips across the boundary', () => {
    const fx = slotMachineDropFx(new THREE.Vector3(), { seed: 7 });
    try {
      fx.update(0, DEFAULT_DURATION * 0.70);
      expect(fx.debugState().impactCount).toBe(1);
      fx.update(0, DEFAULT_DURATION * 0.90);
      fx.update(0, DEFAULT_DURATION);
      expect(fx.debugState().impactCount).toBe(1);
    } finally {
      fx.dispose();
    }
  });

  it('clamps progress and honours a custom duration', () => {
    const fx = slotMachineDropFx(new THREE.Vector3(), { duration: 1, seed: 1 });
    try {
      fx.update(0, -10);
      expect(fx.debugState().progress).toBe(0);
      fx.update(0, 0.62);
      expect(fx.debugState().phase).toBe('impact');
      expect(fx.debugState().impactCount).toBe(1);
      expect(fx.update(0, 1.01)).toBe(false);
      expect(fx.debugState().progress).toBe(1);
    } finally {
      fx.dispose();
    }
  });

  it('uses one brief non-shadow point light only for the full effect', () => {
    const normal = slotMachineDropFx(new THREE.Vector3(), { seed: 2 });
    const low = slotMachineDropFx(new THREE.Vector3(), { seed: 2, lowEffects: true });
    try {
      expect(countPointLights(normal.object)).toBe(1);
      const light = normal.object.getObjectByName('slot-impact-light') as THREE.PointLight;
      expect(light.castShadow).toBe(false);
      normal.update(0, DEFAULT_DURATION * 0.62);
      expect(light.intensity).toBeGreaterThan(0);
      normal.update(0, DEFAULT_DURATION * 0.80);
      expect(light.intensity).toBe(0);

      expect(countPointLights(low.object)).toBe(0);
      const lowDebris = low.object.getObjectByName('slot-debris') as THREE.InstancedMesh;
      const normalDebris = normal.object.getObjectByName('slot-debris') as THREE.InstancedMesh;
      expect(lowDebris.count).toBeGreaterThan(0);
      expect(lowDebris.count).toBeLessThan(normalDebris.count);
      expect(low.object.getObjectByName('slot-impact-flash')).toBeUndefined();

      let meshCount = 0;
      normal.object.traverse((object) => { if ((object as THREE.Mesh).isMesh) meshCount += 1; });
      expect(meshCount).toBeLessThanOrEqual(60);
    } finally {
      normal.dispose();
      low.dispose();
    }
  });

  it('keeps the complete effect deterministic for the same seed', () => {
    const first = slotMachineDropFx(new THREE.Vector3(1, 0, 2), { seed: 12345 });
    const second = slotMachineDropFx(new THREE.Vector3(1, 0, 2), { seed: 12345 });
    const different = slotMachineDropFx(new THREE.Vector3(1, 0, 2), { seed: 54321 });
    try {
      const sampleTime = DEFAULT_DURATION * 0.62 + 0.04;
      first.update(1 / 60, sampleTime);
      second.update(1 / 30, sampleTime);
      different.update(1 / 60, sampleTime);
      expect(debrisMatrices(first)).toEqual(debrisMatrices(second));
      expect(debrisMatrices(first)).not.toEqual(debrisMatrices(different));
      expect(first.debugState()).toEqual(second.debugState());
    } finally {
      first.dispose();
      second.dispose();
      different.dispose();
    }
  });

  it('reduced motion lands immediately with no fall, spin, debris, flash or light', () => {
    const fx = slotMachineDropFx(new THREE.Vector3(4, 0, 5), { seed: 99, reducedMotion: true });
    try {
      const machine = fx.object.getObjectByName('slot-machine')!;
      const lever = fx.object.getObjectByName('slot-lever')!;
      const leverQuaternion = lever.quaternion.clone();
      fx.update(0, 0);
      expect(fx.debugState()).toEqual({ phase: 'impact', progress: 0, height: 0, impactCount: 1 });
      expect(machine.position.y).toBe(0);
      expect(machine.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
      expect(machine.scale.toArray()).toEqual([1, 1, 1]);
      expect(lever.quaternion.equals(leverQuaternion)).toBe(true);
      expect(fx.object.getObjectByName('slot-debris')).toBeUndefined();
      expect(fx.object.getObjectByName('slot-impact-flash')).toBeUndefined();
      expect(fx.object.getObjectByName('slot-warning-ring')?.visible).toBe(false);
      expect(countPointLights(fx.object)).toBe(0);
      expect(fx.object.getObjectByName('slot-impact-ring')?.visible).toBe(true);

      for (const time of [0.2, 0.5, 1.0, 1.8]) {
        fx.update(1 / 60, time);
        expect(fx.debugState().height).toBe(0);
        expect(machine.position.y).toBe(0);
        expect(machine.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
        expect(machine.scale.toArray()).toEqual([1, 1, 1]);
        expect(lever.quaternion.equals(leverQuaternion)).toBe(true);
        expect(fx.debugState().impactCount).toBe(1);
      }
      expect(fx.debugState().phase).toBe('settled');
      expect(fx.object.getObjectByName('slot-impact-ring')?.visible).toBe(false);
      expect(fx.update(0, DEFAULT_DURATION)).toBe(false);
    } finally {
      fx.dispose();
    }
  });

  it('cleans every effect and model geometry/material/texture on dispose', () => {
    const fx = slotMachineDropFx(new THREE.Vector3(), { seed: 314 });
    fx.update(1 / 60, DEFAULT_DURATION * 0.70);
    expectResourcesDisposedOnce(fx);
  });
});
