import * as THREE from 'three';
import type { FxInstance } from './fx.js';
import { createSlotMachineModel } from './slot-machine-model.js';

export const SLOT_DROP_FX_KIND = 'slot-drop' as const;

export interface SlotDropFxOptions {
  duration?: number;
  reducedMotion?: boolean;
  lowEffects?: boolean;
  seed?: number;
}

export interface SlotDropFxDebugState {
  phase: 'warning' | 'falling' | 'impact' | 'settled';
  progress: number;
  height: number;
  impactCount: number;
}

export interface SlotDropFx extends FxInstance {
  readonly kind: 'slot-drop';
  debugState(): SlotDropFxDebugState;
}

const DEFAULT_DURATION = 2.2;
const DEFAULT_SEED = 0x51a7d00d;
const WARNING_END = 0.12;
const IMPACT_AT = 0.62;
const SETTLED_AT = 0.82;
const DROP_HEIGHT = 7.5;
const IMPACT_WINDOW = 0.44;
const TAU = Math.PI * 2;
const TIME_EPSILON = 1e-9;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const easeOutCubic = (value: number): number => 1 - Math.pow(1 - value, 3);
const smoothstep = (value: number): number => value * value * (3 - 2 * value);

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function basicMaterial(color: number, opacity: number, additive = false): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

interface DebrisParticle {
  origin: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Vector3;
  spin: THREE.Vector3;
  scale: number;
}

interface MaterialState {
  material: THREE.Material;
  opacity: number;
  depthWrite: boolean;
}

function collectResources(root: THREE.Object3D): {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
  textures: Set<THREE.Texture>;
  instancedMeshes: Set<THREE.InstancedMesh>;
} {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const instancedMeshes = new Set<THREE.InstancedMesh>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) {
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) {
        materials.add(material);
        for (const value of Object.values(material)) {
          for (const entry of Array.isArray(value) ? value : [value]) {
            if (entry && typeof entry === 'object' && (entry as { isTexture?: boolean }).isTexture) {
              textures.add(entry as THREE.Texture);
            }
          }
        }
      }
    }
    if ((object as THREE.InstancedMesh).isInstancedMesh) {
      instancedMeshes.add(object as THREE.InstancedMesh);
    }
  });
  return { geometries, materials, textures, instancedMeshes };
}

/**
 * One-shot ground-impact presentation. Time is derived from FxInstance.elapsed,
 * while debris uses analytic trajectories so identical seeds remain identical
 * even when frame pacing changes.
 */
