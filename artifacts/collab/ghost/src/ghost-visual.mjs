import { AnimationMixer, LoopOnce } from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

const limit = (n) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/** Creates one instance of the authored GLB. The cache owns the source geometries. */
export function createGhostVisual(gltf) {
  const root = clone(gltf.scene);
  const mixer = new AnimationMixer(root);
  const clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
  const materialGroups = { body: new Map(), drain: new Map(), smoke: new Map() };
  const body = root.getObjectByName('BodyPivot');
  const drain = root.getObjectByName('DrainFX');
  const smoke = root.getObjectByName('SmokeFX');

  for (const [name, group] of Object.entries({ body, drain, smoke })) {
    const materials = materialGroups[name];
    group.traverse((object) => {
      if (!object.isMesh) return;
      const source = object.material;
      if (!materials.has(source)) {
        const copy = source.clone();
        copy.transparent = true;
        copy.depthWrite = false;
        materials.set(source, copy);
      }
      object.material = materials.get(source);
    });
  }
  let opacity = 1;
  let active;
  let current;
  let progress = 0;
  let disposed = false;

  function updateMaterialOpacity() {
    const isDying = current === 'dead';
    const bodyOpacity = isDying ? 1 - limit((progress - 0.06) / 0.49) : 1;
    const smokeOpacity = isDying ? limit(progress / 0.22) * (1 - limit((progress - 0.46) / 0.54)) : 0;
    const drainOpacity = current === 'drain' ? limit((progress - 0.14) / 0.19) * (1 - limit((progress - 0.58) / 0.27)) : 0;
    body.visible = bodyOpacity > 0;
    drain.visible = drainOpacity > 0;
    smoke.visible = smokeOpacity > 0;
    for (const [source, copy] of materialGroups.body) copy.opacity = source.opacity * opacity * bodyOpacity;
    for (const [source, copy] of materialGroups.drain) copy.opacity = source.opacity * drainOpacity;
    for (const [source, copy] of materialGroups.smoke) copy.opacity = source.opacity * smokeOpacity;
  }

  function sample(name, fraction) {
    if (disposed) return;
    const clip = clips.get(name) ?? clips.get('idle');
    if (clip.name !== current) {
      active?.stop();
      active = mixer.clipAction(clip).reset().setLoop(LoopOnce, 1);
      active.clampWhenFinished = true;
      active.play();
      active.paused = true;
      current = clip.name;
    }
    progress = limit(fraction);
    active.time = clip.duration * progress;
    mixer.update(0);
    updateMaterialOpacity();
  }

  sample('idle', 0);
  return {
    root,
    sample,
    setOpacity(multiplier) {
      if (disposed) return;
      opacity = limit(multiplier);
      updateMaterialOpacity();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      root.removeFromParent();
      for (const materials of Object.values(materialGroups)) {
        for (const copy of materials.values()) copy.dispose();
        materials.clear();
      }
    },
  };
}
