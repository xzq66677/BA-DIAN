/**
 * 拔典 · 3D 战场场景（BattleScene3D）V2
 *
 * 空间结构：中央事件舞台（演出的空间锚点）+ 六棱石台房间（有高度/厚度/台阶/界柱/
 * 全尺寸主题图腾）+ 石径连接（明确空间关系）。
 * 角色实体：程序化低多边形人形（rig.ts），带朝向与程序化动作。
 * 快照权威 + 演出命令只做视觉，与 React 解耦；文本信息走 HTML 覆盖层。
 */

import * as THREE from 'three';
import { TABLE, defaultPose, orbitPose, roomSlot, roomPosition } from './layout.js';
import { charVisual, roomVisual, STATE_COLORS } from './palette.js';
import { cardMeta } from '../cards.js';
import { Humanoid, buildProp } from './rig.js';
import {
  slashFx, ringBurst, beamFx, projectileFx, explosionFx, healFx, skillAuraFx,
  flashLightFx, dustFx, domainBurstFx, type FxInstance,
} from './fx.js';

// ── 对外数据契约（与 net.ts 的 GameSnapshot 字段对齐的最小子集） ──
export interface SnapPlayerLite {
  id: string; name: string; charId: string; charName: string;
  hp: number; maxHp: number; room: string; alive: boolean;
  hidden: boolean; invisible: boolean;
  char: Record<string, unknown>;
}
export interface SnapLite {
  players: SnapPlayerLite[];
  roomIds: string[];
  currentActor: string | null;
  phase: 'rps1' | 'act' | 'roundEnd' | 'over';
  winner: string | null;
  domainHolder?: string | null;
  deferred?: { id: string; kind: string; room: string; explodeRound: number }[];
  submittedIds?: string[];
  /** 本机身份（「我」徽标与镜头归属） */
  myIds?: string[];
}

export interface SceneHooks {
  onPickPlayer: (pid: string) => void;
  onPickRoom: (rid: string) => void;
}

// ── 内部实体 ────────────────────────────────────────────────

type PoseKind = 'idle' | 'walk' | 'attack' | 'flinch' | 'dead' | 'cast' | 'drink' | 'crouch' | 'cheer';

interface PoseTask {
  kind: PoseKind;
  t: number;      // 已播时间
  dur: number;    // 总时长（idle/walk 为 Infinity）
}

interface Entity {
  pid: string;
  group: THREE.Group;          // 根（位于房间 group 内）
  rig: Humanoid;
  ring: THREE.Mesh;            // 脚下状态环
  blob: THREE.Mesh;            // 接地阴影
  plate: HTMLDivElement;       // 名牌（覆盖层）
  hpFill: HTMLDivElement;
  badges: HTMLDivElement;
  nameEl: HTMLDivElement;
  avatar: HTMLDivElement;
  colors: { main: number; accent: number };
  stick: THREE.Object3D | null;
  bobPhase: number;
  pose: PoseTask;              // 当前动作
  curRoom: string;
  deadPose: boolean;
  invisible: boolean;
  alive: boolean;
  walk: { from: THREE.Vector3; to: THREE.Vector3; ctrl: THREE.Vector3; t: number; dur: number } | null;
  lunge: { dir: THREE.Vector3; t: number; dur: number; base: THREE.Vector3 } | null;
}

interface Room {
  rid: string;
  group: THREE.Group;
  beacon: THREE.Mesh;            // 状态灯球（远处可读）
  beaconMat: THREE.MeshBasicMaterial;
  edgeGlow: THREE.Mesh;          // 台面边缘发光环
  edgeMat: THREE.MeshBasicMaterial;
  dome: THREE.Mesh | null;       // 领域穹顶
  label: HTMLDivElement;
  labelCount: HTMLSpanElement;
  labelPending: HTMLSpanElement;
  pos: THREE.Vector3;
  yaw: number;
  pendingIvan: boolean;
  bombMarker: THREE.Group | null;
}

interface Tween { el: number; dur: number; fn: (t: number) => void; done?: () => void; dead?: boolean }

const GOLD = 0xd8b04a;
const BG = 0x0a0e14;
const PLATFORM_H = 1.12;

