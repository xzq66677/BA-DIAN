import { useEffect, useState } from 'react';
import { net, type GameSnapshot, type LobbyState, type RevealInfo, type SnapPlayer } from '../net.js';
import type { Throw } from '../../../shared/src/types.js';

export const THROW_LABEL: Record<string, string> = { rock: '石头', scissors: '剪刀', paper: '布' };
export const THROW_ICON: Record<string, string> = { rock: '✊', scissors: '✌️', paper: '✋' };

export interface ThrowView {
  t: string;
  result: 'win' | 'lose' | 'tie';
}

/** 该玩家在「最近一次已揭示子轮」中的出拳与胜负结果；提交阶段返回 null（不泄露） */
export function throwViewOf(game: GameSnapshot, pid: string): ThrowView | null {
  const rv: RevealInfo | null | undefined = game.reveal;
  if (!rv || !rv.throws[pid]) return null;
  const result: ThrowView['result'] = rv.winners.includes(pid) ? 'win' : rv.losers.includes(pid) ? 'lose' : 'tie';
  return { t: rv.throws[pid], result };
}

/** 该玩家在当前出拳阶段是否已提交（rps1 全员出拳 / rps2 当前排序子轮） */
export function hasThrown(game: GameSnapshot, pid: string): boolean {
  if (game.phase === 'rps2') {
    return (game.orderGroup ?? []).includes(pid) && (game.orderSubmittedIds ?? []).includes(pid);
  }
  if (game.phase === 'judge') {
    return (game.judge?.submittedIds ?? []).includes(pid);
  }
  return game.phase === 'rps1' && game.submittedIds.includes(pid);
}

export function namesOf(game: GameSnapshot, ids: string[]): string {
  return ids.map((id) => game.players.find((p) => p.id === id)?.name || '?').join('、');
}

function verdictText(game: GameSnapshot, rv: RevealInfo): string {
  // 二次判定（行动排序）：只决定先后，不剥夺资格；领域不参与
  if (rv.stage === 'rps2') {
    switch (rv.outcome) {
      case 'cycle': return '三人循环 → 同组重新出拳（排序内部重判，不消耗回合）';
      case 'alltie': return '同拳平局 → 同组重新出拳（排序内部重判，不消耗回合）';
      case 'tieWin': return `${namesOf(game, rv.winners)} 领域判胜 → 其余优先行动`;
      default: {
        const w = namesOf(game, rv.winners);
        const l = namesOf(game, rv.losers);
        return l ? `${w} 胜出 → ${l} 优先行动` : `${w} 胜出`;
      }
    }
  }
  switch (rv.outcome) {
    case 'cycle': return '三人循环 → 平局回合，下回合全员重新出拳';
    case 'alltie': return '全员同拳平局 → 平局回合，下回合重新出拳';
    case 'tieWin': return `领域生效：${namesOf(game, rv.winners)} 平局判胜`;
    default: {
      const w = namesOf(game, rv.winners);
      const l = rv.losers.length > 0 ? `${namesOf(game, rv.losers)} 无资格` : '';
      return `${w} 获得行动资格${l ? `；${l}` : ''}`;
    }
  }
}

// ── 出拳揭示台（中央牌桌，全员可见） ─────────────────────

