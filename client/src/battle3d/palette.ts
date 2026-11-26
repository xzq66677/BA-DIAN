export const GOLD = 0xd8b04a;

/**
 * 拔典 3D 战场 · 视觉元数据（纯数据 + 纯辅助函数，可在 jsdom 单测）
 *
 * 全部为原创程序化视觉（几何拼装 + 颜色语义），不使用任何受版权保护素材。
 * 角色识别：专属色 + 专属道具（棋子风格棋盘件），房间识别：图腾微缩景观。
 */

export interface RGB { r: number; g: number; b: number }

/** 0xRRGGBB → {r,g,b} 归一化 */
export function hex(c: number): RGB {
  return { r: ((c >> 16) & 255) / 255, g: ((c >> 8) & 255) / 255, b: (c & 255) / 255 };
}

export type CharPropKind =
  | 'none' | 'stick' | 'flute' | 'scissors' | 'bomb' | 'dice'
  | 'taiji' | 'hat' | 'magnet' | 'small' | 'band' | 'bow' | 'ghost' | 'lance' | 'tentacle';

export interface CharVisual {
  /** 棋子主体色 */
  color: number;
  /** 辅助色（头部/装饰） */
  accent: number;
  /** 专属道具（程序化拼装，可随角色运行状态变化，如拔棍的棍） */
  prop: CharPropKind;
  /** 相对身高（大屁孩 0.72，其余 1） */
  scale: number;
}

/**
 * 角色视觉注册表：覆盖 shared/src/characters 全部 11 名角色。
 * 颜色语义保持角色卡面主色调的一致性（卡面为用户提供素材，这里做低饱和呼应）。
 */
export const CHAR_VISUALS: Record<string, CharVisual> = {
  default: { color: 0x5a6b7d, accent: 0x8fa3b8, prop: 'none', scale: 1 },        // 无业游民：灰蓝
  bagun: { color: 0x7d5a3c, accent: 0xc9a06a, prop: 'stick', scale: 1 },         // 拔棍：棕木+棍
  chuixiao: { color: 0x3f7d6b, accent: 0x9fd8c2, prop: 'flute', scale: 1 },      // 吹箫哥：青竹
  gojo: { color: 0x2f3d8f, accent: 0xe8ecff, prop: 'band', scale: 1 },           // 五条悟：深蓝白发带
  laodaye: { color: 0x6b5540, accent: 0xd8cbb0, prop: 'hat', scale: 1 },         // 老大爷：褐+斗笠
  mabaoguo: { color: 0x8f2f2a, accent: 0xefe6d8, prop: 'taiji', scale: 1 },      // 马保国：朱红+太极盘
  wuliuqi: { color: 0x4a4a58, accent: 0xc0c8d8, prop: 'scissors', scale: 1 },    // 伍六七：暗银剪刀
  'ivan-girl': { color: 0xa86428, accent: 0xf0b56a, prop: 'bomb', scale: 0.92 }, // 卖大伊万的小女孩：橙
  'hero-today': { color: 0x2f8f4f, accent: 0xbdf0cf, prop: 'dice', scale: 0.96 },// 今日勇者：绿+骰子
  dajianke: { color: 0x7a3f7d, accent: 0xe0b8e8, prop: 'magnet', scale: 1 },     // 大贱客：紫+磁环
  dapihuai: { color: 0xb5483f, accent: 0xffd2a8, prop: 'small', scale: 0.74 },   // 大屁孩：矮个
  'hunchback-archer': { color: 0x6f7a5a, accent: 0xe8e2cf, prop: 'bow', scale: 0.96 }, // 佝偻弓箭手：骨灰绿+弓
  ghost: { color: 0x3b4d5e, accent: 0xbfe8ff, prop: 'ghost', scale: 1.02 }, // 鬼影：雾青+幽光
  'wild-hunt': { color: 0x7a2f2f, accent: 0xd8b04a, prop: 'lance', scale: 1.02 }, // 狂猎：暗红+金枪
  'water-snake': { color: 0x2f6f7a, accent: 0x9fd8e8, prop: 'tentacle', scale: 1.04 }, // 飞天水螅：水青+触手
};

export function charVisual(charId: string): CharVisual {
  return CHAR_VISUALS[charId] ?? CHAR_VISUALS.default;
}

// ── 房间图腾 ────────────────────────────────────────────────

export type TotemKind = 'mountain' | 'forest' | 'village' | 'castle' | 'volcano' | 'water';

export interface RoomVisual {
  totem: TotemKind;
  /** 平台主色 */
  base: number;
  /** 图腾点缀色 */
  prop: number;
  /** 房间徽记（覆盖层文本） */
  icon: string;
}

/** 与 2D 版 ROOM_TOTEM（🏔🌲🏘🏰🌋🌊）一一对应的 3D 图腾 */
export const ROOM_VISUALS: Record<string, RoomVisual> = {
  R1: { totem: 'mountain', base: 0x3a4350, prop: 0xcfd8e2, icon: '🏔' },
  R2: { totem: 'forest', base: 0x2e4a34, prop: 0x5fae6f, icon: '🌲' },
  R3: { totem: 'village', base: 0x4a3d2e, prop: 0xd8a86a, icon: '🏘' },
  R4: { totem: 'castle', base: 0x474060, prop: 0x9aa4b8, icon: '🏰' },
  R5: { totem: 'volcano', base: 0x4a2620, prop: 0xe06030, icon: '🌋' },
  R6: { totem: 'water', base: 0x24425a, prop: 0x5ab8d8, icon: '🌊' },
};

/** 第 7+ 间房（理论上玩家>6 时）的兜底图腾：循环取色 */
export function roomVisual(rid: string): RoomVisual {
  const v = ROOM_VISUALS[rid];
  if (v) return v;
  const idx = Math.abs(hashStr(rid)) % 6;
  const kinds = Object.values(ROOM_VISUALS);
  return { ...kinds[idx], icon: '◈' };
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// ── 状态语义色 ──────────────────────────────────────────────

/** 房间/角色状态环颜色（与 2D 视觉语义一致：金=行动、绿=可选目标、红=受击/告警、橙=待爆、紫=领域） */
export const STATE_COLORS = {
  acting: 0xf0d68a,
  targetable: 0x4ade80,
  alertAoe: 0xe23d30,
  alertIvan: 0xff9828,
  domain: 0x9a6ae0,
  winner: 0xf0d68a,
  heal: 0x4ade80,
  hit: 0xe23d30,
  move: 0x7ec8ff,
  beam: 0xff5545,
} as const;
