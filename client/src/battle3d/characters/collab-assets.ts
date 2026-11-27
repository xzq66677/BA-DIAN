import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import type { SnapPlayer } from '../../../../shared/src/protocol.js';
import type { CharacterRig } from './index.js';
const ghostUrl = new URL('../../../../artifacts/collab/ghost/model/ghost.glb', import.meta.url).href;
const huntUrl = new URL('../../../../artifacts/collab/wild-hunt-heathcliff/model/wild-hunt-heathcliff-wraith.glb', import.meta.url).href;
const archerUrl = new URL('../../../../artifacts/collab/skeleton-archer/model/skeleton-archer.glb', import.meta.url).href;
const snakeUrl = new URL('../../../../artifacts/collab/flying-leech/model/flying-leech.glb', import.meta.url).href;
const towerUrl = new URL('../../../../artifacts/collab/flying-leech/model/basalt-tower.glb', import.meta.url).href;
const windUrl = new URL('../../../../artifacts/collab/flying-leech/model/wind-vortex.glb', import.meta.url).href;

type VisualState = Pick<SnapPlayer, 'alive' | 'char' | 'effects'>;
export interface RoomDecoration {
  room: string;
  asset: 'basalt-tower';
  progress: number;
}
export interface RigPresentation {
  readonly actionClip?: string;
  updateState(state: VisualState, immediate: boolean): void;
  play(clip: string, duration: number, keepStationary?: boolean): boolean;
  update(dt: number, findHost: (id: string) => THREE.Object3D | undefined): void;
  reset(): void;
  dispose(): void;
}
type Options = {
  url: string;
  id: string;
  height: number;
  clips?: Partial<Record<'attackSwing' | 'reviveRise', string>>;
  mounted?: boolean;
  possession?: boolean;
  skeleton?: boolean;
  spectral?: boolean;
  props?: readonly string[];
};
const characters: Readonly<Record<string, Options>> = {
  ghost: { url: ghostUrl, id: 'ghost-v1', height: 1.91, clips: { attackSwing: 'drain' }, possession: true },
  'wild-hunt': { url: huntUrl, id: 'wild-hunt-heathcliff-wraith', height: 1.85, mounted: true },
  'hunchback-archer': { url: archerUrl, id: 'skeleton-archer-v1', height: 2.145, clips: { attackSwing: 'shoot' }, skeleton: true },
  'water-snake': { url: snakeUrl, id: 'flying-leech-v2', height: 1.95, clips: { attackSwing: 'attack', reviveRise: 'revive' }, spectral: true,
    props: ['basalt-tower', 'wind-vortex'] },
};
const urls: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(characters).map(([id, opt]) => [id, opt.url])),
  'basalt-tower': towerUrl, 'wind-vortex': windUrl,
};
const requests = new Map<string, Promise<void>>();
const cache = new Map<string, GLTF>();
async function preload(id: string): Promise<void> {
  if (!urls[id] || cache.has(id)) return;
  let pending = requests.get(id);
  if (!pending) {
    pending = new GLTFLoader().loadAsync(urls[id]).then(gltf => { cache.set(id, gltf); }).catch(() => {
      // One unavailable asset should leave the existing rig usable. A later load can retry.
    }).finally(() => requests.delete(id));
    requests.set(id, pending);
  }
  await pending;
}
export async function preloadCollaborationAssets(ids: readonly string[]): Promise<void> {
  await Promise.all([...new Set(ids.flatMap(id => [id, ...(characters[id]?.props ?? [])]))].map(preload));
}
export function loadedCollaborationVisualId(id: string): string | undefined {
  return cache.has(id) ? characters[id]?.id : undefined;
}

