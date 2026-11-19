/**
 * 拔典 · 核心类型定义
 * 规则引擎完全独立于前端与网络层。
 */
export const DEFAULT_RULES = {
    allowHide: true,
    allowSeek: true,
    allowSkip: true,
    secondJudgeMode: 'serverRoll',
    ivanExplodeTiming: 'sameRoundEnd',
    defaultMaxHp: 3,
    defaultAttack: 1,
    berserkDamage: 1,
    skillJudgeMode: 'serverRoll',
};
export function fmtNum(n) {
    if (Number.isInteger(n))
        return String(n);
    return String(Math.round(n * 100) / 100);
}
//# sourceMappingURL=types.js.map