export function RevealBoard({ game }: { game: GameSnapshot }) {
  const rv: RevealInfo | null = game.reveal ?? null;
  const alive = game.players.filter((p) => p.alive);
  const isOrder = game.phase === 'rps2';
  /** rps2：只有当前排序子轮的参与组出拳；rps1：全员出拳 */
  const orderGroupAlive = (game.orderGroup ?? []).map((id) => game.players.find((p) => p.id === id)).filter((p): p is SnapPlayer => !!p && p.alive);
  const waitingPool = isOrder ? orderGroupAlive : alive;
  const submittedSet = isOrder ? (game.orderSubmittedIds ?? []) : game.submittedIds;
  const waiting = game.phase === 'rps1' || isOrder;
  const submittedCount = waitingPool.filter((p) => submittedSet.includes(p.id)).length;
  // 行动阶段：判定已完成，揭示台收缩为紧凑状态条（把空间还给战场），保留判定结果与出牌顺序
  const compact = game.phase === 'act' && !waiting;

  // 按玩家座次稳定排序（只显示真正出了拳的人，含判定后已淘汰者）
  const threw: { p: SnapPlayer; t: string; result: ThrowView['result'] }[] = [];
  if (rv) {
    for (const p of game.players) {
      const v = throwViewOf(game, p.id);
      if (v) threw.push({ p, t: v.t, result: v.result });
    }
  }

  // ── 紧凑模式：单行状态条（判定结果 + 出牌顺序） ──
  if (compact) {
    const ord: RevealInfo | null = game.orderReveal ?? null;
    return (
      <div className={`reveal-board compact ${rv ? 'has-reveal' : ''}`}>
        <div className="rb-compact-row">
          <span className="rb-title">🎴 判定</span>
          {rv && <span className="rb-compact-verdict">{verdictText(game, rv)}</span>}
          {game.queue.length > 0 && (
            <span className="rb-order inline">
              {game.queue.map((pid, i) => {
                const p = game.players.find((x) => x.id === pid);
                if (!p) return null;
                const cls = i < game.actIndex ? 'done' : i === game.actIndex ? 'now' : '';
                return <span key={pid} className={`rb-order-chip ${cls}`}>{p.name}</span>;
              })}
            </span>
          )}
        </div>
        {ord && (
          <div className="rb-compact-row rb-compact-order">
            <span className="rb-title">🔀 排序</span>
            <span className="rb-compact-verdict">{verdictText(game, ord)}</span>
            <span className="rb-order inline">
              {Object.entries(ord.throws).map(([pid, t]) => {
                const p = game.players.find((x) => x.id === pid);
                const win = ord.winners.includes(pid);
                return (
                  <span key={pid} className={`rb-order-chip ${win ? 'done' : 'now'}`} title={`${p?.name ?? pid} 出了${THROW_LABEL[t] ?? t}`}>
                    {p?.name ?? pid} {THROW_ICON[t] ?? ''}
                  </span>
                );
              })}
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`reveal-board ${rv ? 'has-reveal' : ''}`}>
      <div className="rb-head">
        <span className="rb-title">🎴 出拳揭示</span>
        {waiting ? (
          <span className="rb-stat">
            {isOrder
              ? `行动排序 · 子轮 ${(game.orderSub ?? 0) + 1} · 已出拳 ${submittedCount}/${waitingPool.length}（提交期间保密）`
              : `已出拳 ${submittedCount}/${waitingPool.length}（提交期间保密）`}
          </span>
        ) : rv ? (
          <span className="rb-stat">{rv.stage === 'rps1' ? '初次判定' : `排序判定 · 子轮 ${rv.sub}`}</span>
        ) : (
          <span className="rb-stat">等待判定</span>
        )}
      </div>

      {waiting && (
        <div className="rb-waiting">
          {waitingPool.map((p) => {
            const ok = submittedSet.includes(p.id);
            return (
              <span key={p.id} className={`rb-wait ${ok ? 'done' : ''}`}>
                {ok ? '🎴 已出拳' : '⏳ 待出拳'} · {p.name}
              </span>
            );
          })}
        </div>
      )}

      {rv ? (
        <>
          <div className={`rb-cards ${waiting ? 'rb-cards-prev' : ''}`}>
            {threw.map(({ p, t, result }) => (
              <div key={p.id} className={`rb-card rc-${result}`} title={`${p.name} 出了${THROW_LABEL[t]}`}>
                <span className="rb-icon">{THROW_ICON[t]}</span>
                <span className="rb-name">{p.name}</span>
                <span className="rb-tag">{result === 'win' ? '胜' : result === 'lose' ? '负' : '平'}</span>
              </div>
            ))}
          </div>
          <div className="rb-verdict">
            <span className="rb-verdict-label">{waiting ? '上一轮判定' : '判定结果'}</span>
            {verdictText(game, rv)}
          </div>
        </>
      ) : (
        <div className="rb-hint">
          所有存活玩家提交出拳后统一揭示：每个人都能看到彼此出了什么，提交期间谁也无法偷看（不破坏公平性）。
        </div>
      )}

      {/* 平局（同拳/三人循环）现为独立回合：judgeRecords 每回合至多一条 rps1 记录，
          原「本轮判定记录」多子轮历史条已无存在场景，随平局重判机制一并移除 */}
    </div>
  );
}

// ── 隐藏出拳（交设备遮罩，卡背式选择） ────────────────────

export function ThrowPrivacy({ myIds, game, lobby, stage = 'rps1', judgeLabel, judgeRound, judgeRounds }: {
  myIds: { playerId: string; name: string; token: string }[];
  game: GameSnapshot;
  lobby: LobbyState;
  /** rps1=回合判定；rps2=行动排序（二次判定）；judge=技能内判定（太极/五连鞭/不讲武德） */
  stage?: 'rps1' | 'rps2' | 'judge';
  judgeLabel?: string;
  judgeRound?: number;
  judgeRounds?: number;
}) {
  // 用 playerId 而不是数组下标追踪当前出拳身份：每次提交后该身份会从 myIds 中移除，
  // 数组会收缩。若用下标（旧实现），一旦「选中的下标 >= 新长度」，渲染里读 me.name 就会
  // 抛 TypeError —— React 会卸载整棵树，表现为「所有面板突然全部消失」。
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const isOrder = stage === 'rps2';
  const isSkill = stage === 'judge';
  const veilTitle = isSkill
    ? `⚡ ${judgeLabel ?? '技能判定'}（第 ${judgeRound ?? 1}/${judgeRounds ?? 1} 局）— 以下身份还未出拳`
    : isOrder
      ? '🔀 行动排序出拳（二次判定）— 以下身份还未出拳'
      : '🎲 隐藏出拳阶段 — 以下身份还未出拳';
  const me = activeId ? myIds.find((i) => i.playerId === activeId) ?? null : null;

  // 选中的身份已不在待出拳名单里（自己已提交 / 阶段推进）→ 回到选择遮罩
  useEffect(() => {
    if (activeId && !myIds.some((i) => i.playerId === activeId)) {
      setActiveId(null);
      setError('');
    }
  }, [activeId, myIds]);

  if (!me) {
    return (
      <div className="privacy-veil">
        <p>{veilTitle}</p>
        <div className="pv-names" style={{ margin: '8px 0', display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {myIds.map((i) => <span key={i.playerId} className="pv-name" style={{ fontSize: 14 }}>{i.name}</span>)}
        </div>
        <p className="pv-hint tcg-chip" style={{ display: 'inline-block' }}>为防止偷看，请依次传递设备，由本人亲自出拳</p>
        <div className="pv-actions" style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {myIds.map((i) => (
            <button key={i.playerId} className="tcg-btn" onClick={() => setActiveId(i.playerId)}>
              我是 {i.name}，开始出拳
            </button>
          ))}
        </div>
      </div>
    );
  }

  const p = game.players.find((x) => x.id === me.playerId);
  // 闭包里用局部常量：避免 await 期间外部状态变化导致取到已失效的身份
  const { playerId: mePlayerId, token: meToken, name: meName } = me;

  async function throwIt(t: Throw) {
    setError('');
    try {
      const r = await net.submitThrow(lobby.code, mePlayerId, meToken, t) as { ok: boolean; error?: string };
      if (!r.ok) { setError(r.error || '提交失败'); return; }
      setActiveId(null); // 返回遮罩，不回显拳种
    } catch (e) {
      setError('提交失败：' + String((e as Error)?.message ?? e));
    }
  }

  return (
    <div className="privacy-veil hand-throw-veil">
      <p>请 <span className="pv-name">{meName}</span> 出拳（{p?.charName} · 房间 {p?.room}）</p>
      {isOrder && <p className="pv-hint tcg-chip" style={{ display: 'inline-block' }}>本次出拳只决定行动先后，不会失去行动资格</p>}
      {isSkill && <p className="pv-hint tcg-chip" style={{ display: 'inline-block' }}>双方各自出拳、逐局揭牌；判定结果会写进战斗日志</p>}
      <div className="throw-row">
        {(['rock', 'scissors', 'paper'] as const).map((t) => (
          <button key={t} className="throw-card" onClick={() => throwIt(t)}>
            {THROW_ICON[t]}
            <small>{THROW_LABEL[t]}</small>
          </button>
        ))}
      </div>
      {error && <div className="error-text">{error}</div>}
      <button className="tcg-btn ghost" onClick={() => setActiveId(null)}>返回（暂不出拳）</button>
    </div>
  );
}
