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
import { applyHairStyle, setHairStyle } from './hair-style.js';

/** The stage owns placement, timing and feedback. Rigs only pose their local joints. */
export type CharacterRig = Pick<Humanoid,
  'root' | 'materials' | 'setOpacity' | 'headHeight' | 'resetPose' | 'idle' | 'walk' |
  'attackSwing' | 'flinch' | 'cast' | 'drink' | 'crouch' | 'cheer' | 'reviveRise'> & {
  dead(progress: number): void;
  signalActor?(time: number): void;
};

const models = new Map<string, { id: string; create: (scale: number) => CharacterRig }>();

/**
 * 注册（或替换）一名角色的专属 3D 视觉——新角色接入 3D 的唯一接口。
 * 未注册的角色（含未来新增到 shared/src/characters 的角色）自动回退 legacy Humanoid：
 * 取 `charVisual(charId)` 的调色板与道具（未收录时用默认灰蓝），正常出现在对局中。
 * 专用 rig 可通过返回对象上的 `stick` 属性暴露场景要驱动的挂件（见 bagun）。
 */
export function registerCharacterRig(charId: string, visualId: string, create: (scale: number) => CharacterRig): void {
  models.set(charId, { id: visualId, create });
}

/** 当前已注册专属 3D 视觉的角色清单（随注册实时变化） */
export function dedicatedCharIds(): readonly string[] {
  return [...models.keys()];
}

/** 整体显隐某角色实例的发型增强层（新旧对照 / 回退开关） */
export function setCharacterHairStyle(rig: CharacterRig, on: boolean): void {
  setHairStyle(rig, on);
}

export { applyHairStyle, setHairStyle, HAIR_STYLES } from './hair-style.js';

registerCharacterRig('gojo', 'gojo-v1', createGojoRig);
registerCharacterRig('laodaye', 'laodaye-v1', createLaodayeRig);
registerCharacterRig('bagun', 'bagun-v1', createBagunRig);
registerCharacterRig('chuixiao', 'chuixiao-v1', createChuixiaoRig);
registerCharacterRig('wuliuqi', 'wuliuqi-v1', createWuliuqiRig);
registerCharacterRig('mabaoguo', 'mabaoguo-v1', createMabaoguoRig);
registerCharacterRig('ivan-girl', 'ivan-girl-v1', createIvanGirlRig);
registerCharacterRig('hero-today', 'hero-today-v1', createHeroTodayRig);
registerCharacterRig('dajianke', 'dajianke-v1', createDajiankeRig);
registerCharacterRig('dapihuai', 'dapihuai-v1', createDapihuaiRig);
registerCharacterRig('default', 'nobody-v1', createNobodyRig);

/** 注册完成后的专属角色 ID 快照（供取证 harness 等静态枚举使用），随注册表自动同步 */
export const DEDICATED_CHAR_IDS: readonly string[] = dedicatedCharIds();

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
    // 专用 rig 统一挂发型增强层（幂等；复用 rig 材质，随淡入淡出/dispose 生效）。
    // 无 3D 兜底的 legacy Humanoid 挂点未命名，保持原样不动。
    applyHairStyle(rig, charId);
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
