import * as THREE from 'three';

export interface SlotMachineModelStats {
  meshes: number;
  materials: number;
  geometries: number;
  triangles: number;
}

export interface SlotMachineModel {
  root: THREE.Group;
  lever: THREE.Group;
  reels: THREE.Group[];
  dispose(): void;
  stats: SlotMachineModelStats;
}

type MeshWithResources = THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>;

function standard(color: number, metalness: number, roughness: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

function extrude(shape: THREE.Shape | THREE.Shape[], depth: number, bevel = 0.012): THREE.ExtrudeGeometry {
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments: 5,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
  });
}

function chamferedShape(width: number, height: number, chamfer: number): THREE.Shape {
  const w = width / 2;
  const h = height / 2;
  const c = Math.min(chamfer, w, h);
  const shape = new THREE.Shape();
  shape.moveTo(-w + c, -h);
  shape.lineTo(w - c, -h);
  shape.lineTo(w, -h + c);
  shape.lineTo(w, h - c);
  shape.lineTo(w - c, h);
  shape.lineTo(-w + c, h);
  shape.lineTo(-w, h - c);
  shape.lineTo(-w, -h + c);
  shape.closePath();
  return shape;
}

function crownShape(): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-0.64, 0);
  shape.lineTo(0.64, 0);
  shape.lineTo(0.64, 0.14);
  shape.lineTo(0.52, 0.14);
  shape.lineTo(0.52, 0.24);
  shape.lineTo(0.38, 0.24);
  shape.lineTo(0.38, 0.32);
  shape.lineTo(0.22, 0.32);
  shape.lineTo(0.22, 0.40);
  shape.lineTo(0.11, 0.40);
  shape.lineTo(0.11, 0.46);
  shape.lineTo(-0.11, 0.46);
  shape.lineTo(-0.11, 0.40);
  shape.lineTo(-0.22, 0.40);
  shape.lineTo(-0.22, 0.32);
  shape.lineTo(-0.38, 0.32);
  shape.lineTo(-0.38, 0.24);
  shape.lineTo(-0.52, 0.24);
  shape.lineTo(-0.52, 0.14);
  shape.lineTo(-0.64, 0.14);
  shape.closePath();
  return shape;
}

function archedWindow(cx: number): THREE.Path {
  const r = 0.135;
  const shoulder = 0.075;
  const bottom = -0.215;
  const path = new THREE.Path();
  path.moveTo(cx - r, bottom);
  path.lineTo(cx - r, shoulder);
  path.absarc(cx, shoulder, r, Math.PI, 0, true);
  path.lineTo(cx + r, bottom);
  path.closePath();
  return path;
}

function sevenShape(cx: number): THREE.Shape {
  const points = [
    [-0.046, 0.072], [0.046, 0.072], [0.046, 0.058], [0.006, -0.072],
    [-0.016, -0.072], [0.034, 0.058], [-0.046, 0.058],
  ];
  const shape = new THREE.Shape();
  points.forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(cx + x, y);
    else shape.lineTo(cx + x, y);
  });
  shape.closePath();
  return shape;
}

