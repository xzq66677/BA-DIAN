import * as THREE from 'three';
import { TABLE, type RoomAnchor } from './layout.js';
import { releaseMeshes } from './characters/index.js';
import { GOLD, roomVisual } from './palette.js';
import { island, RUINS_COLORS } from './ruins.js';

const PLATFORM_H = TABLE.roomHeight;

export interface RoomView {
  rid: string;
  anchor: RoomAnchor;
  slots: Map<string, number>;
  bridge: THREE.Group | null;
  pulse: { kind: 'aoe' | 'blast' | 'hit' | 'heal'; until: number } | null;
  group: THREE.Group;
  beaconMat: THREE.MeshBasicMaterial;
  edgeMat: THREE.MeshBasicMaterial;
  dome: THREE.Mesh | null;       // 领域穹顶
  label: HTMLDivElement;
  labelCount: HTMLSpanElement;
  labelPending: HTMLSpanElement;
  labelMud: HTMLSpanElement;
  labelObjects: HTMLSpanElement;
  pos: THREE.Vector3;
  pendingIvan: boolean;
  bombMarker: THREE.Group | null;
}

interface RoomLabelControls {
  canPick(rid: string): boolean;
  pick(rid: string): void;
  hover(rid: string): void;
}

export function buildRoomView(anchor: RoomAnchor, controls: RoomLabelControls): RoomView {
  const rid = anchor.id;
  const vis = roomVisual(rid);
  const group = new THREE.Group();
  group.userData.room = rid;
  const { center: pos0, yaw } = anchor;
  group.position.set(pos0.x, 0, pos0.z);
  group.rotation.y = yaw;
  group.add(island(anchor.radius, pos0.x + pos0.z, 2.55));

  // 石台主体（六棱柱，有厚度）
  const baseMat = new THREE.MeshStandardMaterial({ color: RUINS_COLORS.ashlar, roughness: 0.9, flatShading: true });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(TABLE.roomRadius, TABLE.roomRadius * 1.02, PLATFORM_H, 6), baseMat);
  base.position.y = PLATFORM_H / 2;
  base.rotation.y = Math.PI / 6;
  base.userData = { room: rid };
  group.add(base);
  // 台面（主题地面色）
  const topMat = new THREE.MeshStandardMaterial({ color: 0x666a75, roughness: 0.9, flatShading: true });
  topMat.color.lerp(new THREE.Color(vis.base), 0.44);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(TABLE.roomRadius * 0.94, TABLE.roomRadius * 0.94, 0.14, 6), topMat);
  top.position.y = PLATFORM_H + 0.02;
  top.rotation.y = Math.PI / 6;
  group.add(top);
  const inlay = new THREE.Mesh(
    new THREE.TorusGeometry(anchor.radius * 0.64, 0.018, 3, 6),
    new THREE.MeshBasicMaterial({ color: RUINS_COLORS.bronze, transparent: true, opacity: 0.45 }),
  );
  inlay.rotation.set(-Math.PI / 2, 0, Math.PI / 6);
  inlay.position.y = anchor.floor + 0.006;
  group.add(inlay);
  // 台面边缘发光描边（状态主视觉之一）
  const edgeMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.4 });
  const edgeGlow = new THREE.Mesh(new THREE.TorusGeometry(TABLE.roomRadius * 0.97, 0.035, 6, 6), edgeMat);
  edgeGlow.rotation.x = Math.PI / 2;
  edgeGlow.rotation.z = Math.PI / 6;
  edgeGlow.position.y = PLATFORM_H + 0.1;
  group.add(edgeGlow);

  // 入口台阶（面向桌心，即本地 +Z）
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x3a4149, roughness: 0.85, flatShading: true });
  const step1 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.34, 0.62), stepMat);
  step1.position.set(0, 0.83, TABLE.roomRadius * 0.9);
  const step2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 0.62), stepMat);
  step2.position.set(0, 0.60, TABLE.roomRadius * 0.9 + 0.35);
  group.add(step1, step2);

  // Instanced boundary posts keep the playable floor open.
  const postGeo = new THREE.CylinderGeometry(0.095, 0.145, 0.55, 5);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x596373, roughness: 0.83 });
  const posts = new THREE.InstancedMesh(postGeo, postMat, 6);
  const caps = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.12, 0.115, 5),
    new THREE.MeshStandardMaterial({ color: RUINS_COLORS.bronze, roughness: 0.57, metalness: 0.28 }), 6);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(angle) * anchor.radius * 0.91;
    const z = Math.sin(angle) * anchor.radius * 0.91;
    posts.setMatrixAt(i, matrix.makeTranslation(x, anchor.floor + 0.21, z));
    caps.setMatrixAt(i, matrix.makeTranslation(x, anchor.floor + 0.51, z));
  }
  group.add(posts, caps);

  // 状态灯塔（远处可读的事件/状态指示）
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.085, 0.73, 6), postMat);
  pole.position.set(-TABLE.roomRadius * 0.8, PLATFORM_H + 0.41, -TABLE.roomRadius * 0.55);
  const beaconMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.9 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), beaconMat);
  beacon.position.set(-TABLE.roomRadius * 0.8, PLATFORM_H + 0.80, -TABLE.roomRadius * 0.55);
  group.add(pole, beacon);

  // 全尺寸主题图腾（平台后半部）
  const totem = buildTotem(vis.totem, vis.prop);
  totem.position.set(0, anchor.floor, -TABLE.roomRadius * 0.68);
  totem.scale.setScalar(0.61);
  group.add(totem);

  const label = document.createElement('div');
  label.className = 'b3-roomlabel';
  label.dataset.room = rid;
  label.setAttribute('role', 'button');
  label.setAttribute('aria-label', `房间 ${rid}`);
  label.tabIndex = -1;
  const icon = document.createElement('span');
  icon.className = 'b3-rl-icon';
  icon.textContent = vis.icon;
  const name = document.createElement('span');
  name.className = 'b3-rl-name';
  name.textContent = rid;
  const labelCount = document.createElement('span');
  labelCount.className = 'b3-rl-count';
  labelCount.textContent = '0 人';
  const labelMud = document.createElement('span');
  labelMud.className = 'b3-rl-mud';
  labelMud.hidden = true;
  const labelPending = document.createElement('span');
  labelPending.className = 'b3-rl-pending';
  const labelObjects = document.createElement('span');
  labelObjects.className = 'b3-rl-objects';
  labelObjects.hidden = true;
  label.append(icon, name, labelCount, labelMud, labelPending, labelObjects);
  label.addEventListener('click', (event) => {
    event.stopPropagation();
    if (controls.canPick(rid)) controls.pick(rid);
  });
  label.addEventListener('keydown', (event) => {
    if (!controls.canPick(rid) || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    controls.pick(rid);
  });
  label.addEventListener('pointerenter', () => controls.hover(rid));
  label.addEventListener('pointerleave', () => controls.hover(''));

  return {
    rid, anchor, slots: new Map(), bridge: null, pulse: null,
    group, beaconMat, edgeMat, dome: null,
    label, labelCount, labelPending, labelMud, labelObjects,
    pos: new THREE.Vector3(pos0.x, 0, pos0.z),
    pendingIvan: false, bombMarker: null,
  };
}

