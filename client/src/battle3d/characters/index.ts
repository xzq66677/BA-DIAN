import * as THREE from 'three';
import { charVisual } from '../palette.js';
import { Humanoid, buildProp } from '../rig.js';
import { createGojoRig } from './gojo.js';
import { createLaodayeRig } from './laodaye.js';
import { createBagunRig } from './bagun.js';
import { createChuixiaoRig } from './chuixiao.js';
import { createWuliuqiRig } from './wuliuqi.js';
import { createMabaoguoRig } from './mabaoguo.js';
import { createIvanGirlRig } from './ivan-girl.js';
import { createHeroTodayRig } from './hero-today.js';
import { createDajiankeRig } from './dajianke.js';
import { createDapihuaiRig } from './dapihuai.js';
import { createNobodyRig } from './nobody.js';

/** The stage owns placement, timing and feedback. Rigs only pose their local joints. */
export type CharacterRig = Pick<Humanoid,
  'root' | 'materials' | 'setOpacity' | 'headHeight' | 'resetPose' | 'idle' | 'walk' |
  'attackSwing' | 'flinch' | 'cast' | 'drink' | 'crouch' | 'cheer' | 'reviveRise'> & {
  dead(progress: number): void;
  signalActor?(time: number): void;
};

const models = new Map<string, { id: string; create: (scale: number) => CharacterRig }>([
  ['gojo', { id: 'gojo-v1', create: createGojoRig }],
  ['laodaye', { id: 'laodaye-v1', create: createLaodayeRig }],
  ['bagun', { id: 'bagun-v1', create: createBagunRig }],
  ['chuixiao', { id: 'chuixiao-v1', create: createChuixiaoRig }],
  ['wuliuqi', { id: 'wuliuqi-v1', create: createWuliuqiRig }],
  ['mabaoguo', { id: 'mabaoguo-v1', create: createMabaoguoRig }],
  ['ivan-girl', { id: 'ivan-girl-v1', create: createIvanGirlRig }],
  ['hero-today', { id: 'hero-today-v1', create: createHeroTodayRig }],
  ['dajianke', { id: 'dajianke-v1', create: createDajiankeRig }],
  ['dapihuai', { id: 'dapihuai-v1', create: createDapihuaiRig }],
  ['default', { id: 'nobody-v1', create: createNobodyRig }],
]);

/** 已有专属 3D 视觉的角色（测试与文档按此清单收窄 legacy 断言） */
export const DEDICATED_CHAR_IDS: readonly string[] = [...models.keys()];

/** All geometries and materials in this subtree belong to this instance. */
export function releaseMeshes(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (Array.isArray(mesh.material)) mesh.material.forEach(m => materials.add(m));
    else if (mesh.material) materials.add(mesh.material);
  });
  geometries.forEach(g => g.dispose());
  materials.forEach(m => m.dispose());
}

export function createCharacterAsset(charId: string) {
  const spec = charVisual(charId);
  const model = models.get(charId);
  let rig: CharacterRig;
  let stick: THREE.Object3D | null = null;
  if (model) {
    rig = model.create(spec.scale);
  } else {
    const legacy = new Humanoid({ main: spec.color, accent: spec.accent, skin: 0xe8c49a, dark: 0x2e2822 }, { scale: spec.scale });
    for (const m of legacy.materials()) m.emissive.copy(m.color).multiplyScalar(0.16);
    const prop = buildProp(spec.prop);
    if (prop.hand) legacy.handR.add(prop.hand);
    if (prop.headTop) legacy.headTop.add(prop.headTop);
    if (prop.back) legacy.back.add(prop.back);
    stick = prop.stick ?? null;
    rig = legacy;
  }
  let disposed = false;
  if (model) {
    // 专用 rig 可通过同名属性暴露场景要驱动的挂件（如拔棍的 stick）
    stick = (rig as { stick?: THREE.Object3D | null }).stick ?? null;
  }
  return { id: model?.id ?? 'humanoid', rig, stick, dispose() {
    if (disposed) return;
    disposed = true;
    rig.root.removeFromParent();
    releaseMeshes(rig.root);
  } };
}
