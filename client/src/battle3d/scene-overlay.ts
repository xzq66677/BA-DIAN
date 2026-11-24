import * as THREE from 'three';
import { TABLE } from './layout.js';
import { GOLD, STATE_COLORS } from './palette.js';
import type { RoomView } from './room-view.js';

interface OverlayEntity {
  pid: string;
  group: THREE.Group;
  rig: { headHeight(): number };
  curRoom: string;
  plateSlot: number;
  plate: HTMLDivElement;
  ring: THREE.Mesh;
  alive: boolean;
}

export interface FloatingLabel {
  world: THREE.Vector3;
  until: number;
}

interface OverlayLayout {
  camera: THREE.PerspectiveCamera;
  lookZ: number;
  w: number;
  h: number;
  rooms: ReadonlyMap<string, RoomView>;
  entities: ReadonlyMap<string, OverlayEntity>;
  floatLabels: ReadonlyMap<HTMLDivElement, FloatingLabel>;
  targetablePids: ReadonlySet<string>;
  currentActor?: string | null;
  selectedPlayer: string;
  myIds: readonly string[];
}

const PLATFORM_H = TABLE.roomHeight;

export function positionOverlay({
  camera, lookZ, w, h, rooms, entities, floatLabels, targetablePids, currentActor, selectedPlayer, myIds,
}: OverlayLayout): void {
  const proj = (v: THREE.Vector3) => v.clone().project(camera);
  // 先定位房间标签（名牌避让需要标签的屏幕位置）。
  // 近侧房间（靠近镜头一侧）的标签放平台下方（门牌位）：俯视相机下头顶锚点
  // 与角色几乎重合，标签若留在朝向桌心一侧（角色上方 35px）必然压住名牌；
  // 平台下方是岩层空地，无角色无名牌，天然不冲突。
  const labelAt = new Map<string, { x: number; y: number; wide: boolean }>();
  for (const r of rooms.values()) {
    const lp = new THREE.Vector3(r.anchor.label.x, r.anchor.floor + 0.07, r.anchor.label.z);
    const p = proj(lp);
    let x = (p.x * 0.5 + 0.5) * w;
    let y = (-p.y * 0.5 + 0.5) * h;
    if (r.pos.z > lookZ + 2) {
      // proj 返回 NDC（-1..1），需换算成像素再取平台下方门牌位
      const floorNdcY = proj(new THREE.Vector3(r.pos.x, PLATFORM_H, r.pos.z)).y;
      const floorPx = (-floorNdcY * 0.5 + 0.5) * h;
      y = Math.min(h - 34, floorPx + 30);
      x = Math.max(44, Math.min(w - 44, x));
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
  interface PlatePos { e: OverlayEntity; x: number; y: number; visible: boolean }
  const byRoom = new Map<string, PlatePos[]>();
  for (const e of entities.values()) {
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
    const room = rooms.get(rid);
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
        if (lastX > -Infinity && Math.abs(m.x - lastX) < 96 && Math.abs(m.y - lastY) < 46) {
          m.x = lastX + 96;
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
      const t = targetablePids.has(e.pid) && e.alive;
      const acting = currentActor === e.pid && e.alive;
      const priority = t || acting || selectedPlayer === e.pid || myIds.includes(e.pid);
      e.plate.classList.toggle('is-priority', priority && dense);
      e.plate.style.transform = `translate(-50%,-100%) translate(${m.x.toFixed(1)}px,${m.y.toFixed(1)}px) scale(var(--dead-scale, 1))`;
      // 已淘汰成员不再隐藏名牌：压缩灰章保留「谁已出局」的信息
      e.plate.style.display = m.visible ? '' : 'none';
      e.plate.classList.toggle('is-targetable', t);
      e.plate.classList.toggle('is-selected', t && selectedPlayer === e.pid);
      e.plate.classList.toggle('is-acting', acting);
      e.plate.classList.toggle('is-dead', !e.alive);
      // 行动者/可选目标/选中者名牌浮到最上层
      e.plate.style.zIndex = priority ? '6' : e.alive ? '4' : '3';
      const ring = e.ring.material as THREE.MeshBasicMaterial;
      ring.color.setHex(selectedPlayer === e.pid && t ? 0x67e9f5 : acting ? GOLD : STATE_COLORS.targetable);
      ring.opacity = t ? 0.78 : acting ? 0.96 : 0;
      e.ring.scale.setScalar(t ? 1.2 : 1);
    }
  }
  for (const [wrap, { world }] of floatLabels) {
    const p = proj(world);
    wrap.style.transform = `translate(-50%,-50%) translate(${((p.x * 0.5 + 0.5) * w).toFixed(1)}px,${((-p.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
  }
}
