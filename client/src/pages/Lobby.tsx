import { useState } from 'react';
import { net, type LobbyState } from '../net.js';
import type { SessionInfo } from '../App.js';
import { CHARACTER_LIST } from '../../../shared/src/characters/index.js';

export default function Lobby({ lobby, session, onExit }: {
  lobby: LobbyState;
  session: SessionInfo;
  onExit: () => void;
}) {
  const me = session.identities[0];
  const isHost = lobby.hostSeat === me.playerId;
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(lobby.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  async function addAI() {
    await net.addAI(lobby.code, me.playerId, me.token, 1);
  }

  async function startGame() {
    const r = await net.start(lobby.code, me.playerId, me.token) as { ok: boolean; error?: string };
    if (!r.ok) alert(r.error || '开始失败');
  }

  async function leave() {
    await net.leave(lobby.code, me.playerId, me.token);
    onExit();
  }

  return (
    <div className="lobby">
      <div className="card">
        <div className="code-row">
          <h2>房间邀请码：<span className="code">{lobby.code}</span></h2>
          <button className="btn small" onClick={copyCode}>{copied ? '已复制' : '复制'}</button>
        </div>
        <p className="muted">把邀请码发给朋友，加入后即可开始。房主：{lobby.seats.find((s) => s.playerId === lobby.hostSeat)?.name || '?'}</p>

        <h3>玩家名单（{lobby.seats.length}人）</h3>
        <table className="seat-table">
          <thead>
            <tr><th>昵称</th><th>角色</th><th>类型</th><th>连接</th><th></th></tr>
          </thead>
          <tbody>
            {lobby.seats.map((s) => {
              const mine = session.identities.some((i) => i.playerId === s.playerId);
              const cd = CHARACTER_LIST.find((c) => c.id === s.charId);
              return (
                <tr key={s.playerId}>
                  <td>{s.name}{lobby.hostSeat === s.playerId ? ' 👑' : ''}{mine ? '（我）' : ''}</td>
                  <td>
                    {mine && s.type !== 'ai' ? (
                      <select
                        value={s.charId}
                        onChange={(e) => net.setChar(lobby.code, s.playerId, session.identities.find((i) => i.playerId === s.playerId)!.token, e.target.value)}
                      >
                        {CHARACTER_LIST.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : (
                      <>{cd?.name || s.charId}{cd?.dataMissing?.length ? ' ⚠' : ''}</>
                    )}
                  </td>
                  <td>{s.type === 'ai' ? 'AI' : s.type === 'local' ? '本机' : '真人'}</td>
                  <td>{s.connected ? '🟢' : '🔴'}</td>
                  <td>
                    {isHost && s.playerId !== me.playerId && (
                      <button className="btn tiny danger" onClick={() => net.removeSeat(lobby.code, me.playerId, me.token, s.playerId)}>移除</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="btn-row">
          {isHost && <button className="btn" onClick={addAI}>添加 AI</button>}
          {isHost && <button className="btn primary" disabled={lobby.seats.length < 2} onClick={startGame}>开始游戏（至少2人）</button>}
          {!isHost && <span className="muted">等待房主开始游戏…</span>}
          <button className="btn danger" onClick={leave}>离开房间</button>
        </div>
      </div>

      <div className="card">
        <h3>角色速查</h3>
        <ul className="char-list">
          {CHARACTER_LIST.map((c) => (
            <li key={c.id}>
              <strong>{c.name}</strong>：{c.desc}
              {c.dataMissing?.length ? <em className="missing">（待确认：{c.dataMissing.join('；')}）</em> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
