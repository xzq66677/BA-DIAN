/** Three.js arena, DOM overlays and character presentation. Rules live in the engine. */

import * as THREE from 'three';
import { TABLE, createRuinsMap, defaultPose, stableMembers, type RoomAnchor } from './layout.js';
import { CameraDirector, type Shot } from './camera-director.js';
import { RUINS_COLORS, buildBridge, createRuinsEnvironment, island } from './ruins.js';
import { createRuinsWeather } from './ruins-weather.js';
import type { GameSnapshot, SnapPlayer } from '../../../shared/src/protocol.js';
import type { DeferredEvent } from '../../../shared/src/types.js';
import type { RuinsConditions } from '../../../shared/src/floating-ruins.js';
import { roomVisual, STATE_COLORS } from './palette.js';
import { cardMeta } from '../cards.js';
import { createCharacterAsset, releaseMeshes, type CharacterRig } from './characters/index.js';
import {
  slashFx, ringBurst, beamFx, projectileFx, explosionFx, healFx, skillAuraFx,
  flashLightFx, dustFx, domainBurstFx, type FxInstance,
} from './fx.js';
import { gllog } from './gllog.js';
import { B3D_RESTORE_WAIT_MS } from './gl-policy.js';

// ── 大贱客辱骂演出计数 ──────────────────────────────────────
// 2D/3D 视图切换会 dispose 并重建 BattleScene3D 实例，实例字段会丢计数；
// 因此放模块级，按「战局代|行动者->目标」累计。战局代由 Battle3D 在每次
// 演出前以当前 gameNo 调用 setInsultGeneration 同步，换代（重开新局）即清零。
const insultSeen = new Map<string, number>();
let insultGen = '';
/** 同步辱骂计数的战局代（换代即清零；权威累计仍在服务端） */
export function setInsultGeneration(gen: string): void {
  if (gen !== insultGen) {
    insultGen = gen;
    insultSeen.clear();
  }
}

// ── 对外数据契约（与 net.ts 的 GameSnapshot 字段对齐的最小子集） ──
export type SnapPlayerLite = Pick<SnapPlayer,
  'id' | 'name' | 'charId' | 'charName' | 'hp' | 'maxHp' | 'room' | 'alive' | 'hidden' | 'invisible' | 'char'>;
export type SnapLite = Pick<GameSnapshot, 'roomIds' | 'currentActor' | 'phase' | 'winner' | 'domainHolder' | 'ruins'> & {
  players: SnapPlayerLite[];
  deferred?: Pick<DeferredEvent, 'id' | 'kind' | 'room' | 'explodeRound'>[];
  submittedIds?: string[];
  myIds?: string[];
};

export interface SceneHooks {
  onPickPlayer: (pid: string) => void;
  onPickRoom: (rid: string) => void;
  /** WebGL 上下文丢失且恢复窗口内未恢复（上下文已死）→ 调用方应回退 2D 牌桌 */
  onContextLost?: () => void;
  /** 上下文在恢复窗口内成功恢复（three.js 自动重建 GL 资源）→ 调用方做丢失计数/降级判定 */
  onContextRestored?: () => void;
}

// ── 内部实体 ────────────────────────────────────────────────

type PoseKind = 'idle' | 'walk' | 'attack' | 'flinch' | 'dead' | 'revive' | 'cast' | 'drink' | 'crouch' | 'cheer';

interface PoseTask {
  kind: PoseKind;
  t: number;      // 已播时间
  dur: number;    // 总时长（idle/walk 为 Infinity）
}

interface Entity {
  pid: string;
  group: THREE.Group;          // 根（位于房间 group 内）
  charId: string;
  asset: ReturnType<typeof createCharacterAsset>;
  rig: CharacterRig;
  appearance: { material: THREE.MeshStandardMaterial; color: THREE.Color; emissive: THREE.Color }[];
  ring: THREE.Mesh;            // 脚下状态环
  blob: THREE.Mesh;            // 接地阴影
  plate: HTMLDivElement;       // 名牌（覆盖层）
  hpFill: HTMLDivElement;
  badges: HTMLDivElement;
  nameEl: HTMLDivElement;
  avatar: HTMLDivElement;
  stick: THREE.Object3D | null;
  bobPhase: number;
  pose: PoseTask;              // 当前动作
  curRoom: string;
  shownHp: number;
  deadPose: boolean;
  invisible: boolean;
  alive: boolean;
  walk: { from: THREE.Vector3; to: THREE.Vector3; ctrl: THREE.Vector3; t: number; dur: number } | null;
  lunge: { dir: THREE.Vector3; t: number; dur: number; base: THREE.Vector3 } | null;
  /** 进行中的受击挤压补间（连续受击时取消前一个） */
  squash: Tween | null;
  /** 创建时的基准缩放（squash 恢复基准；连续受击不累积体积漂移） */
  baseScale: THREE.Vector3;
  /** 名牌水平错开：房间内成员序号 / 总数（同房间多人名牌投影重叠时横向分散） */
  plateSlot: number;
  plateCount: number;
}

interface Room {
  rid: string;
  anchor: RoomAnchor;
  slots: Map<string, number>;
  bridge: THREE.Group | null;
  pulse: { kind: 'aoe' | 'blast' | 'hit' | 'heal'; until: number } | null;
  group: THREE.Group;
  beacon: THREE.Mesh;            // 状态灯球（远处可读）
  beaconMat: THREE.MeshBasicMaterial;
  edgeGlow: THREE.Mesh;          // 台面边缘发光环
  edgeMat: THREE.MeshBasicMaterial;
  dome: THREE.Mesh | null;       // 领域穹顶
  label: HTMLDivElement;
  labelCount: HTMLSpanElement;
  labelPending: HTMLSpanElement;
  labelMud: HTMLSpanElement;
  pos: THREE.Vector3;
  yaw: number;
  pendingIvan: boolean;
  bombMarker: THREE.Group | null;
}

// Presentation commands can arrive after the authoritative life transition.
function canAct(e: Entity): boolean {
  return e.alive && !e.deadPose && e.pose.kind !== 'revive';
}

interface Tween { owner?: Entity; el: number; dur: number; fn: (t: number) => void; done?: () => void; dead?: boolean }

