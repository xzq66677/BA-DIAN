/**
 * 拔典 · 种子随机数模块
 * 所有随机性必须经过本模块，保证测试可复现（固定种子 → 相同序列）。
 */

export class RNG {
  private s: number;
  private draws = 0;

  get drawCount(): number { return this.draws; }

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** mulberry32 — [0,1) */
  /** Advance past draws consumed outside the engine, such as AI decision making. */
  advance(count: number): void {
    this.s = (this.s + Math.imul(count, 0x6d2b79f5)) >>> 0;
    this.draws += count;
  }

  next(): number {
    this.draws++;
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [0, n) 整数 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** 从数组中随机取一个 */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  /** 洗牌（Fisher-Yates，返回新数组） */
  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}

export const THROW_LIST = ['rock', 'scissors', 'paper'] as const;

export function randomThrow(rng: RNG): 'rock' | 'scissors' | 'paper' {
  return THROW_LIST[rng.int(3)];
}

/** 判定记录：随机数生成过程留痕（测试复现要求） */
export interface RngTrace {
  calls: number;
  log: string[];
}

export function makeTrace(): RngTrace {
  return { calls: 0, log: [] };
}

export function tracedThrow(rng: RNG, trace: RngTrace, who: string): 'rock' | 'scissors' | 'paper' {
  const t = randomThrow(rng);
  trace.calls++;
  trace.log.push(`#${trace.calls} ${who} → ${t}`);
  return t;
}
