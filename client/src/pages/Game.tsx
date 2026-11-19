import { useMemo, useState } from 'react';
import { net, type LobbyState, type GameSnapshot, type SnapPlayer } from '../net.js';
import type { SessionInfo } from '../App.js';
import { CHARACTERS } from '../../../shared/src/characters/index.js';

const THROW_LABEL: Record<string, string> = { rock: '石头', scissors: '剪刀', paper: '布' };

export default function GamePage({ lobby, game, session, logs, onExit }: {
  lobby: LobbyState;
  game: GameSnapshot | null;
  session: SessionInfo;
  logs: { seq: number; text: string; important?: boolean }[];
  onExit: () => void;
  onBackToLobby?: () => void;
}) {
  if (!game) return <div className="card">等待游戏状态…</div>;
  return <GameInner lobby={lobby} game={game} session={session} logs={logs} onExit={onExit} />;
}

function GameInner({ lobby, game, session, logs, onExit }: {
  lobby: LobbyState;
  game: GameSnapshot;
  session: SessionInfo;
  logs: { seq: number; text: string; important?: boolean }[];
  onExit: () => void;
}) {
  const myIds = session.identities;
  const meId = myIds[0].playerId;
  const me = game.players.find((p) => p.id === meId);
  const isHost = lobby.hostSeat === meId;

  return (
    <div className="game">
      <header className="game-header">
        <span className="chip">房间 {lobby.code}</span>
        <span className="chip">第 {game.roundNo} 回合</span>
        <span className="chip">{phaseText(game.phase, game)}</span>
        <span className="chip">存活 {game.aliveCount}</span>
        <span className="chip">种子 {game.seed}</span>
        <span className="spacer" />
        {isHost && game.phase === 'over' && (
          <button className="btn small primary" onClick={() => net.restart(lobby.code, meId, myIds[0].token)}>重新开始</button>
        )}
        <button className="btn small danger" onClick={onExit}>退出</button>
      </header>

      {game.phase === 'over' && (
        <div className="card winner-card">
          <h2>{game.winner ? `🏆 ${game.players.find((p) => p.id === game.winner)?.name} 获胜！` : '平局：所有玩家同时淘汰'}</h2>
        </div>
      )}

      <div className="game-grid">
        <PlayersPanel game={game} myId={meId} identities={myIds} />
        <RoomsPanel game={game} />
        <ActionPanel game={game} session={session} lobby={lobby} />
        <LogPanel logs={logs} />
      </div>
    </div>
  );
}

function phaseText(phase: GameSnapshot['phase'], game: GameSnapshot): string {
  switch (phase) {
    case 'rps1': return `初次判定（出拳 ${game.submittedIds.length} 人）`;
    case 'act': return '行动阶段';
    case 'roundEnd': return '回合末结算';
    case 'over': return '游戏结束';
  }
}

// ─── 玩家面板 ────────────────────────────────────────────────

