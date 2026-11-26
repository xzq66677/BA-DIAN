export type SlotReelCount = 3 | 4;
export type SlotReels =
  | [number, number, number]
  | [number, number, number, number];
export type SlotSymbolKind = 'money' | 'bomb' | 'attack' | 'key';

export interface SlotSymbolDefinition {
  kind: SlotSymbolKind;
  label: string;
  digits: string;
}

export const SLOT_SYMBOLS: readonly SlotSymbolDefinition[] = [
  { kind: 'key', label: '钥匙', digits: '0' },
  { kind: 'money', label: '金钱', digits: '1–3' },
  { kind: 'bomb', label: '炸弹', digits: '4–7' },
  { kind: 'attack', label: '攻击', digits: '8–9' },
];

export function slotSymbolForDigit(digit: number): SlotSymbolDefinition {
  if (digit === 0) return SLOT_SYMBOLS[0];
  if (digit <= 3) return SLOT_SYMBOLS[1];
  if (digit <= 7) return SLOT_SYMBOLS[2];
  return SLOT_SYMBOLS[3];
}

export function normalizeSlotReelCount(value: unknown): SlotReelCount | null {
  return value === 3 || value === 4 ? value : null;
}

export function normalizeSlotReels(value: unknown): SlotReels | null {
  if (!Array.isArray(value) || normalizeSlotReelCount(value.length) === null) return null;
  if (!value.every((digit) => typeof digit === 'number' && Number.isInteger(digit) && digit >= 0 && digit <= 9)) return null;
  return value.length === 3 ? [value[0], value[1], value[2]] : [value[0], value[1], value[2], value[3]];
}

export function previewSlotReels(key: number, count: SlotReelCount = 3): SlotReels {
  let state = (Math.trunc(key) ^ 0x51a7d00d) >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % 10;
  };
  const digits = [next(), next(), next()];
  return count === 4 ? [...digits, next()] as SlotReels : digits as SlotReels;
}

export function slotReelsFor(view: { key: number; reels?: unknown; reelCount?: unknown }): { digits: SlotReels; source: 'event' | 'preview' } {
  const digits = normalizeSlotReels(view.reels);
  if (digits) return { digits, source: 'event' };
  return { digits: previewSlotReels(view.key, normalizeSlotReelCount(view.reelCount) ?? 3), source: 'preview' };
}
