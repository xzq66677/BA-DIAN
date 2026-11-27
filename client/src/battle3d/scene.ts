/** Three.js arena, DOM overlays and character presentation. Rules live in the engine. */

import * as THREE from 'three';
import { TABLE, createRuinsMap, defaultPose, stableMembers, type RoomAnchor } from './layout.js';
import { CameraDirector, type Shot } from './camera-director.js';
import { RUINS_COLORS, buildBridge, createRuinsEnvironment } from './ruins.js';
import { createRuinsWeather } from './ruins-weather.js';
import type { GameSnapshot, SnapPlayer } from '../../../shared/src/protocol.js';
import type { DeferredEvent } from '../../../shared/src/types.js';
import type { RuinsConditions } from '../../../shared/src/floating-ruins.js';
import { GOLD, STATE_COLORS } from './palette.js';
import { buildRoomView, releaseRoomObject, type RoomView } from './room-view.js';
import { positionOverlay, type FloatingLabel } from './scene-overlay.js';
import { cardMeta } from '../cards.js';
import { slotMachineRoomLabel, slotMachineState } from '../battle/slot-machine-state.js';
import { createCharacterAsset, releaseMeshes, type CharacterRig } from './characters/index.js';
import {
  slashFx, ringBurst, beamFx, projectileFx, explosionFx, healFx, skillAuraFx,
  flashLightFx, dustFx, domainBurstFx, towerCollapseFx, type FxInstance,
} from './fx.js';
import { gllog } from './gllog.js';
import { slotMachineDropFx } from './slot-drop-fx.js';
import { B3D_RESTORE_WAIT_MS } from './gl-policy.js';
import { loadedCollaborationVisualId, roomDecoration } from './characters/collab-assets.js';
import { RoomDecorations, windAssetFx, windTravel } from './collaboration-props.js';
import type { AssetCue } from './collaboration-presenters.js';
export { preloadCollaborationAssets } from './characters/collab-assets.js';

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
  'id' | 'name' | 'charId' | 'charName' | 'hp' | 'maxHp' | 'room' | 'alive' | 'hidden' | 'invisible' | 'char' | 'effects'>;
export type SnapLite = Pick<GameSnapshot, 'roomIds' | 'currentActor' | 'phase' | 'winner' | 'domainHolder' | 'ruins'> & {
  players: SnapPlayerLite[];
  deferred?: Pick<DeferredEvent, 'id' | 'kind' | 'room' | 'explodeRound'>[];
  submittedIds?: string[];
  myIds?: string[];
};

export interface SceneHooks {
  onPickPlayer: (pid: string) => void;
  onShowStatus?: (pid: string) => void;
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
  pickButton: HTMLButtonElement;
  hpButton: HTMLButtonElement;
  hpFill: HTMLSpanElement;
  hpText: HTMLSpanElement;
  badges: HTMLDivElement;
  nameEl: HTMLDivElement;
  avatar: HTMLDivElement;
  stick: THREE.Object3D | null;
  bobPhase: number;
  pose: PoseTask;              // 当前动作
  curRoom: string;
  inRoomStructure: boolean;
  shownHp: number;
  deadPose: boolean;
  invisible: boolean;
  alive: boolean;
  walk: { from: THREE.Vector3; to: THREE.Vector3; ctrl: THREE.Vector3; t: number; dur: number; curve?: (t: number) => THREE.Vector3 } | null;
  lunge: { dir: THREE.Vector3; t: number; dur: number; base: THREE.Vector3 } | null;
  /** 进行中的受击挤压补间（连续受击时取消前一个） */
  squash: Tween | null;
  /** 创建时的基准缩放（squash 恢复基准；连续受击不累积体积漂移） */
  baseScale: THREE.Vector3;
  /** 名牌水平错开：房间内成员序号 / 总数（同房间多人名牌投影重叠时横向分散） */
  plateSlot: number;
  plateCount: number;
}

// Presentation commands can arrive after the authoritative life transition.
function canAct(e: Entity): boolean {
  return e.alive && !e.deadPose && e.pose.kind !== 'revive';
}