export function cloneAsset(id: string) {
  const gltf = cache.get(id);
  if (!gltf) return;
  const scene = cloneSkeleton(gltf.scene);
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const skeletons = new Set<THREE.Skeleton>();
  scene.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry = node.geometry.clone();
    geometries.add(node.geometry);
    const copy = (material: THREE.Material) => {
      const cloned = material.clone();
      materials.add(cloned);
      return cloned;
    };
    node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
    node.castShadow = !materialsFor(node).some(material => material.transparent);
    node.receiveShadow = !materialsFor(node).some(material => material.transparent && !material.name.includes('hide into mist'));
    if (node instanceof THREE.SkinnedMesh) {
      node.frustumCulled = false;
      skeletons.add(node.skeleton);
    }
  });
  const mixer = new THREE.AnimationMixer(scene);
  const clips = new Map(gltf.animations.map(clip => [clip.name, clip]));
  let action: THREE.AnimationAction | undefined;
  function sample(name: string, seconds: number) {
    const clip = clips.get(name);
    if (!clip) return false;
    if (action?.getClip() !== clip) {
      action?.stop();
      action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1);
      action.play();
      action.paused = true;
    }
    action.time = THREE.MathUtils.clamp(seconds, 0, clip.duration);
    mixer.update(0);
    return true;
  }
  function stop() {
    action?.stop();
    action = undefined;
  }
  return {
    scene, materials: [...materials], clips, sample, stop,
    dispose() {
      stop();
      mixer.uncacheRoot(scene);
      skeletons.forEach(skeleton => skeleton.dispose());
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
      scene.removeFromParent();
    },
  };
}
function materialsFor(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

export function motionTrack(id: string, clip: string, name: string) {
  return cache.get(id)?.animations.find(candidate => candidate.name === clip)?.tracks.find(track => track.name === name);
}

export function roomDecoration(id: string, room: string, state: VisualState): RoomDecoration | undefined {
  if (!characters[id]?.props?.includes('basalt-tower')) return;
  if (typeof state.char.towerBaseRoom === 'string' && Number(state.char.towerHp) > 0) {
    return { room: state.char.towerBaseRoom, asset: 'basalt-tower', progress: 1 };
  }
  if (state.alive && state.char.buildProgress === 1) return { room, asset: 'basalt-tower', progress: .46 };
}

export function makeCollaborationRig(id: string, scale: number): CharacterRig | undefined {
  const opt = characters[id];
  if (!opt) return;
  const asset = cloneAsset(id);
  if (!asset) return;
  const root = new THREE.Group();
  root.name = opt.id;
  root.scale.setScalar(scale);
  root.add(asset.scene);
  const baseMaterials = asset.materials.map(material => ({
    material, opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite,
  }));
  const standard = asset.materials.filter((m): m is THREE.MeshStandardMaterial => m instanceof THREE.MeshStandardMaterial);
  const hostOffset = new THREE.Vector3();
  const worldHost = new THREE.Vector3();
  const hostRotation = new THREE.Quaternion();
  const worldInverse = new THREE.Quaternion();
  const charge = asset.scene.getObjectByName('ChargeOffset');
  let alive = true;
  let mounted = false;
  let downed = false;
  let spectral = false;
  let burning = false;
  let hostId: string | undefined;
  let attachProgress = 0;
  let opacity = 1;
  let active: { clip: string; duration: number; time: number; stationary: boolean } | undefined;

  function paintOpacity() {
    const multiplier = spectral ? .4 : hostId ? THREE.MathUtils.lerp(1, .36, attachProgress) : opacity;
    for (const base of baseMaterials) {
      const transparent = base.transparent || multiplier < .999;
      if (base.material.transparent !== transparent) {
        base.material.transparent = transparent;
        base.material.needsUpdate = true;
      }
      base.material.opacity = base.opacity * multiplier;
      base.material.depthWrite = base.depthWrite && multiplier >= .999;
    }
  }
  const length = (clip: string) => asset!.clips.get(clip)?.duration ?? 1;
  function sample(clip: string, seconds: number) {
    if (!asset!.sample(clip, seconds)) asset!.sample('idle', seconds % length('idle'));
  }
  function play(clip: string, duration: number, stationary = false) {
    if (!asset!.clips.has(clip)) return false;
    if (active?.clip === clip && (clip === 'mount' || clip === 'attach')) return true;
    active = { clip, duration: Math.max(.08, duration || length(clip)), time: 0, stationary };
    return true;
  }
  function once(clip: string, progress: number) {
    if (!active) sample(clip, progress * length(clip));
  }
  function idle(time: number) {
    if (active) return;
    if (downed) { sample('dead', length('dead')); return; }
    const clip = spectral ? 'dead_idle' : hostId ? 'attached_idle' : mounted ? 'mountedIdle' : burning ? 'burn' : 'idle';
    sample(clip, (time % length(clip) + length(clip)) % length(clip));
  }
  const presentation: RigPresentation = {
    actionClip: opt.clips?.attackSwing ?? 'attackSwing',
    updateState(player, immediate) {
      const nextMounted = !!opt.mounted && (player.effects?.some(effect => effect.kind === 'mounted') || player.char.mounted === true);
      const nextDowned = !!opt.skeleton && player.char.downed === true;
      const nextSpectral = !!opt.spectral && player.char.posthumous === true;
      const nextBurning = !!opt.skeleton && !!player.effects?.some(effect => effect.kind === 'burning');
      const nextHost = opt.possession && typeof player.char.possessing === 'string' ? player.char.possessing : undefined;
      alive = player.alive;
      if (!alive || immediate) active = undefined;
      if (alive && !immediate) {
        if (nextDowned !== downed) play(nextDowned ? 'dead' : 'reviveRise', nextDowned ? .86 : .9);
        else if (nextSpectral !== spectral && nextSpectral) play('dead', 1.05);
        else if (nextMounted !== mounted) play(nextMounted ? 'mount' : 'dismount', nextMounted ? 1.1 : 1);
        else if (nextBurning && !burning) play('flinch_burning', .8);
        else if (nextHost && hostId !== nextHost) play('attach', .72);
      }
      if (hostId !== nextHost || immediate) attachProgress = immediate && nextHost ? 1 : 0;
      hostId = alive ? nextHost : undefined;
      mounted = !!nextMounted;
      downed = nextDowned;
      spectral = nextSpectral;
      burning = nextBurning;
      paintOpacity();
    },
    play,
    update(dt, findHost) {
      if (active) {
        active.time += dt;
        sample(active.clip, Math.min(1, active.time / active.duration) * length(active.clip));
        if (charge && active.clip === 'mountedAttack') {
          if (active.stationary) charge.position.set(0, 0, 0);
          else charge.position.z *= .48 * Math.sin(Math.PI * Math.min(1, active.time / active.duration));
        }
        if (active.time >= active.duration) active = undefined;
      }
      const host = hostId && findHost(hostId);
      if (host) {
        attachProgress = Math.min(1, attachProgress + dt / .72);
        host.updateWorldMatrix(true, false);
        root.updateWorldMatrix(true, false);
        host.getWorldQuaternion(hostRotation);
        worldHost.set(.38, .12, -.86).applyMatrix4(host.matrixWorld);
        root.worldToLocal(worldHost);
        hostOffset.copy(worldHost).multiplyScalar(THREE.MathUtils.smoothstep(attachProgress, 0, 1));
        asset!.scene.position.copy(hostOffset);
        root.getWorldQuaternion(worldInverse).invert();
        asset!.scene.quaternion.copy(worldInverse.multiply(hostRotation));
      } else if (opt.possession) {
        attachProgress = 0;
        asset!.scene.position.set(0, 0, 0);
        asset!.scene.quaternion.identity();
      }
      paintOpacity();
    },
    reset() { active = undefined; },
    dispose: asset.dispose,
  };
  return {
    root, presentation, materials: () => standard, headHeight: () => opt.height * root.scale.y,
    setOpacity(value) { opacity = value; paintOpacity(); },
    resetPose: asset.stop,
    idle: time => idle(time),
    walk: time => {
      if (mounted || hostId || spectral || downed) { idle(time); return; }
      if (!active) sample('walk', time % length('walk'));
    },
    attackSwing: progress => once(presentation.actionClip!, progress),
    flinch: progress => once(burning ? 'flinch_burning' : 'flinch', progress),
    cast: time => { if (!active) sample('cast', Math.min(time, length('cast'))); },
    drink: time => idle(time),
    crouch: time => { if (!active) sample('crouch', time % length('crouch')); },
    cheer: time => { if (!active) sample('cheer', time % length('cheer')); },
    dead: progress => once('dead', progress),
    reviveRise: progress => once(opt.clips?.reviveRise ?? 'reviveRise', progress),
  };
}
