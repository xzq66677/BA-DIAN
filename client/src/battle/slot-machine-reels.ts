export type SlotReels = [number, number, number];
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

export function normalizeSlotReels(value: unknown): SlotReels | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  if (!value.every((digit) => typeof digit === 'number' && Number.isInteger(digit) && digit >= 0 && digit <= 9)) return null;
  return [value[0], value[1], value[2]];
}

export function previewSlotReels(key: number): SlotReels {
  let state = (Math.trunc(key) ^ 0x51a7d00d) >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % 10;
  };
  return [next(), next(), next()];
}

export function slotReelsFor(view: { key: number; reels?: SlotReels }): { digits: SlotReels; source: 'event' | 'preview' } {
  const digits = normalizeSlotReels(view.reels);
  return digits ? { digits, source: 'event' } : { digits: previewSlotReels(view.key), source: 'preview' };
}
