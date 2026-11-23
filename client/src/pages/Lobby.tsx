import { useEffect, useRef, useState } from 'react';
import { net, type LobbyState } from '../net.js';
import type { SessionInfo } from '../App.js';
import { CHARACTER_LIST } from '../../../shared/src/characters/index.js';
import { thumbOf } from '../cards.js';

export default function Lobby({ lobby, session, onExit }: {
  lobby: LobbyState;
  session: SessionInfo;
  onExit: () => void;
}) {
  const me = session.identities[0];
  const isHost = lobby.hostSeat === me.playerId;
  const [copied, setCopied] = useState(false);
  const [aiCharId, setAiCharId] = useState('random');
  const [chatText, setChatText] = useState('');
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const chat: { name: string; text: string; ts: number }[] = lobby.chat || [];

  useEffect(() => {
    if (chatLogRef.current) chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
  }, [chat.length]);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(lobby.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  async function sendChat() {
    const text = chatText.trim();
    if (!text) return;
    setChatText('');
    await net.chat(lobby.code, me.playerId, me.token, text);
  }

  async function leave() {
    // App.exitSession 统一负责通知服务端退出（含本设备全部身份与解散规则）
    onExit();
  }
  async function dissolve() {
    const r = await net.dissolve(lobby.code, me.playerId, me.token) as { ok: boolean; error?: string };
    if (!r.ok) alert(r.error || '解散失败');
    // 服务端会广播 room:dissolved，App 统一处理回首页
  }

  return (
    <div className="tcg-app tcg-lobby">
      <div className="tcg-panel">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span className="tcg-logo">拔典</span>
          <span style={{ fontSize: 28, fontWeight: 900, letterSpacing: 6, color: 'var(--gold-2)', fontFamily: 'monospace', background: 'rgba(216,176,74,0.1)', padding: '4px 16px', borderRadius: 10, border: '1px solid var(--gold-dim)' }}>{lobby.code}</span>
          <button className="tcg-btn ghost" onClick={copyCode}>{copied ? '✓ 已复制' : '📋 复制邀请码'}</button>
          <span style={{ flex: 1 }} />
          {isHost && <button className="tcg-btn danger" onClick={dissolve}>💥 解散房间</button>}
          <button className="tcg-btn ghost" onClick={leave}>离开房间</button>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          把邀请码发给朋友加入；房主：<b style={{ color: 'var(--gold-2)' }}>{lobby.seats.find((s) => s.playerId === lobby.hostSeat)?.name || '?'}</b>
          {isHost ? '（你）' : ''} · 至少 2 人可开局
        </p>
        <p className="muted">地图：悬浮遗迹 · 天气与泥潭：{lobby.config.map?.mechanics.weather === false ? '关闭' : '开启'}</p>
      </div>

      <div className="hall-grid">
        <div className="tcg-panel">
          <h2>🎴 玩家卡位（{lobby.seats.length}）</h2>
          <div className="seat-slots">
            {lobby.seats.map((s) => {
              const mine = session.identities.some((i) => i.playerId === s.playerId);
              const cd = CHARACTER_LIST.find((c) => c.id === s.charId);
              const thumb = thumbOf(s.charId);
              return (
                <div key={s.playerId} className={`seat-slot ${lobby.hostSeat === s.playerId ? 'host' : ''} ${s.connected ? '' : 'offline'}`}>
                  {thumb ? <img src={thumb} alt={cd?.name} /> : <div className="ss-ph">拔</div>}
                  <div className="ss-name">{s.name}{mine ? '（我）' : ''}</div>
                  <div className="ss-role">
                    {mine && s.type !== 'ai' ? (
                      <select
                        value={s.charId}
                        onChange={(e) => net.setChar(lobby.code, s.playerId, session.identities.find((i) => i.playerId === s.playerId)!.token, e.target.value)}
                        style={{ width: '100%', minHeight: 24, fontSize: 11, padding: '2px' }}
                      >
                        {CHARACTER_LIST.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : isHost && s.type === 'ai' ? (
                      <select
                        value={s.charId}
                        onChange={(e) => net.setChar(lobby.code, me.playerId, me.token, e.target.value, s.playerId)}
                        style={{ width: '100%', minHeight: 24, fontSize: 11, padding: '2px' }}
                        title="房主可为AI改角色"
                      >
                        {CHARACTER_LIST.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    ) : (
                      <>{cd?.name}{s.type === 'ai' ? ' · AI' : s.type === 'local' ? ' · 本机' : ''}{s.connected ? '' : ' · 离线'}</>
                    )}
                  </div>
                  {isHost && s.playerId !== me.playerId && (
                    <button className="tcg-btn ghost" style={{ marginTop: 4, padding: '2px 8px', fontSize: 10, width: '100%' }}
                      onClick={() => net.removeSeat(lobby.code, me.playerId, me.token, s.playerId)}>移除</button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="btn-row" style={{ marginTop: 14 }}>
            {isHost && (
              <>
                <select
                  value={lobby.aiDifficulty || 'normal'}
                  onChange={(e) => net.setAI(lobby.code, me.playerId, me.token, e.target.value)}
                  style={{ minWidth: 150 }}
                  title="AI 难度：休闲=随性、普通=稳健、硬核=会反制出拳并优先补刀"
                >
                  <option value="easy">🤖 AI 难度：休闲</option>
                  <option value="normal">🤖 AI 难度：普通</option>
                  <option value="hard">🤖 AI 难度：硬核</option>
                </select>
                <select value={aiCharId} onChange={(e) => setAiCharId(e.target.value)} style={{ minWidth: 150 }}>
                  <option value="random">AI 角色：🎲 随机</option>
                  {CHARACTER_LIST.map((c) => <option key={c.id} value={c.id}>AI 角色：{c.name}</option>)}
                </select>
                <button className="tcg-btn ghost" onClick={() => net.addAI(lobby.code, me.playerId, me.token, 1, aiCharId)}>+ 添加 AI</button>
              </>
            )}
            {!isHost && lobby.seats.some((s) => s.type === 'ai') && (
              <span className="tcg-chip">🤖 AI 难度：{({ easy: '休闲', normal: '普通', hard: '硬核' } as Record<string, string>)[lobby.aiDifficulty || 'normal']}</span>
            )}
            {isHost && <button className="tcg-btn" disabled={lobby.seats.length < 2} onClick={async () => {
              const r = await net.start(lobby.code, me.playerId, me.token) as { ok: boolean; error?: string };
              if (!r.ok) alert(r.error || '开始失败');
            }}>⚔ 开始对局（至少2人）</button>}
            {!isHost && <span className="tcg-chip">等待房主开始…</span>}
          </div>
        </div>

        <div className="tcg-panel">
          <h2>💬 房间交流</h2>
          <div className="chat-box">
            <div className="chat-log" ref={chatLogRef}>
              {chat.length === 0 && <div className="muted">还没有消息，打个招呼吧</div>}
              {chat.map((m, i) => (
                <div key={i} className="chat-line"><b>{m.name}</b>：{m.text}</div>
              ))}
            </div>
            <div className="chat-input-row">
              <input
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }}
                placeholder="输入消息…"
                maxLength={200}
              />
              <button className="tcg-btn" onClick={sendChat}>发送</button>
            </div>
          </div>
          <h2 style={{ marginTop: 18 }}>📜 快速规则</h2>
          <p className="muted" style={{ fontSize: 12, lineHeight: 1.8 }}>
            每回合所有存活玩家<b style={{ color: 'var(--gold-2)' }}>隐藏出拳</b> → 胜者获得行动资格 →
            再判定<b style={{ color: 'var(--gold-2)' }}>行动顺序（输者先动）</b> → 依次 移动/攻击/回复/技能 →
            HP归零淘汰 → 最后一名存活者获胜。
          </p>
        </div>
      </div>
    </div>
  );
}
