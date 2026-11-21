/**
 * 拔典 · 对局回放
 * 服务端按状态变化录制的「状态帧」逐帧播放：座位血量/房间、出拳揭示、行动顺序、日志。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { net, type ReplayRecord, type ReplayFrame, type ReplaySummary } from '../net.js';
import { CHARACTERS } from '../../../shared/src/characters/index.js';

const THROW_LABEL: Record<string, string> = { rock: '石头', scissors: '剪刀', paper: '布' };
const THROW_ICON: Record<string, string> = { rock: '✊', scissors: '✌️', paper: '✋' };
const PHASE_LABEL: Record<string, string> = {
  rps1: '隐藏出拳', act: '行动阶段', roundEnd: '回合末结算', over: '游戏结束',
};

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

export default function ReplayViewer({ code, onClose, autoOpenId }: {
  code: string;
  onClose: () => void;
  /** 直接打开某一局（如刚结束的对局） */
  autoOpenId?: string | null;
}) {
  const [list, setList] = useState<ReplaySummary[]>([]);
  const [liveId, setLiveId] = useState<string | null>(null);
  const [rec, setRec] = useState<ReplayRecord | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [msg, setMsg] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 拉取回放列表
  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await net.replayList(code) as { ok: boolean; replays?: ReplaySummary[]; live?: string | null };
      if (!alive) return;
      if (!r.ok) { setMsg('回放列表获取失败'); return; }
      const replays = r.replays ?? [];
      setList(replays);
      setLiveId(r.live ?? null);
      const autoOk = autoOpenId
        && (replays.some((x) => x.id === autoOpenId) || r.live === autoOpenId);
      const first = autoOk ? autoOpenId : (replays[0]?.id ?? r.live ?? null);
      if (first) setSelId(first);
    })();
    return () => { alive = false; };
  }, [code, autoOpenId]);

  // 载入选中的回放
  useEffect(() => {
    if (!selId) return;
    let alive = true;
    (async () => {
      const r = await net.replayGet(code, selId) as { ok: boolean; replay?: ReplayRecord; error?: string };
      if (!alive) return;
      if (!r.ok || !r.replay) { setMsg(r.error || '回放载入失败'); return; }
      setRec(r.replay);
      setIdx(0);
      setPlaying(false);
      setMsg('');
    })();
    return () => { alive = false; };
  }, [code, selId]);

  const frames = rec?.frames ?? [];
  const total = frames.length;
  const frame: ReplayFrame | null = total > 0 ? frames[Math.min(idx, total - 1)] : null;

  // 播放：按倍速推进（每帧 900ms / speed）
  useEffect(() => {
    if (!playing || total === 0) return;
    if (idx >= total - 1) { setPlaying(false); return; }
    timer.current = setTimeout(() => setIdx((i) => Math.min(i + 1, total - 1)), 900 / speed);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [playing, idx, total, speed]);

  // 累计日志（到当前帧为止）
  const logs = useMemo(() => {
    if (!frame) return [];
    const out: { seq: number; text: string; important?: boolean; round: number }[] = [];
    for (let i = 0; i <= Math.min(idx, total - 1); i++) {
      const f = frames[i];
      for (const l of f.logs) out.push({ seq: l.seq, text: l.text, important: l.important, round: f.roundNo });
    }
    return out.slice(-120);
  }, [frames, idx, total, frame]);

  const logRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [logs.length]);

  const revealById = useMemo(() => {
    const map: Record<string, { t: string; result: 'win' | 'lose' | 'tie' }> = {};
    if (!frame?.reveal) return map;
    for (const [pid, t] of Object.entries(frame.reveal.throws)) {
      map[pid] = {
        t,
        result: frame.reveal.winners.includes(pid) ? 'win' : frame.reveal.losers.includes(pid) ? 'lose' : 'tie',
      };
    }
    return map;
  }, [frame]);

  function download() {
    if (!rec) return;
    const blob = new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `badian-replay-${rec.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <div className="rp-overlay" onClick={onClose}>
      <div className="rp-modal anim-in" onClick={(e) => e.stopPropagation()}>
        <header className="rp-head">
          <h2>🎬 对局回放</h2>
          {rec && (
            <span className="tcg-chip">
              种子 {rec.seed} · {rec.rounds} 回合 · {rec.frameCount} 帧
            </span>
          )}
          {rec?.winnerName && <span className="tcg-chip hot">🏆 {rec.winnerName}</span>}
          <span style={{ flex: 1 }} />
          <button className="tcg-btn ghost tiny" onClick={download} disabled={!rec}>⬇ 导出 JSON</button>
          <button className="tcg-btn ghost tiny" onClick={onClose}>关闭 ✕</button>
        </header>

        <div className="rp-body">
          <aside className="rp-list">
            {liveId && !list.some((x) => x.id === liveId) && (
              <button className={`rp-item ${selId === liveId ? 'active' : ''}`} onClick={() => setSelId(liveId)}>
                <b>● 进行中</b>
                <span>当前对局（未归档）</span>
              </button>
            )}
            {list.length === 0 && !liveId && <div className="muted" style={{ fontSize: 12 }}>本房间还没有打完的对局，打完一局即可回放。</div>}
            {list.map((r) => (
              <button key={r.id} className={`rp-item ${selId === r.id ? 'active' : ''}`} onClick={() => setSelId(r.id)}>
                <b>{r.winnerName ? `🏆 ${r.winnerName}` : '☠ 平局'}</b>
                <span>{r.rounds} 回合 · {r.frameCount} 帧 · {r.players.length} 人</span>
                <span className="rp-time">{new Date(r.ts).toLocaleTimeString('zh-CN', { hour12: false })}</span>
              </button>
            ))}
          </aside>

          <main className="rp-stage">
            {msg && <div className="error-text" style={{ marginBottom: 8 }}>{msg}</div>}
            {!frame && <div className="muted">选择左侧一条回放开始播放</div>}
            {frame && (
              <>
                <div className="rp-status">
                  <span className="rp-round">第 <b>{frame.roundNo}</b> 回合</span>
                  <span className="tcg-chip">{PHASE_LABEL[frame.phase] || frame.phase}</span>
                  <span className="tcg-chip">子轮 {frame.subRound}</span>
                  <span className="tcg-chip">存活 {frame.aliveCount}</span>
                  <span className="tcg-chip">帧 {idx + 1}/{total}</span>
                  {frame.currentActor && (
                    <span className="tcg-chip hot">
                      行动中：{frame.players.find((p) => p.id === frame.currentActor)?.name}
                    </span>
                  )}
                </div>

                <div className="rp-players">
                  {frame.players.map((p) => {
                    const tv = revealById[p.id];
                    const cd = CHARACTERS[p.charId] || CHARACTERS['default'];
                    return (
                      <div key={p.id} className={`rp-pl ${p.alive ? '' : 'dead'} ${frame.currentActor === p.id ? 'acting' : ''}`}>
                        <div className="rp-pl-top">
                          <span className="rp-pl-name">{p.name}</span>
                          <span className="rp-pl-char">{p.charName || cd.name}</span>
                        </div>
                        <div className="rp-pl-hp">
                          <span>❤ {fmt(p.hp)}/{fmt(p.maxHp)}</span>
                          <span>📍{p.room}</span>
                          {p.hidden && <span>🙈</span>}
                          {p.invisible && <span>👻</span>}
                        </div>
                        <div className="rp-pl-stats">
                          {p.stats && (
                            <>
                              <span title="出拳胜/负/平">🎴 {p.stats.throwWin}/{p.stats.throwLose}/{p.stats.throwTie}</span>
                              <span title="造成伤害">⚔ {fmt(p.stats.damageDealt)}</span>
                              <span title="击杀">💀 {p.stats.kills}</span>
                            </>
                          )}
                        </div>
                        {tv && p.alive && (
                          <span className={`rp-throw rv-${tv.result}`} title={`出了${THROW_LABEL[tv.t]}`}>
                            {THROW_ICON[tv.t]}<small>{tv.result === 'win' ? '胜' : tv.result === 'lose' ? '负' : '平'}</small>
                          </span>
                        )}
                        {!p.alive && <span className="rp-dead">已淘汰</span>}
                      </div>
                    );
                  })}
                </div>

                {frame.reveal && (
                  <div className="rp-reveal">
                    <span className="rb-verdict-label">出拳揭示</span>
                    {Object.entries(frame.reveal.throws).map(([pid, t]) => (
                      <span key={pid} className="rp-rv-chip">
                        {THROW_ICON[t]} {frame.players.find((p) => p.id === pid)?.name}·{THROW_LABEL[t]}
                      </span>
                    ))}
                    <span className="rp-rv-verdict">
                      {frame.reveal.outcome === 'cycle' ? '三人循环·平局回合'
                        : frame.reveal.outcome === 'alltie' ? '同拳平局·平局回合'
                          : frame.reveal.outcome === 'tieWin' ? '领域判胜'
                            : '分出胜负'}
                    </span>
                  </div>
                )}

                {frame.queue.length > 0 && (
                  <div className="rp-order">
                    <span className="rb-order-label">行动顺序</span>
                    {frame.queue.map((pid, i) => (
                      <span key={pid} className={`rb-order-chip ${i < frame.actIndex ? 'done' : i === frame.actIndex ? 'now' : ''}`}>
                        {frame.players.find((p) => p.id === pid)?.name}
                      </span>
                    ))}
                  </div>
                )}

                <div className="rp-logs" ref={logRef}>
                  {logs.map((l) => (
                    <div key={l.seq} className={`log-line ${l.important ? 'imp' : 'dim'}`}>
                      <span className="log-icon">R{l.round}</span>{l.text}
                    </div>
                  ))}
                </div>

                {frame.phase === 'over' && (
                  <div className="rp-final">
                    {frame.winner
                      ? `🏆 ${frame.players.find((p) => p.id === frame.winner)?.name} 获胜`
                      : '☠ 平局 · 全员同时淘汰'}
                  </div>
                )}
              </>
            )}
          </main>
        </div>

        <footer className="rp-controls">
          <button className="tcg-btn ghost tiny" onClick={() => { setIdx(0); setPlaying(false); }} disabled={!frame}>⏮ 开头</button>
          <button className="tcg-btn ghost tiny" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={!frame}>◀ 上一帧</button>
          <button className="tcg-btn" onClick={() => setPlaying((p) => !p)} disabled={!frame}>
            {playing ? '⏸ 暂停' : '▶ 播放'}
          </button>
          <button className="tcg-btn ghost tiny" onClick={() => setIdx((i) => Math.min(total - 1, i + 1))} disabled={!frame}>下一帧 ▶</button>
          <input
            className="rp-slider"
            type="range"
            min={0}
            max={Math.max(0, total - 1)}
            value={Math.min(idx, Math.max(0, total - 1))}
            onChange={(e) => { setIdx(Number(e.target.value)); setPlaying(false); }}
            disabled={!frame}
          />
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="rp-speed">
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
            <option value={4}>4×</option>
          </select>
        </footer>
      </div>
    </div>
  );
}