export function slotMachineDropFx(target: THREE.Vector3, options: SlotDropFxOptions = {}): SlotDropFx {
  const duration = Number.isFinite(options.duration) && (options.duration ?? 0) > 0
    ? options.duration as number
    : DEFAULT_DURATION;
  const reducedMotion = options.reducedMotion === true;
  const lowEffects = options.lowEffects === true;
  const seed = Number.isFinite(options.seed) ? Math.trunc(options.seed as number) >>> 0 : DEFAULT_SEED;
  const random = seededRandom(seed);
  const impactAt = reducedMotion ? 0 : IMPACT_AT * duration;

  const object = new THREE.Group();
  object.name = 'slot-drop-fx';
  object.userData.kind = SLOT_DROP_FX_KIND;
  object.position.copy(target);

  const model = createSlotMachineModel();
  model.root.position.set(0, reducedMotion ? 0 : DROP_HEIGHT, 0);
  object.add(model.root);

  const modelMaterials: MaterialState[] = [];
  const seenMaterials = new Set<THREE.Material>();
  model.root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.material) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (seenMaterials.has(material)) continue;
      seenMaterials.add(material);
      modelMaterials.push({ material, opacity: material.opacity, depthWrite: material.depthWrite });
    }
  });
  const bulbMesh = model.root.getObjectByName('slot-bulbs') as THREE.Mesh | undefined;
  const bulbMaterial = bulbMesh?.material as THREE.MeshStandardMaterial | undefined;
  const leverBaseRotation = model.lever.userData.baseRotationZ as number;

  const ringGeometry = new THREE.RingGeometry(0.78, 0.825, 48);
  const warningMaterial = basicMaterial(0xffcf62, 0.72, true);
  const warningRing = new THREE.Mesh(ringGeometry, warningMaterial);
  warningRing.name = 'slot-warning-ring';
  warningRing.rotation.x = -Math.PI / 2;
  warningRing.position.y = 0.026;
  warningRing.visible = !reducedMotion;
  object.add(warningRing);

  let warningTicks: THREE.InstancedMesh | undefined;
  if (!reducedMotion) {
    const tickGeometry = new THREE.BoxGeometry(0.085, 0.012, 0.022);
    warningTicks = new THREE.InstancedMesh(tickGeometry, warningMaterial, 12);
    warningTicks.name = 'slot-warning-ticks';
    const tick = new THREE.Object3D();
    for (let i = 0; i < 12; i += 1) {
      const angle = (i / 12) * TAU;
      tick.position.set(Math.cos(angle) * 0.80, 0.028, Math.sin(angle) * 0.80);
      tick.rotation.set(0, -angle, 0);
      tick.updateMatrix();
      warningTicks.setMatrixAt(i, tick.matrix);
    }
    warningTicks.instanceMatrix.needsUpdate = true;
    warningTicks.computeBoundingBox();
    object.add(warningTicks);
  }

  const impactMaterial = basicMaterial(0xffe2a0, 0, true);
  const impactRing = new THREE.Mesh(ringGeometry, impactMaterial);
  impactRing.name = 'slot-impact-ring';
  impactRing.rotation.x = -Math.PI / 2;
  impactRing.position.y = 0.034;
  impactRing.visible = false;
  object.add(impactRing);

  const debrisCount = reducedMotion ? 0 : lowEffects ? 6 : 14;
  const debrisMaterial = basicMaterial(0xffffff, 0.92, true);
  const debrisGeometry = new THREE.TetrahedronGeometry(0.055, 0);
  let debris: THREE.InstancedMesh | undefined;
  const particles: DebrisParticle[] = [];
  if (debrisCount > 0) {
    debris = new THREE.InstancedMesh(debrisGeometry, debrisMaterial, debrisCount);
    debris.name = 'slot-debris';
    debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    debris.frustumCulled = false;
    const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    const colors = [0xffd46d, 0xe34b42, 0xffe9b5];
    for (let i = 0; i < debrisCount; i += 1) {
      const angle = random() * TAU;
      const radialSpeed = 1.45 + random() * 1.45;
      const originRadius = 0.32 + random() * 0.26;
      particles.push({
        origin: new THREE.Vector3(Math.cos(angle) * originRadius, 0.10 + random() * 0.12, Math.sin(angle) * originRadius),
        velocity: new THREE.Vector3(Math.cos(angle) * radialSpeed, 2.1 + random() * 1.7, Math.sin(angle) * radialSpeed),
        rotation: new THREE.Vector3(random() * TAU, random() * TAU, random() * TAU),
        spin: new THREE.Vector3((random() - 0.5) * 9, (random() - 0.5) * 9, (random() - 0.5) * 9),
        scale: 0.65 + random() * 0.75,
      });
      debris.setMatrixAt(i, hidden);
      debris.setColorAt(i, new THREE.Color(colors[i % colors.length]));
    }
    debris.instanceMatrix.needsUpdate = true;
    if (debris.instanceColor) debris.instanceColor.needsUpdate = true;
    object.add(debris);
  }

  let flash: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> | undefined;
  let flashMaterial: THREE.MeshBasicMaterial | undefined;
  if (!reducedMotion && !lowEffects) {
    flashMaterial = basicMaterial(0xffe6a6, 0, true);
    flash = new THREE.Mesh(new THREE.CircleGeometry(1, 32), flashMaterial);
    flash.name = 'slot-impact-flash';
    flash.rotation.x = -Math.PI / 2;
    flash.position.y = 0.04;
    flash.visible = false;
    object.add(flash);
  }

  let light: THREE.PointLight | undefined;
  if (!reducedMotion && !lowEffects) {
    light = new THREE.PointLight(0xffbf55, 0, 5, 2);
    light.name = 'slot-impact-light';
    light.position.set(0, 0.72, 0.15);
    light.castShadow = false;
    object.add(light);
  }

  const particleTransform = new THREE.Object3D();
  const particleMatrix = new THREE.Matrix4();
  let impactCount = 0;
  let progress = 0;
  let phase: SlotDropFxDebugState['phase'] = reducedMotion ? 'impact' : 'warning';
  let disposed = false;
  let fading = false;
  const reelImpactStarts = [0, 0, 0];
  const reelImpactTargets = [0, 0, 0];

  function updateDebris(timeSinceImpact: number): void {
    if (!debris) return;
    const life = clamp01(timeSinceImpact / 0.88);
    const visibleScale = 1 - smoothstep(clamp01((life - 0.55) / 0.45));
    debris.visible = timeSinceImpact >= 0 && life < 1;
    debrisMaterial.opacity = 0.92 * (1 - life);
    for (let i = 0; i < particles.length; i += 1) {
      const particle = particles[i];
      const t = Math.max(0, timeSinceImpact);
      let y = particle.origin.y + particle.velocity.y * t - 4.9 * t * t;
      if (y < 0.035) y = 0.035 + (0.035 - y) * 0.14;
      particleTransform.position.set(
        particle.origin.x + particle.velocity.x * t,
        y,
        particle.origin.z + particle.velocity.z * t,
      );
      particleTransform.rotation.set(
        particle.rotation.x + particle.spin.x * t,
        particle.rotation.y + particle.spin.y * t,
        particle.rotation.z + particle.spin.z * t,
      );
      particleTransform.scale.setScalar(Math.max(0.001, particle.scale * visibleScale));
      particleTransform.updateMatrix();
      particleMatrix.copy(particleTransform.matrix);
      debris.setMatrixAt(i, particleMatrix);
    }
    debris.instanceMatrix.needsUpdate = true;
  }

  function triggerImpact(time: number): void {
    if (impactCount !== 0) return;
    impactCount = 1;
    const fallingDuration = (IMPACT_AT - WARNING_END) * duration;
    for (let i = 0; i < model.reels.length; i += 1) {
      reelImpactStarts[i] = -fallingDuration * (8.5 + i * 1.1);
      reelImpactTargets[i] = Math.round(reelImpactStarts[i] / TAU) * TAU;
    }
    updateDebris(Math.max(0, time - impactAt));
  }

  function setModelFade(amount: number): void {
    if (!fading && amount > 0) {
      fading = true;
      for (const state of modelMaterials) {
        state.material.transparent = true;
        state.material.depthWrite = false;
        state.material.needsUpdate = true;
      }
    }
    if (!fading) return;
    for (const state of modelMaterials) state.material.opacity = state.opacity * (1 - amount);
  }

  function update(_dt: number, elapsed: number): boolean {
    if (disposed) return false;
    const time = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
    progress = clamp01(time / duration);
    if (time >= impactAt) triggerImpact(time);

    if (reducedMotion) {
      phase = progress < 0.32 ? 'impact' : 'settled';
      model.root.position.y = 0;
      model.root.rotation.set(0, 0, 0);
      model.root.scale.set(1, 1, 1);
      model.lever.rotation.z = leverBaseRotation;
      model.reels.forEach((reel) => { reel.rotation.x = 0; });
    } else if (progress < WARNING_END - TIME_EPSILON) {
      phase = 'warning';
      model.root.position.y = DROP_HEIGHT;
      model.root.rotation.set(0, 0, 0);
      model.root.scale.set(1, 1, 1);
      model.lever.rotation.z = leverBaseRotation;
    } else if (progress < IMPACT_AT - TIME_EPSILON) {
      phase = 'falling';
      const fall = clamp01((progress - WARNING_END + TIME_EPSILON) / (IMPACT_AT - WARNING_END));
      const height = DROP_HEIGHT * (1 - Math.pow(fall, 2.35));
      model.root.position.y = height;
      model.root.rotation.set(0.045 * Math.sin(fall * Math.PI), 0.55 * fall, -0.16 * fall);
      const stretch = 1 + 0.035 * Math.sin(fall * Math.PI);
      model.root.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
      model.lever.rotation.z = leverBaseRotation - 0.08 * fall;
      model.reels.forEach((reel, index) => {
        reel.rotation.x = -(time - WARNING_END * duration) * (8.5 + index * 1.1);
      });
    } else if (progress < SETTLED_AT - TIME_EPSILON) {
      phase = 'impact';
      const impactTime = Math.max(0, time - impactAt);
      const q = clamp01(impactTime / IMPACT_WINDOW);
      const bounce = 0.30 * Math.exp(-q * 5.2) * Math.abs(Math.sin(q * Math.PI * 3));
      const squashY = 1 - 0.16 * Math.exp(-q * 4.8) * Math.cos(q * Math.PI * 3.2);
      model.root.position.y = bounce;
      model.root.scale.set(1 / Math.sqrt(squashY), squashY, 1 / Math.sqrt(squashY));
      model.root.rotation.set(
        0.045 * (1 - q) * Math.sin(q * Math.PI * 4),
        0.55 * (1 - easeOutCubic(q)),
        0.12 * (1 - q) * Math.sin(q * Math.PI * 4),
      );
      model.lever.rotation.z = leverBaseRotation + 0.42 * Math.sin(Math.min(1, q * 1.4) * Math.PI) * Math.exp(-q * 2);
      model.reels.forEach((reel, index) => {
        reel.rotation.x = THREE.MathUtils.lerp(reelImpactStarts[index], reelImpactTargets[index], easeOutCubic(q));
      });
    } else {
      phase = 'settled';
      model.root.position.y = 0;
      model.root.rotation.set(0, 0, 0);
      model.root.scale.set(1, 1, 1);
      model.lever.rotation.z = leverBaseRotation;
      model.reels.forEach((reel, index) => { reel.rotation.x = reelImpactTargets[index]; });
    }

    if (!reducedMotion) {
      const warningVisible = progress < IMPACT_AT;
      warningRing.visible = warningVisible;
      if (warningTicks) warningTicks.visible = warningVisible;
      const pulse = 1 + 0.055 * Math.sin(time * 19);
      warningRing.scale.set(pulse, pulse, 1);
      if (warningTicks) warningTicks.scale.set(pulse, 1, pulse);
      warningMaterial.opacity = progress < WARNING_END
        ? 0.45 + 0.30 * Math.sin(progress / WARNING_END * Math.PI)
        : 0.24 * (1 - clamp01((progress - WARNING_END) / (IMPACT_AT - WARNING_END)));
    }

    const impactTime = Math.max(0, time - impactAt);
    const ringLife = reducedMotion ? 0.32 : 0.52;
    const ringT = clamp01(impactTime / ringLife);
    impactRing.visible = impactCount === 1 && impactTime >= 0 && ringT < 1;
    if (impactRing.visible) {
      const scale = 0.32 + easeOutCubic(ringT) * 2.15;
      impactRing.scale.set(scale, scale, 1);
      impactMaterial.opacity = (reducedMotion ? 0.62 : 0.88) * Math.pow(1 - ringT, 1.4);
    }

    if (debris) updateDebris(impactTime);
    if (flash && flashMaterial) {
      const flashT = clamp01(impactTime / 0.16);
      flash.visible = impactCount === 1 && flashT < 1;
      if (flash.visible) {
        const scale = 0.35 + easeOutCubic(flashT) * 1.55;
        flash.scale.set(scale, scale, 1);
        flashMaterial.opacity = 0.24 * (1 - flashT);
      }
    }
    if (light) {
      const lightT = clamp01(impactTime / 0.22);
      light.intensity = impactCount === 1 && lightT < 1 ? 7 * Math.pow(1 - lightT, 2) : 0;
    }
    if (bulbMaterial) {
      bulbMaterial.emissiveIntensity = reducedMotion
        ? 1.15
        : 1.05 + 0.20 * Math.sin(time * 17) + (impactTime < 0.22 ? 1.4 * (1 - impactTime / 0.22) : 0);
    }

    setModelFade(smoothstep(clamp01((progress - SETTLED_AT) / (1 - SETTLED_AT))));
    return progress < 1;
  }

  function debugState(): SlotDropFxDebugState {
    return {
      phase,
      progress,
      height: Math.max(0, model.root.position.y),
      impactCount,
    };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    object.visible = false;
    const resources = collectResources(object);
    resources.instancedMeshes.forEach((mesh) => mesh.dispose());
    resources.geometries.forEach((geometry) => geometry.dispose());
    resources.materials.forEach((material) => material.dispose());
    resources.textures.forEach((texture) => texture.dispose());
  }

  return { kind: SLOT_DROP_FX_KIND, object, update, dispose, debugState };
}
