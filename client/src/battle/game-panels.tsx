/**
 * 对局面板与覆盖层（自 pages/Game.tsx 拆分，Issue #107）：
 * 局内发言 / 战斗日志 / 战绩面板 / 局内小互动飞行特效。
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GameSnapshot, InteractionEvent } from '../net.js';
import { INTERACT_ICON } from './game-cards.js';
import { formatHp as fmtHp } from './status-types.js';

export function ChatDock({ chat, chatText, setChatText, onSend, onClose }: {
  chat: { name: string; text: string; ts: number }[];
  chatText: string;
  setChatText: (v: string) => void;
  onSend: () => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [chat.length]);
  return (
    <div className="chat-dock">
      <div className="chat-dock-head">
        <span>💬 局内发言{chat.length > 0 ? `（${chat.length}）` : ''}</span>
        <button className="tcg-btn ghost tiny" onClick={onClose}>收起 ▼</button>
      </div>
      <div className="chat-dock-log" ref={boxRef}>
        {chat.length === 0 && <div className="muted">还没有发言，打个招呼或嘲讽一下</div>}
        {chat.map((m, i) => (
          <div key={i} className="chat-line"><b>{m.name}</b>：{m.text}</div>
        ))}
      </div>
      <div className="chat-dock-input">
        <input
          value={chatText}
          onChange={(e) => setChatText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onSend(); }}
          placeholder="输入发言，回车发送…"
          maxLength={200}
        />
        <button className="tcg-btn" onClick={onSend}>发送</button>
      </div>
    </div>
  );
}

// ── 日志面板 ─────────────────────────────────────────────

export function LogPanel({ logs, onClose }: {
  logs: { seq: number; text: string; important?: boolean; type?: string; data?: Record<string, unknown> }[];
  onClose: () => void;
}) {
  const [onlyKey, setOnlyKey] = useState(false);
  const ICON: Record<string, string> = {
    phase: '⏱️', judge: '🎲', order: '🔀', action: '🎬', damage: '⚔️',
    heal: '💊', move: '🚶', eliminate: '💀', trigger: '✨', state: '🔧',
    deferred: '💥', error: '❌', result: '🏆', info: 'ℹ️',
  };
  const shown = onlyKey ? logs.filter((l) => l.important) : logs;
  return (
    <>
      <div className="log-header">
        <h3 style={{ color: 'var(--gold-2)', letterSpacing: 3 }}>📜 战斗日志</h3>
        <div className="btn-row">
          <button className={`tcg-btn ${onlyKey ? '' : 'ghost'}`} style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setOnlyKey(true)}>⭐ 重点</button>
          <button className={`tcg-btn ${!onlyKey ? '' : 'ghost'}`} style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setOnlyKey(false)}>全部</button>
          <button className="tcg-btn ghost tiny" aria-label="关闭日志" title="关闭日志" onClick={onClose}>×</button>
        </div>
      </div>
      <div className="log-scroll">
        {shown.slice().reverse().map((l) => (
          <div key={l.seq} className={`log-line ${l.important ? 'imp' : 'dim'}`}>
            <span className="log-icon">{ICON[l.type || ''] || '·'}</span>{l.text}
          </div>
        ))}
      </div>
    </>
  );
}

// ── 局内小互动飞行特效（丢番茄/鸡蛋/献花） ───────────────

interface FxItem { key: number; icon: string; x0: number; y0: number; x1: number; y1: number; }

export function InteractFx({ interactions }: { interactions: InteractionEvent[] }) {
  const [fx, setFx] = useState<FxItem[]>([]);
  const seen = useRef<number | null>(null);

  useEffect(() => {
    const maxId = interactions.length > 0 ? Math.max(...interactions.map((e) => e.id)) : 0;
    // 首次进入对局：只记录游标，不回放历史互动
    if (seen.current === null) { seen.current = maxId; return; }
    const fresh = interactions.filter((e) => e.id > (seen.current as number));
    if (fresh.length === 0) return;
    seen.current = maxId;
    const items: FxItem[] = [];
    for (const e of fresh) {
      const el = document.querySelector(`[data-pid="${e.to}"]`) as HTMLElement | null;
      const rect = el?.getBoundingClientRect();
      const x1 = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const y1 = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
      items.push({
        key: e.id, icon: INTERACT_ICON[e.kind],
        x0: window.innerWidth / 2, y0: window.innerHeight - 36, x1, y1,
      });
      if (el) {
        el.classList.remove('hit-flash');
        void el.offsetWidth;
        el.classList.add('hit-flash');
        setTimeout(() => el.classList.remove('hit-flash'), 850);
      }
    }
    setFx((prev) => [...prev, ...items]);
    const t = setTimeout(() => {
      const keys = new Set(items.map((i) => i.key));
      setFx((prev) => prev.filter((x) => !keys.has(x.key)));
    }, 900);
    return () => clearTimeout(t);
  }, [interactions]);

  if (fx.length === 0) return null;
  return (
    <div className="interact-fx-layer" aria-hidden>
      {fx.map((f) => (
        <span
          key={f.key}
          className="interact-fx"
          style={{
            left: f.x0, top: f.y0,
            ['--dx' as string]: `${f.x1 - f.x0}px`,
            ['--dy' as string]: `${f.y1 - f.y0}px`,
          } as React.CSSProperties}
        >{f.icon}</span>
      ))}
    </div>
  );
}

// ── 局内战绩面板 ─────────────────────────────────────────

export function StatsPanel({ game, meId, counts, onClose }: {
  game: GameSnapshot;
  meId: string;
  counts: Record<string, { given: number; got: number }>;
  onClose: () => void;
}) {
  const rows = game.players
    .map((p) => ({ p, s: game.stats?.[p.id], c: counts[p.id] }))
    .sort((a, b) => {
      if (a.p.alive !== b.p.alive) return a.p.alive ? -1 : 1;
      const da = a.s?.damageDealt ?? 0;
      const db = b.s?.damageDealt ?? 0;
      if (db !== da) return db - da;
      return (b.s?.kills ?? 0) - (a.s?.kills ?? 0);
    });
  return (
    <div className="stats-overlay" onClick={onClose}>
      <div className="stats-modal anim-in" onClick={(e) => e.stopPropagation()}>
        <header className="stats-head">
          <h2>📊 本局战绩</h2>
          <span className="tcg-chip">第 {game.roundNo} 回合 · 存活 {game.aliveCount}</span>
          <span style={{ flex: 1 }} />
          <button className="tcg-btn ghost tiny" onClick={onClose}>关闭 ✕</button>
        </header>
        <div className="stats-scroll">
          <table className="stats-table">
            <thead>
              <tr>
                <th>玩家</th>
                <th>出拳 胜/负/平</th>
                <th>造成伤害</th>
                <th>承受伤害</th>
                <th>击杀</th>
                <th>行动</th>
                <th>存活回合</th>
                <th>🍅 给/收</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, s, c }) => (
                <tr key={p.id} className={p.id === meId ? 'me' : ''}>
                  <td>
                    <span className={`stats-name ${p.alive ? '' : 'dead'}`}>{p.name}</span>
                    <span className="stats-char">{p.charName}</span>
                    {p.id === meId && <span className="seat-tag">我</span>}
                    {!p.alive && <span className="seat-tag dead">淘汰</span>}
                  </td>
                  <td>
                    <span className="st-win">{s?.throwWin ?? 0}</span>/
                    <span className="st-lose">{s?.throwLose ?? 0}</span>/
                    <span className="st-tie">{s?.throwTie ?? 0}</span>
                  </td>
                  <td className="st-dmg">{fmtHp(s?.damageDealt ?? 0)}</td>
                  <td>{fmtHp(s?.damageTaken ?? 0)}</td>
                  <td>{s?.kills ?? 0}</td>
                  <td>{s?.actions ?? 0}</td>
                  <td>{s?.roundsAlive ?? 0}</td>
                  <td>{c?.given ?? 0}/{c?.got ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="stats-tip">
            战绩只做统计展示，不参与任何规则判定。出拳胜负按每回合判定计（平局回合记为平）。
          </p>
        </div>
      </div>
    </div>
  );
}
