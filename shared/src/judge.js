/**
 * 拔典 · 石头剪刀布判定算法
 *
 * 初次判定（行动资格）：
 *  - 按出拳分组。恰好两组：胜组获得行动资格，败组无资格。
 *  - 全员同拳（平局）或三拳齐全（三人循环）：全员重新判定，不得随机决定胜者。
 *  - 领域平局算胜（如五条悟领域）：仅在"全员同拳"子轮且恰有一名领域持有者生效；
 *    多名领域持有者则领域对冲，平局保持平局。
 *
 * 二次判定（行动排序）：
 *  - 仅初次判定胜者参与。
 *  - 输者优先行动，赢者排在输者之后；同输者/同赢者递归判定；
 *    三人循环/同拳重新判定；直至确定完整顺序。
 *  - 不会剥夺行动资格。
 *
 * 判定历史：每个玩家在每个判定子轮获得一条 win/tie/lose 记录（跨回合累积），
 * 供大屁孩等角色使用。二次判定默认由服务端种子代掷（可配置）。
 */
import { randomThrow } from './rng.js';
const BEATS = {
    rock: 'scissors',
    scissors: 'paper',
    paper: 'rock',
};
export function beats(a, b) {
    return BEATS[a] === b;
}
/**
 * 解析一个判定子轮（单轮出拳）。
 * entrants 顺序即平局时的记录顺序（与提交顺序无关，按玩家列表稳定排序）。
 */
export function resolveSubRound(throws, entrants, tieWin) {
    const groups = new Map();
    for (const pid of entrants) {
        const t = throws[pid];
        if (!t)
            continue;
        if (!groups.has(t))
            groups.set(t, []);
        groups.get(t).push(pid);
    }
    const distinct = [...groups.keys()];
    if (distinct.length === 3) {
        // 三人循环：全员重新判定，不得随机决定胜者
        return { status: 'cycle', winners: [], losers: [] };
    }
    if (distinct.length === 1) {
        // 全员同拳：平局。领域持有者恰好一人时平局算胜。
        const solo = entrants.length === 1;
        if (!solo && tieWin) {
            const tw = tieWin(entrants);
            if (tw) {
                const others = entrants.filter((p) => p !== tw);
                return { status: 'tieWin', winners: [tw], losers: others };
            }
        }
        return { status: 'alltie', winners: [], losers: [] };
    }
    // 恰好两组：必有明确胜负
    const [a, b] = distinct;
    const ga = groups.get(a);
    const gb = groups.get(b);
    if (beats(a, b)) {
        return { status: 'resolved', winners: ga, losers: gb };
    }
    return { status: 'resolved', winners: gb, losers: ga };
}
/** 为一轮判定记录历史步（全员同记录） */
function recordRound(sink, outcome, entrants, stage, sub) {
    for (const pid of entrants) {
        if (outcome.winners.includes(pid))
            sink.append(pid, 'win', stage, sub);
        else if (outcome.losers.includes(pid))
            sink.append(pid, 'lose', stage, sub);
        else
            sink.append(pid, 'tie', stage, sub);
    }
}
/**
 * 初次判定完整流程（由引擎驱动，逐子轮提交）。
 * 引擎职责：
 *  1. 收集本子轮出拳（隐藏提交）。
 *  2. 调 resolveSubRound。
 *  3. cycle/alltie → 记录 tie，清空出拳，进入下一子轮。
 *  4. resolved/tieWin → 记录 win/lose，胜者获得行动资格。
 */
export function appendHistoryForRound(sink, outcome, entrants, stage, sub) {
    recordRound(sink, outcome, entrants, stage, sub);
}
/**
 * 二次判定：确定行动顺序（递归分组排序）。
 * roll：为指定玩家集合代掷一轮出拳（服务端种子随机）。
 * 返回最终行动顺序（输者先、赢者后，子组递归）与判定记录。
 */
export function resolveActionOrder(winners, roll, tieWin, sink, stage = 'rps2') {
    const rounds = [];
    let sub = 0;
    const MAX_SUBROUNDS = 10000;
    function orderGroup(group) {
        if (group.length <= 1)
            return group;
        for (let guard = 0; guard < MAX_SUBROUNDS; guard++) {
            sub++;
            const throws = roll(group);
            const outcome = resolveSubRound(throws, group, tieWin);
            rounds.push({ stage, sub, throws: { ...throws }, outcome: outcome.status, winners: outcome.winners, losers: outcome.losers });
            if (sink)
                appendHistoryForRound(sink, outcome, group, stage, sub);
            if (outcome.status === 'cycle' || outcome.status === 'alltie')
                continue; // 重新判定
            const losersLeft = orderGroup(outcome.losers); // 输者优先行动
            const winnersRight = orderGroup(outcome.winners); // 赢者靠后
            return [...losersLeft, ...winnersRight];
        }
        throw new Error('二次判定子轮数超出安全上限');
    }
    return { order: orderGroup(winners), rounds };
}
/** 便捷：为一批玩家按种子代掷出拳 */
export function rollThrows(pids, rng) {
    const out = {};
    for (const pid of pids)
        out[pid] = randomThrow(rng);
    return out;
}
//# sourceMappingURL=judge.js.map