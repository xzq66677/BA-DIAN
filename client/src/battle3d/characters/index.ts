import * as THREE from 'three';
import { charVisual } from '../palette.js';
import { Humanoid, buildProp } from '../rig.js';
import { createGojoRig } from './gojo.js';

/** The stage owns placement, timing and feedback. Rigs only pose their local joints. */
export type CharacterRig = Pick<Humanoid,
  'root' | 'materials' | 'setOpacity' | 'headHeight' | 'resetPose' | 'idle' | 'walk' |
  'attackSwing' | 'flinch' | 'cast' | 'drink' | 'crouch' | 'cheer' | 'reviveRise'> & {
  dead(progress: number): void;
  signalActor?(time: number): void;
};

const models = new Map<string, { id: string; create: (scale: number) => CharacterRig }>([
  ['gojo', { id: 'gojo-v1', create: createGojoRig }],
]);

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
  return { id: model?.id ?? 'humanoid', rig, stick, dispose() {
    if (disposed) return;
    disposed = true;
    rig.root.removeFromParent();
    releaseMeshes(rig.root);
  } };
}
