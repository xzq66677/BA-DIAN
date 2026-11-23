import { RNG } from './rng.js';
import type { RoomId } from './types.js';

export type RuinsWeather = 'clear' | 'wind' | 'rain' | 'mist';

export interface RuinsConditions {
  weather: RuinsWeather;
  changesOnRound: number;
  mud: { room: RoomId; activeRound: number; active: boolean } | null;
}

export const RUINS_WEATHER_NAME: Record<RuinsWeather, string> = {
  clear: '云海初霁',
  wind: '穿岛阵风',
  rain: '斜风骤雨',
  mist: '雨后薄雾',
};

export function mudBlocksEntry(conditions: RuinsConditions | undefined, from: RoomId, to: RoomId): boolean {
  const mud = conditions?.mud;
  return from !== to && !!mud?.active && mud.room === to;
}

export function canOpenSluice(conditions: RuinsConditions | undefined, room: RoomId): boolean {
  const mud = conditions?.mud;
  return !!mud && !mud.active && mud.room === room;
}

/** Weather is advanced once per round on the server and uses a separate random stream. */
export class FloatingRuins {
  private readonly rng: RNG;
  private conditions: RuinsConditions;

  constructor(seed: number) {
    this.rng = new RNG(seed ^ 0x9d41b327);
    this.conditions = { weather: 'clear', changesOnRound: 2 + this.rng.int(2), mud: null };
  }

  snapshot(): RuinsConditions {
    const { mud, ...weather } = this.conditions;
    return { ...weather, mud: mud && { ...mud } };
  }

  blocksEntry(from: RoomId, to: RoomId): boolean {
    return mudBlocksEntry(this.conditions, from, to);
  }

  openSluice(room: RoomId): boolean {
    if (!canOpenSluice(this.conditions, room)) return false;
    this.conditions = { ...this.conditions, mud: null };
    return true;
  }

  advance(round: number, rooms: readonly RoomId[]): string[] {
    const notes: string[] = [];
    let { weather, changesOnRound, mud } = this.conditions;
    if (mud && round > mud.activeRound) {
      notes.push(`${mud.room} 的泥潭退去，入口恢复通行。`);
      mud = null;
    } else if (mud && !mud.active && round === mud.activeRound) {
      mud = { ...mud, active: true };
      notes.push(`${mud.room} 泥潭封路，本回合无法从其他房间移入。`);
    }

    if (round === changesOnRound) {
      if (weather === 'clear') {
        weather = 'wind';
        changesOnRound = round + 1 + this.rng.int(2);
        notes.push('穿岛阵风袭来，浮岛的云和微尘随风漂移。');
      } else if (weather === 'wind') {
        weather = 'rain';
        changesOnRound = round + 2 + this.rng.int(2);
        notes.push('斜风骤雨笼罩悬浮遗迹。');
        if (rooms.length > 1 && this.rng.next() < 0.75) {
          mud = { room: this.rng.pick(rooms), activeRound: round + 1, active: false };
          notes.push(`${mud.room} 积水，预计下一回合形成泥潭并封闭入口。`);
        }
      } else if (weather === 'rain') {
        weather = 'mist';
        changesOnRound = round + 1;
        notes.push('阵雨停歇，雨后薄雾沿岛缘散开。');
      } else {
        weather = 'clear';
        changesOnRound = round + 2 + this.rng.int(3);
        notes.push('风雨过去，云海放晴。');
      }
    }

    this.conditions = { weather, changesOnRound, mud };
    return notes;
  }
}
