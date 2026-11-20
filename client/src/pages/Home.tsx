import { useEffect, useState } from 'react';
import { net, type RoomListEntry } from '../net.js';
import { CHARACTER_LIST } from '../../../shared/src/characters/index.js';
import { thumbOf, cardMeta } from '../cards.js';

export default function Home({ onEnter, onArena }: {
  onEnter: (code: string, identities: { playerId: string; name: string; token: string }[]) => void;
  onArena: () => void;
}) {
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [localCount, setLocalCount] = useState(1);
  const [aiCount, setAiCount] = useState(0);
  const [charId, setCharId] = useState('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rooms, setRooms] = useState<RoomListEntry[]>([]);
  const [showRules, setShowRules] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => {
    const off = net.onLobbyRooms(setRooms);
    return off;
  }, []);

  const charOptions = CHARACTER_LIST.filter((c) => c.id !== 'default' || true);

  async function wrap(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await fn(); } catch (e) { setError(String(e)); }
    setBusy(false);
  }

  async function createRoom(autoStart: boolean) {
    await wrap(async () => {
      await net.connect();
      const myName = name.trim() || '玩家1';
      const localNames = Array.from({ length: localCount }, (_, i) => (localCount === 1 ? myName : `${myName}${i + 1}`));
      const r = await net.createRoom(myName, localNames, charId) as { ok: boolean; code?: string; seats?: { playerId: string; name: string; token: string }[]; error?: string };
      if (!r.ok || !r.code || !r.seats) { setError(r.error || '创建失败'); return; }
      onEnter(r.code, r.seats.map((s) => ({ playerId: s.playerId, name: s.name, token: s.token })));
      if (autoStart) {
        const me = r.seats[0];
        if (aiCount > 0) await net.addAI(r.code, me.playerId, me.token, aiCount);
        const s = await net.start(r.code, me.playerId, me.token) as { ok: boolean; error?: string };
        if (!s.ok) setError(s.error || '开始失败');
      }
    });
  }

  async function joinRoom(code?: string) {
    await wrap(async () => {
      await net.connect();
      const target = (code || joinCode).trim().toUpperCase();
      const r = await net.joinRoom(target, name.trim() || '玩家', charId) as { ok: boolean; code?: string; seats?: { playerId: string; name: string; token: string }[]; error?: string };
      if (!r.ok || !r.code || !r.seats) { setError(r.error || '加入失败'); return; }
      const mine = r.seats[r.seats.length - 1];
      onEnter(r.code, [{ playerId: mine.playerId, name: mine.name, token: mine.token }]);
    });
  }

  const detailMeta = detail ? cardMeta(detail) : null;
  const detailChar = detail ? CHARACTER_LIST.find((c) => c.id === detail) : null;

  return (
    <div className="tcg-app tcg-lobby">
      <h1 className="hall-title">拔 典</h1>
      <p className="hall-sub">多人房间制生存游戏 · 石头剪刀布 · 卡桌对决 · 最后一名存活者获胜</p>

      {/* 角色卡展示墙 */}
      <div className="tcg-panel">
        <h2>🃏 角色卡池（点击查看卡面）</h2>
        <div className="char-showcase">
          {CHARACTER_LIST.map((c) => (
            thumbOf(c.id) ? (
              <img key={c.id} src={thumbOf(c.id)} alt={c.name} title={c.name}
                onClick={() => setDetail(c.id)}
                style={{ cursor: 'pointer' }}
              />
            ) : (
              <div key={c.id} className="showcase-ph" title={c.name} onClick={() => setDetail(c.id)}>
                <span>{c.name.slice(0, 1)}</span>
                <small>{c.name}</small>
              </div>
            )
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          ⚔ 每回合所有存活玩家隐藏出拳 → 胜者获得行动资格 → 再判定行动顺序（输者先动）→ 依次移动 / 攻击 / 回复 / 发动技能 → HP归零淘汰 → 最后一人获胜
        </p>
      </div>

      <div className="hall-grid">
        <div className="tcg-panel">
          <h2>🎴 开启对局</h2>
          <label className="field">
            <span>昵称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="输入昵称" maxLength={12} />
          </label>
          <label className="field">
            <span>选择角色卡</span>
            <select value={charId} onChange={(e) => setCharId(e.target.value)}>
              {charOptions.map((c) => (
                <option key={c.id} value={c.id}>{c.name}（血{c.hp ?? 3} 攻{c.attack ?? 1}）</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>单设备多人（本机玩家数）</span>
            <select value={localCount} onChange={(e) => setLocalCount(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="field">
            <span>AI 数量（单人游戏填 1 以上）</span>
            <select value={aiCount} onChange={(e) => setAiCount(Number(e.target.value))}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="btn-row">
            <button className="tcg-btn" disabled={busy} onClick={() => createRoom(true)}>
              {aiCount > 0 ? '⚔ 单人开局（+AI）' : '⚔ 创建房间'}
            </button>
            <button className="tcg-btn ghost" disabled={busy} onClick={() => createRoom(false)}>仅创建（邀请好友）</button>
            <button className="tcg-btn ghost" onClick={() => setShowRules(true)}>📖 规则</button>
          </div>
          <hr className="sep" />
          <label className="field">
            <span>加入房间（邀请码）</span>
            <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="4位邀请码" maxLength={4} />
          </label>
          <button className="tcg-btn" disabled={busy || joinCode.trim().length < 4} onClick={() => joinRoom()}>加入房间</button>
          <button className="tcg-btn ghost" onClick={onArena}>🧪 机制测试场</button>
          {error && <div className="error-text">{error}</div>}
        </div>

        <div className="tcg-panel">
          <h2>🎴 房间列表 <button className="tcg-btn ghost" style={{ float: 'right', padding: '2px 10px', fontSize: 11 }} onClick={() => net.connect().then(() => net.requestLobbyRooms())}>刷新</button></h2>
          <div className="room-list">
            {rooms.length === 0 && <div className="zone-empty" style={{ minHeight: 80 }}>暂无房间 · 创建一个吧</div>}
            {rooms.filter((r) => r.state !== 'over').map((r) => (
              <div key={r.code} className="room-item">
                <div>
                  <div className="ri-code">{r.code}</div>
                  <div className="ri-meta">房主 {r.hostName} · {r.seatCount}人（真人{r.humans}）</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={`ri-state ${r.state}`}>{r.state === 'lobby' ? '等待中' : r.state === 'playing' ? '对战中' : '已结束'}</span>
                  {r.state === 'lobby' && (
                    <button className="tcg-btn" style={{ padding: '5px 12px', fontSize: 12 }} disabled={busy} onClick={() => joinRoom(r.code)}>加入</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showRules && (
        <div className="card-detail" onClick={() => setShowRules(false)}>
          <div className="card-detail-inner" onClick={(e) => e.stopPropagation()}>
            <h3>拔典 · 对局规则</h3>
            <ol className="cd-mech" style={{ paddingLeft: 20 }}>
              <li><b>隐藏出拳</b>：每回合所有存活玩家同时出拳（拳种保密），服务端统一揭示判定；平局/三人循环全员重判。</li>
              <li><b>行动资格</b>：胜者（可多名）获得行动资格，败者本回合不行动。</li>
              <li><b>行动顺序</b>：资格者再判定排序，<b>输者先行动</b>；不剥夺资格。</li>
              <li><b>行动</b>：依次执行一次 —— 移动（任意初始房间）/ 攻击（默认同房间近战）/ 回复（满血）/ 喝牛奶（嘲讽）/ 躲藏 / 找出来 / 角色技能。</li>
              <li><b>躲藏</b>：指向性攻击无法锁定；AOE 与无视躲避攻击仍可命中；移动/攻击后现身。</li>
              <li><b>回合末</b>：延迟事件结算（如大伊万爆炸，按爆炸时房间成员动态判定）。</li>
              <li><b>胜负</b>：HP归零立即淘汰；最后一名存活玩家获胜。</li>
            </ol>
            <button className="tcg-btn" style={{ marginTop: 14, width: '100%' }} onClick={() => setShowRules(false)}>明白了</button>
          </div>
        </div>
      )}

      {detailMeta && detailChar && (
        <div className="card-detail" onClick={() => setDetail(null)}>
          <div className="card-detail-inner" onClick={(e) => e.stopPropagation()}>
            {detailMeta.img && <img src={detailMeta.img} alt={detailChar.name} />}
            <h3>No.{detailMeta.no} · {detailChar.name}（HP {detailChar.hp ?? 3} / 攻 {detailChar.attack ?? 1}）</h3>
            <div className="cd-skills">{detailMeta.skills}</div>
            <div className="cd-mech">{detailMeta.mech}</div>
            {detailMeta.quote && <div className="cd-quote">「{detailMeta.quote}」</div>}
            {detailChar.dataMissing?.length ? <div className="cd-mech" style={{ color: '#a2651a' }}>⚠ 待确认：{detailChar.dataMissing.join('；')}</div> : null}
            <button className="tcg-btn" style={{ marginTop: 14, width: '100%' }} onClick={() => setDetail(null)}>关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}
