import * as THREE from 'three';
import { TABLE, type RoomAnchor, type Vec2 } from './layout.js';

export const RUINS_COLORS = {
  sky: 0x101b2b,
  bronze: 0xc5a66a,
  footings: 0x273044,
  ashlar: 0x626674,
  seam: 0x394856,
} as const;

const stone = (color: number) => new THREE.MeshStandardMaterial({
  color, flatShading: true, roughness: 0.93,
});

/** Terraced rock strata supporting detached floor meshes. Each subtree owns its resources. */
export function island(radius: number, seed: number, height: number): THREE.Group {
  const group = new THREE.Group();
  const layers = [
    { top: 1.04, bottom: 0.95, depth: 0.42, color: 0x555e6d },
    { top: 0.91, bottom: 0.74, depth: 0.57, color: RUINS_COLORS.footings },
    { top: 0.75, bottom: 0.37, depth: height * 0.48, color: 0x384455 },
    { top: 0.4, bottom: 0.11, depth: height * 0.46, color: 0x30374b },
  ];
  let y = 0.05;
  for (const [i, layer] of layers.entries()) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * layer.top, radius * layer.bottom, layer.depth, 6),
      stone(layer.color),
    );
    mesh.rotation.y = Math.PI / 6 + (i < 2 ? 0 : Math.sin(seed + i) * 0.14);
    mesh.position.set(i < 2 ? 0 : Math.cos(seed) * i * 0.14, y - layer.depth / 2, 0);
    group.add(mesh);
    y -= layer.depth;
  }
  return group;
}

export function createRuinsEnvironment(): { root: THREE.Group; motes: THREE.Points; relic: THREE.Mesh } {
  const root = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0xb8d3ff, 0x485066, 1.52);
  const sun = new THREE.DirectionalLight(0xffe1ac, 2.25);
  sun.position.set(7, 12, 5);
  const rim = new THREE.DirectionalLight(0x719ddd, 0.9);
  rim.position.set(-9, 5, -9);
  root.add(hemi, sun, rim);

  const core = new THREE.Group();
  core.position.y = 0.46;
  core.add(island(TABLE.coreRadius * 1.2, 7, 3.8));
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.88, 3.14, 0.43, 12), stone(0x5e6472));
  deck.position.y = 0.12;
  core.add(deck);
  const inlayMaterial = new THREE.MeshBasicMaterial({ color: 0xc3a272, transparent: true, opacity: 0.66 });
  for (const radius of [2.58, 2.08, 0.93]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.024, 4, 12), inlayMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.345;
    core.add(ring);
  }
  const spokes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.018, 0.43), inlayMaterial, 12);
  const transform = new THREE.Object3D();
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    transform.position.set(Math.sin(angle) * 1.74, 0.35, Math.cos(angle) * 1.74);
    transform.rotation.y = angle;
    transform.updateMatrix();
    spokes.setMatrixAt(i, transform.matrix);
  }
  core.add(spokes);
  const relic = new THREE.Mesh(new THREE.OctahedronGeometry(0.64),
    new THREE.MeshStandardMaterial({ color: 0x95cadc, emissive: 0x367f8f, emissiveIntensity: 0.65, roughness: 0.32, metalness: 0.38 }));
  relic.position.y = 1.56;
  core.add(relic);
  root.add(core);

  // Fragmented silhouettes below the fighting plane.
  const fragments = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1), stone(0x3d536a), 30);
  for (let i = 0; i < fragments.count; i++) {
    const a = i * 2.39996;
    const r = 9 + (i * 17 % 31) * 0.6;
    const size = 0.21 + (i * 7 % 19) * 0.065;
    transform.position.set(Math.sin(a) * r, -3.5 - (i * 13 % 17) * 0.34, Math.cos(a) * r);
    transform.rotation.set(a * 0.72, a, a * 0.38);
    transform.scale.set(size, size * 1.25, size * 0.72);
    transform.updateMatrix();
    fragments.setMatrixAt(i, transform.matrix);
  }
  root.add(fragments);
  const dust = new Float32Array(72 * 3);
  for (let i = 0; i < 72; i++) {
    const r = 3 + (i * 23 % 59) * 0.34;
    const a = i * 2.39996;
    dust.set([Math.sin(a) * r, -2.5 + (i * 17 % 19) * 0.21, Math.cos(a) * r], 3 * i);
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(dust, 3));
  const motes = new THREE.Points(dustGeometry,
    new THREE.PointsMaterial({ color: 0x9ed2de, size: 0.095, transparent: true, opacity: 0.53, depthWrite: false }));
  root.add(motes);
  return { root, motes, relic };
}

export function buildBridge(anchor: RoomAnchor, destination: Vec2, destinationRadius: number): THREE.Group {
  const origin = new THREE.Vector3(anchor.center.x, 0, anchor.center.z);
  const target = new THREE.Vector3(destination.x, 0, destination.z);
  const direction = target.clone().sub(origin).normalize();
  const start = origin.addScaledVector(direction, anchor.radius - 0.14);
  const end = target.addScaledVector(direction, -destinationRadius + 0.12);
  const bridge = new THREE.Group();
  const span = start.distanceTo(end);
  if (span < 0.25) return bridge;
  bridge.position.copy(start).lerp(end, 0.5);
  bridge.rotation.y = Math.atan2(direction.x, direction.z);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(1.23, 0.31, span), stone(0x596475));
  deck.position.y = 0.43;
  bridge.add(deck);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.1, span), stone(0x30394b));
  trim.position.y = 0.23;
  bridge.add(trim);
  const count = Math.max(2, Math.ceil(span / 0.56));
  const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1.06, 0.05, (span / count) * 0.89), stone(0x788291), count);
  const t = new THREE.Matrix4();
  for (let i = 0; i < count; i++) blocks.setMatrixAt(i, t.makeTranslation(0, 0.61, span * ((i + 0.5) / count - 0.5)));
  bridge.add(blocks);
  return bridge;
}
