/**
 * 拔典 · 种子随机数模块
 * 所有随机性必须经过本模块，保证测试可复现（固定种子 → 相同序列）。
 */
export class RNG {
    s;
    constructor(seed) {
        this.s = seed >>> 0;
    }
    /** mulberry32 — [0,1) */
    next() {
        this.s = (this.s + 0x6d2b79f5) >>> 0;
        let t = this.s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    /** [0, n) 整数 */
    int(n) {
        return Math.floor(this.next() * n);
    }
    /** 从数组中随机取一个 */
    pick(arr) {
        return arr[this.int(arr.length)];
    }
    /** 洗牌（Fisher-Yates，返回新数组） */
    shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = this.int(i + 1);
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }
}
export const THROW_LIST = ['rock', 'scissors', 'paper'];
export function randomThrow(rng) {
    return THROW_LIST[rng.int(3)];
}
export function makeTrace() {
    return { calls: 0, log: [] };
}
export function tracedThrow(rng, trace, who) {
    const t = randomThrow(rng);
    trace.calls++;
    trace.log.push(`#${trace.calls} ${who} → ${t}`);
    return t;
}
//# sourceMappingURL=rng.js.map