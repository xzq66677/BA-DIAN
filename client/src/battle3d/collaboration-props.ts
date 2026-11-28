import * as THREE from 'three';
import { cloneAsset, motionTrack, type RoomDecoration } from './characters/collab-assets.js';
import type { FxInstance } from './fx.js';
import { createSlotMachineModel } from './slot-machine-model.js';

interface DecorationModel {
  scene: THREE.Object3D;
  setProgress(progress: number): void;
  dispose(): void;
}

const TOWER_SCALE = 0.44;

const modelFactories: Record<RoomDecoration['asset'], () => DecorationModel | undefined> = {
  'basalt-tower': () => {
    const model = cloneAsset('basalt-tower');
    if (!model) return;
    model.scene.name = 'basalt-tower';
    model.scene.scale.setScalar(TOWER_SCALE);
    return { scene: model.scene, dispose: model.dispose,
      setProgress: progress => model.sample('build', progress * (model.clips.get('build')?.duration ?? 1)) };
  },
  'slot-machine': () => {
    const model = createSlotMachineModel();
    model.root.name = 'landed-slot-machine';
    return { scene: model.root, setProgress: progress => model.root.scale.setScalar(.65 * progress),
      dispose() { model.root.removeFromParent(); model.dispose(); } };
  },
};

export class RoomDecorations {
  private items = new Map<string, {
    model: DecorationModel;
    asset: RoomDecoration['asset'];
    room: string;
    progress: number;
    target: number;
    baseY: number;
    hitTime?: number;
    collapseTime?: number;
  }>();

  objectFor(id: string): THREE.Object3D | undefined {
    return this.items.get(id)?.model.scene;
  }

  sync(wanted: ReadonlyMap<string, RoomDecoration>, findRoom: (room: string) => THREE.Object3D | undefined,
    floor: number, immediate: boolean): void {
    for (const [id, item] of this.items) {
      if (!findRoom(item.room)) {
        item.model.dispose();
        this.items.delete(id);
      } else if (!wanted.has(id)) {
        if (item.asset === 'basalt-tower' && item.collapseTime === undefined) item.collapseTime = 0;
        item.target = 0;
      }
    }
    const machinesPerRoom = new Map<string, number>();
    for (const [id, request] of wanted) {
      const room = findRoom(request.room);
      if (!room) continue;
      let item = this.items.get(id);
      if (!item) {
        const model = modelFactories[request.asset]();
        if (!model) continue;
        const progress = request.asset === 'slot-machine' ? request.progress : 0;
        model.setProgress(progress);
        item = { model, asset: request.asset, room: request.room, progress, target: request.progress, baseY: floor };
        this.items.set(id, item);
        room.add(model.scene);
      } else if (item.room !== request.room) {
        room.add(item.model.scene);
        item.room = request.room;
      }
      if (request.asset === 'slot-machine') {
        const index = machinesPerRoom.get(request.room) ?? 0;
        const angle = Math.PI / 4 + index * Math.PI / 5;
        item.model.scene.position.set(1.65 * Math.sin(angle), floor + .1, -1.65 * Math.cos(angle));
        machinesPerRoom.set(request.room, index + 1);
      } else item.model.scene.position.set(0, floor, 0);
      item.target = request.progress;
    }
    if (immediate) this.update(2);
  }

  hit(room: string): void {
    for (const item of this.items.values()) {
      if (item.asset === 'basalt-tower' && item.room === room && item.collapseTime === undefined) item.hitTime = 0;
    }
  }

  collapse(room: string): boolean {
    for (const item of this.items.values()) {
      if (item.asset !== 'basalt-tower' || item.room !== room || item.collapseTime !== undefined) continue;
      item.collapseTime = 0;
      item.target = 0;
      return true;
    }
    return false;
  }

