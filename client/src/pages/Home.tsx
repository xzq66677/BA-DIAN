import { useState } from 'react';
import { net } from '../net.js';
import { CHARACTER_LIST } from '../../../shared/src/characters/index.js';

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

  const charOptions = CHARACTER_LIST;

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

  async function joinRoom() {
    await wrap(async () => {
      await net.connect();
      const r = await net.joinRoom(joinCode.trim().toUpperCase(), name.trim() || '玩家', charId) as { ok: boolean; code?: string; seats?: { playerId: string; name: string; token: string }[]; error?: string };
      if (!r.ok || !r.code || !r.seats) { setError(r.error || '加入失败'); return; }
      // 只绑定自己（最后加入的座位）
      const mine = r.seats[r.seats.length - 1];
      onEnter(r.code, [{ playerId: mine.playerId, name: mine.name, token: mine.token }]);
    });
  }

  return (
    <div className="home">
      <h1 className="title">拔典</h1>
      <p className="subtitle">多人房间制生存游戏 · 石头剪刀布 · 每回合资格判定 · 最后一名存活者获胜</p>

      <div className="card">
        <h2>开始游戏</h2>
        <label className="field">
          <span>昵称</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="输入昵称" maxLength={12} />
        </label>
        <label className="field">
          <span>角色</span>
          <select value={charId} onChange={(e) => setCharId(e.target.value)}>
            {charOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}（血{c.hp ?? 3} 攻{c.attack ?? 1}）{c.dataMissing?.length ? ' ·资料缺失' : ''}</option>
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
        <button className="btn primary" disabled={busy} onClick={() => createRoom(true)}>
          {aiCount > 0 ? '单人开局（+AI）' : '创建房间'}
        </button>
        <button className="btn" disabled={busy} onClick={() => createRoom(false)}>仅创建房间（邀请好友）</button>

        <hr className="sep" />
        <label className="field">
          <span>加入房间（邀请码）</span>
          <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="4位邀请码" maxLength={4} />
        </label>
        <button className="btn" disabled={busy || joinCode.trim().length < 4} onClick={joinRoom}>加入房间</button>
        {error && <div className="error-text">{error}</div>}
      </div>

      <div className="card">
        <h2>机制测试场</h2>
        <p className="muted">角色机制验证、测试用例运行、PASS/FAIL、随机种子复现。无需联机。</p>
        <button className="btn" onClick={onArena}>进入测试场</button>
      </div>

      <div className="rules-brief">
        <h3>玩法速览</h3>
        <ol>
          <li>每回合所有存活玩家<strong>隐藏出拳</strong>（石头/剪刀/布）</li>
          <li>服务端判定：胜者获得行动资格（平局/三人循环重新判定）</li>
          <li>胜者再进行一次判定确定<strong>行动顺序</strong>（输者先行动）</li>
          <li>按顺序执行一次行动：<strong>移动 / 攻击 / 回复</strong>（角色另有技能）</li>
          <li>血量归零立即淘汰；<strong>最后一名存活玩家获胜</strong></li>
        </ol>
      </div>
    </div>
  );
}