function sunburstGeometry(): THREE.BufferGeometry {
  const vertices: number[] = [];
  const rays = [-0.95, -0.64, -0.32, 0, 0.32, 0.64, 0.95];
  for (const slope of rays) {
    const endX = slope * 0.42;
    const endY = 0.19 - Math.abs(slope) * 0.035;
    vertices.push(
      -0.012, 0, 0,
      endX - 0.012, endY, 0,
      endX + 0.012, endY, 0,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function reelBarsGeometry(): THREE.BufferGeometry {
  const vertices: number[] = [];
  const widths = [0.14, 0.105, 0.07];
  widths.forEach((width, index) => {
    const y = 0.058 - index * 0.058;
    const h = 0.026;
    vertices.push(
      -width / 2, y - h / 2, 0, width / 2, y - h / 2, 0, width / 2, y + h / 2, 0,
      -width / 2, y - h / 2, 0, width / 2, y + h / 2, 0, -width / 2, y + h / 2, 0,
    );
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function sunGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 16; i += 1) {
    const angle = Math.PI / 2 + (i * Math.PI) / 8;
    const radius = i % 2 === 0 ? 0.082 : 0.043;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return extrude(shape, 0.012, 0.003);
}

function addMesh(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  const count = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
  return Math.floor(count / 3);
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
    const mesh = object as Partial<MeshWithResources>;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) {
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of list) {
        materials.add(material);
        for (const value of Object.values(material)) {
          const values = Array.isArray(value) ? value : [value];
          for (const entry of values) {
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
 * Authored, asset-free Art-Deco cabinet. The pivot is at the centre of its feet,
 * at ground height; all decoration is built from shared low-poly geometry.
 */
export function createSlotMachineModel(): SlotMachineModel {
  const root = new THREE.Group();
  root.name = 'slot-machine';
  root.userData.slotMachineModel = true;

  const red = standard(0x9d2435, 0.38, 0.34);
  const redDark = standard(0x4c101c, 0.28, 0.48);
  const gold = standard(0xd8ad45, 0.72, 0.27);
  gold.side = THREE.DoubleSide;
  const cream = standard(0xf2dfb7, 0.08, 0.56);
  const black = standard(0x100d13, 0.12, 0.72);
  const bulb = new THREE.MeshStandardMaterial({
    color: 0xffe7a3,
    emissive: 0xffb52e,
    emissiveIntensity: 1.15,
    metalness: 0.12,
    roughness: 0.3,
  });

  // Chamfered cabinet shell: a tapered extrusion rather than a plain box.
  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(-0.55, 0.22);
  bodyShape.lineTo(0.55, 0.22);
  bodyShape.lineTo(0.60, 0.34);
  bodyShape.lineTo(0.56, 1.38);
  bodyShape.lineTo(-0.56, 1.38);
  bodyShape.lineTo(-0.60, 0.34);
  bodyShape.closePath();
  const body = addMesh(root, 'cabinet-shell', extrude(bodyShape, 0.66, 0.022), red);
  body.position.z = -0.34;

  const railGeometry = new THREE.BoxGeometry(0.042, 1.02, 0.032);
  for (const side of [-1, 1]) {
    const rail = addMesh(root, `cabinet-rail-${side}`, railGeometry, gold);
    rail.position.set(side * 0.565, 0.86, 0.352);
    rail.rotation.z = side * -0.035;
  }

  // Stepped base and chamfered plinth share one authored prism.
  const plinthGeometry = extrude(chamferedShape(1, 1, 0.085), 1, 0.015);
  const tiers = [
    { width: 1.25, height: 0.09, depth: 0.78, y: 0.055 },
    { width: 1.17, height: 0.08, depth: 0.74, y: 0.135 },
    { width: 1.09, height: 0.09, depth: 0.70, y: 0.215 },
  ];
  tiers.forEach((tier, index) => {
    const mesh = addMesh(root, `base-tier-${index}`, plinthGeometry, index === 1 ? redDark : red);
    mesh.scale.set(tier.width, tier.height, tier.depth);
    mesh.position.set(0, tier.y, -tier.depth / 2);
  });
  const trimGeometry = new THREE.BoxGeometry(1, 0.018, 1);
  for (const [index, y] of [0.095, 0.185].entries()) {
    const trim = addMesh(root, `base-gold-trim-${index}`, trimGeometry, gold);
    trim.scale.set(index === 0 ? 1.20 : 1.12, 1, index === 0 ? 0.755 : 0.715);
    trim.position.set(0, y, 0);
  }

  const footGeometry = new THREE.CylinderGeometry(0.062, 0.07, 0.055, 8);
  const feet = new THREE.InstancedMesh(footGeometry, black, 4);
  feet.name = 'cabinet-feet';
  const transform = new THREE.Object3D();
  let footIndex = 0;
  for (const x of [-0.47, 0.47]) {
    for (const z of [-0.27, 0.27]) {
      transform.position.set(x, 0.0275, z);
      transform.updateMatrix();
      feet.setMatrixAt(footIndex++, transform.matrix);
    }
  }
  feet.instanceMatrix.needsUpdate = true;
  feet.computeBoundingBox();
  root.add(feet);

  // Lower control fascia with Deco grooves, dial and coin return.
  const fasciaShape = new THREE.Shape();
  fasciaShape.moveTo(-0.48, -0.13);
  fasciaShape.lineTo(0.48, -0.13);
  fasciaShape.lineTo(0.42, 0.13);
  fasciaShape.lineTo(-0.42, 0.13);
  fasciaShape.closePath();
  const fascia = addMesh(root, 'control-fascia', extrude(fasciaShape, 0.035, 0.008), cream);
  fascia.position.set(0, 0.50, 0.345);
  const grooveGeometry = new THREE.BoxGeometry(1, 1, 1);
  [0.43, 0.49, 0.55].forEach((y, index) => {
    const groove = addMesh(root, `fascia-groove-${index}`, grooveGeometry, redDark);
    groove.scale.set(0.62 - index * 0.11, 0.014, 0.012);
    groove.position.set(-0.035, y, 0.392);
  });
  const dialGeometry = new THREE.CylinderGeometry(0.046, 0.052, 0.032, 12);
  const dial = addMesh(root, 'control-dial', dialGeometry, red);
  dial.rotation.x = Math.PI / 2;
  dial.position.set(0.40, 0.50, 0.405);

  const tray = addMesh(root, 'coin-tray', grooveGeometry, gold);
  tray.scale.set(0.57, 0.115, 0.15);
  tray.position.set(0, 0.295, 0.37);
  const trayInset = addMesh(root, 'coin-tray-inset', grooveGeometry, black);
  trayInset.scale.set(0.45, 0.052, 0.012);
  trayInset.position.set(0, 0.305, 0.451);
  const coinGeometry = new THREE.CylinderGeometry(0.034, 0.034, 0.012, 10);
  const coins = new THREE.InstancedMesh(coinGeometry, gold, 3);
  coins.name = 'tray-coins';
  for (let i = 0; i < 3; i += 1) {
    transform.position.set((i - 1) * 0.105, 0.322, 0.424 + (i % 2) * 0.018);
    transform.rotation.set(0.08, 0, (i - 1) * 0.12);
    transform.scale.set(1, 1, 1);
    transform.updateMatrix();
    coins.setMatrixAt(i, transform.matrix);
  }
  coins.instanceMatrix.needsUpdate = true;
  coins.computeBoundingBox();
  root.add(coins);

  // A single extruded bezel contains all three arched reel windows.
  const bezelShape = chamferedShape(1.14, 0.62, 0.075);
  bezelShape.holes.push(archedWindow(-0.34), archedWindow(0), archedWindow(0.34));
  const bezel = addMesh(root, 'reel-window-bezel', extrude(bezelShape, 0.07, 0.012), gold);
  bezel.position.set(0, 1.03, 0.365);
  const reelBack = addMesh(root, 'reel-window-back', grooveGeometry, black);
  reelBack.scale.set(1.06, 0.50, 0.035);
  reelBack.position.set(0, 1.03, 0.365);

  const drumGeometry = new THREE.CylinderGeometry(0.155, 0.155, 0.22, 14);
  const rimGeometry = new THREE.CylinderGeometry(0.161, 0.161, 0.014, 14);
  const diamondGeometry = new THREE.OctahedronGeometry(0.086, 0);
  const barsGeometry = reelBarsGeometry();
  const starGeometry = sunGeometry();
  const glyphs = [diamondGeometry, barsGeometry, starGeometry];
  const glyphMaterials = [red, gold, cream];
  const reels: THREE.Group[] = [];
  for (let i = 0; i < 3; i += 1) {
    const reel = new THREE.Group();
    reel.name = `slot-reel-${i}`;
    reel.userData.reelIndex = i;
    reel.position.set((i - 1) * 0.34, 1.03, 0.345);
    const drum = addMesh(reel, `reel-drum-${i}`, drumGeometry, cream);
    drum.rotation.z = Math.PI / 2;
    for (const side of [-1, 1]) {
      const rim = addMesh(reel, `reel-rim-${i}-${side}`, rimGeometry, gold);
      rim.rotation.z = Math.PI / 2;
      rim.position.x = side * 0.116;
    }
    const glyph = addMesh(reel, `reel-symbol-${i}`, glyphs[i], glyphMaterials[i]);
    glyph.position.z = 0.171;
    if (i === 0) glyph.scale.set(0.82, 1, 0.28);
    root.add(reel);
    reels.push(reel);
  }

  // Stepped marquee, inset red field, cream title card, rays and sculpted 777s.
  const crownGeometry = extrude(crownShape(), 0.72, 0.016);
  const crown = addMesh(root, 'marquee-gold-crown', crownGeometry, gold);
  crown.position.set(0, 1.34, -0.36);
  const crownInset = addMesh(root, 'marquee-red-inset', crownGeometry, redDark);
  crownInset.scale.set(0.94, 0.82, 1.012);
  crownInset.position.set(0, 1.365, -0.354);
  const titleCard = addMesh(root, 'marquee-title-card', grooveGeometry, cream);
  titleCard.scale.set(0.91, 0.205, 0.026);
  titleCard.position.set(0, 1.495, 0.385);
  const rays = addMesh(root, 'marquee-sunburst', sunburstGeometry(), gold);
  rays.position.set(0, 1.555, 0.405);
  const sevens = addMesh(root, 'marquee-sevens', extrude([sevenShape(-0.19), sevenShape(0), sevenShape(0.19)], 0.014, 0.003), red);
  sevens.position.set(0, 1.495, 0.408);

  // All bulbs are one instanced draw call along the authored crown outline.
  const bulbPositions: Array<[number, number, number]> = [];
  for (let i = 0; i < 9; i += 1) bulbPositions.push([-0.54 + i * 0.135, 1.395, 0.395]);
  for (const side of [-1, 1]) {
    bulbPositions.push(
      [side * 0.59, 1.46, 0.395], [side * 0.59, 1.54, 0.395],
      [side * 0.48, 1.62, 0.395], [side * 0.34, 1.70, 0.395],
      [side * 0.20, 1.76, 0.395],
    );
  }
  bulbPositions.push([-0.075, 1.785, 0.395], [0.075, 1.785, 0.395]);
  const bulbGeometry = new THREE.SphereGeometry(0.022, 8, 6);
  const bulbs = new THREE.InstancedMesh(bulbGeometry, bulb, bulbPositions.length);
  bulbs.name = 'slot-bulbs';
  transform.rotation.set(0, 0, 0);
  transform.scale.set(1, 1, 1);
  bulbPositions.forEach(([x, y, z], index) => {
    transform.position.set(x, y, z);
    transform.updateMatrix();
    bulbs.setMatrixAt(index, transform.matrix);
  });
  bulbs.instanceMatrix.needsUpdate = true;
  bulbs.computeBoundingBox();
  root.add(bulbs);

  // Side vents and diamond escutcheons add silhouette detail without textures.
  const ventGeometry = new THREE.BoxGeometry(1, 1, 1);
  const vents = new THREE.InstancedMesh(ventGeometry, black, 6);
  vents.name = 'cabinet-vents';
  let ventIndex = 0;
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i += 1) {
      transform.position.set(side * 0.592, 0.64 + i * 0.095, -0.03);
      transform.scale.set(0.012, 0.026, 0.20);
      transform.updateMatrix();
      vents.setMatrixAt(ventIndex++, transform.matrix);
    }
  }
  vents.instanceMatrix.needsUpdate = true;
  vents.computeBoundingBox();
  root.add(vents);
  const escutcheonGeometry = new THREE.OctahedronGeometry(0.055, 0);
  for (const side of [-1, 1]) {
    const badge = addMesh(root, `cabinet-diamond-${side}`, escutcheonGeometry, gold);
    badge.scale.set(0.38, 1, 0.22);
    badge.position.set(side * 0.57, 1.27, 0.37);
  }

  // Functional lever pivot: the returned group can be animated without moving the cabinet.
  const lever = new THREE.Group();
  lever.name = 'slot-lever';
  lever.userData.baseRotationZ = -0.28;
  lever.position.set(0.59, 0.73, -0.02);
  lever.rotation.z = -0.28;
  const pivotGeometry = new THREE.CylinderGeometry(0.068, 0.068, 0.075, 12);
  const pivot = addMesh(lever, 'lever-pivot', pivotGeometry, gold);
  pivot.rotation.x = Math.PI / 2;
  const armGeometry = new THREE.CylinderGeometry(0.018, 0.022, 0.38, 10);
  const arm = addMesh(lever, 'lever-arm', armGeometry, gold);
  arm.position.y = 0.19;
  const knobGeometry = new THREE.SphereGeometry(0.057, 12, 8);
  const knob = addMesh(lever, 'lever-knob', knobGeometry, red);
  knob.position.y = 0.405;
  root.add(lever);

  root.updateMatrixWorld(true);
  const resources = collectResources(root);
  let meshes = 0;
  let triangles = 0;
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes += 1;
    const instances = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
    triangles += triangleCount(mesh.geometry) * instances;
  });

  let disposed = false;
  return {
    root,
    lever,
    reels,
    stats: {
      meshes,
      materials: resources.materials.size,
      geometries: resources.geometries.size,
      triangles,
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      resources.instancedMeshes.forEach((mesh) => mesh.dispose());
      resources.geometries.forEach((geometry) => geometry.dispose());
      resources.materials.forEach((material) => material.dispose());
      resources.textures.forEach((texture) => texture.dispose());
    },
  };
}
