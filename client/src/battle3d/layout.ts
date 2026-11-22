/** 3D arena coordinates in world units. This module has no renderer dependency. */
export interface Vec2 { x: number; z: number }

export const TABLE = {
  roomRadius: 2.7,
  coreRadius: 2.65,
  roomHeight: 1.12,
} as const;

export interface RoomAnchor {
  id: string;
  center: Vec2;
  yaw: number;
  radius: number;
  floor: number;
  entrance: Vec2;
  label: Vec2;
  focus: Vec2;
  spawns: readonly Vec2[];
}

export interface MapDefinition {
  id: string;
  radius: number;
  rooms: ReadonlyMap<string, RoomAnchor>;
}

const SPACING = 6.7;
const TAU = Math.PI * 2;
const ringRadius = (size: number) => size < 3 ? 6.35 : Math.max(6.35, SPACING / (2 * Math.sin(Math.PI / size)));

export function createRuinsMap(roomIds: readonly string[]): MapDefinition {
  const ids = [...new Set(roomIds)].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }) || a.localeCompare(b, 'en'));
  const inner = ids.length > 10 ? Math.min(8, Math.floor(ids.length * 0.4)) : ids.length;
  const outer = ids.length - inner;
  const innerRadius = ringRadius(inner);
  const outerRadius = outer ? Math.max(innerRadius + SPACING, ringRadius(outer)) : 0;
  const spawns = Array.from({ length: Math.max(1, ids.length) }, (_, index) => roomSlot(index, ids.length));
  const rooms = new Map<string, RoomAnchor>();
  ids.forEach((id, index) => {
    const outside = index >= inner;
    const radius = outside ? outerRadius : innerRadius;
    const angle = outside ? ((index - inner + 0.5) / outer) * TAU : (index / inner) * TAU;
    const center = { x: Math.sin(angle) * radius * 1.08, z: Math.cos(angle) * radius };
    const distance = Math.hypot(center.x, center.z);
    const offset = (n: number): Vec2 => ({ x: center.x * (1 - n / distance), z: center.z * (1 - n / distance) });
    rooms.set(id, {
      id, center, yaw: Math.atan2(-center.x, -center.z),
      floor: TABLE.roomHeight + 0.1, radius: TABLE.roomRadius,
      entrance: offset(TABLE.roomRadius - 0.08),
      label: offset(TABLE.roomRadius - 0.34),
      focus: center, spawns,
    });
  });
  return { id: 'floating-ruins', radius: (outerRadius || innerRadius) * 1.08 + TABLE.roomRadius, rooms };
}

/** Center first, then keep occupied slots fixed as neighbors arrive or leave. */
export function roomSlot(index: number, capacity: number): Vec2 {
  if (index <= 0) return { x: 0, z: 0 };
  const inner = 6;
  const outer = Math.max(1, capacity - inner - 1);
  const angle = index <= inner ? ((index - 1) / inner) * TAU : ((index - inner - 0.5) / outer) * TAU;
  const radius = index <= inner ? 1.18 : 2.03;
  return { x: Math.sin(angle) * radius, z: Math.cos(angle) * radius };
}

export function stableMembers<T extends { id: string }>(members: T[]): T[] {
  return members.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface CamPose { radius: number; height: number; look: Vec2; fov: number }

/** Fit the map inside the area between the reveal panel and action dock. */
export function defaultPose(aspect: number, roomCount: number): CamPose {
  const inner = roomCount > 10 ? Math.min(8, Math.floor(roomCount * 0.4)) : roomCount;
  const extent = roomCount > 10
    ? Math.max(ringRadius(inner) + SPACING, ringRadius(roomCount - inner))
    : ringRadius(inner);
  const scale = (extent + TABLE.roomRadius) / 9.05;
  const widthFit = Math.max(1, 0.82 / Math.max(aspect, 0.3));
  const distance = scale * widthFit;
  if (aspect < 0.93) return { radius: 10.8 * distance, height: 21.5 * distance, look: { x: 0, z: 2.3 }, fov: 64 };
  if (aspect > 2.1) return { radius: 11.7 * scale, height: 23 * scale, look: { x: 0, z: 2.1 }, fov: 53 };
  return { radius: 14.2 * scale, height: 19.9 * scale, look: { x: 0, z: 2.05 }, fov: 53 };
}

export function orbitPose(base: CamPose, azimuth: number, elevation: number, zoom: number) {
  const angle = Math.min(1.46, Math.max(0.48, elevation));
  const distance = Math.hypot(base.radius, base.height) * zoom;
  return {
    x: base.look.x + Math.sin(azimuth) * Math.cos(angle) * distance,
    y: 1.1 + Math.sin(angle) * distance,
    z: base.look.z + Math.cos(azimuth) * Math.cos(angle) * distance,
  };
}