interface Tween { owner?: Entity; el: number; dur: number; fn: (t: number) => void; done?: () => void; dead?: boolean }

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
  private rooms = new Map<string, RoomView>();
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
  private readonly floatLabels = new Map<HTMLDivElement, FloatingLabel>();

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
  private excludedRoom = '';
  private lastRender = 0;
  private camMoving = true;
  private targetablePids = new Set<string>();
  private lastSnapshot: SnapLite | null = null;
  private readonly decorations = new RoomDecorations();

  refreshCollaborationAssets(): void {
    const snapshot = this.lastSnapshot;
    if (this.disposed || !snapshot) return;
    const upgrade = snapshot.players.some(player => {
      const id = loadedCollaborationVisualId(player.charId);
      return id && this.entities.get(player.id)?.asset.id !== id;
    });
    if (upgrade) this.syncSnapshot(snapshot, true);
    else this.syncDecorations(snapshot, true);
  }

  private syncDecorations(snapshot: SnapLite, immediate: boolean): void {
    const requests = new Map<string, NonNullable<ReturnType<typeof roomDecoration>>>();
    for (const player of snapshot.players) {
      const request = roomDecoration(player.charId, player.room, player);
      if (request && snapshot.roomIds.includes(request.room)) requests.set(player.id, request);
    }
    this.decorations.sync(requests, room => this.map.rooms.has(room) ? this.rooms.get(room)?.group : undefined, PLATFORM_H, immediate);
  }
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
      if (room.bridge) {
        releaseRoomObject(room.bridge);
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
          room.group.rotation.y = Math.atan2(destination.x - anchor.center.x, destination.z - anchor.center.z);
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

  private ensureRoom(anchor: RoomAnchor): RoomView {
    const existing = this.rooms.get(anchor.id);
    if (existing) return existing;
    const room = buildRoomView(anchor, {
      canPick: (rid) => this.roomPickMode && rid !== this.blockedRoom && rid !== this.excludedRoom,
      pick: (rid) => this.hooks.onPickRoom(rid),
      hover: (rid) => { this.hoveredRoom = rid; },
    });
    this.scene.add(room.group);
    this.overlay.appendChild(room.label);
    this.rooms.set(room.rid, room);
    return room;
  }

  // ── 角色实体：程序化人形 ───────────────────────────────────

  private ensureEntity(p: SnapPlayerLite): Entity {
    let e = this.entities.get(p.id);
    const available = loadedCollaborationVisualId(p.charId);
    if (e?.charId === p.charId && (!available || e.asset.id === available)) return e;
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
    plate.innerHTML = `
      <button class="b3-pick" type="button">
        <span class="b3-av"></span>
        <span class="b3-nm"><span class="b3-nm-text"></span></span>
      </button>
      <button class="b3-hpbar" type="button" title="点击查看生命与角色状态">
        <span class="b3-hp-fill"></span><span class="b3-hp-text"></span>
      </button>
      <div class="b3-badges"></div>`;
    const pickButton = plate.querySelector('.b3-pick') as HTMLButtonElement;
    const hpButton = plate.querySelector('.b3-hpbar') as HTMLButtonElement;
    pickButton.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.hooks.onPickPlayer(p.id);
    });
    hpButton.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.hooks.onShowStatus?.(p.id);
    });
    this.overlay.appendChild(plate);
    const e_avatarHost = plate.querySelector('.b3-av') as HTMLSpanElement;

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
      pickButton,
      hpButton,
      hpFill: plate.querySelector('.b3-hp-fill')!,
      hpText: plate.querySelector('.b3-hp-text')!,
      badges: plate.querySelector('.b3-badges')!,
      nameEl: plate.querySelector('.b3-nm-text')!,
      avatar: plate.querySelector('.b3-av')!,
      stick: asset.stick,
      bobPhase: Math.random() * Math.PI * 2,
      pose: { kind: 'idle', t: 0, dur: Infinity },
      curRoom: p.room, inRoomStructure: p.char.inTower === true, shownHp: p.hp, deadPose: false, invisible: false, alive: p.alive, walk: null, lunge: null, squash: null,
      baseScale: rig.root.scale.clone(),
      plateSlot: 0, plateCount: 1,
    };
    e.group.visible = !e.inRoomStructure;
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

  private reconcileSlots(room: RoomView, players: SnapPlayerLite[]): void {
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

  private spawnFor(pid: string, room: RoomView) {
    const spawn = room.anchor.spawns[room.slots.get(pid) ?? 0];
    return this.entities.get(pid)?.inRoomStructure ? { x: spawn.x * .40, z: spawn.z * .40 } : spawn;
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
    this.syncDecorations(snap, immediate || this.reduced);
    for (const [rid, room] of this.rooms) {
      if (this.map.rooms.has(rid)) continue;
      releaseRoomObject(room.group);
      if (room.bridge) releaseRoomObject(room.bridge);
      room.label.remove();
      this.rooms.delete(rid);
    }

    // 房间状态
    const machines = snap.players.map(slotMachineState);
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
      const objects = machines.flatMap(machine => machine?.room === room.rid ? [slotMachineRoomLabel(machine)] : []);
      room.labelObjects.textContent = objects.join(' · ');
      room.labelObjects.hidden = !objects.length;
      room.label.classList.toggle('is-muddy', !!mudHere?.active);
      room.label.setAttribute('aria-label', [`房间 ${room.rid}`, mudHere?.active ? '泥潭封路' : mudHere ? `第 ${mudHere.activeRound} 回合泥潭预警` : '', ...objects].filter(Boolean).join('，'));
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
        releaseRoomObject(room.dome);
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
        releaseRoomObject(room.bombMarker);
        room.bombMarker = null;
      }
      room.group.visible = true;
    }

    if (snap.phase === 'act' && snap.currentActor && snap.currentActor !== prevActor) {
      const p = players.get(snap.currentActor);
      if (p) this.focusRoom('room', p.room);
    }
  }

  private paintRoom(room: RoomView): void {
    const pickable = this.roomPickMode && this.blockedRoom !== room.rid && this.excludedRoom !== room.rid;
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
    const structureChanged = e.inRoomStructure !== (p.char.inTower === true);
    e.inRoomStructure = p.char.inTower === true;
    e.group.visible = !e.inRoomStructure;
    const slot = this.spawnFor(p.id, toRoom);
    if (e.curRoom !== p.room || structureChanged) {
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
    e.plate.dataset.room = p.room;
    e.pickButton.setAttribute('aria-label', `${p.name}，${p.room}，生命 ${fmtN(p.hp)}/${fmtN(p.maxHp)}，点击选择或查看详情`);
    e.hpButton.setAttribute('aria-label', `查看 ${p.name} 的生命与状态（${fmtN(p.hp)}/${fmtN(p.maxHp)}）`);
    const hpPct = Math.max(0, Math.min(100, (p.hp / Math.max(1, p.maxHp)) * 100));
    e.shownHp = p.hp;
    e.plate.dataset.hp = String(p.hp);
    e.hpText.textContent = `${fmtN(p.hp)}/${fmtN(p.maxHp)}`;
    e.hpFill.style.width = `${hpPct}%`;
    e.hpFill.style.background = hpPct > 50 ? 'linear-gradient(90deg,#63d97e,#8ce6a0)' : hpPct > 25 ? 'linear-gradient(90deg,#e2a23c,#f0c060)' : 'linear-gradient(90deg,#e23d30,#ff6a5c)';
    this.renderBadges(e, p, snap);
    // 存活状态
    e.alive = p.alive;
    e.invisible = p.invisible;
    e.rig.presentation?.updateState(p, immediate || this.reduced);
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
    if (p.alive && p.effects?.some(effect => effect.kind === 'possessing')) parts.push('<span class="b3-bdg">👻 附身中</span>');
    else if (p.invisible && p.alive) parts.push('<span class="b3-bdg">👻</span>');
    if (p.alive && p.effects?.some(effect => effect.kind === 'possessed')) parts.push('<span class="b3-bdg">被附身</span>');
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

  playAssetCue(pid: string, cue: AssetCue): boolean {
    const actor = this.entities.get(pid);
    if (!actor || !canAct(actor)) return false;
    const direction = cue.targets.map(id => this.worldOf(id)).find(position => position !== null);
    if (direction) this.faceTo(actor, direction);
    const played = actor.rig.presentation?.play(cue.clip, this.reduced ? .12 : cue.seconds);
    if (!played) return false;
    if (cue.directional && !this.reduced && !this.lowEffects) {
      const from = actor.rig.root.getObjectByName('WindOrigin')?.getWorldPosition(new THREE.Vector3())
        ?? actor.rig.root.getWorldPosition(new THREE.Vector3());
      for (const target of cue.targets) {
        const entity = this.entities.get(target);
        if (entity?.walk && cue.moves?.some(move => move.pid === target)) {
          entity.walk.curve = windTravel(cue.directional, entity.walk.from, entity.walk.to);
          entity.walk.dur = cue.seconds;
        }
        const position = this.worldOf(target);
        if (!position) continue;
        const fx = windAssetFx(cue.directional, position.sub(from), cue.seconds);
        if (fx) this.spawnFx(fx, from, cue.seconds * 1000);
      }
    }
    return true;
  }

  /** 行动姿态 */
  playAction(pid: string, kind: string, targetId?: string): void {
    const e = this.entities.get(pid);
    if (!e || !canAct(e)) return;
    switch (kind) {
      case 'attack': {
        if (e.rig.presentation) return; // GLB rigs use the authoritative attack declaration once.
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
  playAttackDecl(sourceId: string, targetId: string, presentation?: Readonly<Record<string, unknown>>): void {
    const e = this.entities.get(sourceId);
    const to = this.worldOf(targetId);
    if (!e || !to || !canAct(e)) return;
    this.faceTo(e, to);
    if (e.rig.presentation) {
      const mounted = presentation?.mounted === true;
      const crossing = mounted && typeof presentation?.fromRoom === 'string' &&
        typeof presentation?.toRoom === 'string' && presentation.fromRoom !== presentation.toRoom;
      const action = mounted ? 'mountedAttack' : e.rig.presentation.actionClip ?? 'attackSwing';
      const seconds = this.reduced ? .16 : action === 'shoot' ? 1.5 : mounted ? 1.15 : .78;
      if (e.rig.presentation.play(action, seconds, crossing)) {
        this.focusPlayer('target', targetId);
        return;
      }
    }
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
  private startWalkTo(e: Entity, toRoom: RoomView, slot: { x: number; z: number }, worldFrom: THREE.Vector3, dur: number): THREE.Vector3 {
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

  playSlotDrop(pid: string, room: string, seconds: number): void {
    const target = this.rooms.get(room);
    if (!target) return;
    const duration = Math.max(0.8, seconds);
    const landed = this.decorations.objectFor(pid);
    const position = landed?.getWorldPosition(new THREE.Vector3()) ?? target.pos.clone().setY(PLATFORM_H);
    const fx = slotMachineDropFx(position, {
      duration,
      reducedMotion: this.reduced,
      lowEffects: this.lowEffects,
    });
    if (landed) landed.visible = false;
    this.spawnFx({ ...fx, dispose() {
      if (landed) landed.visible = true;
      fx.dispose();
    } }, position, duration * 1000 + 200);
    const actor = this.entities.get(pid);
    if (actor && canAct(actor)) actor.pose = { kind: 'attack', t: 0, dur: Math.min(0.7, duration * 0.3) };
    this.spawnFloat(position.clone().setY(PLATFORM_H + 2.25), '<span class="b3-ticker boom">老虎机从天而降</span>');
    this.focusRoom('major', room);
    if (this.reduced) return;
    this.tweens.push({
      el: 0,
      dur: duration * 0.62,
      fn: () => {},
      done: () => {
        this.pulseRoom(room, 'blast', 0.85);
        this.shake(this.lowEffects ? 0.08 : 0.28);
      },
    });
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

  playTowerHit(room: string, amount: number, hpAfter: number): void {
    const to = this.rooms.get(room);
    if (!to) return;
    if (hpAfter <= 0) this.decorations.collapse(room);
    else this.decorations.hit(room);
    this.spawnFx(ringBurst(0xb8a78c, 1.15, 0.5, { y: PLATFORM_H + 0.15, tube: 0.045 }), to.pos.clone().setY(0), 650);
    this.spawnFloat(to.pos.clone().setY(PLATFORM_H + 2.1), `<span class="b3-ticker">🗼 高塔 -${amount}（${hpAfter}/6）</span>`);
  }

  playTowerCollapse(room: string): void {
    const to = this.rooms.get(room);
    if (!to) return;
    this.decorations.collapse(room);
    const pos = to.pos.clone().setY(PLATFORM_H + 0.25);
    this.spawnFx(towerCollapseFx(), pos, 1500);
    this.spawnFloat(to.pos.clone().setY(PLATFORM_H + 2.5), '<span class="b3-ticker boom">🗼 玄武岩高塔坍塌！</span>');
    this.shake(this.reduced ? 0.08 : 0.42);
    this.pulseRoom(room, 'blast', 1.2);
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

  private pulseRoom(rid: string, kind: NonNullable<RoomView['pulse']>['kind'], seconds: number): void {
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
    this.floatLabels.set(wrap, { world: worldPos.clone(), until: this.elapsed + 1.7 });
  }

  private updateOverlay(): void {
    positionOverlay({
      camera: this.camera, lookZ: this.lookCur.z,
      w: this.container.clientWidth, h: this.container.clientHeight,
      rooms: this.rooms, entities: this.entities, floatLabels: this.floatLabels,
      currentActor: this.lastSnapshot?.currentActor,
      targetablePids: this.targetablePids, selectedPlayer: this.selectedPlayer, myIds: this.myIds,
    });
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
      if (id !== this.blockedRoom && id !== this.excludedRoom) this.hooks.onPickRoom(id);
    } else this.hooks.onPickPlayer(id);
  }

  // ── 对外控制 ──────────────────────────────────────────────

  setTargetable(pids: string[]): void { this.targetablePids = new Set(pids); }

  setSelection(roomPickMode: boolean, room: string, player: string, blockedRoom = '', excludedRoom = ''): void {
    this.roomPickMode = roomPickMode;
    this.blockedRoom = blockedRoom;
    this.excludedRoom = excludedRoom;
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
    for (const node of this.floatLabels.keys()) node.remove();
    this.floatLabels.clear();
    this.tweens.length = 0;
    this.decorations.dispose();
    for (const e of this.entities.values()) {
      if (newGame) { this.removeEntity(e); continue; }
      e.rig.presentation?.reset();
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
        t: e.pose.t, dur: e.pose.dur, room: e.curRoom, alive: e.alive, visible: e.rig.root.visible, visualId: e.asset.id,
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
      slotDrops: this.fxList.filter(({ fx }) => fx.object.userData.kind === 'slot-drop').length,
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
    for (const [node, { until }] of this.floatLabels) {
      if (this.elapsed < until) continue;
      node.remove();
      this.floatLabels.delete(node);
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
        const p = e.walk.curve?.(t) ?? e.walk.from.clone().multiplyScalar(it * it)
          .add(e.walk.ctrl.clone().multiplyScalar(2 * it * t))
          .add(e.walk.to.clone().multiplyScalar(t * t));
        const parent = e.group.parent;
        if (parent) {
          const local = parent.worldToLocal(p.clone());
          e.group.position.copy(local);
          e.group.position.y = e.walk.curve ? p.y : Math.sin(Math.PI * t) * 0.68;
        }
        // 面向行进方向
        const aheadT = Math.min(1, t + 0.04);
        const it2 = 1 - aheadT;
        const ahead = e.walk.curve?.(aheadT) ?? e.walk.from.clone().multiplyScalar(it2 * it2)
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

    const updatedRigs = new Set<string>();
    const updateRig = (entity: Entity): void => {
      const presentation = entity.rig.presentation;
      if (!presentation || updatedRigs.has(entity.pid)) return;
      updatedRigs.add(entity.pid);
      presentation.update(poseDt, id => {
        const host = this.entities.get(id);
        if (!host?.alive || host.curRoom !== entity.curRoom) return;
        updateRig(host);
        return host.rig.presentation?.attachmentAnchor?.() ?? host.rig.root;
      });
    };
    for (const entity of this.entities.values()) updateRig(entity);
    const movingDecorations = this.decorations.update(poseDt);

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
    const busy = movingDecorations || this.tweens.length > 0 || this.fxList.length > 0 || this.dragging || this.camMoving
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
    releaseRoomObject(this.environment.root);
    for (const room of this.rooms.values()) {
      releaseRoomObject(room.group);
      if (room.bridge) releaseRoomObject(room.bridge);
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