export class BattleScene3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private overlay: HTMLElement;
  private floats: HTMLElement;
  private hooks: SceneHooks;

  private entities = new Map<string, Entity>();
  private rooms = new Map<string, Room>();
  private fxList: { fx: FxInstance; start: number }[] = [];
  private tweens: Tween[] = [];
  private raf = 0;
  private clock = new THREE.Clock();
  private elapsed = 0;
  private disposed = false;
  private reduced = false;

  // 相机
  private aspect = 1.5;
  private camPose = defaultPose(1.5, 4);
  private orbit = { az: 0, polar: 0, zoom: 1 };
  private lookCur = new THREE.Vector3(0, 1, 0);
  private focus = { x: 0, z: 0, w: 0 };
  private focusWTarget = 0;
  private shakeAmp = 0;
  private finaleWinner: string | null = null;
  private roomPickMode = false;
  private targetablePids = new Set<string>();
  private lastSnapshot: SnapLite | null = null;
  private myRoom: string | null = null;
  private myIds: string[] = [];

  private pickedPoint = new THREE.Vector2();
  private downPos: { x: number; y: number; t: number } | null = null;
  private dragging = false;
  private raycaster = new THREE.Raycaster();

  constructor(container: HTMLElement, hooks: SceneHooks) {
    this.container = container;
    this.hooks = hooks;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor(BG);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'b3-canvas';

    this.overlay = document.createElement('div');
    this.overlay.className = 'b3-overlay';
    container.appendChild(this.overlay);
    this.floats = document.createElement('div');
    this.floats.className = 'b3-floats';
    container.appendChild(this.floats);

    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.Fog(BG, 26, 52);
    this.camera = new THREE.PerspectiveCamera(48, 1.5, 0.1, 90);

    this.buildEnvironment();
    this.bindEvents();
    this.resize();
    this.clock.start();
    this.loop();
  }

  // ── 环境：地面 + 中央事件舞台 ──────────────────────────────

  private buildEnvironment(): void {
    const hemi = new THREE.HemisphereLight(0x7488a2, 0x2a2118, 1.15);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffe2b0, 2.0);
    dir.position.set(8, 14, 6);
    this.scene.add(dir);
    const rim = new THREE.DirectionalLight(0x8fb0ff, 0.5);
    rim.position.set(-9, 8, -7);
    this.scene.add(rim);
    const centerLight = new THREE.PointLight(0xffd9a0, 40, 0, 1.8);
    centerLight.position.set(0, 8.5, 0);
    this.scene.add(centerLight);

    // 大地（暗场）
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(42, 48),
      new THREE.MeshStandardMaterial({ color: 0x141b26, roughness: 0.95 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    this.scene.add(ground);
    // 地面金环（场地边界语义）
    const groundRing = new THREE.Mesh(
      new THREE.TorusGeometry(TABLE.rx * 1.16, 0.03, 6, 80),
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.22 }),
    );
    groundRing.rotation.x = Math.PI / 2;
    groundRing.position.y = 0.01;
    this.scene.add(groundRing);

    // 中央事件舞台：圆形高台 + 金环 + 悬浮徽记（演出的空间锚点）
    const dais = new THREE.Mesh(
      new THREE.CylinderGeometry(TABLE.coreRadius, TABLE.coreRadius * 1.14, 0.5, 36),
      new THREE.MeshStandardMaterial({ color: 0x2a3040, roughness: 0.7, metalness: 0.25 }),
    );
    dais.position.y = 0.25;
    this.scene.add(dais);
    const daisTop = new THREE.Mesh(
      new THREE.CylinderGeometry(TABLE.coreRadius * 0.94, TABLE.coreRadius * 0.94, 0.08, 36),
      new THREE.MeshStandardMaterial({ color: 0x32405a, roughness: 0.55, metalness: 0.3 }),
    );
    daisTop.position.y = 0.54;
    this.scene.add(daisTop);
    const coreRing = new THREE.Mesh(
      new THREE.TorusGeometry(TABLE.coreRadius * 0.8, 0.028, 8, 56),
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.75 }),
    );
    coreRing.rotation.x = Math.PI / 2;
    coreRing.position.y = 0.6;
    this.scene.add(coreRing);
    // 悬浮徽记（缓慢旋转的八面体，全场可见的"事件核心"）
    const emblem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.5),
      new THREE.MeshStandardMaterial({ color: 0xf0d68a, emissive: 0xa08030, emissiveIntensity: 0.7, roughness: 0.3, metalness: 0.6 }),
    );
    emblem.position.y = 2.6;
    emblem.name = 'core-emblem';
    this.scene.add(emblem);
    const emblemLight = new THREE.PointLight(0xffe2a0, 8, 12, 1.8);
    emblemLight.position.set(0, 2.6, 0);
    this.scene.add(emblemLight);
  }

  // ── 房间：六棱石台 + 全尺寸图腾 ────────────────────────────

  private ensureRoom(rid: string): Room {
    let r = this.rooms.get(rid);
    if (r) return r;
    const vis = roomVisual(rid);
    const group = new THREE.Group();
    const pos0 = roomPosition(rid, this.myRoom, this.lastSnapshot?.roomIds ?? [rid]);
    // 朝向桌心：台阶与入口面向中央
    const yaw = Math.atan2(-pos0.x, -pos0.z);
    group.position.set(pos0.x, 0, pos0.z);
    group.rotation.y = yaw;

    // 石台主体（六棱柱，有厚度）
    const baseMat = new THREE.MeshStandardMaterial({ color: vis.base, roughness: 0.82, metalness: 0.12, flatShading: true });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(TABLE.roomRadius, TABLE.roomRadius * 1.16, PLATFORM_H, 6), baseMat);
    base.position.y = PLATFORM_H / 2;
    base.rotation.y = Math.PI / 6;
    base.userData = { room: rid };
    group.add(base);
    // 台面（主题地面色）
    const topMat = new THREE.MeshStandardMaterial({ color: vis.prop, roughness: 0.9, flatShading: true });
    topMat.color.multiplyScalar(0.5);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(TABLE.roomRadius * 0.94, TABLE.roomRadius * 0.94, 0.14, 6), topMat);
    top.position.y = PLATFORM_H + 0.02;
    top.rotation.y = Math.PI / 6;
    group.add(top);
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
    step1.position.set(0, 0.44, TABLE.roomRadius * 1.1);
    const step2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 0.62), stepMat);
    step2.position.set(0, 0.16, TABLE.roomRadius * 1.1 + 0.5);
    group.add(step1, step2);

    // 六角界柱（空间边界感）
    const postGeo = new THREE.CylinderGeometry(0.085, 0.1, 0.62, 8);
    const capGeo = new THREE.SphereGeometry(0.11, 10, 8);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x45404a, roughness: 0.7 });
    const capMat = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.4, metalness: 0.6 });
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const pr = TABLE.roomRadius * 1.04;
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(Math.cos(ang) * pr, PLATFORM_H + 0.31, Math.sin(ang) * pr);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(Math.cos(ang) * pr, PLATFORM_H + 0.66, Math.sin(ang) * pr);
      group.add(post, cap);
    }

    // 状态灯塔（远处可读的事件/状态指示）
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.7, 8), postMat);
    pole.position.set(-TABLE.roomRadius * 0.8, PLATFORM_H + 0.85, -TABLE.roomRadius * 0.55);
    const beaconMat = new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.9 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), beaconMat);
    beacon.position.set(-TABLE.roomRadius * 0.8, PLATFORM_H + 1.78, -TABLE.roomRadius * 0.55);
    group.add(pole, beacon);

    // 全尺寸主题图腾（平台后半部）
    const totem = this.buildTotem(vis.totem, vis.prop);
    totem.position.set(0, PLATFORM_H + 0.06, -TABLE.roomRadius * 0.62);
    group.add(totem);

    this.scene.add(group);

    // 石径：房间入口 → 中央舞台
    this.buildPath(new THREE.Vector3(pos0.x, 0, pos0.z));

    r = {
      rid, group, beacon, beaconMat, edgeGlow, edgeMat, dome: null,
      label: this.buildRoomLabel(rid, vis.icon),
      labelCount: null as unknown as HTMLSpanElement,
      labelPending: null as unknown as HTMLSpanElement,
      pos: new THREE.Vector3(pos0.x, 0, pos0.z),
      yaw, pendingIvan: false, bombMarker: null,
    };
    r.labelCount = r.label.querySelector('.b3-rl-count')!;
    r.labelPending = r.label.querySelector('.b3-rl-pending')!;
    this.rooms.set(rid, r);
    return r;
  }

  /** 石径：从房间台阶到中央舞台边缘的空间连接 */
  private buildPath(pos: THREE.Vector3): void {
    const dir = pos.clone().setY(0).normalize();
    const start = dir.clone().multiplyScalar(TABLE.roomRadius * 1.6);
    const end = dir.clone().multiplyScalar(TABLE.coreRadius + 0.15);
    const len = start.distanceTo(end);
    if (len < 0.4) return;
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const path = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.1, len),
      new THREE.MeshStandardMaterial({ color: 0x465060, roughness: 0.85 }),
    );
    path.position.set(mid.x, 0.02, mid.z);
    path.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2;
    this.scene.add(path);
    // 径面描边（微金）
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.04, len),
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.25 }),
    );
    line.position.set(mid.x, 0.09, mid.z);
    line.rotation.y = path.rotation.y;
    this.scene.add(line);
  }

  private buildTotem(kind: string, color: number): THREE.Group {
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

  private buildRoomLabel(rid: string, icon: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'b3-roomlabel';
    el.dataset.room = rid;
    el.innerHTML = `
      <span class="b3-rl-icon">${icon}</span>
      <span class="b3-rl-name">${rid}</span>
      <span class="b3-rl-count">0 人</span>
      <span class="b3-rl-pending"></span>`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.roomPickMode) this.hooks.onPickRoom(rid);
    });
    this.overlay.appendChild(el);
    return el;
  }

  // ── 角色实体：程序化人形 ───────────────────────────────────

  private ensureEntity(p: SnapPlayerLite): Entity {
    let e = this.entities.get(p.id);
    if (e) return e;
    const room = this.ensureRoom(p.room);
    const vis = charVisual(p.charId);
    const rig = new Humanoid({ main: vis.color, accent: vis.accent, skin: 0xe8c49a, dark: 0x2e2822 }, { scale: vis.scale });
    for (const m of rig.materials()) {
      m.emissive.copy(m.color).multiplyScalar(0.16);
    }

    const group = new THREE.Group();
    group.add(rig.root);
    rig.root.position.y = PLATFORM_H + 0.1; // 站在台面上
    rig.root.scale.multiplyScalar(1.4);

    // 脚下状态环（可选目标/行动者）
    const ringMat = new THREE.MeshBasicMaterial({ color: STATE_COLORS.targetable, transparent: true, opacity: 0 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 8, 30), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = PLATFORM_H + 0.13;
    group.add(ring);

    // 接地阴影
    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 20),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = PLATFORM_H + 0.125;
    group.add(blob);

    // 道具
    const prop = buildProp(vis.prop);
    if (prop.hand) rig['handR'].add(prop.hand);
    if (prop.headTop) rig.headTop.add(prop.headTop);
    if (prop.back) rig.back.add(prop.back);

    room.group.add(group);
    const idx = this.slotIndexOf(p.id, p.room);
    const slot = roomSlot(idx, this.roomMemberCount(p.room));
    group.position.set(slot.x, 0, slot.z);
    // 面向桌心（与房间朝向一致）
    group.rotation.y = room.yaw;

    // 名牌
    const plate = document.createElement('div');
    plate.className = 'b3-plate';
    plate.dataset.pid = p.id;
    plate.innerHTML = `
      <div class="b3-av"></div>
      <div class="b3-nm"><span class="b3-nm-text"></span></div>
      <div class="b3-hpbar"><div class="b3-hp-fill"></div></div>
      <div class="b3-badges"></div>`;
    plate.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.hooks.onPickPlayer(p.id);
    });
    this.overlay.appendChild(plate);
    const e_avatarHost = plate.querySelector('.b3-av') as HTMLDivElement;

    const meta = cardMeta(p.charId);
    if (meta?.img) {
      const img = document.createElement('img');
      img.src = meta.img;
      img.alt = '';
      e_avatarHost.appendChild(img);
    } else {
      e_avatarHost.textContent = '拔';
    }

    e = {
      pid: p.id, group, rig, ring, blob, plate,
      hpFill: plate.querySelector('.b3-hp-fill')!,
      badges: plate.querySelector('.b3-badges')!,
      nameEl: plate.querySelector('.b3-nm-text')!,
      avatar: plate.querySelector('.b3-av')!,
      colors: { main: vis.color, accent: vis.accent },
      stick: prop.stick ?? null,
      bobPhase: Math.random() * Math.PI * 2,
      pose: { kind: 'idle', t: 0, dur: Infinity },
      curRoom: p.room, deadPose: false, invisible: false, alive: p.alive, walk: null, lunge: null,
    };
    this.entities.set(p.id, e);
    return e;
  }

  private roomMemberIds(roomId: string): string[] {
    return (this.lastSnapshot?.players ?? []).filter((p) => p.room === roomId && p.alive).map((p) => p.id);
  }
  private roomMemberCount(roomId: string): number {
    return Math.max(1, this.roomMemberIds(roomId).length);
  }
  private slotIndexOf(pid: string, roomId: string): number {
    const ids = this.roomMemberIds(roomId).slice().sort();
    const i = ids.indexOf(pid);
    return i < 0 ? 0 : i;
  }

  // ── 快照同步（显示权威） ───────────────────────────────────

  syncSnapshot(snap: SnapLite): void {
    if (this.disposed) return;
    const prevActor = this.lastSnapshot?.currentActor ?? null;
    const prevPhase = this.lastSnapshot?.phase ?? null;
    this.lastSnapshot = snap;
    this.myIds = snap.myIds ?? [];

    for (const rid of snap.roomIds) this.ensureRoom(rid);
    for (const [rid, room] of this.rooms) {
      if (!snap.roomIds.includes(rid)) {
        this.scene.remove(room.group);
        room.label.remove();
        this.rooms.delete(rid);
      }
    }

    for (const p of snap.players) this.ensureEntity(p);
    for (const [pid, e] of this.entities) {
      const p = snap.players.find((x) => x.id === pid);
      if (!p) {
        e.group.removeFromParent();
        e.plate.remove();
        this.entities.delete(pid);
        continue;
      }
      this.syncEntity(e, p, snap);
    }

    // 房间状态
    for (const room of this.rooms.values()) {
      const pos = roomPosition(room.rid, this.myRoom, snap.roomIds);
      room.group.position.set(pos.x, 0, pos.z);
      room.pos.set(pos.x, 0, pos.z);
      room.group.rotation.y = Math.atan2(-pos.x, -pos.z);
      const members = snap.players.filter((x) => x.room === room.rid && x.alive);
      const acting = !!snap.currentActor && members.some((m) => m.id === snap.currentActor);
      const pendingD = snap.deferred?.find((d) => d.kind === 'ivan' && d.room === room.rid);
      const pending = !!pendingD;
      const winnerHere = snap.phase === 'over' && !!snap.winner && members.some((m) => m.id === snap.winner);
      const domainHere = members.some((m) => m.char.domain === true);
      room.pendingIvan = pending;
      room.labelCount.textContent = `${members.length} 人${acting ? ' · 行动中' : ''}`;
      room.labelPending.textContent = pending ? `💣 第 ${pendingD!.explodeRound} 回合末爆炸` : '';
      room.label.classList.toggle('is-empty', members.length === 0);
      room.label.classList.toggle('is-pending', pending);
      room.label.classList.toggle('is-acting', acting);
      room.label.classList.toggle('is-winner', winnerHere);
      // 状态灯：胜者金 / 待爆橙 / 行动金 / 默认暗金
      const bc = winnerHere ? 0xffe08a : pending ? STATE_COLORS.alertIvan : acting ? 0xffd060 : GOLD;
      room.beaconMat.color.setHex(bc);
      room.beaconMat.opacity = winnerHere || pending ? 1 : acting ? 0.95 : 0.5;
      room.edgeMat.color.setHex(bc);
      room.edgeMat.opacity = winnerHere || pending ? 0.85 : acting ? 0.7 : 0.3;
      // 领域穹顶
      if (domainHere && !room.dome) {
        const dome = new THREE.Mesh(
          new THREE.SphereGeometry(TABLE.roomRadius * 0.95, 26, 16, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: STATE_COLORS.domain, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
        );
        dome.position.y = PLATFORM_H;
        room.group.add(dome);
        room.dome = dome;
      } else if (!domainHere && room.dome) {
        room.group.remove(room.dome);
        room.dome = null;
      }
      // 待爆炸弹浮标
      if (pending && !room.bombMarker) {
        const g = new THREE.Group();
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.4 }));
        const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.18, 6), new THREE.MeshBasicMaterial({ color: 0xff9828 }));
        fuse.position.y = 0.3;
        g.add(b, fuse);
        g.position.set(0, PLATFORM_H + 1.35, 0);
        room.group.add(g);
        room.bombMarker = g;
      } else if (!pending && room.bombMarker) {
        room.group.remove(room.bombMarker);
        room.bombMarker = null;
      }
      room.group.visible = true;
    }

    // 行动者变化 → 柔和镜头聚焦其房间
    if (snap.phase === 'act' && snap.currentActor && snap.currentActor !== prevActor) {
      const p = snap.players.find((x) => x.id === snap.currentActor);
      if (p) this.setFocus(p.room, 0.3);
    }
    // 终局
    if (snap.phase === 'over' && prevPhase !== 'over') {
      this.finaleWinner = snap.winner;
      if (snap.winner) this.setFocus(snap.winner, 0.55);
      // 胜者欢呼
      if (snap.winner) {
        const we = this.entities.get(snap.winner);
        if (we) this.setPose(we, { kind: 'cheer', t: 0, dur: Infinity });
      }
    }
    if (snap.phase !== 'over') this.finaleWinner = null;
  }

  private syncEntity(e: Entity, p: SnapPlayerLite, snap: SnapLite): void {
    // 房间迁移
    if (e.curRoom !== p.room) {
      const fromRoom = this.rooms.get(e.curRoom);
      if (fromRoom) e.group.removeFromParent();
      const toRoom = this.ensureRoom(p.room);
      toRoom.group.add(e.group);
      const idx = this.slotIndexOf(p.id, p.room);
      const slot = roomSlot(idx, this.roomMemberCount(p.room));
      if (!e.walk) e.group.position.set(slot.x, 0, slot.z);
      else e.walk.to.set(slot.x, PLATFORM_H + 0.1, slot.z);
      e.curRoom = p.room;
    }
    // 名牌
    e.nameEl.textContent = p.name;
    const hpPct = Math.max(0, Math.min(100, (p.hp / Math.max(1, p.maxHp)) * 100));
    e.hpFill.style.width = `${hpPct}%`;
    e.hpFill.style.background = hpPct > 50 ? 'linear-gradient(90deg,#63d97e,#8ce6a0)' : hpPct > 25 ? 'linear-gradient(90deg,#e2a23c,#f0c060)' : 'linear-gradient(90deg,#e23d30,#ff6a5c)';
    this.renderBadges(e, p, snap);
    // 存活状态
    e.alive = p.alive;
    e.invisible = p.invisible;
    if (p.alive) {
      if (e.deadPose) this.standUp(e, false);
      if (!e.invisible) {
        const targetOpacity = p.hidden ? 0.55 : 1;
        e.rig.setOpacity(targetOpacity);
      }
      e.blob.visible = !p.invisible;
      // 躲藏 → 下蹲
      if (p.hidden && e.pose.kind === 'idle') this.setPose(e, { kind: 'crouch', t: 0, dur: Infinity });
      if (!p.hidden && e.pose.kind === 'crouch') this.setPose(e, { kind: 'idle', t: 0, dur: Infinity });
    } else if (!e.deadPose) {
      this.killPose(e);
    }
    // 拔棍状态
    if (e.stick) e.stick.visible = p.char.stickDrawn === true;
  }

  private renderBadges(e: Entity, p: SnapPlayerLite, snap: SnapLite): void {
    const parts: string[] = [];
    if (this.myIds.includes(p.id)) parts.push('<span class="b3-bdg mine">我</span>');
    if (snap.currentActor === p.id && p.alive) parts.push('<span class="b3-bdg act">行动中</span>');
    if (p.hidden && p.alive) parts.push('<span class="b3-bdg">🙈</span>');
    if (p.invisible && p.alive) parts.push('<span class="b3-bdg">👻</span>');
    if (p.char.domain === true && p.alive) parts.push('<span class="b3-bdg dom">✨领域</span>');
    if (typeof p.char.livesLeft === 'number' && (p.char.livesLeft as number) > 1 && p.alive) parts.push(`<span class="b3-bdg">💫${p.char.livesLeft}</span>`);
    if (snap.submittedIds?.includes(p.id) && snap.phase === 'rps1' && p.alive) parts.push('<span class="b3-bdg">已出拳</span>');
    if (!p.alive) parts.push('<span class="b3-bdg dead">淘汰</span>');
    if (snap.phase === 'over' && snap.winner === p.id) parts.push('<span class="b3-bdg win">👑 胜者</span>');
    e.badges.innerHTML = parts.join('');
  }

  // ── 姿态管理 ───────────────────────────────────────────────

  private setPose(e: Entity, pose: PoseTask): void {
    e.pose = pose;
    if (pose.kind === 'idle') e.rig.resetPose();
    if (pose.kind === 'dead') {
      // 倒地
      e.deadPose = true;
      e.blob.visible = false;
      e.ring.scale.setScalar(0.001);
      for (const m of e.rig.materials()) m.color.multiplyScalar(0.45);
      this.addTween(0.55, (t) => {
        e.rig['hips'].rotation.x = -t * Math.PI / 2 * 0.94;
        e.rig['hips'].position.y = -t * 0.5;
      });
    }
  }

  private killPose(e: Entity): void {
    if (e.deadPose) return;
    this.setPose(e, { kind: 'dead', t: 0, dur: Infinity });
  }

  /** 起身（复活或快照纠错） */
  private standUp(e: Entity, fx: boolean): void {
    e.deadPose = false;
    const mats = e.rig.materials();
    mats[0].color.setHex(e.colors.main);
    mats[1].color.setHex(e.colors.accent);
    mats[2].color.setHex(0xe8c49a);
    mats[3].color.setHex(0x2e2822);
    for (const m of mats) m.emissive.copy(m.color).multiplyScalar(0.16);
    e.rig.setOpacity(1);
    e.blob.visible = true;
    e.ring.scale.setScalar(1);
    if (fx) {
      this.addTween(0.5, (t) => e.rig.reviveRise(t), () => { e.rig.resetPose(); e.pose = { kind: 'idle', t: 0, dur: Infinity }; });
    } else {
      e.rig.resetPose();
      e.pose = { kind: 'idle', t: 0, dur: Infinity };
    }
  }

  private addTween(dur: number, fn: (t: number) => void, done?: () => void): void {
    this.tweens.push({ el: 0, dur, fn, done });
  }

  private worldOf(pid: string): THREE.Vector3 | null {
    const e = this.entities.get(pid);
    if (!e) return null;
    const v = new THREE.Vector3();
    e.group.getWorldPosition(v);
    return v;
  }

  private spawnFx(fx: FxInstance, pos: THREE.Vector3, ttlMs: number): void {
    fx.object.position.copy(pos);
    this.scene.add(fx.object);
    const rec = { fx, start: this.elapsed };
    this.fxList.push(rec);
    this.tweens.push({
      el: 0, dur: ttlMs / 1000 + 0.3, fn: () => {},
      done: () => {
        if (this.fxList.includes(rec)) this.removeFx(rec);
      },
    });
  }

  private removeFx(rec: { fx: FxInstance; start: number }): void {
    this.scene.remove(rec.fx.object);
    rec.fx.dispose();
    this.fxList = this.fxList.filter((r) => r !== rec);
  }

  // ── 演出命令 ───────────────────────────────────────────────

  /** 面向某个世界点（仅水平朝向，瞬时） */
  private faceTo(e: Entity, target: THREE.Vector3): void {
    const myPos = new THREE.Vector3();
    e.group.getWorldPosition(myPos);
    const dir = target.clone().sub(myPos).setY(0);
    if (dir.lengthSq() < 0.001) return;
    const worldYaw = Math.atan2(dir.x, dir.z);
    // group 嵌套在房间 group 内（房间自身旋转），换算局部 yaw
    const parent = e.group.parent;
    if (parent) {
      const parentWorldYaw = new THREE.Vector3(0, 0, 1).applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
      const parentYaw = Math.atan2(parentWorldYaw.x, parentWorldYaw.z);
      e.group.rotation.y = worldYaw - parentYaw;
    } else {
      e.group.rotation.y = worldYaw;
    }
  }

  /** 行动姿态 */
  playAction(pid: string, kind: string, targetId?: string): void {
    const e = this.entities.get(pid);
    if (!e || !e.alive) return;
    switch (kind) {
      case 'attack': {
        const targetPos = targetId ? this.worldOf(targetId) : null;
        if (targetPos) this.faceTo(e, targetPos);
        // 前扑
        const myPos = new THREE.Vector3();
        e.group.getWorldPosition(myPos);
        const dir = targetPos
          ? targetPos.clone().sub(myPos).setY(0).normalize()
          : new THREE.Vector3(0, 0, 1).applyQuaternion(e.group.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
        const base = e.group.position.clone();
        e.lunge = { dir, t: 0, dur: 0.5, base };
        e.pose = { kind: 'attack', t: 0, dur: 0.52 };
        if (!this.reduced) {
          const w = this.worldOf(pid)!;
          this.spawnFx(flashLightFx(w, 0xffc9a0, 2.4, 0.3), w.clone().setY(0.5), 500);
        }
        break;
      }
      case 'heal': {
        e.pose = { kind: 'cast', t: 0, dur: 1.0 };
        const w = this.worldOf(pid)!;
        this.spawnFx(healFx(), w.clone().setY(PLATFORM_H), 1000);
        break;
      }
      case 'milk': {
        e.pose = { kind: 'drink', t: 0, dur: 1.0 };
        const w = this.worldOf(pid)!;
        this.spawnFx(ringBurst(0xefe6d8, 0.8, 0.6, { y: 0.2 }), w.clone().setY(PLATFORM_H), 700);
        break;
      }
      case 'aim': {
        const w = this.worldOf(pid)!;
        const tPos = targetId ? this.worldOf(targetId) : null;
        if (tPos && !this.reduced) {
          this.spawnFx(beamFx(w.clone().add(new THREE.Vector3(0, 0.6, 0)), tPos.clone().add(new THREE.Vector3(0, 0.6, 0)), 0x7ec8ff, 0.65, 0.026), new THREE.Vector3(0, 0, 0), 800);
        }
        e.pose = { kind: 'cast', t: 0, dur: 0.8 };
        break;
      }
      case 'hide': {
        e.pose = { kind: 'crouch', t: 0, dur: Infinity };
        break;
      }
      case 'seek': {
        const w = this.worldOf(pid)!;
        this.spawnFx(ringBurst(0xf0d68a, 1.3, 0.65, { y: PLATFORM_H }), w.clone().setY(0), 750);
        break;
      }
      case 'skill': {
        e.pose = { kind: 'cast', t: 0, dur: 0.9 };
        const w = this.worldOf(pid)!;
        this.spawnFx(skillAuraFx(), w.clone().setY(PLATFORM_H), 900);
        break;
      }
      default: break;
    }
  }

  /** 攻击宣告：转向目标 + 挥击预备 + 预警光束 */
  playAttackDecl(sourceId: string, targetId: string): void {
    const e = this.entities.get(sourceId);
    const to = this.worldOf(targetId);
    if (!e || !to || !e.alive) return;
    this.faceTo(e, to);
    e.pose = { kind: 'attack', t: 0, dur: 0.4 };
    const from = this.worldOf(sourceId);
    if (from && !this.reduced) {
      this.spawnFx(beamFx(from.clone().add(new THREE.Vector3(0, 0.8, 0)), to.clone().add(new THREE.Vector3(0, 0.8, 0)), STATE_COLORS.beam, 0.42, 0.034), new THREE.Vector3(0, 0, 0), 560);
    }
    this.setFocus(to, 0.42, 800);
  }

  /** 实际扣血 */
  playHit(pid: string, o: { amount: number; lethal?: boolean; instakill?: boolean; segment?: { index: number; total: number }; sourceId?: string; room?: string; tag?: string }): void {
    const e = this.entities.get(pid);
    if (!e) return;
    const w = this.worldOf(pid)!;
    // 来源光束（冲击线）
    const src = o.sourceId ? this.worldOf(o.sourceId) : null;
    if (src && !this.reduced) {
      this.spawnFx(beamFx(src.clone().add(new THREE.Vector3(0, 0.8, 0)), w.clone().add(new THREE.Vector3(0, 0.8, 0)), 0xff8060, 0.3, 0.05), new THREE.Vector3(0, 0, 0), 420);
    }
    this.spawnFx(slashFx(!!o.lethal || !!o.instakill), w.clone().setY(PLATFORM_H + 0.9), 620);
    e.pose = { kind: 'flinch', t: 0, dur: 0.5 };
    // 红闪
    const mats = e.rig.materials();
    this.addTween(0.42, (t) => {
      const k = Math.sin(Math.PI * Math.min(1, t));
      for (const m of mats) m.emissive.setRGB(k * 0.5, 0, 0);
    }, () => {
      for (const m of mats) m.emissive.copy(m.color).multiplyScalar(0.16);
    });
    if (!this.reduced) this.spawnFx(flashLightFx(w, STATE_COLORS.hit, o.lethal ? 4.5 : 2.6, 0.35), w.clone().setY(0), 520);
    this.spawnFloat(w, `<span class="dmg-float ${o.lethal || o.instakill ? 'lethal' : ''}">-${fmtN(o.amount)}</span>`);
    if (o.segment && o.segment.total > 1) this.spawnFloat(w, `<span class="b3-seg">${o.segment.index}/${o.segment.total} 段</span>`, 30);
    if (o.lethal || o.instakill) this.shake(0.18);
  }

  playHeal(pid: string, o: { amount?: number }): void {
    const e = this.entities.get(pid);
    const w = this.worldOf(pid);
    if (!e || !w) return;
    e.pose = { kind: 'cast', t: 0, dur: 1.0 };
    this.spawnFx(healFx(), w.clone().setY(PLATFORM_H), 1000);
    this.spawnFloat(w, `<span class="heal-float">+${fmtN(o.amount ?? 0)}</span>`);
  }

  playMiss(pid: string): void {
    const e = this.entities.get(pid);
    const w = this.worldOf(pid);
    if (!e || !w || !e.alive) return;
    const base = e.group.position.clone();
    e.group.rotation.y += Math.PI / 5;
    this.addTween(0.45, (t) => {
      const k = Math.sin(Math.PI * t);
      e.group.position.x = base.x + k * 0.35;
    }, () => {
      e.group.position.copy(base);
    });
    this.spawnFloat(w, '<span class="miss-float">未命中</span>');
  }

  playEliminate(pid: string): void {
    const e = this.entities.get(pid);
    const w = this.worldOf(pid);
    if (!e || !w) return;
    this.spawnFloat(w, '<span class="death-stamp b3-stamp">💀 淘汰</span>');
    if (!this.reduced) {
      this.spawnFx(ringBurst(0xe23d30, 1.4, 0.75, { y: PLATFORM_H + 0.1 }), w.clone().setY(0), 850);
      this.spawnFx(flashLightFx(w, 0xff5545, 3.6, 0.4), w.clone().setY(0), 520);
    }
    this.shake(0.14);
    this.setFocus(w, 0.55, 1000);
    this.killPose(e);
  }

  playRevive(pid: string, livesLeft: number): void {
    const e = this.entities.get(pid);
    const w = this.worldOf(pid);
    if (!e || !w) return;
    this.standUp(e, true);
    this.spawnFloat(w, `<span class="revive-burst b3-stamp">💫 ${livesLeft} 命复活</span>`);
    if (!this.reduced) {
      this.spawnFx(ringBurst(0xffe082, 1.5, 0.85, { y: PLATFORM_H + 0.1 }), w.clone().setY(0), 950);
      this.spawnFx(flashLightFx(w, 0xffd68a, 3.4, 0.5), w.clone().setY(0), 620);
    }
  }

  /** 移动：沿路径行走（经中央舞台侧翼） */
  playWalk(pid: string, fromRoom: string, toRoom: string): void {
    const e = this.entities.get(pid);
    if (!e) return;
    const from = this.rooms.get(fromRoom);
    const to = this.rooms.get(toRoom);
    if (!from || !to) return;
    const worldFrom = new THREE.Vector3();
    e.group.getWorldPosition(worldFrom);
    const idx = this.slotIndexOf(pid, toRoom);
    const slot = roomSlot(idx, Math.max(1, this.roomMemberIds(toRoom).length));
    const worldTo = new THREE.Vector3(slot.x, PLATFORM_H + 0.1, slot.z);
    to.group.localToWorld(worldTo);
    // 控制点：起点→终点中点向桌心收，形成绕行弧线
    const ctrl = worldFrom.clone().add(worldTo).multiplyScalar(0.5);
    ctrl.multiplyScalar(0.72);
    ctrl.y = PLATFORM_H + 0.4;
    e.walk = { from: worldFrom.clone(), to: worldTo.clone(), ctrl, t: 0, dur: 0.85 };
    e.pose = { kind: 'walk', t: 0, dur: Infinity };
    if (!this.reduced) {
      this.spawnFx(dustFx(), worldFrom.clone().setY(PLATFORM_H + 0.05), 600);
      window.setTimeout(() => {
        if (!this.disposed) this.spawnFx(dustFx(), worldTo.clone().setY(PLATFORM_H + 0.05), 600);
      }, 780);
    }
    this.setFocus(worldTo, 0.3, 900);
  }

  playIvanThrow(pid: string, room: string): void {
    const from = this.worldOf(pid);
    const to = this.rooms.get(room);
    if (!from || !to) return;
    const target = to.pos.clone().setY(PLATFORM_H + 0.5);
    const fx = projectileFx(from.clone().add(new THREE.Vector3(0, 0.9, 0)), target, {
      color: 0xff9828, radius: 0.2, dur: 1.05, arc: 3.2, spin: true, trail: 3,
      build: (g) => {
        const fuse = new THREE.Mesh(
          new THREE.CylinderGeometry(0.024, 0.024, 0.12, 6),
          new THREE.MeshBasicMaterial({ color: 0xffd68a }),
        );
        fuse.position.y = 0.22;
        g.add(fuse);
      },
    });
    this.spawnFx(fx, new THREE.Vector3(0, 0, 0), 1400);
    this.spawnFloat(from, '<span class="b3-ticker">💣 大伊万投掷！</span>');
    // 投掷姿态
    const e = this.entities.get(pid);
    if (e) e.pose = { kind: 'attack', t: 0, dur: 0.5 };
    this.setFocus(to.pos, 0.5, 1200);
  }

  playIvanBoom(room: string): void {
    const to = this.rooms.get(room);
    if (!to) return;
    const pos = to.pos.clone().setY(PLATFORM_H + 0.4);
    this.spawnFx(explosionFx(0xff8830), pos, 1500);
    if (!this.reduced) this.spawnFx(flashLightFx(pos, 0xff9828, 7, 0.55), pos, 750);
    this.spawnFloat(to.pos.clone().setY(PLATFORM_H + 2.4), '<span class="b3-ticker boom">💥 大伊万爆炸！</span>');
    this.shake(this.reduced ? 0.05 : 0.34);
    this.setFocus(to.pos, 0.85, 1400);
  }

  playRoomAlert(room: string, kind: 'aoe' | 'ivan'): void {
    const to = this.rooms.get(room);
    if (!to) return;
    const color = kind === 'ivan' ? STATE_COLORS.alertIvan : STATE_COLORS.alertAoe;
    this.spawnFx(ringBurst(color, TABLE.roomRadius * 1.5, 0.9, { y: PLATFORM_H + 0.12, tube: 0.055 }), to.pos.clone().setY(0), 1050);
    this.setFocus(to.pos, 0.4, 900);
    to.label.classList.add('zone-alert', `zone-alert-${kind}`);
    window.setTimeout(() => to.label.classList.remove('zone-alert', `zone-alert-${kind}`), 1150);
  }

  playTrigger(pid: string, color = 0xb27ce8): void {
    const e = this.entities.get(pid);
    const w = this.worldOf(pid);
    if (!e || !w) return;
    if (!this.reduced) this.spawnFx(skillAuraFx(color), w.clone().setY(PLATFORM_H), 850);
    if (e.alive && e.pose.kind === 'idle') e.pose = { kind: 'cast', t: 0, dur: 0.8 };
  }

  playDomain(pid: string): void {
    const e = this.entities.get(pid);
    const w = this.worldOf(pid);
    if (!e || !w) return;
    this.spawnFx(domainBurstFx(), w.clone().setY(PLATFORM_H), 1100);
    if (!this.reduced) this.spawnFx(flashLightFx(w, 0x9a6ae0, 3, 0.5), w.clone().setY(0), 620);
    this.spawnFloat(w, '<span class="b3-ticker dom">✨ 领域展开！</span>');
    this.setFocus(w, 0.5, 1000);
  }

  // ── 覆盖层 ────────────────────────────────────────────────

  private spawnFloat(worldPos: THREE.Vector3, html: string, yOffset = 0): void {
    const wrap = document.createElement('div');
    wrap.className = 'b3-float';
    wrap.style.top = `${yOffset}px`;
    wrap.innerHTML = html;
    this.floats.appendChild(wrap);
    (wrap as unknown as { _world?: THREE.Vector3 })._world = worldPos.clone();
    window.setTimeout(() => wrap.remove(), 1700);
  }

  private updateOverlay(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const proj = (v: THREE.Vector3) => v.clone().project(this.camera);
    for (const e of this.entities.values()) {
      const world = new THREE.Vector3();
      e.group.getWorldPosition(world);
      world.y += PLATFORM_H + e.rig.headHeight() + 0.55;
      const p = proj(world);
      e.plate.style.transform = `translate(-50%,-100%) translate(${((p.x * 0.5 + 0.5) * w).toFixed(1)}px,${((-p.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
      e.plate.style.display = p.z > 1 ? 'none' : '';
      const t = this.targetablePids.has(e.pid) && e.alive;
      e.plate.classList.toggle('is-targetable', t);
      (e.ring.material as THREE.MeshBasicMaterial).opacity = t ? 0.55 + Math.sin(this.elapsed * 6) * 0.28 : 0;
      e.ring.scale.setScalar(t ? 1.2 : 1);
      e.plate.classList.toggle('is-acting', this.lastSnapshot?.currentActor === e.pid && e.alive);
      e.plate.classList.toggle('is-dead', !e.alive);
    }
    for (const r of this.rooms.values()) {
      // 标签挂在台阶前方（世界坐标：房间位置朝桌心方向偏移）
      const dir = r.pos.clone().setY(0).normalize();
      const lp = r.pos.clone().addScaledVector(dir, TABLE.roomRadius * 1.7);
      lp.y = PLATFORM_H + 0.35;
      const p = proj(lp);
      r.label.style.transform = `translate(-50%,-50%) translate(${((p.x * 0.5 + 0.5) * w).toFixed(1)}px,${((-p.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
      r.label.style.display = p.z > 1 ? 'none' : '';
      r.label.classList.toggle('is-pickable', this.roomPickMode);
    }
    for (const wrap of Array.from(this.floats.children) as HTMLDivElement[]) {
      const wp = (wrap as unknown as { _world?: THREE.Vector3 })._world;
      if (!wp) continue;
      const p = proj(wp);
      wrap.style.transform = `translate(-50%,-50%) translate(${((p.x * 0.5 + 0.5) * w).toFixed(1)}px,${((-p.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
    }
  }

  // ── 交互 ──────────────────────────────────────────────────

  private bindEvents(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('resize', this.resize);
  }

  private onDown = (e: PointerEvent): void => {
    this.downPos = { x: e.clientX, y: e.clientY, t: Date.now() };
    this.dragging = false;
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.downPos) return;
    const dx = e.clientX - this.downPos.x;
    const dy = e.clientY - this.downPos.y;
    if (!this.dragging && Math.hypot(dx, dy) > 7) this.dragging = true;
    if (this.dragging) {
      this.orbit.az -= (e.movementX ?? dx * 0.2) * 0.0055;
      this.orbit.polar = Math.min(0.9, Math.max(-0.5, this.orbit.polar - (e.movementY ?? dy * 0.2) * 0.0038));
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (!this.downPos) return;
    const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
    const quick = Date.now() - this.downPos.t < 600;
    this.downPos = null;
    if (this.dragging || moved > 8 || !quick) {
      this.dragging = false;
      return;
    }
    this.dragging = false;
    this.pick(e);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.orbit.zoom = Math.min(1.75, Math.max(0.6, this.orbit.zoom * (e.deltaY > 0 ? 1.07 : 0.93)));
  };

  private pick(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pickedPoint.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pickedPoint, this.camera);
    const entMeshes: THREE.Object3D[] = [];
    for (const ent of this.entities.values()) {
      if (ent.alive) entMeshes.push(ent.rig.root);
    }
    const hits = this.raycaster.intersectObjects(entMeshes, true);
    if (hits.length > 0) {
      let o: THREE.Object3D | null = hits[0].object;
      while (o && !o.userData.pid) o = o.parent;
      // rig.root 上没有 pid → 沿 group 找 entity
      if (!o || !o.userData.pid) {
        for (const [pid, ent] of this.entities) {
          let p: THREE.Object3D | null = hits[0].object;
          while (p) {
            if (p === ent.group) { o = ent.group; o.userData.pid = pid; break; }
            p = p.parent;
          }
          if (o && o.userData.pid) break;
        }
      }
      if (o?.userData.pid) {
        this.hooks.onPickPlayer(o.userData.pid as string);
        return;
      }
    }
    if (this.roomPickMode) {
      const roomMeshes = Array.from(this.rooms.values()).map((r) => r.group);
      const rh = this.raycaster.intersectObjects(roomMeshes, true);
      if (rh.length > 0) {
        let o: THREE.Object3D | null = rh[0].object;
        while (o && !o.userData.room) o = o.parent;
        if (o?.userData.room) this.hooks.onPickRoom(o.userData.room as string);
      }
    }
  }

  // ── 对外控制 ──────────────────────────────────────────────

  setMyRoom(rid: string | null): void {
    if (this.myRoom === rid) return;
    this.myRoom = rid;
    this.refreshAllSlots();
  }

  private refreshAllSlots(): void {
    const snap = this.lastSnapshot;
    if (!snap) return;
    this.syncSnapshot(snap);
  }

  setTargetable(pids: string[]): void {
    this.targetablePids = new Set(pids);
  }

  setRoomPickMode(on: boolean): void {
    if (this.roomPickMode === on) return;
    this.roomPickMode = on;
    if (!on && this.lastSnapshot) this.syncSnapshot(this.lastSnapshot);
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
  }

  setFocus(target: THREE.Vector3 | string | null, weight = 0.4, ms = 900): void {
    if (target === null) {
      this.focusWTarget = 0;
      return;
    }
    let v: THREE.Vector3 | null = null;
    if (typeof target === 'string') {
      const r = this.rooms.get(target);
      v = r ? r.pos.clone() : null;
    } else {
      v = target.clone();
    }
    if (!v) return;
    this.focus.x = v.x;
    this.focus.z = v.z;
    this.focusWTarget = weight;
    if (ms > 0) {
      window.setTimeout(() => {
        if (this.finaleWinner === null) this.focusWTarget = 0.08;
      }, ms);
    }
  }

  resetView(): void {
    this.orbit = { az: 0, polar: 0, zoom: 1 };
    this.focusWTarget = 0;
    this.shakeAmp = 0;
  }

  private shake(amp: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, this.reduced ? amp * 0.2 : amp);
  }

  resize = (): void => {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 500;
    this.aspect = w / h;
    this.camPose = defaultPose(this.aspect, this.lastSnapshot?.roomIds.length ?? this.rooms.size ?? 4);
    this.camera.aspect = this.aspect;
    this.camera.fov = this.camPose.fov;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  // ── 主循环 ────────────────────────────────────────────────

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    this.elapsed += dt;
    const snap = this.lastSnapshot;

    // 补间
    for (const t of this.tweens) {
      if (t.dead) continue;
      t.el += dt;
      const k = Math.min(1, t.el / t.dur);
      t.fn(k);
      if (k >= 1) {
        t.dead = true;
        t.done?.();
      }
    }
    if (this.tweens.some((t) => t.dead)) this.tweens = this.tweens.filter((t) => !t.dead);

    // 特效
    for (const rec of this.fxList.slice()) {
      const alive = rec.fx.update(dt, this.elapsed - rec.start);
      if (!alive) this.removeFx(rec);
    }

    // 实体动画
    for (const e of this.entities.values()) {
      // 行走位移
      if (e.walk) {
        e.walk.t += dt / e.walk.dur;
        const t = Math.min(1, e.walk.t);
        const it = 1 - t;
        const p = e.walk.from.clone().multiplyScalar(it * it)
          .add(e.walk.ctrl.clone().multiplyScalar(2 * it * t))
          .add(e.walk.to.clone().multiplyScalar(t * t));
        const parent = e.group.parent;
        if (parent) {
          const local = parent.worldToLocal(p.clone());
          e.group.position.copy(local);
          e.group.position.y = 0;
        }
        // 面向行进方向
        const aheadT = Math.min(1, t + 0.04);
        const it2 = 1 - aheadT;
        const ahead = e.walk.from.clone().multiplyScalar(it2 * it2)
          .add(e.walk.ctrl.clone().multiplyScalar(2 * it2 * aheadT))
          .add(e.walk.to.clone().multiplyScalar(aheadT * aheadT));
        const dir = ahead.sub(p);
        if (dir.lengthSq() > 0.0001) {
          const worldYaw = Math.atan2(dir.x, dir.z);
          const parentYaw = parent
            ? Math.atan2(
              new THREE.Vector3(0, 0, 1).applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion())).x,
              new THREE.Vector3(0, 0, 1).applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion())).z,
            )
            : 0;
          e.group.rotation.y = worldYaw - parentYaw;
        }
        if (t >= 1) {
          e.walk = null;
          if (e.pose.kind === 'walk') e.pose = { kind: 'idle', t: 0, dur: Infinity };
        }
      }
      // 前扑位移
      if (e.lunge) {
        e.lunge.t += dt / e.lunge.dur;
        const t = Math.min(1, e.lunge.t);
        const k = t < 0.4 ? t / 0.4 : Math.max(0, 1 - (t - 0.4) / 0.6);
        e.group.position.copy(e.lunge.base).addScaledVector(e.lunge.dir, k * 0.5);
        if (t >= 1) {
          e.group.position.copy(e.lunge.base);
          e.lunge = null;
        }
      }
      // 姿态
      if (e.deadPose) {
        // 倒地静态（tween 已处理倒地过程）
      } else if (e.walk && e.pose.kind === 'walk') {
        e.rig.walk(this.elapsed, 1);
      } else {
        e.pose.t += dt;
        switch (e.pose.kind) {
          case 'attack':
            e.rig.attackSwing(Math.min(1, e.pose.t / e.pose.dur));
            if (e.pose.t >= e.pose.dur) e.pose = { kind: 'idle', t: 0, dur: Infinity };
            break;
          case 'flinch':
            e.rig.flinch(Math.min(1, e.pose.t / e.pose.dur));
            if (e.pose.t >= e.pose.dur) e.pose = { kind: 'idle', t: 0, dur: Infinity };
            break;
          case 'cast':
            e.rig.cast(this.elapsed);
            if (e.pose.t >= e.pose.dur) e.pose = { kind: 'idle', t: 0, dur: Infinity };
            break;
          case 'drink':
            e.rig.drink(e.pose.t);
            if (e.pose.t >= e.pose.dur) e.pose = { kind: 'idle', t: 0, dur: Infinity };
            break;
          case 'crouch':
            e.rig.crouch(e.pose.t);
            break;
          case 'cheer':
            e.rig.cheer(this.elapsed);
            break;
          default: {
            e.rig.idle(this.elapsed, e.bobPhase);
            // 行动者轻微举手示意
            if (snap?.currentActor === e.pid && !this.reduced) {
              e.rig['armR'].pivot.rotation.x = -0.5 + Math.sin(this.elapsed * 4) * 0.12;
            }
          }
        }
      }
      // 隐身呼吸
      if (e.alive && e.invisible) {
        const o = 0.2 + Math.sin(this.elapsed * 1.6 + e.bobPhase) * 0.07;
        e.rig.setOpacity(o);
      }
      // 道具旋转（骰子/太极盘/磁环）
      for (const spinName of ['spin']) {
        const spin = e.rig.root.getObjectByName(spinName);
        if (spin && e.alive) spin.rotation.y += dt * 1.8;
      }
    }

    // 房间动画
    for (const r of this.rooms.values()) {
      if (r.pendingIvan && !this.reduced) {
        r.beaconMat.opacity = 0.6 + Math.sin(this.elapsed * 5) * 0.35;
        if (r.bombMarker) r.bombMarker.position.y = PLATFORM_H + 1.35 + Math.sin(this.elapsed * 2.6) * 0.12;
      }
      if (r.dome && !this.reduced) {
        (r.dome.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(this.elapsed * 2.2) * 0.05;
      }
      const lava = r.group.getObjectByName('lava');
      if (lava && !this.reduced) {
        (lava as THREE.Mesh).scale.y = 1 + Math.sin(this.elapsed * 3.2) * 0.25;
      }
    }
    // 中央徽记旋转
    const emblem = this.scene.getObjectByName('core-emblem');
    if (emblem && !this.reduced) {
      emblem.rotation.y += dt * 0.6;
      emblem.position.y = 2.6 + Math.sin(this.elapsed * 1.4) * 0.12;
    }

    this.updateCamera(dt);
    this.updateOverlay();
    this.renderer.render(this.scene, this.camera);
  };

  private updateCamera(dt: number): void {
    if (this.finaleWinner !== null) {
      this.orbit.az += dt * 0.1;
    }
    this.focus.w += (this.focusWTarget - this.focus.w) * Math.min(1, dt * (this.reduced ? 8 : 3.2));
    const base = this.camPose;
    const pos = orbitPose(base, this.orbit.az, 0.68 + this.orbit.polar, this.orbit.zoom);
    const look = new THREE.Vector3(base.look.x, 1.1, base.look.z);
    const focusV = new THREE.Vector3(this.focus.x, 1.0, this.focus.z);
    look.lerp(focusV, Math.min(1, this.focus.w));
    this.lookCur.lerp(look, Math.min(1, dt * (this.reduced ? 8 : 3.4)));
    const camTarget = new THREE.Vector3(pos.x, pos.y, pos.z);
    camTarget.x += (this.focus.x * this.focus.w) * 0.22;
    camTarget.z += (this.focus.z * this.focus.w) * 0.18;
    this.camera.position.lerp(camTarget, Math.min(1, dt * (this.reduced ? 8 : 3)));
    if (this.shakeAmp > 0.001) {
      this.shakeAmp *= Math.pow(0.002, dt);
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmp;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmp * 0.6;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeAmp;
    }
    this.camera.lookAt(this.lookCur);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.renderer.domElement.removeEventListener('pointerdown', this.onDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onUp);
    this.renderer.domElement.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('resize', this.resize);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = (m as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.remove();
    this.floats.remove();
  }
}

function fmtN(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