  update(dt: number): boolean {
    let moving = false;
    for (const [id, item] of this.items) {
      if (item.collapseTime !== undefined) {
        item.collapseTime += dt / 0.9;
        const t = THREE.MathUtils.clamp(item.collapseTime, 0, 1);
        const fall = Math.max(0, (t - 0.18) / 0.82);
        const shake = t < 0.22 ? Math.sin(t * 90) * (1 - t / 0.22) * 0.08 : 0;
        item.model.scene.position.set(shake + fall * 0.24, item.baseY - fall * fall * 0.72, shake * 0.5);
        item.model.scene.rotation.set(fall * 0.32, fall * 0.45, shake * 1.8 + fall * 0.62);
        item.model.scene.scale.set(TOWER_SCALE * (1 + fall * 0.22), TOWER_SCALE * (1 - fall * 0.62), TOWER_SCALE * (1 + fall * 0.22));
        moving = true;
        if (t >= 1) {
          item.model.dispose();
          this.items.delete(id);
        }
        continue;
      }
      if (item.hitTime !== undefined && item.hitTime < 0.34) {
        item.hitTime += dt;
        const t = THREE.MathUtils.clamp(item.hitTime / 0.34, 0, 1);
        const shake = Math.sin(t * 46) * (1 - t) * 0.055;
        item.model.scene.position.set(shake, item.baseY, 0);
        item.model.scene.rotation.z = shake * 1.4;
        moving = true;
        if (t >= 1) {
          item.model.scene.position.set(0, item.baseY, 0);
          item.model.scene.rotation.z = 0;
          item.hitTime = undefined;
        }
        continue;
      }
      const step = dt * (item.target === 0 ? 1.8 : .95);
      item.progress += THREE.MathUtils.clamp(item.target - item.progress, -step, step);
      if (item.target === 0 && item.progress < .001) {
        item.model.dispose();
        this.items.delete(id);
      } else {
        item.model.setProgress(item.progress);
        moving ||= item.progress !== item.target;
      }
    }
    return moving;
  }

  dispose() {
    for (const item of this.items.values()) item.model.dispose();
    this.items.clear();
  }
}

export function windTravel(clip: 'inhale' | 'exhale', from: THREE.Vector3, to: THREE.Vector3) {
  const track = motionTrack('wind-vortex', clip, 'WindTargetMotion.position');
  if (!track || track.getValueSize() !== 3) return;
  const interpolation = new THREE.LinearInterpolant(track.times, track.values, 3);
  const endTime = track.times[track.times.length - 1];
  const first = Array.from(interpolation.evaluate(0));
  const end = Array.from(interpolation.evaluate(endTime));
  const depth = end[2] - first[2];
  if (Math.abs(depth) < .001) return;
  const forward = to.clone().sub(from).setY(0).normalize();
  const sideways = new THREE.Vector3(forward.z, 0, -forward.x);
  return (t: number) => {
    const [x, y, z] = interpolation.evaluate(t * endTime);
    const progress = THREE.MathUtils.clamp((z - first[2]) / depth, 0, 1);
    const result = from.clone().lerp(to, progress);
    result.addScaledVector(sideways, x - THREE.MathUtils.lerp(first[0], end[0], t));
    result.y = Math.max(0, y - THREE.MathUtils.lerp(first[1], end[1], t));
    return result;
  };
}

/**
 * 漩涡吸附曲线（「吸」的落点演出，Issue #99）：以落点为轴心螺旋收敛，
 * 半径线性衰减、绕行圈数随距离增加，中途轻微离地被吸起。t=1 精确落在 to。
 * 纯代码生成，不依赖 wind-vortex.glb 的自定义轨道。
 */
export function vortexPull(from: THREE.Vector3, to: THREE.Vector3) {
  const dx = from.x - to.x;
  const dz = from.z - to.z;
  const radius = Math.hypot(dx, dz);
  if (radius < .001) return;
  const angle0 = Math.atan2(dz, dx);
  const turns = radius > 1.6 ? 1.25 : 0.75;
  const lift = Math.min(.45, radius * .18);
  const baseY = to.y;
  return (t: number) => {
    const angle = angle0 + turns * Math.PI * 2 * t;
    const r = radius * (1 - t);
    return new THREE.Vector3(
      to.x + Math.cos(angle) * r,
      baseY + lift * Math.sin(Math.PI * t),
      to.z + Math.sin(angle) * r,
    );
  };
}

export function windAssetFx(clip: 'inhale' | 'exhale', delta: THREE.Vector3, seconds: number): FxInstance | undefined {
  const model = cloneAsset('wind-vortex');
  if (!model) return;
  model.scene.rotation.y = Math.atan2(delta.x, delta.z);
  model.scene.scale.set(.76, .76, Math.max(.17, Math.hypot(delta.x, delta.z) / 2.93));
  const duration = model.clips.get(clip)?.duration ?? 1;
  return {
    object: model.scene,
    update(_dt, elapsed) {
      model.sample(clip, Math.min(1, elapsed / seconds) * duration);
      return elapsed < seconds;
    },
    dispose: model.dispose,
  };
}