export function releaseRoomObject(object: THREE.Object3D): void {
  object.traverse(node => { if (node instanceof THREE.InstancedMesh) node.dispose(); });
  releaseMeshes(object);
  object.removeFromParent();
}

function buildTotem(kind: string, color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.78, flatShading: true });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x322c26, roughness: 0.85, flatShading: true });
  const matSnow = new THREE.MeshStandardMaterial({ color: 0xdfe6ee, roughness: 0.9, flatShading: true });
  const put = (o: THREE.Object3D, x: number, y: number, z: number, s = 1) => {
    o.position.set(x, y, z);
    o.scale.setScalar(s);
    g.add(o);
  };
  switch (kind) {
    case 'mountain': {
      const mk = (h: number, r: number) => new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), mat);
      const cap = (r: number) => new THREE.Mesh(new THREE.ConeGeometry(r * 0.4, 0.3, 6), matSnow);
      const m1 = mk(2.0, 0.85); put(m1, -0.9, 1.0, -0.3, 1);
      put(cap(0.85), -0.9, 1.85, -0.3, 1);
      const m2 = mk(2.5, 1.0); put(m2, 0.35, 1.25, -0.5, 1);
      put(cap(1.0), 0.35, 2.35, -0.5, 1);
      const m3 = mk(1.4, 0.65); put(m3, 1.35, 0.7, -0.1, 1);
      put(cap(0.65), 1.35, 1.32, -0.1, 1);
      break;
    }
    case 'forest': {
      const tree = (s: number) => {
        const t = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.5, 6), matDark);
        trunk.position.y = 0.25;
        const c1 = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.7, 7), mat);
        c1.position.y = 0.75;
        const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.55, 7), mat);
        c2.position.y = 1.2;
        t.add(trunk, c1, c2);
        t.scale.setScalar(s);
        return t;
      };
      put(tree(1.25), -1.0, 0, -0.45);
      put(tree(1.0), -0.15, 0, -0.75);
      put(tree(1.15), 0.85, 0, -0.35);
      put(tree(0.8), 0.3, 0, -0.15);
      break;
    }
    case 'village': {
      const house = (s: number) => {
        const h = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.6, 0.7), mat);
        base.position.y = 0.3;
        const roof = new THREE.Mesh(new THREE.ConeGeometry(0.72, 0.5, 4), matDark);
        roof.position.y = 0.85;
        roof.rotation.y = Math.PI / 4;
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.36, 0.05), matDark);
        door.position.set(0, 0.18, 0.36);
        h.add(base, roof, door);
        h.scale.setScalar(s);
        return h;
      };
      put(house(1.1), -0.75, 0, -0.35);
      put(house(0.9), 0.7, 0, -0.5);
      break;
    }
    case 'castle': {
      const tower = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 2.1, 10), mat);
      body.position.y = 1.05;
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.44, 0.3, 10), matDark);
      crown.position.y = 2.2;
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.55, 10), matDark);
      roof.position.y = 2.6;
      for (let i = 0; i < 5; i++) {
        const ang = (i / 5) * Math.PI * 2;
        const mer = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.12), mat);
        mer.position.set(Math.cos(ang) * 0.42, 2.42, Math.sin(ang) * 0.42);
        tower.add(mer);
      }
      const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5), matDark);
      flagPole.position.y = 3.0;
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.02), new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.9 }));
      flag.position.set(0.15, 3.15, 0);
      tower.add(body, crown, roof, flagPole, flag);
      put(tower, 0.35, 0, -0.55);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.3), mat);
      put(wall, -0.65, 0.35, -0.35);
      break;
    }
    case 'volcano': {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.15, 1.9, 7), matDark);
      put(cone, 0, 0.95, -0.35);
      const lavaMat = new THREE.MeshBasicMaterial({ color: 0xff6030, transparent: true, opacity: 0.95 });
      const lava = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.16, 9), lavaMat);
      put(lava, 0, 1.85, -0.35);
      lava.name = 'lava';
      const rock1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24), mat);
      put(rock1, 0.95, 0.16, 0.1);
      const rock2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.17), mat);
      put(rock2, -1.0, 0.12, 0.25);
      break;
    }
    case 'water': {
      const pond = new THREE.Mesh(
        new THREE.CylinderGeometry(1.05, 1.05, 0.1, 20),
        new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.35, transparent: true, opacity: 0.85 }),
      );
      put(pond, 0, 0.05, -0.4);
      pond.name = 'pond';
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22), matDark);
      put(rock, 0.85, 0.12, 0.15);
      const reed = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.5, 5), matDark);
      put(reed, -0.7, 0.25, 0.1);
      break;
    }
  }
  return g;
}