function PlayersPanel({ game, myId, identities }: { game: GameSnapshot; myId: string; identities: { playerId: string }[] }) {
  const cur = game.currentActor;
  return (
    <div className="card">
      <h3>玩家状态</h3>
      <table className="seat-table">
        <thead><tr><th>玩家</th><th>角色</th><th>HP</th><th>房间</th><th>状态</th></tr></thead>
        <tbody>
          {game.players.map((p) => (
            <tr key={p.id} className={!p.alive ? 'dead' : ''}>
              <td>
                {p.name}
                {identities.some((i) => i.playerId === p.id) ? '·我' : ''}
                {cur === p.id ? <span className="acting"> ▶行动中</span> : ''}
                {game.queue.includes(p.id) && game.phase === 'act' ? <span className="muted small">（队列{game.queue.indexOf(p.id) + 1}）</span> : ''}
              </td>
              <td>{p.charName}</td>
              <td>{fmtHp(p.hp)} / {fmtHp(p.maxHp)}</td>
              <td>{p.room}</td>
              <td>
                {!p.alive ? '💀淘汰' : p.hidden ? '🙈躲藏' : p.invisible ? '👻隐身' : '存活'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {game.deferred.length > 0 && (
        <div className="pending-bombs">
          ⏳ 待结算事件：
          {game.deferred.map((d) => (
            <span key={d.id} className="chip warn">{d.kind === 'ivan' ? `💣大伊万→${d.room}（第${d.explodeRound}回合末）` : d.kind}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtHp(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

// ─── 房间面板 ────────────────────────────────────────────────

function RoomsPanel({ game }: { game: GameSnapshot }) {
  return (
    <div className="card">
      <h3>房间分布</h3>
      <div className="rooms">
        {game.roomIds.map((r) => {
          const members = game.players.filter((p) => p.alive && p.room === r);
          return (
            <div key={r} className="room-box">
              <div className="room-title">{r}{members.some((m) => m.id === game.currentActor) ? ' ▶' : ''}</div>
              <div className="room-members">
                {members.length === 0 ? <span className="muted">（空）</span> : members.map((m) => (
                  <span key={m.id} className={m.hidden ? 'hidden-tag' : ''}>{m.name}·{fmtHp(m.hp)}{m.hidden ? '🙈' : ''}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 行动面板 ────────────────────────────────────────────────

function ActionPanel({ game, session, lobby }: { game: GameSnapshot; session: SessionInfo; lobby: LobbyState }) {
  const myIds = session.identities;
  const submittedSet = new Set(game.submittedIds);

  // 出拳阶段：单设备多人隐私处理
  if (game.phase === 'rps1') {
    const pendingIds = myIds.filter((i) => game.players.find((p) => p.id === i.playerId)?.alive && !submittedSet.has(i.playerId));
    const allDone = pendingIds.length === 0;
    return (
      <div className="card">
        <h3>初次判定 · 隐藏出拳</h3>
        {!allDone ? (
          <ThrowPrivacy myIds={pendingIds.map((i) => ({ playerId: i.playerId, name: i.name, token: i.token }))} game={game} lobby={lobby} />
        ) : (
          <p className="muted">✅ 全部身份已提交，等待其他玩家（已提交人数 {submittedSet.size}，不显示拳种）…</p>
        )}
        <RevealHistory game={game} />
      </div>
    );
  }

  if (game.phase === 'act') {
    const cur = game.currentActor;
    const mine = myIds.find((i) => i.playerId === cur);
    if (!mine) {
      const curP = game.players.find((p) => p.id === cur);
      return (
        <div className="card">
          <h3>行动阶段</h3>
          <p>等待 <strong>{curP?.name || '?'}</strong>（{curP?.charName}）行动…</p>
          <ActionQueue game={game} />
          <RevealHistory game={game} />
        </div>
      );
    }
    return (
      <div className="card">
        <h3>轮到 <span className="acting">{mine.name}</span> 行动</h3>
        <ActionForm game={game} identity={mine} lobby={lobby} />
        <RevealHistory game={game} />
      </div>
    );
  }

  if (game.phase === 'roundEnd') {
    return (
      <div className="card"><h3>回合末结算</h3><p className="muted">延迟事件结算中…</p><RevealHistory game={game} /></div>
    );
  }

  return <div className="card"><h3>游戏结束</h3><RevealHistory game={game} /></div>;
}

function ActionQueue({ game }: { game: GameSnapshot }) {
  return (
    <ol className="queue">
      {game.queue.map((pid, i) => {
        const p = game.players.find((x) => x.id === pid);
        if (!p) return null;
        return <li key={pid} className={i < game.actIndex ? 'done' : i === game.actIndex ? 'now' : ''}>{p.name}</li>;
      })}
    </ol>
  );
}

function RevealHistory({ game }: { game: GameSnapshot }) {
  const records = game.judgeRecords;
  if (records.length === 0) return null;
  return (
    <div className="reveal">
      <h4>本轮判定记录（已揭示）</h4>
      <table className="seat-table small-table">
        <thead><tr><th>阶段</th><th>子轮</th><th>出拳</th><th>结果</th></tr></thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={i}>
              <td>{r.stage === 'rps1' ? '初次' : '排序'}</td>
              <td>{r.sub}</td>
              <td>{Object.entries(r.throws).map(([pid, t]) => `${nameOf(game, pid)}:${THROW_LABEL[t] || t}`).join('，')}</td>
              <td>{r.outcome === 'cycle' ? '三人循环→重判' : r.outcome === 'alltie' ? '同拳平局→重判' : r.outcome === 'tieWin' ? '领域平局判胜' : `胜 ${r.winners?.map((w) => nameOf(game, w)).join('、') || ''}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function nameOf(game: GameSnapshot, pid: string): string {
  return game.players.find((p) => p.id === pid)?.name || pid;
}

// ─── 隐藏出拳（单设备多人：交设备遮罩，提交后不回显） ───────────

function ThrowPrivacy({ myIds, game, lobby }: {
  myIds: { playerId: string; name: string; token: string }[];
  game: GameSnapshot;
  lobby: LobbyState;
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [error, setError] = useState('');

  if (activeIdx === null) {
    return (
      <div className="privacy-screen">
        <p>📋 以下身份还未出拳：{myIds.map((i) => i.name).join('、')}</p>
        <p className="muted">为防止其他人看到出拳，请依次传递设备，由本人亲自出拳。</p>
        {myIds.map((i, idx) => (
          <button key={i.playerId} className="btn" onClick={() => setActiveIdx(idx)}>
            我是 {i.name}，开始出拳
          </button>
        ))}
      </div>
    );
  }

  const me = myIds[activeIdx];
  const p = game.players.find((x) => x.id === me.playerId);

  async function throwIt(t: string) {
    setError('');
    const r = await net.submitThrow(lobby.code, me.playerId, me.token, t) as { ok: boolean; error?: string };
    if (!r.ok) { setError(r.error || '提交失败'); return; }
    setActiveIdx(null); // 返回遮罩，不回显拳种
  }

  return (
    <div className="privacy-input">
      <p><strong>{me.name}</strong>（{p?.charName}，房间 {p?.room}）请选择出拳：</p>
      <div className="btn-row">
        <button className="btn throw" onClick={() => throwIt('rock')}>✊ 石头</button>
        <button className="btn throw" onClick={() => throwIt('scissors')}>✌️ 剪刀</button>
        <button className="btn throw" onClick={() => throwIt('paper')}>✋ 布</button>
      </div>
      {error && <div className="error-text">{error}</div>}
      <button className="btn tiny" onClick={() => setActiveIdx(null)}>返回（不出拳）</button>
    </div>
  );
}

// ─── 行动表单 ────────────────────────────────────────────────

function ActionForm({ game, identity, lobby }: {
  game: GameSnapshot;
  identity: { playerId: string; name: string; token: string };
  lobby: LobbyState;
}) {
  const me = game.players.find((p) => p.id === identity.playerId)!;
  const cd = CHARACTERS[me.charId] || CHARACTERS['default'];
  const [actionType, setActionType] = useState('attack');
  const [targetId, setTargetId] = useState('');
  const [room, setRoom] = useState(game.roomIds[0]);
  const [msg, setMsg] = useState('');

  const others = useMemo(() => game.players.filter((p) => p.alive && p.id !== me.id), [game]);
  const sameRoomTargets = others.filter((p) => p.room === me.room && (!p.hidden || cd.ignoreHide));
  const otherRoomTargets = cd.rangedCapable ? others.filter((p) => p.room !== me.room && !p.hidden) : [];
  const hiddenSameRoom = others.filter((p) => p.room === me.room && (p.hidden || p.invisible));

  // 可用行动列表
  const options: { key: string; label: string; targetHint?: string; roomHint?: boolean }[] = [
    { key: 'move', label: '移动', roomHint: true },
    { key: 'heal', label: '回复' },
    { key: 'milk', label: '喝牛奶（嘲讽）' },
    { key: 'skip', label: '跳过' },
  ];
  if (sameRoomTargets.length > 0 || otherRoomTargets.length > 0) options.unshift({ key: 'attack', label: '攻击', targetHint: 'attack' });
  if (cd.rangedNeedsAim && !(cd.aimExemptWhenDomain && me.char.domain === true)) options.push({ key: 'aim', label: '瞄准', targetHint: 'aim' });
  options.push({ key: 'hide', label: '躲藏' });
  if (hiddenSameRoom.length > 0) options.push({ key: 'seek', label: '找出来', targetHint: 'seek' });
  for (const a of cd.actions || []) {
    options.push({ key: a.name, label: a.label, targetHint: a.targetHint, roomHint: a.roomHint });
  }

  const current = options.find((o) => o.key === actionType) || options[0];
  let targets: SnapPlayer[] = [];
  if (current?.targetHint === 'attack') targets = [...sameRoomTargets, ...otherRoomTargets];
  else if (current?.targetHint === 'aim') targets = others.filter((p) => !p.hidden && !p.invisible);
  else if (current?.targetHint === 'seek') targets = hiddenSameRoom;
  else if (current?.targetHint === 'sameRoomPlayer') targets = sameRoomTargets;
  else if (current?.targetHint === 'anyPlayer') targets = others;
  else if (current?.targetHint === 'otherRoomPlayer') targets = otherRoomTargets;

  async function submit() {
    setMsg('');
    const action: Record<string, unknown> = { type: actionType };
    if (current?.targetHint && targetId) action.targetId = targetId;
    if (actionType === 'move' || current?.roomHint) action.room = room;
    if (actionType === 'attack' && targets.find((t) => t.id === targetId)?.room !== me.room) action.ranged = true;
    const r = await net.submitAction(lobby.code, identity.playerId, identity.token, action) as { ok: boolean; error?: string };
    if (!r.ok) setMsg(r.error || '行动失败');
  }

  return (
    <div className="action-form">
      <div className="field"><span>选择行动</span>
        <select value={actionType} onChange={(e) => { setActionType(e.target.value); setTargetId(''); }}>
          {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </div>
      {current?.roomHint && (
        <div className="field"><span>目标房间</span>
          <select value={room} onChange={(e) => setRoom(e.target.value)}>
            {game.roomIds.map((r) => <option key={r} value={r}>{r}（{game.players.filter((p) => p.alive && p.room === r).map((p) => p.name).join('、') || '空'}）</option>)}
          </select>
        </div>
      )}
      {current?.targetHint && targets.length > 0 && (
        <div className="field"><span>目标</span>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">（选择目标）</option>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>{t.name}（{t.room}·HP{fmtHp(t.hp)}{t.hidden ? '·躲藏' : ''}）</option>
            ))}
          </select>
        </div>
      )}
      {current?.targetHint && targets.length === 0 && <p className="muted">当前无可用目标</p>}
      <button className="btn primary" onClick={submit}>确认行动</button>
      {msg && <div className="error-text">{msg}</div>}
      <ActionQueue game={game} />
    </div>
  );
}

// ─── 日志面板 ────────────────────────────────────────────────

function LogPanel({ logs }: { logs: { seq: number; text: string; important?: boolean }[] }) {
  const [onlyKey, setOnlyKey] = useState(false);
  const ICON: Record<string, string> = {
    phase: '⏱️', judge: '🎲', order: '🔀', action: '🎬', damage: '⚔️',
    heal: '💊', move: '🚶', eliminate: '💀', trigger: '✨', state: '🔧',
    deferred: '💥', error: '❌', result: '🏆', info: 'ℹ️',
  };
  const shown = onlyKey ? logs.filter((l) => l.important) : logs;
  return (
    <div className="card log-card">
      <div className="log-header">
        <h3>游戏日志</h3>
        <div className="btn-row">
          <button className={`btn tiny ${onlyKey ? 'primary' : ''}`} onClick={() => setOnlyKey(true)}>⭐ 重点</button>
          <button className={`btn tiny ${!onlyKey ? 'primary' : ''}`} onClick={() => setOnlyKey(false)}>全部</button>
        </div>
      </div>
      <div className="log-scroll">
        {shown.slice().reverse().map((l) => (
          <div key={l.seq} className={`log-line ${l.important ? 'imp' : 'dim'}`}>
            <span className="log-icon">{ICON[l.type] || '·'}</span>{l.text}
          </div>
        ))}
      </div>
    </div>
  );
}