const GOLD = 0xd8b04a;
const BG = RUINS_COLORS.sky;
const PLATFORM_H = TABLE.roomHeight;
const ROOM_EFFECTS = { aoe: 0xff5478, blast: 0xff943c, hit: 0xff5159, heal: 0x70d7b0 };

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
  private frameAt = 0;
  private elapsed = 0;
  private realElapsed = 0;
  private disposed = false;
  private sizeObserver?: ResizeObserver;
  private reduced = false;
  private lowEffects = false;
  private pixelRatio = 1;
  private readonly environment = createRuinsEnvironment();
  private readonly weather = createRuinsWeather();
  private map = createRuinsMap([]);
  private topologyKey = '';
  private contextTimer: number | undefined;
  private readonly floatEnds = new Map<HTMLDivElement, number>();

  // 相机
  private aspect = 1.5;
  private camPose = defaultPose(1.5, 4);
  private readonly director = new CameraDirector();
  private lookCur = new THREE.Vector3(0, 1.1, 0);
  private camTarget = new THREE.Vector3();
  private shot: Shot = 'overview';
  private shakeAmp = 0;
  /** 打击感慢动作截止（elapsed 秒）：致命/重击瞬间全体演出短暂减速 */
  private hitStopUntil = 0;
  private finaleWinner: string | null = null;
  private roomPickMode = false;
  private blockedRoom = '';
  private lastRender = 0;
  private camMoving = true;
  private targetablePids = new Set<string>();
  private lastSnapshot: SnapLite | null = null;
  private selectedRoom = '';
  private selectedPlayer = '';
  private hoveredRoom = '';
  private finaleKey: string | null = null;
  private myIds: string[] = [];

  private pickedPoint = new THREE.Vector2();
  private downPos: { id: number; x: number; y: number; lastX: number; lastY: number; t: number } | null = null;
  private dragging = false;
  private raycaster = new THREE.Raycaster();

  constructor(container: HTMLElement, hooks: SceneHooks) {
    this.container = container;
    this.hooks = hooks;
    // The renderer's own context provides capability and adapter information.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    let rendererLabel = '';
    try {
      const gl = this.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) rendererLabel = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    } catch { /* diagnostics are optional */ }
    const software = /swiftshader|llvmpipe|softpipe|basic render/i.test(rendererLabel);
    this.pixelRatio = software ? 1 : Math.min(window.devicePixelRatio || 1, 1.55);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor(BG);
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.className = 'b3-canvas';
    gllog.push('scene-init', {
      renderer: rendererLabel, software,
      pixelRatio: this.renderer.getPixelRatio(),
    }, true);

    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);

    this.overlay = document.createElement('div');
    this.overlay.className = 'b3-overlay';
    container.appendChild(this.overlay);
    this.floats = document.createElement('div');
    this.floats.className = 'b3-floats';
    container.appendChild(this.floats);

    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.Fog(BG, 30, 76);
    this.camera = new THREE.PerspectiveCamera(48, 1.5, 0.1, 180);

    this.environment.root.add(this.weather.root);
    this.scene.add(this.environment.root);
    this.bindEvents();
    this.resize();
    this.frameAt = performance.now();
    this.loop();
  }

  private onContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.disposed) return;
    gllog.push('ctx-lost', {}, true);
    window.clearTimeout(this.contextTimer);
    this.contextTimer = window.setTimeout(() => {
      this.contextTimer = undefined;
      gllog.push('ctx-lost-timeout', { waitMs: B3D_RESTORE_WAIT_MS }, true);
      this.hooks.onContextLost?.();
    }, B3D_RESTORE_WAIT_MS);
  };

  private onContextRestored = (): void => {
    window.clearTimeout(this.contextTimer);
    this.contextTimer = undefined;
    gllog.push('ctx-restored', {}, true);
    this.resize();
    this.hooks.onContextRestored?.();
  };

  private updateTopology(roomIds: string[]): void {
    const key = JSON.stringify([...new Set(roomIds)].sort());
    if (key === this.topologyKey) return;
    this.topologyKey = key;
    this.map = createRuinsMap(roomIds);
    const core = { x: 0, z: 0 };
    const anchors = Array.from(this.map.rooms.values());
    for (const anchor of anchors) {
      const room = this.ensureRoom(anchor);
      room.anchor = anchor;
      room.pos.set(anchor.center.x, 0, anchor.center.z);
      room.group.position.copy(room.pos);
      room.group.rotation.y = anchor.yaw;
      room.yaw = anchor.yaw;
      if (room.bridge) {
        this.releaseRoomObject(room.bridge);
      }
      const radius = Math.hypot(anchor.center.x, anchor.center.z);
      let destination = core;
      let destinationRadius: number = TABLE.coreRadius;
      if (radius > 12 && anchors.length > 10) {
        const inner = anchors.filter(other => Math.hypot(other.center.x, other.center.z) < radius - 3);
        const nearest = inner.sort((a, b) =>
          Math.hypot(a.center.x - anchor.center.x, a.center.z - anchor.center.z) -
          Math.hypot(b.center.x - anchor.center.x, b.center.z - anchor.center.z))[0];
        if (nearest) {
          destination = nearest.center;
          destinationRadius = nearest.radius;
          room.yaw = Math.atan2(destination.x - anchor.center.x, destination.z - anchor.center.z);
          room.group.rotation.y = room.yaw;
        }
      }
      room.bridge = buildBridge(anchor, destination, destinationRadius);
      this.scene.add(room.bridge);
    }
    const fog = this.scene.fog as THREE.Fog;
    fog.near = Math.max(27, this.map.radius * 2.7);
    fog.far = fog.near + 42;
    this.resize();
  }

  private releaseRoomObject(object: THREE.Object3D): void {
    object.traverse(node => { if (node instanceof THREE.InstancedMesh) node.dispose(); });
    releaseMeshes(object);
    object.removeFromParent();
  }

  private ensureRoom(anchor: RoomAnchor): Room {
    const rid = anchor.id;
    const existing = this.rooms.get(rid);
    if (existing) return existing;
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
    const totem = this.buildTotem(vis.totem, vis.prop);
    totem.position.set(0, anchor.floor, -TABLE.roomRadius * 0.68);
    totem.scale.setScalar(0.61);
    group.add(totem);

    this.scene.add(group);

    const r: Room = {
      rid, anchor, slots: new Map(), bridge: null, pulse: null,
      group, beacon, beaconMat, edgeGlow, edgeMat, dome: null,
      label: this.buildRoomLabel(rid, vis.icon),
      labelCount: null as unknown as HTMLSpanElement,
      labelPending: null as unknown as HTMLSpanElement,
      labelMud: null as unknown as HTMLSpanElement,
      pos: new THREE.Vector3(pos0.x, 0, pos0.z),
      yaw, pendingIvan: false, bombMarker: null,
    };
    r.labelCount = r.label.querySelector('.b3-rl-count')!;
    r.labelPending = r.label.querySelector('.b3-rl-pending')!;
    r.labelMud = r.label.querySelector('.b3-rl-mud')!;
    this.rooms.set(rid, r);
    return r;
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
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `房间 ${rid}`);
    el.tabIndex = -1;
    el.innerHTML = `
      <span class="b3-rl-icon">${icon}</span>
      <span class="b3-rl-name"></span>
      <span class="b3-rl-count">0 人</span>
      <span class="b3-rl-mud" hidden></span>
      <span class="b3-rl-pending"></span>`;
    el.querySelector('.b3-rl-name')!.textContent = rid;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.roomPickMode && rid !== this.blockedRoom) this.hooks.onPickRoom(rid);
    });
    el.addEventListener('keydown', (e) => {
      if (!this.roomPickMode || rid === this.blockedRoom || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      this.hooks.onPickRoom(rid);
    });
    el.addEventListener('pointerenter', () => { this.hoveredRoom = rid; });
    el.addEventListener('pointerleave', () => { this.hoveredRoom = ''; });
    this.overlay.appendChild(el);
    return el;
  }

  // ── 角色实体：程序化人形 ───────────────────────────────────

  private ensureEntity(p: SnapPlayerLite): Entity {
    let e = this.entities.get(p.id);
    if (e?.charId === p.charId) return e;
    if (e) this.removeEntity(e);
    const room = this.rooms.get(p.room)!;
    const asset = createCharacterAsset(p.charId);
    const { rig } = asset;
    const appearance = rig.materials().map(material => ({ material, color: material.color.clone(), emissive: material.emissive.clone() }));

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

    room.group.add(group);
    const slot = this.spawnFor(p.id, room);
    group.position.set(slot.x, 0, slot.z);
    // 面向桌心（与房间朝向一致）
    group.rotation.y = 0; // 房间局部 +Z 为入口方向

    // 名牌
    group.userData.pid = p.id;
    const plate = document.createElement('div');
    plate.className = 'b3-plate';
    plate.dataset.pid = p.id;
    plate.setAttribute('role', 'button');
    plate.tabIndex = 0;
    plate.innerHTML = `
      <div class="b3-av"></div>
      <div class="b3-nm"><span class="b3-nm-text"></span></div>
      <div class="b3-hpbar"><div class="b3-hp-fill"></div></div>
      <div class="b3-badges"></div>`;
    plate.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.hooks.onPickPlayer(p.id);
    });
    plate.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
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
      pid: p.id, charId: p.charId, asset, appearance, group, rig, ring, blob, plate,
      hpFill: plate.querySelector('.b3-hp-fill')!,
      badges: plate.querySelector('.b3-badges')!,
      nameEl: plate.querySelector('.b3-nm-text')!,
      avatar: plate.querySelector('.b3-av')!,
      stick: asset.stick,
      bobPhase: Math.random() * Math.PI * 2,
      pose: { kind: 'idle', t: 0, dur: Infinity },
      curRoom: p.room, shownHp: p.hp, deadPose: false, invisible: false, alive: p.alive, walk: null, lunge: null, squash: null,
      baseScale: rig.root.scale.clone(),
      plateSlot: 0, plateCount: 1,
    };
    this.entities.set(p.id, e);
    return e;
  }

  private removeEntity(e: Entity): void {
    this.tweens = this.tweens.filter(t => t.owner !== e);
    e.asset.dispose();
    releaseMeshes(e.group); // ring + contact shadow; rig is already detached
    e.group.removeFromParent();
    e.plate.remove();
    this.entities.delete(e.pid);
  }

  private reconcileSlots(room: Room, players: SnapPlayerLite[]): void {
    const occupants = stableMembers(players.filter(p => p.room === room.rid));
    const ids = new Set(occupants.map(p => p.id));
    for (const [pid, index] of room.slots) {
      if (!ids.has(pid) || index >= room.anchor.spawns.length) room.slots.delete(pid);
    }
    const occupied = new Set(room.slots.values());
    for (const p of occupants) {
      if (room.slots.has(p.id)) continue;
      const slot = room.anchor.spawns.findIndex((_, index) => !occupied.has(index));
      if (slot < 0) break;
      room.slots.set(p.id, slot);
      occupied.add(slot);
    }
  }

  private spawnFor(pid: string, room: Room) {
    return room.anchor.spawns[room.slots.get(pid) ?? 0];
  }

  // ── 快照同步（显示权威） ───────────────────────────────────

  syncSnapshot(snap: SnapLite, immediate = false, moveSeconds = 0.54): void {
    if (this.disposed) return;
    const prevActor = this.lastSnapshot?.currentActor ?? null;
    this.lastSnapshot = snap;
    this.myIds = snap.myIds ?? [];

    this.updateTopology(snap.roomIds);
    const mud = snap.ruins?.mud;
    this.weather.sync(snap.ruins, mud ? this.map.rooms.get(mud.room) : undefined, this.map.radius);
    const weather = snap.ruins?.weather ?? 'clear';
    this.container.dataset.weather = weather;
    const fog = this.scene.fog as THREE.Fog;
    fog.far = fog.near + (weather === 'mist' ? 31 : 42);
    fog.color.setHex(weather === 'mist' ? 0x3a5369 : BG);
    for (const room of this.rooms.values()) this.reconcileSlots(room, snap.players);
    const players = new Map(snap.players.filter(p => this.map.rooms.has(p.room)).map(p => [p.id, p]));
    for (const [pid, e] of this.entities) if (!players.has(pid)) this.removeEntity(e);
    for (const p of players.values()) this.syncEntity(this.ensureEntity(p), p, snap, immediate, moveSeconds);
    for (const [rid, room] of this.rooms) {
      if (this.map.rooms.has(rid)) continue;
      this.releaseRoomObject(room.group);
      if (room.bridge) this.releaseRoomObject(room.bridge);
      room.label.remove();
      this.rooms.delete(rid);
    }

    // 房间状态
    for (const room of this.rooms.values()) {
      const members = snap.players.filter((x) => x.room === room.rid && x.alive);
      const acting = !!snap.currentActor && members.some((m) => m.id === snap.currentActor);
      const pendingD = snap.deferred?.find((d) => d.kind === 'ivan' && d.room === room.rid);
      const pending = !!pendingD;
      const winnerHere = snap.phase === 'over' && !!snap.winner && members.some((m) => m.id === snap.winner);
      const domainHere = members.some((m) => m.char.domain === true);
      const mudHere = mud?.room === room.rid ? mud : null;
      room.pendingIvan = pending;
      room.labelCount.textContent = `${members.length} 人${acting ? ' · 行动中' : ''}`;
      room.labelPending.textContent = pending ? `💣 预计第 ${pendingD!.explodeRound} 回合末爆炸（平局顺延）` : '';
      room.labelMud.hidden = !mudHere;
      room.labelMud.textContent = mudHere?.active ? '泥潭' : mudHere ? '积水' : '';
      room.label.classList.toggle('is-muddy', !!mudHere?.active);
      room.label.setAttribute('aria-label', `房间 ${room.rid}${mudHere?.active ? '，泥潭封路' : mudHere ? `，第 ${mudHere.activeRound} 回合泥潭预警` : ''}`);
      room.label.classList.toggle('is-empty', members.length === 0);
      room.label.classList.toggle('is-pending', pending);
      room.label.classList.toggle('is-acting', acting);
      room.label.classList.toggle('is-winner', winnerHere);
      this.paintRoom(room);
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
        this.releaseRoomObject(room.dome);
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
        this.releaseRoomObject(room.bombMarker);
        room.bombMarker = null;
      }
      room.group.visible = true;
    }

    if (snap.phase === 'act' && snap.currentActor && snap.currentActor !== prevActor) {
      const p = players.get(snap.currentActor);
      if (p) this.focusRoom('room', p.room);
    }
  }

  private paintRoom(room: Room): void {
    const pickable = this.roomPickMode && this.blockedRoom !== room.rid;
    const selected = pickable && this.selectedRoom === room.rid;
    const hovered = pickable && this.hoveredRoom === room.rid;
    const acting = room.label.classList.contains('is-acting');
    const winner = room.label.classList.contains('is-winner');
    const empty = room.label.classList.contains('is-empty');
    const pulse = room.pulse;
    const edge = pulse ? ROOM_EFFECTS[pulse.kind] : room.pendingIvan ? STATE_COLORS.alertIvan
      : selected ? 0x67e9f5 : winner || acting ? 0xffd060 : pickable ? STATE_COLORS.targetable
        : room.label.classList.contains('is-muddy') ? 0xc18346 : GOLD;
    room.edgeMat.color.setHex(edge);
    room.edgeMat.opacity = pulse || selected || hovered || room.pendingIvan ? 1
      : acting || pickable || winner ? 0.83 : empty ? 0.25 : 0.44;
    room.beaconMat.color.setHex(acting || winner ? 0xffd060 : edge);
    room.beaconMat.opacity = 0.55 + 0.4 * room.edgeMat.opacity;
    room.label.classList.toggle('is-pickable', pickable);
    room.label.classList.toggle('is-selected', selected);
    room.label.setAttribute('aria-disabled', String(!pickable));
    room.label.tabIndex = pickable ? 0 : -1;
  }

  private syncEntity(e: Entity, p: SnapPlayerLite, snap: SnapLite, immediate: boolean, moveSeconds: number): void {
    const toRoom = this.rooms.get(p.room)!;
    const slot = this.spawnFor(p.id, toRoom);
    if (e.curRoom !== p.room) {
      const worldFrom = e.group.getWorldPosition(new THREE.Vector3());
      toRoom.group.add(e.group);
      e.curRoom = p.room;
      e.lunge = null;
      if (p.alive && !immediate && !this.reduced) this.startWalkTo(e, toRoom, slot, worldFrom, moveSeconds);
    }
    if (!e.walk && !e.lunge) e.group.position.set(slot.x, 0, slot.z);
    // 名牌错开参数（同房间成员序号/总数，updateOverlay 据此水平分散）
    const memberIds = Array.from(toRoom.slots).sort((a, b) => a[1] - b[1]).map(([pid]) => pid);
    e.plateSlot = Math.max(0, memberIds.indexOf(p.id));
    e.plateCount = memberIds.length;
    // 名牌
    e.nameEl.textContent = p.name;
    e.plate.setAttribute('aria-label', `${p.name}，${p.room}，生命 ${p.hp}/${p.maxHp}`);
    const hpPct = Math.max(0, Math.min(100, (p.hp / Math.max(1, p.maxHp)) * 100));
    e.shownHp = p.hp;
    e.plate.dataset.hp = String(p.hp);
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
    if (snap.submittedIds?.includes(p.id) && (snap.phase === 'rps1' || snap.phase === 'rps2') && p.alive) parts.push('<span class="b3-bdg">已出拳</span>');
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
      for (const { material, color } of e.appearance) material.color.copy(color).multiplyScalar(0.45);
    }
  }

  private killPose(e: Entity): void {
    if (e.deadPose) return;
    this.setPose(e, { kind: 'dead', t: 0, dur: Infinity });

  }

  /** 起身（复活或快照纠错） */
  private standUp(e: Entity, fx: boolean): void {
    e.deadPose = false;
    e.rig.root.visible = true; // 尸体回收后可能已隐藏：复活（或快照纠错）恢复
    for (const { material, color, emissive } of e.appearance) {
      material.color.copy(color);
      material.emissive.copy(emissive);
    }
    e.rig.setOpacity(1);
    e.blob.visible = true;
    e.ring.scale.setScalar(1);
    e.rig.resetPose();
    e.pose = fx ? { kind: 'revive', t: 0, dur: 0.65 } : { kind: 'idle', t: 0, dur: Infinity };
  }

  private addTween(owner: Entity, dur: number, fn: (t: number) => void, done?: () => void): Tween {
    const t: Tween = { owner, el: 0, dur, fn, done };
    this.tweens.push(t);
    return t;
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
    if (!e || !canAct(e)) return;
    switch (kind) {
      case 'attack': {
        this.focusPlayer('actor', pid);
        const targetPos = targetId ? this.worldOf(targetId) : null;
        if (targetPos) this.faceTo(e, targetPos);
        // 前扑
        const myPos = new THREE.Vector3();
        e.group.getWorldPosition(myPos);
        const dir = targetPos
          ? targetPos.clone().sub(myPos).setY(0).normalize()
          : new THREE.Vector3(0, 0, 1).applyQuaternion(e.group.getWorldQuaternion(new THREE.Quaternion())).setY(0).normalize();
        const base = e.group.position.clone();
        if (e.group.parent) dir.applyQuaternion(e.group.parent.getWorldQuaternion(new THREE.Quaternion()).invert());
        e.lunge = { dir, t: 0, dur: 0.5, base };
        e.pose = { kind: 'attack', t: 0, dur: 0.52 };
        if (!this.reduced) {
          const w = this.worldOf(pid)!;
          this.spawnFx(flashLightFx(w, 0xffc9a0, 2.4, 0.3), w.clone().setY(0.5), 500);
        }
        // 大贱客·辱骂：戳指峰值给被指目标一次短促点名反馈（前两次累计，第三次由 eliminate 演出死亡）
        if (e.charId === 'dajianke' && targetId) this.playInsultFeedback(e, targetId);
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

  /**
   * 大贱客·辱骂目标反馈：对齐 attackSwing 戳指峰值（≈0.55 × 0.52s），被指者得到清楚短促的点名——
   * 紫（精神/领域色）束线从大贱客指尖打向目标 + 目标脚下光圈 + 「被辱骂 n/3」浮字 + 镜头切向目标。
   * 计数按本局真实 attack 事件本地累计（服务端在第三次结算时会清零快照计数，读快照会滞后一拍）；
   * 前两次表达被点名与累计，第三次由既有 eliminate 演出播放死亡。
   * 跨房沿用既有世界坐标 FX 与 focusPlayer 可见性规则，不区分房间。
   */
  private playInsultFeedback(actor: Entity, targetId: string): void {
    this.addTween(actor, 0.3, () => { }, () => {
      const target = this.entities.get(targetId);
      const from = this.worldOf(actor.pid);
      const to = this.worldOf(targetId);
      if (!target || !from || !to) return;
      from.y += 0.72; to.y += 0.72;
      const key = `${insultGen}|${actor.pid}->${targetId}`;
      const strike = (insultSeen.get(key) ?? 0) + 1;
      insultSeen.set(key, strike);
      if (!this.reduced) {
        this.spawnFx(beamFx(from, to, STATE_COLORS.domain, 0.34, 0.03), new THREE.Vector3(), 520);
        if (target.alive) {
          this.spawnFx(ringBurst(STATE_COLORS.domain, 0.6, 0.42, { y: PLATFORM_H }), to.clone().setY(0), 560);
          this.spawnFloat(to, `<span class="b3-ticker dom">被辱骂 ${strike}/3</span>`, 24);
        }
      }
      this.focusPlayer('target', targetId);
    });
  }

  /** 攻击宣告：转向目标 + 挥击预备 + 预警光束 */
  playAttackDecl(sourceId: string, targetId: string): void {
    const e = this.entities.get(sourceId);
    const to = this.worldOf(targetId);
    if (!e || !to || !canAct(e)) return;
    this.faceTo(e, to);
    e.pose = { kind: 'attack', t: 0, dur: 0.4 };
    const from = this.worldOf(sourceId);
    if (from && !this.reduced) {
      this.spawnFx(beamFx(from.clone().add(new THREE.Vector3(0, 0.8, 0)), to.clone().add(new THREE.Vector3(0, 0.8, 0)), STATE_COLORS.beam, 0.42, 0.034), new THREE.Vector3(0, 0, 0), 560);
    }
    this.focusPlayer('target', targetId);
  }

  /** 实际扣血 */
  playHit(pid: string, o: { amount: number; lethal?: boolean; segment?: { index: number; total: number }; sourceId?: string; room?: string; tag?: string }): void {
    const e = this.entities.get(pid);
    if (!e) return;
    const w = this.worldOf(pid)!;
    this.pulseRoom(e.curRoom, 'hit', 0.68);
    this.focusPlayer('target', pid);
    // 来源光束（冲击线）
    const src = o.sourceId ? this.worldOf(o.sourceId) : null;
    if (src && !this.reduced) {
      this.spawnFx(beamFx(src.clone().add(new THREE.Vector3(0, 0.8, 0)), w.clone().add(new THREE.Vector3(0, 0.8, 0)), 0xff8060, 0.3, 0.05), new THREE.Vector3(0, 0, 0), 420);
    }
    this.spawnFx(slashFx(!!o.lethal), w.clone().setY(PLATFORM_H + 0.9), 620);
    if (canAct(e)) e.pose = { kind: 'flinch', t: 0, dur: 0.5 };
    // 受击击退：沿攻击来源方向被推开一小段再回弹（谁打谁的空间关系更明确）
    if (src && canAct(e)) {
      const knockDir = w.clone().sub(src).setY(0).normalize();
      const base = e.group.position.clone();
      const parent = e.group.parent;
      if (parent) {
        // 世界方向 → 房间局部方向
        const invQ = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
        knockDir.applyQuaternion(invQ).setY(0).normalize();
      }
      if (!e.lunge) {
        e.lunge = { dir: knockDir, t: 0, dur: 0.34, base };
      }
    }
    // 命中白闪→红闪两段：先全白一瞬（打击确认感）再转红（伤害语义）
    const mats = e.rig.materials();
    if (!this.reduced && !this.lowEffects) this.addTween(e, 0.42, (t) => {
      const k = Math.sin(Math.PI * Math.min(1, t));
      if (t < 0.3) {
        const w2 = k / Math.max(0.001, Math.sin(Math.PI * 0.3));
        for (const m of mats) m.emissive.setRGB(w2, w2, w2 * 0.92);
      } else {
        for (const m of mats) m.emissive.setRGB(k * 0.5, 0, 0);
      }
    }, () => {
      for (const { material, emissive } of e.appearance) material.emissive.copy(emissive);
    });
    if (!this.reduced && !this.lowEffects) this.spawnFx(flashLightFx(w, STATE_COLORS.hit, o.lethal ? 4.5 : 2.6, 0.35), w.clone().setY(0), 520);
    this.spawnFloat(w, `<span class="dmg-float ${o.lethal ? 'lethal' : ''}">-${fmtN(o.amount)}</span>`);
    if (o.segment && o.segment.total > 1) this.spawnFloat(w, `<span class="b3-seg">${o.segment.index}/${o.segment.total} 段</span>`, 30);
    if (o.lethal) this.shake(0.18);
    // 打击感：短促的体积挤压脉冲（squash & stretch），受击辨识度优先于姿态后仰
    if (!this.reduced) {
      if (e.squash) e.squash.dead = true;
      const base = e.baseScale;
      e.squash = this.addTween(e, 0.26, (t) => {
        const k = Math.sin(Math.PI * Math.min(1, t));
        e.rig.root.scale.set(base.x * (1 + 0.09 * k), base.y * (1 - 0.16 * k), base.z * (1 + 0.09 * k));
      }, () => {
        e.rig.root.scale.copy(base);
        e.squash = null;
      });
    }
    // 打击感：致命/重击瞬间全体演出短暂减速（微慢动作，不影响结算时序）
    if (!this.reduced && (o.lethal || o.amount >= 3)) {
      this.hitStopUntil = this.realElapsed + 0.09;
    }
  }

  playHeal(pid: string, o: { amount?: number }): void {
    const e = this.entities.get(pid);
    const w = this.worldOf(pid);
    if (!e || !w) return;
    if (canAct(e)) e.pose = { kind: 'cast', t: 0, dur: 1.0 };
    this.pulseRoom(e.curRoom, 'heal', 0.85);
    this.focusPlayer('actor', pid);
    this.spawnFx(healFx(), w.clone().setY(PLATFORM_H), 1000);
    this.spawnFloat(w, `<span class="heal-float">+${fmtN(o.amount ?? 0)}</span>`);
  }

  playMiss(pid: string): void {
    const e = this.entities.get(pid);
    const w = this.worldOf(pid);
    if (!e || !w || !canAct(e)) return;
    const base = e.group.position.clone();
    e.group.rotation.y += Math.PI / 5;
    this.addTween(e, 0.45, (t) => {
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
    const insultPrefix = `${insultGen}|`;
    for (const key of insultSeen.keys()) {
      if (key.startsWith(insultPrefix) && key.endsWith(`->${pid}`)) insultSeen.delete(key);
    }
    this.spawnFloat(w, '<span class="death-stamp b3-stamp">💀 淘汰</span>');
    if (!this.reduced) {
      this.spawnFx(ringBurst(0xe23d30, 1.4, 0.75, { y: PLATFORM_H + 0.1 }), w.clone().setY(0), 850);
      this.spawnFx(flashLightFx(w, 0xff5545, 3.6, 0.4), w.clone().setY(0), 520);
    }
    this.shake(0.14);
    this.focusPlayer('target', pid);
    this.killPose(e);
  }

  playRevive(pid: string, livesLeft: number): void {
    const e = this.entities.get(pid);
    const w = this.worldOf(pid);
    if (!e || !w) return;
    if (!e.alive || e.pose.kind === 'revive') return;
    this.standUp(e, true);
    this.spawnFloat(w, `<span class="revive-burst b3-stamp">💫 ${livesLeft} 命复活</span>`);
    // S 级事件：关键复活值得镜头聚焦（此前缺失，复活演出无聚焦）
    this.focusPlayer('major', pid);
    if (!this.reduced) {
      this.spawnFx(ringBurst(0xffe082, 1.5, 0.85, { y: PLATFORM_H + 0.1 }), w.clone().setY(0), 950);
      this.spawnFx(flashLightFx(w, 0xffd68a, 3.4, 0.5), w.clone().setY(0), 620);
    }
  }

  /**
   * 让实体从 worldFrom 平滑走到目标房间的槽位（弧线绕行）。
   * 快照房间迁移与演出 playWalk 共用：起终点的世界坐标都以房间当前布局为准，
   * 终态与快照一致，仅过程是视觉过渡。
   */
  private startWalkTo(e: Entity, toRoom: Room, slot: { x: number; z: number }, worldFrom: THREE.Vector3, dur: number): THREE.Vector3 {
    const worldTo = new THREE.Vector3(slot.x, PLATFORM_H + 0.1, slot.z);
    toRoom.group.localToWorld(worldTo);
    // 控制点：起点→终点中点向桌心收，形成绕行弧线
    const ctrl = worldFrom.clone().add(worldTo).multiplyScalar(0.5);
    ctrl.multiplyScalar(0.72);
    ctrl.y = PLATFORM_H + 0.4;
    e.walk = { from: worldFrom.clone(), to: worldTo.clone(), ctrl, t: 0, dur };
    if (canAct(e)) e.pose = { kind: 'walk', t: 0, dur: Infinity };
    return worldTo;
  }

  /** 移动：沿路径行走（经中央舞台侧翼）+ 落点尘土 + 聚焦 */
  playWalk(pid: string, fromRoom: string, toRoom: string): void {
    const e = this.entities.get(pid);
    if (!e || !canAct(e) || e.curRoom !== toRoom || !this.rooms.has(fromRoom)) return;
    if (e.walk && !this.reduced && !this.lowEffects) this.spawnFx(dustFx(), this.worldOf(pid)!.setY(PLATFORM_H + 0.05), 600);
    this.focusPlayer('move', pid);
  }

  playIvanThrow(pid: string, room: string, seconds = 1): void {
    const from = this.worldOf(pid);
    const to = this.rooms.get(room);
    if (!from || !to) return;
    const target = to.pos.clone().setY(PLATFORM_H + 0.5);
    const fx = projectileFx(from.clone().add(new THREE.Vector3(0, 0.9, 0)), target, {
      color: 0xff9828, radius: 0.2, dur: seconds, arc: 3.2, spin: true, trail: 3,
      build: (g) => {
        const fuse = new THREE.Mesh(
          new THREE.CylinderGeometry(0.024, 0.024, 0.12, 6),
          new THREE.MeshBasicMaterial({ color: 0xffd68a }),
        );
        fuse.position.y = 0.22;
        g.add(fuse);
      },
    });
    this.spawnFx(fx, new THREE.Vector3(0, 0, 0), seconds * 1000 + 200);
    this.spawnFloat(from, '<span class="b3-ticker">💣 大伊万投掷！</span>');
    // 投掷姿态
    const e = this.entities.get(pid);
    if (e && canAct(e)) e.pose = { kind: 'attack', t: 0, dur: 0.5 };
    this.focusRoom('major', room);
  }

  playIvanBoom(room: string): void {
    const to = this.rooms.get(room);
    if (!to) return;
    const pos = to.pos.clone().setY(PLATFORM_H + 0.4);
    if (this.lowEffects || this.reduced) this.spawnFx(ringBurst(0xff943c, TABLE.roomRadius * 1.5, 0.75), pos, 850);
    else this.spawnFx(explosionFx(0xff8830), pos, 1500);
    if (!this.reduced && !this.lowEffects) this.spawnFx(flashLightFx(pos, 0xff9828, 7, 0.55), pos, 750);
    this.spawnFloat(to.pos.clone().setY(PLATFORM_H + 2.4), '<span class="b3-ticker boom">💥 大伊万爆炸！</span>');
    this.shake(this.reduced ? 0.05 : 0.34);
    this.pulseRoom(room, 'blast', 1.5);
    this.focusRoom('major', room);
  }

  playRoomAlert(room: string, kind: 'aoe' | 'ivan', focus = true): void {
    const to = this.rooms.get(room);
    if (!to) return;
    const color = kind === 'ivan' ? STATE_COLORS.alertIvan : STATE_COLORS.alertAoe;
    this.spawnFx(ringBurst(color, TABLE.roomRadius * 1.5, 0.9, { y: PLATFORM_H + 0.12, tube: 0.055 }), to.pos.clone().setY(0), 1050);
    this.pulseRoom(room, kind === 'ivan' ? 'blast' : 'aoe', 1.05);
    if (focus) this.focusRoom('area', room);
  }

  playAreaAlert(ids: string[]): void {
    const anchors = ids.flatMap(id => {
      const room = this.rooms.get(id);
      if (!room) return [];
      this.playRoomAlert(id, 'aoe', false);
      return [room.anchor.focus];
    });
    if (!anchors.length) return;
    const sum = anchors.reduce((total, point) => ({ x: total.x + point.x, z: total.z + point.z }), { x: 0, z: 0 });
    this.director.request('area', ids.join(','), this.elapsed, () => ({ x: sum.x / anchors.length, z: sum.z / anchors.length }));
  }

  private pulseRoom(rid: string, kind: NonNullable<Room['pulse']>['kind'], seconds: number): void {
    const room = this.rooms.get(rid);
    if (!room || (room.pulse && (room.pulse.kind === 'blast' || room.pulse.kind === 'aoe') && kind === 'hit')) return;
    room.pulse = { kind, until: this.elapsed + seconds };
    room.label.dataset.effect = kind;
    this.paintRoom(room);
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
    this.focusPlayer('major', pid);
  }

  // ── 覆盖层 ────────────────────────────────────────────────

  private spawnFloat(worldPos: THREE.Vector3, html: string, yOffset = 0): void {
    const wrap = document.createElement('div');
    wrap.className = 'b3-float';
    wrap.style.top = `${yOffset}px`;
    wrap.innerHTML = html;
    this.floats.appendChild(wrap);
    (wrap as unknown as { _world?: THREE.Vector3 })._world = worldPos.clone();
    this.floatEnds.set(wrap, this.elapsed + 1.7);
  }

  private updateOverlay(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const proj = (v: THREE.Vector3) => v.clone().project(this.camera);
    // 先定位房间标签（名牌避让需要标签的屏幕位置）。
    // 近侧房间（靠近镜头一侧）的标签放平台下方（门牌位）：俯视相机下头顶锚点
    // 与角色几乎重合，标签若留在朝向桌心一侧（角色上方 35px）必然压住名牌；
    // 平台下方是岩层空地，无角色无名牌，天然不冲突。
    const labelAt = new Map<string, { x: number; y: number; wide: boolean }>();
    for (const r of this.rooms.values()) {
      const lp = new THREE.Vector3(r.anchor.label.x, r.anchor.floor + 0.07, r.anchor.label.z);
      const p = proj(lp);
      let x = (p.x * 0.5 + 0.5) * w;
      let y = (-p.y * 0.5 + 0.5) * h;
      if (r.pos.z > this.lookCur.z + 2) {
        // proj 返回 NDC（-1..1），需换算成像素再取平台下方门牌位
        const floorNdcY = proj(new THREE.Vector3(r.pos.x, PLATFORM_H, r.pos.z)).y;
        const floorPx = (-floorNdcY * 0.5 + 0.5) * h;
        y = Math.min(h - 34, floorPx + 30);
        x = Math.max(44, Math.min(w - 44, x));
      } else {
        const nearEdge = r.pos.z > this.lookCur.z + 2 && Math.abs(r.pos.x) < 3;
        if (nearEdge) x += (w < 600 ? 83 : 76);
      }
      const half = r.pendingIvan ? Math.min(114, w * 0.28) : 40;
      const labelX = Math.max(half, Math.min(w - half, x));
      r.label.style.transform = `translate(-50%,-50%) translate(${labelX.toFixed(1)}px,${y.toFixed(1)}px)`;
      r.label.style.display = p.z > 1 || p.z < -1 ? 'none' : '';
      labelAt.set(r.rid, { x: labelX, y, wide: r.pendingIvan });
    }

    // MAP-102 名牌布局：按房间分批。同房间成员按屏幕 x 排序（左右序与站位对应）；
    // ≤4 人逐个锚定各自头顶（保持与角色的位置关联，重叠时横向让位）；
    // 5 人以上收拢为房间锚定的列阵并向上生长（远离角色站立面），
    // >6 人切换紧凑档。已淘汰成员的名牌始终保留（只压缩，不隐藏）。
    interface PlatePos { e: Entity; x: number; y: number; visible: boolean }
    const byRoom = new Map<string, PlatePos[]>();
    for (const e of this.entities.values()) {
      const world = new THREE.Vector3();
      e.group.getWorldPosition(world);
      world.y += PLATFORM_H + e.rig.headHeight() + 0.55;
      const p = proj(world);
      const item: PlatePos = {
        e, x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h,
        visible: p.z <= 1 && p.z >= -1,
      };
      const list = byRoom.get(e.curRoom);
      if (list) list.push(item); else byRoom.set(e.curRoom, [item]);
    }
    const pad = 46;
    for (const [rid, list] of byRoom) {
      const room = this.rooms.get(rid);
      const label = labelAt.get(rid);
      // 自身房标签的屏幕矩形（单步避让用）。跨房间标签不做链式避让：
      // 标签沿屏幕中轴对角分布，逐个上推会连锁把名牌推到屏幕顶部；
      // 残余重叠由标签 z8 置顶兜底（小胶囊浮在名牌上始终可读）。
      const ownLabel = label ? { x: label.x, y: label.y, hw: label.wide ? 140 : 52, hh: label.wide ? 24 : 14 } : null;
      const sorted = list.slice().sort((a, b) => a.x - b.x || a.e.plateSlot - b.e.plateSlot);
      const count = sorted.length;
      const dense = count > 6;
      if (count <= 4) {
        let lastX = -Infinity;
        let lastY = -Infinity;
        for (const m of sorted) {
          if (!m.visible) continue;
          // 轻量避让：与前一名牌重叠向右让位；压到自己房标签时向上让一步
          if (lastX > -Infinity && Math.abs(m.x - lastX) < (dense ? 70 : 96) && Math.abs(m.y - lastY) < 46) {
            m.x = lastX + (dense ? 70 : 96);
          }
          if (ownLabel && Math.abs(m.x - ownLabel.x) < ownLabel.hw + 50 && m.y > ownLabel.y - ownLabel.hh && m.y - 56 < ownLabel.y + ownLabel.hh) {
            m.y = ownLabel.y - ownLabel.hh - 60;
          }
          m.x = Math.max(pad, Math.min(w - pad, m.x));
          m.y = Math.max(30, m.y);
          lastX = m.x;
          lastY = m.y;
        }
      } else {
        const cols = 3;
        const spacing = w < 620 ? 66 : dense ? 76 : 100;
        const rowH = dense ? 28 : 46;
        const plateH = dense ? 42 : 58;
        const plateHW = dense ? 38 : 52;
        const center = room ? proj(room.pos) : null;
        const anchorX = center ? (center.x * 0.5 + 0.5) * w : sorted[Math.floor(count / 2)].x;
        const visibleTop = Math.min(...sorted.filter(m => m.visible).map(m => m.y));
        const topY = Number.isFinite(visibleTop) ? visibleTop : sorted[0].y;
        // 标签在头顶上方（近侧房）：整组从标签上方起步，避免盖住标签
        const groupTop = ownLabel && ownLabel.y < topY ? Math.min(topY, ownLabel.y - 30) : topY;
        const halfRow = ((cols - 1) * spacing) / 2;
        const originX = Math.max(pad + halfRow, Math.min(w - pad - halfRow, anchorX));
        // 逐行检测与自身房标签的相交：命中则整行上移一步（列对齐不变），
        // 并保持行序单调（上行不高于上一行 - 行距）
        const rowY: number[] = [];
        for (let row = 0; row * cols < count; row++) {
          let y = groupTop - 8 - row * rowH;
          if (ownLabel) {
            for (let col = 0; col < cols && row * cols + col < count; col++) {
              const cx = originX + (col - (cols - 1) / 2) * spacing;
              if (Math.abs(cx - ownLabel.x) < ownLabel.hw + plateHW && y > ownLabel.y - ownLabel.hh && y - plateH < ownLabel.y + ownLabel.hh) {
                y = Math.min(y, ownLabel.y - ownLabel.hh - plateH - 4);
              }
            }
          }
          if (row > 0) y = Math.min(y, rowY[row - 1] - rowH);
          rowY.push(Math.max(30, y));
        }
        sorted.forEach((m, i) => {
          const col = i % cols;
          const row = Math.floor(i / cols);
          m.x = originX + (col - (cols - 1) / 2) * spacing;
          m.y = rowY[row] ?? groupTop - 8;
        });
      }
      for (const m of sorted) {
        const e = m.e;
        e.plate.classList.toggle('is-dense', dense);
        const t = this.targetablePids.has(e.pid) && e.alive;
        const acting = this.lastSnapshot?.currentActor === e.pid && e.alive;
        const priority = t || acting || this.selectedPlayer === e.pid || this.myIds.includes(e.pid);
        e.plate.classList.toggle('is-priority', priority && dense);
        e.plate.style.transform = `translate(-50%,-100%) translate(${m.x.toFixed(1)}px,${m.y.toFixed(1)}px) scale(var(--dead-scale, 1))`;
        // 已淘汰成员不再隐藏名牌：压缩灰章保留「谁已出局」的信息
        e.plate.style.display = m.visible ? '' : 'none';
        e.plate.classList.toggle('is-targetable', t);
        e.plate.classList.toggle('is-selected', t && this.selectedPlayer === e.pid);
        e.plate.classList.toggle('is-acting', acting);
        e.plate.classList.toggle('is-dead', !e.alive);
        // 行动者/可选目标/选中者名牌浮到最上层
        e.plate.style.zIndex = priority ? '6' : e.alive ? '4' : '3';
        const ring = e.ring.material as THREE.MeshBasicMaterial;
        ring.color.setHex(this.selectedPlayer === e.pid && t ? 0x67e9f5 : acting ? GOLD : STATE_COLORS.targetable);
        ring.opacity = t ? 0.78 : acting ? 0.96 : 0;
        e.ring.scale.setScalar(t ? 1.2 : 1);
      }
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
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('lostpointercapture', this.onCancel);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    if (typeof ResizeObserver !== 'undefined') {
      this.sizeObserver = new ResizeObserver(this.resize);
      this.sizeObserver.observe(this.container);
    } else {
      window.addEventListener('resize', this.resize);
    }
    // 后台标签页暂停渲染（省电 / 移动端 GPU 压力），回前台恢复
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = (): void => {
    if (this.disposed) return;
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else if (!this.raf) {
      this.frameAt = performance.now();
      this.loop();
    }
  };

  private onDown = (e: PointerEvent): void => {
    if (this.downPos || e.button !== 0) return;
    this.downPos = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, t: Date.now() };
    this.renderer.domElement.setPointerCapture?.(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    const down = this.downPos;
    if (!down || down.id !== e.pointerId) return;
    if (!this.dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7) this.dragging = true;
    if (!this.dragging) return;
    this.director.drag(e.clientX - down.lastX, e.clientY - down.lastY);
    down.lastX = e.clientX;
    down.lastY = e.clientY;
  };

  private onCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.downPos?.id) return;
    this.downPos = null;
    this.dragging = false;
  };

  private onUp = (e: PointerEvent): void => {
    const down = this.downPos;
    if (!down || down.id !== e.pointerId) return;
    const tap = !this.dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 8 && Date.now() - down.t < 600;
    this.onCancel(e);
    if (tap) this.pick(e);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.director.zoom(e.deltaY);
  };

  private pick(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pickedPoint.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pickedPoint, this.camera);
    const candidates = this.roomPickMode
      ? Array.from(this.rooms.values(), r => r.group)
      : Array.from(this.entities.values()).filter(e => e.alive && e.rig.root.visible).map(e => e.rig.root);
    const hit = this.raycaster.intersectObjects(candidates, true)[0];
    let object: THREE.Object3D | undefined = hit?.object;
    const field = this.roomPickMode ? 'room' : 'pid';
    while (object && !object.userData[field]) object = object.parent ?? undefined;
    const id = object?.userData[field] as string | undefined;
    if (!id) return;
    if (this.roomPickMode) {
      if (id !== this.blockedRoom) this.hooks.onPickRoom(id);
    } else this.hooks.onPickPlayer(id);
  }

  // ── 对外控制 ──────────────────────────────────────────────

  setTargetable(pids: string[]): void { this.targetablePids = new Set(pids); }

  setSelection(roomPickMode: boolean, room: string, player: string, blockedRoom = ''): void {
    this.roomPickMode = roomPickMode;
    this.blockedRoom = blockedRoom;
    this.selectedRoom = room;
    this.selectedPlayer = player;
    for (const r of this.rooms.values()) this.paintRoom(r);
  }

  setReducedMotion(on: boolean): void { this.reduced = on; }

  setLowEffects(on: boolean): void {
    if (this.lowEffects === on) return;
    this.lowEffects = on;
    this.container.dataset.lowEffects = String(on);
    this.renderer.setPixelRatio(on ? 1 : this.pixelRatio);
    this.environment.motes.visible = !on;
  }

  setAutomaticCamera(on: boolean): void { this.director.setAutomatic(on); }

  private focusRoom(shot: Shot, rid: string): void {
    this.director.request(shot, rid, this.elapsed, () => this.rooms.get(rid)?.anchor.focus);
  }

  private focusPlayer(shot: Shot, pid: string): void {
    this.director.request(shot, pid, this.elapsed, () => this.worldOf(pid) ?? undefined);
  }

  resetView(): void {
    this.director.reset();
    this.shakeAmp = 0;
  }

  showFinale(key: string, winner: string | null): void {
    if (this.finaleKey === key) return;
    this.finaleKey = key;
    this.finaleWinner = winner;
    if (winner) {
      this.focusPlayer('winner', winner);
      const e = this.entities.get(winner);
      if (e && canAct(e)) this.setPose(e, { kind: 'cheer', t: 0, dur: Infinity });
    } else {
      this.director.request('draw', key, this.elapsed);
    }
  }

  resetPresentation(newGame = false): void {
    this.director.cancel();
    this.shakeAmp = 0;
    this.hitStopUntil = 0;
    for (const fx of this.fxList.slice()) this.removeFx(fx);
    for (const node of this.floatEnds.keys()) node.remove();
    this.floatEnds.clear();
    this.tweens.length = 0;
    for (const e of this.entities.values()) {
      if (newGame) { this.removeEntity(e); continue; }
      e.walk = null;
      e.lunge = null;
      e.squash = null;
      e.rig.root.scale.copy(e.baseScale);
      for (const { material, emissive } of e.appearance) material.emissive.copy(emissive);
      if (e.alive && !e.deadPose) this.setPose(e, { kind: 'idle', t: 0, dur: Infinity });
    }
    for (const r of this.rooms.values()) {
      r.pulse = null;
      delete r.label.dataset.effect;
      if (newGame) r.slots.clear();
    }
    if (newGame) {
      this.lastSnapshot = null;
      this.finaleWinner = null;
      this.finaleKey = null;
      this.resetView();
    }
  }

  /** E2E/取证探针：当前演出活动量（不参与游戏逻辑） */
  debugCharacters() {
    return Array.from(this.entities.values(), e => {
      const center = e.group.getWorldPosition(new THREE.Vector3());
      center.y += PLATFORM_H + e.rig.headHeight() * 0.55;
      const z = center.z;
      center.project(this.camera);
      return { pid: e.pid, hp: e.shownHp, charId: e.charId, asset: e.asset.id, pose: e.pose.kind,
        t: e.pose.t, dur: e.pose.dur, room: e.curRoom, alive: e.alive, visible: e.rig.root.visible,
        x: (center.x + 1) * this.container.clientWidth / 2, y: (1 - center.y) * this.container.clientHeight / 2, z };
    });
  }

  /** E2E/取证探针：辱骂计数现状（key = 战局代|行动者->目标；模块级，跨场景实例存续） */
  debugInsultCounts(): [string, number][] {
    return [...insultSeen.entries()];
  }

  debugStats() {
    let walks = 0;
    let bodiesHidden = 0;
    for (const e of this.entities.values()) {
      if (e.walk) walks++;
      if (e.deadPose && !e.rig.root.visible) bodiesHidden++; // 尸体已回收（淡出后隐藏）
    }
    return {
      fx: this.fxList.length,
      tweens: this.tweens.length,
      walks,
      entities: this.entities.size,
      rooms: this.rooms.size,
      bodiesHidden,
      calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures,
    };
  }

  private shake(amp: number): void {
    if (!this.reduced && !this.lowEffects) this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  resize = (): void => {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 500;
    this.aspect = w / h;
    this.camPose = defaultPose(this.aspect, this.map.rooms.size || 4);
    this.camera.aspect = this.aspect;
    this.camera.fov = this.camPose.fov;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    if (this.camera.position.lengthSq() < 1) {
      const frame = this.director.frame(this.camPose, this.elapsed, this.reduced);
      this.camera.position.set(frame.position.x, frame.position.y, frame.position.z);
      this.lookCur.set(frame.look.x, 1.1, frame.look.z);
      this.camera.lookAt(this.lookCur);
    }
  };

  // ── 主循环 ────────────────────────────────────────────────

  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.22, (now - this.frameAt) / 1000);
    this.frameAt = now;
    // 打击感微慢动作：致命/重击瞬间的一拍减速（0.09s，纯视觉；结算与演出队列时序不受影响）
    this.realElapsed += dt;
    this.elapsed += dt;
    const poseDt = this.realElapsed < this.hitStopUntil ? dt * 0.15 : dt;
    for (const [node, until] of this.floatEnds) {
      if (this.elapsed < until) continue;
      node.remove();
      this.floatEnds.delete(node);
    }
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
          e.group.position.y = Math.sin(Math.PI * t) * 0.68;
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
          const room = this.rooms.get(e.curRoom);
          if (room) {
            const slot = this.spawnFor(e.pid, room);
            e.group.position.set(slot.x, 0, slot.z);
            if (!this.lowEffects && !this.reduced) this.spawnFx(dustFx(), this.worldOf(e.pid)!.setY(PLATFORM_H + 0.05), 540);
          }
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
        // One pose clock owns collapse, hold and fade. Removing/reviving the
        // entity also cancels the fade, with no delayed callback holding the rig.
        if (e.rig.root.visible) {
          e.pose.t += poseDt;
          if (e.pose.t - poseDt < 0.55) e.rig.dead(Math.min(1, e.pose.t / 0.55));
          if (e.pose.t > 2.6) e.rig.setOpacity(Math.max(0, 1 - (e.pose.t - 2.6) / 0.8));
          if (e.pose.t >= 3.4) e.rig.root.visible = false;
        }
      } else if (e.walk && e.pose.kind === 'walk') {
        e.rig.walk(this.elapsed, 1);
      } else {
        e.pose.t += poseDt;
        switch (e.pose.kind) {
          case 'revive':
            e.rig.reviveRise(Math.min(1, e.pose.t / e.pose.dur));
            if (e.pose.t >= e.pose.dur) {
              const kind = this.finaleWinner === e.pid ? 'cheer' : e.walk ? 'walk' : 'idle';
              this.setPose(e, { kind, t: 0, dur: Infinity });
            }
            break;
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
              e.rig.signalActor?.(this.elapsed);
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
      if (r.pulse && this.elapsed >= r.pulse.until) {
        r.pulse = null;
        delete r.label.dataset.effect;
        this.paintRoom(r);
      }
      if (this.roomPickMode) this.paintRoom(r);
      if (r.pendingIvan && !this.reduced && !this.lowEffects) {
        r.beaconMat.opacity = 0.6 + Math.sin(this.elapsed * 5) * 0.35;
        if (r.bombMarker) r.bombMarker.position.y = PLATFORM_H + 1.35 + Math.sin(this.elapsed * 2.6) * 0.12;
      }
      if (r.dome && !this.reduced && !this.lowEffects) {
        (r.dome.material as THREE.MeshBasicMaterial).opacity = 0.14 + Math.sin(this.elapsed * 2.2) * 0.05;
      }
      const lava = r.group.getObjectByName('lava');
      if (lava && !this.reduced && !this.lowEffects) {
        (lava as THREE.Mesh).scale.y = 1 + Math.sin(this.elapsed * 3.2) * 0.25;
      }
    }
    this.environment.motes.visible = !this.lowEffects && !this.reduced;
    if (this.environment.motes.visible) {
      this.environment.relic.rotation.y += dt * 0.52;
      this.environment.relic.position.y = 1.56 + Math.sin(this.elapsed * 1.4) * 0.12;
      this.environment.motes.rotation.y = this.elapsed * 0.023;
    }

    this.updateCamera(dt);
    const busy = this.tweens.length > 0 || this.fxList.length > 0 || this.dragging || this.camMoving
      || Array.from(this.entities.values()).some(e => e.walk || e.lunge);
    const minFrame = busy ? (this.lowEffects ? 0.027 : 0) : 0.05;
    if (this.elapsed - this.lastRender >= minFrame) {
      this.lastRender = this.elapsed;
      this.weather.update(this.realElapsed, !this.lowEffects && !this.reduced);
      this.updateOverlay();
      this.renderer.render(this.scene, this.camera);
    }
  };

  private updateCamera(dt: number): void {
    const frame = this.director.frame(this.camPose, this.elapsed, this.reduced);
    this.shot = frame.shot;
    const look = new THREE.Vector3(frame.look.x, 1.1, frame.look.z);
    const position = new THREE.Vector3(frame.position.x, frame.position.y, frame.position.z);
    const blend = this.reduced ? 1 : 1 - Math.exp(-dt * 6.2);
    // Smooth the unshaken pose. Shake never changes the orbit or framing state.
    this.camTarget.lerp(position, this.camTarget.lengthSq() < 1 ? 1 : blend);
    this.lookCur.lerp(look, blend);
    this.camMoving = this.camTarget.distanceToSquared(position) > 0.003
      || this.lookCur.distanceToSquared(look) > 0.003;
    this.camera.position.copy(this.camTarget);
    if (this.shakeAmp > 0.001) {
      this.shakeAmp *= Math.pow(0.002, dt);
      this.camera.position.x += (Math.random() - 0.5) * this.shakeAmp;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeAmp * 0.6;
      this.camera.position.z += (Math.random() - 0.5) * this.shakeAmp;
    }
    this.camera.lookAt(this.lookCur);
    this.camera.updateMatrixWorld();
  }

  debugMap() {
    return {
      map: this.map.id,
      shot: this.shot,
      rooms: Array.from(this.rooms.values(), r => ({
        id: r.rid, center: r.pos.toArray(), pending: r.pendingIvan, effect: r.pulse?.kind, slots: Array.from(r.slots),
      })),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    gllog.push('scene-disposed', {}, false);
    cancelAnimationFrame(this.raf);
    this.renderer.domElement.removeEventListener('pointerdown', this.onDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.onCancel);
    this.renderer.domElement.removeEventListener('lostpointercapture', this.onCancel);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    window.clearTimeout(this.contextTimer);
    this.renderer.domElement.removeEventListener('wheel', this.onWheel);
    this.sizeObserver?.disconnect();
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.resetPresentation(true);
    this.releaseRoomObject(this.environment.root);
    for (const room of this.rooms.values()) {
      this.releaseRoomObject(room.group);
      if (room.bridge) this.releaseRoomObject(room.bridge);
    }
    this.scene.clear();
    this.rooms.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
    this.overlay.remove();
    this.floats.remove();
  }
}

function fmtN(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
