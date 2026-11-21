/**
 * 拔典 3D 战场 · 布局数学（纯函数，无 three.js 依赖，可在 jsdom 单测）
 *
 * 空间语义（沉浸牌桌 C 构图的 3D 化）：
 *  - 整个战场是一张椭圆牌桌（XZ 平面），中央为事件核心（演出的飞行物/光束交汇区）；
 *  - 「我的房间」平台固定在桌面前缘（靠近默认机位），其余房间沿远端弧线展开；
 *  - 房间数 = 玩家数（引擎规则：每名玩家一个初始房间），弧线随房间数自动收放；
 *  - 每个房间平台内为成员分配泊位（slot），成员按稳定 id 排序，保证站位不抖动。
 */

export interface Vec2 { x: number; z: number }

/** 桌面与房间几何常量（世界单位 ≈ 米） */
export const TABLE = {
  /** 场地金环半径（X / Z） */
  rx: 11.5,
  rz: 9.6,
  /** 房间石台半径（六棱外接） */
  roomRadius: 2.7,
  /** 中央事件舞台半径 */
  coreRadius: 3.0,
  /** 石台高度 */
  roomHeight: 1.12,
} as const;

/** 单个房间内的成员泊位（局部坐标，相对房间中心，XZ 平面） */
export function roomSlot(index: number, total: number): Vec2 {
  if (total <= 1) return { x: 0, z: 0 };
  // 泊位围绕房间中心排成两排（前/后），最多每排 3 人，站得下 6 人
  const layout: Vec2[] = [
    { x: -0.85, z: 0.95 }, { x: 0.85, z: 0.95 },
    { x: -0.85, z: 0.05 }, { x: 0.85, z: 0.05 },
    { x: 0, z: 0.95 }, { x: 0, z: 0.05 },
  ];
  return layout[index % layout.length];
}

/**
 * 房间在桌面上的位置（世界坐标）。
 * @param rid 房间 id（R1/R2/…）
 * @param myRoom 我方房间（null = 观战/未入座，全部房间走弧线）
 * @param roomIds 全部房间（决定弧线密度）
 */
export function roomPosition(rid: string, myRoom: string | null, roomIds: string[]): Vec2 {
  const arcRooms = roomIds.filter((r) => r !== myRoom);
  if (rid === myRoom) {
    // 我的房间：正前方（靠近默认机位）
    return { x: 0, z: TABLE.rz * 0.62 };
  }
  const idx = arcRooms.indexOf(rid);
  const n = arcRooms.length;
  if (n <= 0 || idx < 0) return { x: 0, z: -TABLE.rz * 0.8 };
  // 远端弧线：X 均布 + 弧形深度 + 奇偶错落（两排深度差保证大房间数下石台不重叠）
  const dx = Math.min(3.4, Math.max(3.0, 22 / Math.max(1, n - 1)));
  const W = (dx * (n - 1)) / 2;
  const x = -W + idx * dx;
  const zBase = TABLE.rz * 0.72;
  const bulge = TABLE.rz * 0.12;
  const wSafe = Math.max(1, W);
  const stagger = Math.min(2.6, dx * 0.78);
  const z = -(zBase + bulge * (1 - (x / wSafe) ** 2)) - (idx % 2) * stagger;
  return { x, z };
}

/** 稳定成员排序：按 id 字典序（保证快照间泊位不抖动） */
export function stableMembers<T extends { id: string }>(members: T[]): T[] {
  return members.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 成员在房间内的泊位索引（稳定排序后的位置） */
export function memberSlotIndex(pid: string, roomMemberIds: string[]): number {
  return stableMembers(roomMemberIds.map((id) => ({ id }))).findIndex((m) => m.id === pid);
}

// ── 相机取景 ────────────────────────────────────────────────

export interface CamPose {
  /** 相机位置（球坐标围绕 lookAt 目标） */
  radius: number;
  height: number;
  /** 视线目标（世界坐标） */
  look: Vec2;
  /** 视场角（度） */
  fov: number;
}

/**
 * 默认机位：按画幅宽高比与房间数自适应。
 * 桌面 / 手机竖屏 / 手机横屏各有取景策略，保证全部房间进入视野且不裁切。
 */
export function defaultPose(aspect: number, roomCount: number): CamPose {
  // 房间多（弧线更宽）时拉远一点
  const wide = roomCount >= 6 ? 1.12 : roomCount >= 5 ? 1.06 : 1;
  if (aspect < 0.75) {
    // 手机竖屏：窄视口 → 高机位 + 大 FOV，全场纵向铺满
    // （look.z 偏向前缘：给顶部状态层留出余量，我的房间不贴底）
    return { radius: 2.2 * wide, height: 18.4 * wide, look: { x: 0, z: 1.9 }, fov: 62 };
  }
  if (aspect < 1.05) {
    // 近方形 / 平板竖屏
    return { radius: 3.0 * wide, height: 15.8 * wide, look: { x: 0, z: 1.8 }, fov: 56 };
  }
  if (aspect > 2.1) {
    // 手机横屏（如 844×390）：矮视口 → 高机位 + 小 FOV 压缩透视，横向铺开；
    // 保证近端「我的房间」不被底部操作坞裁切、远端房间不被顶部揭示台遮挡
    return { radius: 6.2 * wide, height: 14.5 * wide, look: { x: 0, z: 2.2 }, fov: 50 };
  }
  // 桌面（约 16:9 ~ 4:3）：高机位俯瞰全场。
  // 取景需避开顶部揭示台（~130px）与底部行动坞（~190px）两块 UI 遮挡区：
  // 拉远 + 抬高机位，保证近端「我的房间」整体可见、远端房间名牌不被裁切。
  return { radius: 5.0 * wide, height: 14.4 * wide, look: { x: 0, z: 1.7 }, fov: 51 };
}

/**
 * 手动轨道参数 → 相机位置。极角限制避免钻入桌面或顶视死板。
 * azimuth 为相对默认机位方位的偏移（弧度）。
 */
export function orbitPose(base: CamPose, azimuth: number, polar: number, zoom: number): { x: number; y: number; z: number } {
  const r = base.radius * zoom;
  const h = base.height * zoom;
  // 极角：0.12（近地） ~ 1.1（近顶视）
  const p = Math.min(1.1, Math.max(0.12, polar));
  const dist = Math.sqrt(r * r + h * h);
  const y = Math.sin(p) * dist * 0.86 + 0.8;
  const flat = Math.cos(p) * dist;
  const az = Math.atan2(r, h) + azimuth;
  return {
    x: Math.sin(az) * flat,
    y,
    z: Math.cos(az) * flat + base.look.z,
  };
}

/** 世界坐标 → 屏幕像素（CSS2D 覆盖层定位用；由调用方提供投影结果） */
export function projectToScreen(
  x: number, y: number, z: number,
  view: { width: number; height: number },
  project: (v: { x: number; y: number; z: number }) => { x: number; y: number; z: number },
): { x: number; y: number; visible: boolean } {
  const p = project({ x, y, z });
  const visible = p.z < 1;
  return {
    x: (p.x * 0.5 + 0.5) * view.width,
    y: (-p.y * 0.5 + 0.5) * view.height,
    visible,
  };
}
