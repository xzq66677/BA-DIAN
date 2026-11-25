import { FloatingRuins } from './floating-ruins.js';
import type { GameSnapshot } from './protocol.js';
import type { ActionRequest, ActionResult, PlayerState, RoomId } from './types.js';

export interface MapLayout {
  rooms: RoomId[];
  spawn: RoomId[];
}

interface MapAction {
  label: string;
  execute(actor: PlayerState, request: ActionRequest): ActionResult & { note?: string };
}

export interface BattleMap {
  layout: MapLayout;
  movementError?(from: RoomId, to: RoomId): string | undefined;
  advance?(round: number): string[];
  snapshot?(): Pick<GameSnapshot, 'ruins'>;
  actions?: ReadonlyMap<string, MapAction>;
}

function numberedRooms(playerCount: number): MapLayout {
  const spawn = Array.from({ length: playerCount }, (_, i) => `R${i + 1}`);
  return { rooms: [...spawn], spawn };
}

export const MAPS = {
  classic(_seed: number, playerCount: number): BattleMap {
    return { layout: numberedRooms(playerCount) };
  },
  floatingRuins(seed: number, playerCount: number): BattleMap {
    const layout = numberedRooms(playerCount);
    const ruins = new FloatingRuins(seed);
    return {
      layout,
      advance: (round) => ruins.advance(round, layout.rooms),
      snapshot: () => ({ ruins: ruins.snapshot() }),
      movementError: (from, to) => ruins.blocksEntry(from, to) ? `${to} 泥潭封路，下回合恢复通行` : undefined,
      actions: new Map([['openSluice', {
        label: '开启泄水闸',
        execute({ name, room }) {
          if (!ruins.openSluice(room)) return { ok: false, error: '只有积水预警房间的玩家可开启泄水闸' };
          return { ok: true, note: `${name} 开启 ${room} 的泄水闸，积水排入云海，泥潭预警解除。` };
        },
      }]]),
    };
  },
};

export type MapId = keyof typeof MAPS;
