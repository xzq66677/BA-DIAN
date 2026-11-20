import { useEffect, useMemo, useRef, useState } from 'react';
import { net, type LobbyState, type GameSnapshot, type SnapPlayer } from '../net.js';
import type { SessionInfo } from '../App.js';
import { CHARACTERS } from '../../../shared/src/characters/index.js';
import { cardMeta } from '../cards.js';

const THROW_LABEL: Record<string, string> = { rock: '石头', scissors: '剪刀', paper: '布' };
const THROW_ICON: Record<string, string> = { rock: '✊', scissors: '✌️', paper: '✋' };

interface ActionOption {
  key: string;
  label: string;
  desc: string;
  typeLabel: string;
  targetHint?: string;
  roomHint?: boolean;
}

export default function GamePage({ lobby, game, session, logs, onExit }: {
  lobby: LobbyState;
  game: GameSnapshot | null;
  session: SessionInfo;
  logs: { seq: number; text: string; important?: boolean; type?: string; data?: Record<string, unknown> }[];
  onExit: () => void;
}) {
  if (!game) return <div className="tcg-app"><div className="tcg-panel" style={{ margin: 20 }}>等待游戏状态…</div></div>;
  return <GameInner lobby={lobby} game={game} session={session} logs={logs} onExit={onExit} />;
}

function fmtHp(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function atkOf(p: SnapPlayer): string {
  const cd = CHARACTERS[p.charId] || CHARACTERS['default'];
  const override = p.char.attackOverride;
  if (typeof override === 'number') return fmtHp(override);
  const v = cd.meleeDamage ?? cd.attack ?? 1;
  return fmtHp(v);
}

function GameInner({ lobby, game, session, logs, onExit }: {
  lobby: LobbyState;
  game: GameSnapshot;
  session: SessionInfo;
  logs: { seq: number; text: string; important?: boolean; type?: string; data?: Record<string, unknown> }[];
  onExit: () => void;
}) {
  const myIds = session.identities;
  const meId = myIds[0].playerId;
  const isHost = lobby.hostSeat === meId;
  const me = game.players.find((p) => p.id === meId);

  // 行动坞交互状态（纯 UI 状态；最终合法性由服务器校验）
  const [selAction, setSelAction] = useState<ActionOption | null>(null);
  const [selTarget, setSelTarget] = useState('');
  const [selRoom, setSelRoom] = useState('');
  const [actMsg, setActMsg] = useState('');

  // 动作特效：从新增日志提取（行动/伤害/触发 → 卡牌表情动画）
  const [actionFx, setActionFx] = useState<Record<string, { kind: string; key: number }>>({});
  const lastFxSeq = useRef(0);
  useEffect(() => {
    const newEntries = logs.filter((l) => l.seq > lastFxSeq.current && l.data);
    if (newEntries.length === 0) return;
    lastFxSeq.current = Math.max(...newEntries.map((l) => l.seq));
    setActionFx((prev) => {
      const next = { ...prev };
      for (const l of newEntries) {
        const d = l.data as { pid?: string; fx?: string; source?: string };
        if (!d) continue;
        const kind = d.fx || (l.type === 'damage' && d.source ? 'attack' : l.type === 'trigger' ? 'skill' : '');
        const pid = d.pid || (kind === 'attack' ? d.source : '');
        if (kind && pid) next[pid] = { kind, key: l.seq };
      }
      return next;
    });
    const t = setTimeout(() => setActionFx({}), 1400);
    return () => clearTimeout(t);
  }, [logs]);

  // 伤害闪烁 + 飘字（记录血量变化量）
  const prevHp = useRef<Record<string, number>>({});
  const [flashMap, setFlashMap] = useState<Record<string, number>>({});
  useEffect(() => {
    const next: Record<string, number> = {};
    const hits: Record<string, number> = {};
    for (const p of game.players) {
      const before = prevHp.current[p.id];
      if (before !== undefined && p.hp < before && p.alive) hits[p.id] = before - p.hp;
      next[p.id] = p.hp;
    }
    prevHp.current = next;
    if (Object.keys(hits).length > 0) {
      setFlashMap(hits);
      const t = setTimeout(() => setFlashMap({}), 950);
      return () => clearTimeout(t);
    }
  }, [game]);

  // 角色详情弹层
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailPlayer = detailId ? game.players.find((p) => p.id === detailId) : null;
  // 胜负判定弹层（新对局自动复位）
  const [winDismissed, setWinDismissed] = useState(false);
  useEffect(() => { if (game.phase !== 'over') setWinDismissed(false); }, [game.phase]);
  // 局内发言
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const chat: { name: string; text: string; ts: number }[] = (lobby as unknown as { chat?: { name: string; text: string; ts: number }[] }).chat || [];
  useEffect(() => {
    if (chatLogRef.current) chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight;
  }, [chat.length, chatOpen]);
  async function sendChat() {
    const text = chatText.trim();
    if (!text) return;
    setChatText('');
    await net.chat(lobby.code, meId, myIds[0].token, text);
  }
  async function kickPlayer(targetId: string, name: string) {
    const r = await net.kick(lobby.code, meId, myIds[0].token, targetId) as { ok: boolean; error?: string };
    if (!r.ok) setActMsg(r.error || '踢人失败');
    else setDetailId(null);
  }

  // 当前行动者是否为我方身份
  const myTurnId = myIds.find((i) => i.playerId === game.currentActor);

  // 可选行动列表（基础 + 角色）
  const options: ActionOption[] = useMemo(() => {
    if (!me) return [];
    const cd = CHARACTERS[me.charId] || CHARACTERS['default'];
    const list: ActionOption[] = [
      { key: 'attack', label: '攻击', desc: `近战攻击同房间目标（伤害 ${atkOf(me)}）${cd.rangedCapable ? `；可远程${cd.rangedNeedsAim ? ((cd.aimExemptWhenDomain && me.char.domain === true) ? '（领域生效免瞄准）' : '（远程需先瞄准）') : '（默认免瞄准）'}` : ''}${cd.ignoreHide ? '；无视躲藏' : ''}`, typeLabel: '基础', targetHint: 'attack' },
      { key: 'move', label: '移动', desc: '移动到任意玩家的初始房间（移动后现身）', typeLabel: '基础', roomHint: true },
      { key: 'heal', label: '回复', desc: '回复至满血', typeLabel: '基础' },
      { key: 'milk', label: '喝牛奶', desc: '嘲讽，无实际作用', typeLabel: '基础' },
      { key: 'hide', label: '躲藏', desc: '指向性攻击无法锁定；AOE与无视躲避攻击仍可命中', typeLabel: '基础' },
    ];
    if (me.charId === 'chuixiao') list[0].desc = '仅能远程攻击异房间目标，伤害1；出手前需先「瞄准」目标';
    if (hiddenSameRoomCount(game, me.id) > 0) list.push({ key: 'seek', label: '找出来', desc: '找出同房间躲藏的玩家', typeLabel: '基础', targetHint: 'seek' });
    if (cd.rangedNeedsAim && !(cd.aimExemptWhenDomain && me.char.domain === true)) {
      list.push({ key: 'aim', label: '瞄准', desc: '锁定一名玩家（远程攻击前必须瞄准）', typeLabel: '基础', targetHint: 'aim' });
    }
    list.push({ key: 'skip', label: '跳过', desc: '不做任何事', typeLabel: '基础' });
    for (const a of cd.actions || []) {
      list.push({
        key: a.name, label: a.label, desc: a.desc, typeLabel: '技能',
        targetHint: a.targetHint, roomHint: a.roomHint,
      });
    }
    return list;
  }, [game, me]);

  // 选中行动的合法目标（客户端提示；服务器重新校验）
  const validTargets: SnapPlayer[] = useMemo(() => {
    if (!me || !selAction?.targetHint) return [];
    const others = game.players.filter((p) => p.alive && p.id !== me.id);
    const cd = CHARACTERS[me.charId] || CHARACTERS['default'];
    const hiddenOthers = others.filter((p) => p.room === me.room && (p.hidden || p.invisible));
    switch (selAction.targetHint) {
      case 'attack': {
        const sameRoom = others.filter((p) => p.room === me.room && (!p.hidden || cd.ignoreHide));
        const otherRoom = cd.rangedCapable ? others.filter((p) => p.room !== me.room && !p.hidden) : [];
        return [...sameRoom, ...otherRoom];
      }
      case 'aim': return others.filter((p) => !p.hidden && !p.invisible);
      case 'seek': return hiddenOthers;
      case 'sameRoomPlayer': return others.filter((p) => p.room === me.room);
      case 'anyPlayer': return others;
      case 'otherRoomPlayer': return others.filter((p) => p.room !== me.room);
      default: return [];
    }
  }, [game, me, selAction]);

  useEffect(() => { if (!selAction?.targetHint) setSelTarget(''); }, [selAction]);
  useEffect(() => { if (!selRoom && game.roomIds.length > 0) setSelRoom(game.roomIds[0]); }, [game.roomIds, selRoom]);

  function resetSelection() {
    setSelAction(null);
    setSelTarget('');
    setActMsg('');
  }

  async function confirmAction() {
    if (!selAction || !myTurnId) return;
    setActMsg('');
    const action: Record<string, unknown> = { type: selAction.key };
    const needTarget = !!selAction.targetHint;
    const needRoom = !!selAction.roomHint || selAction.key === 'move';
    if (needTarget) {
      if (!selTarget) { setActMsg('请先选择目标'); return; }
      action.targetId = selTarget;
    }
    if (needRoom) action.room = selRoom;
    if (selAction.key === 'attack' && validTargets.find((t) => t.id === selTarget)?.room !== me?.room) action.ranged = true;
    const r = await net.submitAction(lobby.code, myTurnId.playerId, myTurnId.token, action) as { ok: boolean; error?: string };
    if (!r.ok) { setActMsg(r.error || '行动失败'); return; }
    resetSelection();
  }

  function phaseText(): string {
    switch (game.phase) {
      case 'rps1': return `隐藏出拳 · 已提交 ${game.submittedIds.length}`;
      case 'act': return '行动阶段';
      case 'roundEnd': return '回合末结算';
      case 'over': return '游戏结束';
    }
  }

  const pendingLocalIds = myIds.filter((i) => game.players.find((p) => p.id === i.playerId)?.alive && !game.submittedIds.includes(i.playerId));

  return (
    <div className="tcg-app">
      <header className="tcg-header">
        <span className="tcg-logo">拔典</span>
        <span className="tcg-chip">房间 {lobby.code}</span>
        <span className="tcg-chip">第 <b>{game.roundNo}</b> 回合</span>
        <span className="tcg-chip hot">{phaseText()}</span>
        <span className="tcg-chip">存活 {game.aliveCount}</span>
        <span className="tcg-chip">种子 {game.seed}</span>
        <span style={{ flex: 1 }} />
        <button className="tcg-btn ghost" onClick={() => setChatOpen(true)}>💬 发言</button>
        {isHost && game.phase === 'over' && (
          <button className="tcg-btn" onClick={() => net.restart(lobby.code, meId, myIds[0].token)}>重新开始</button>
        )}
        <button className="tcg-btn ghost" onClick={async () => { await net.leave(lobby.code, meId, myIds[0].token); onExit(); }}>退出房间</button>
      </header>

      {game.phase === 'over' && !winDismissed && (
        <div className="win-overlay" onClick={() => setWinDismissed(true)}>
          <div className="win-modal anim-in" onClick={(e) => e.stopPropagation()}>
            {game.winner ? (
              <>
                <div className="win-title">🏆 胜 负 判 定</div>
                {(() => {
                  const wp = game.players.find((p) => p.id === game.winner);
                  const meta = wp ? cardMeta(wp.charId) : undefined;
                  return meta?.img ? <img className="win-art" src={meta.img} alt={wp?.charName} /> : null;
                })()}
                <h1 className="win-name">{game.players.find((p) => p.id === game.winner)?.name}</h1>
                <div className="win-sub">
                  使用「{game.players.find((p) => p.id === game.winner)?.charName}」 · HP {fmtHp(game.players.find((p) => p.id === game.winner)?.hp ?? 0)}
                </div>
              </>
            ) : (
              <>
                <div className="win-title">☠ 平 局</div>
                <h1 className="win-name">全员同时淘汰</h1>
              </>
            )}
            <div className="win-btns">
              {isHost && <button className="tcg-btn" onClick={() => { setWinDismissed(true); net.restart(lobby.code, meId, myIds[0].token); }}>🔄 再来一局</button>}
              <button className="tcg-btn ghost" onClick={async () => { setWinDismissed(true); await net.leave(lobby.code, meId, myIds[0].token); onExit(); }}>离开房间</button>
              <button className="tcg-btn ghost" onClick={() => setWinDismissed(true)}>查看战场</button>
            </div>
          </div>
        </div>
      )}
      {game.phase === 'over' && winDismissed && (
        <div className="winner-banner">
          {game.winner ? `🏆 ${game.players.find((p) => p.id === game.winner)?.name} 获胜！` : '☠ 平局 · 全员同时淘汰'}
        </div>
      )}

      <div className="tcg-main">
        <section className="battlefield anim-in">
          <div className="bf-turn">第 <b>{game.roundNo}</b> 回合 · {phaseText()}</div>
          <div className="zones">
            {game.roomIds.map((rid) => {
              const members = game.players.filter((p) => p.alive && p.room === rid);
              const hasActor = members.some((m) => m.id === game.currentActor);
              return (
                <div key={rid} className="zone" style={hasActor ? { borderColor: 'rgba(240,214,138,0.6)' } : undefined}>
                  <div className="zone-title">
                    <span>◈ {rid}</span>
                    <span className="zone-n">{members.length} 人{hasActor ? ' · 行动中' : ''}</span>
                  </div>
                  <div className="zone-cards">
                    {members.length === 0 && <div className="zone-empty">空 房 间</div>}
                    {members.map((p) => (
                      <CharCardView
                        key={p.id}
                        p={p}
                        game={game}
                        meId={meId}
                        isMine={myIds.some((i) => i.playerId === p.id)}
                        isTargetable={!!selAction?.targetHint && validTargets.some((t) => t.id === p.id)}
                        submitted={game.phase === 'rps1' && game.submittedIds.includes(p.id)}
                        flashDelta={flashMap[p.id]}
                        fx={actionFx[p.id]?.kind}
                        onClick={() => {
                          if (selAction?.targetHint && validTargets.some((t) => t.id === p.id)) {
                            setSelTarget(p.id);
                          } else {
                            setDetailId(p.id);
                          }
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="log-side">
          <LogPanel logs={logs} />
        </aside>

        <section className="action-dock anim-in">
          <div className="dock-title">
            ⚔ 行动坞
            {game.phase === 'act' && (
              myTurnId
                ? <span className="cbadge cbadge-acting">轮到 {myTurnId.name}</span>
                : <span className="tcg-chip">等待 {game.players.find((p) => p.id === game.currentActor)?.name || '?'} 行动…</span>
            )}
          </div>

          {game.phase === 'rps1' && (
            pendingLocalIds.length > 0
              ? <ThrowPrivacy myIds={pendingLocalIds} game={game} lobby={lobby} />
              : <div className="privacy-veil">✅ 本机身份全部提交完毕（已提交 {game.submittedIds.length} 人，拳种保密）…</div>
          )}

          {game.phase === 'act' && myTurnId && (
            <>
              <div className="scard-row">
                {options.map((o) => (
                  <button
                    key={o.key}
                    className={`scard ${selAction?.key === o.key ? 'selected' : ''}`}
                    onClick={() => { setSelAction(o); setActMsg(''); }}
                  >
                    <div className="scard-head">
                      <span className="scard-name">{o.label}</span>
                      <span className="scard-type">{o.typeLabel}</span>
                    </div>
                    <div className="scard-desc">{o.desc.length > 44 ? o.desc.slice(0, 44) + '…' : o.desc}</div>
                    <div className="scard-need">{o.targetHint ? '🎯 需选择目标' : o.roomHint ? '🗺️ 需选择房间' : o.key === 'milk' ? '🥛 嘲讽' : ''}</div>
                  </button>
                ))}
              </div>

              {selAction && (
                <div className="confirm-bar">
                  <span>已选 <b>【{selAction.label}】</b></span>
                  {selAction.targetHint && (
                    <span>
                      目标：
                      <b className="cb-target">
                        {selTarget ? game.players.find((p) => p.id === selTarget)?.name : '（点击战场高亮卡牌）'}
                      </b>
                    </span>
                  )}
                  {(selAction.roomHint || selAction.key === 'move') && (
                    <select value={selRoom} onChange={(e) => setSelRoom(e.target.value)}>
                      {game.roomIds.map((r) => (
                        <option key={r} value={r}>
                          {r}（{game.players.filter((p) => p.alive && p.room === r).map((p) => p.name).join('、') || '空'}）
                        </option>
                      ))}
                    </select>
                  )}
                  <button className="tcg-btn" disabled={!!selAction.targetHint && !selTarget} onClick={confirmAction}>确认发动</button>
                  <button className="tcg-btn ghost" onClick={resetSelection}>取消</button>
                  {actMsg && <span className="error-text">{actMsg}</span>}
                </div>
              )}
              {!selAction && <div className="confirm-bar" style={{ borderColor: 'rgba(216,176,74,0.3)', background: 'rgba(216,176,74,0.05)' }}>
                <span className="tcg-chip">🃏 点击下方卡牌选择行动；需要目标时，战场上的可选目标会发绿光</span>
              </div>}
            </>
          )}

          {game.phase === 'act' && !myTurnId && (
            <div className="privacy-veil">
              ⏳ <b>{game.players.find((p) => p.id === game.currentActor)?.name}</b> 正在行动…
              <div style={{ textAlign: 'left', marginTop: 8 }}>
                {game.queue.map((pid, i) => {
                  const p = game.players.find((x) => x.id === pid);
                  if (!p) return null;
                  return <span key={pid} className="tcg-chip" style={{ margin: 2, opacity: i < game.actIndex ? 0.45 : 1 }}>{p.name}</span>;
                })}
              </div>
            </div>
          )}

          {game.phase === 'roundEnd' && <div className="privacy-veil">💥 回合末结算中（延迟事件）…</div>}
          {game.phase === 'over' && (
            <div className="privacy-veil">
              🏁 对局结束
              <div style={{ marginTop: 8 }}>
                <button className="tcg-btn ghost" onClick={onExit}>返回大厅</button>
              </div>
            </div>
          )}
        </section>
      </div>

      {detailPlayer && (
        <CardDetail
          p={detailPlayer}
          onClose={() => setDetailId(null)}
          canKick={isHost && detailPlayer.id !== meId && detailPlayer.alive}
          onKick={() => kickPlayer(detailPlayer.id, detailPlayer.name)}
        />
      )}

      {chatOpen && (
        <div className="card-detail" onClick={() => setChatOpen(false)}>
          <div className="card-detail-inner chat-modal" onClick={(e) => e.stopPropagation()}>
            <h3>💬 局内发言</h3>
            <div className="chat-box">
              <div className="chat-log" ref={chatLogRef}>
                {chat.length === 0 && <div className="muted">还没有发言，来一句嘲讽吧</div>}
                {chat.map((m, i) => (
                  <div key={i} className="chat-line"><b>{m.name}</b>：{m.text}</div>
                ))}
              </div>
              <div className="chat-input-row">
                <input
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }}
                  placeholder="输入发言…"
                  maxLength={200}
                />
                <button className="tcg-btn" onClick={sendChat}>发送</button>
              </div>
            </div>
            <button className="tcg-btn" style={{ marginTop: 12, width: '100%' }} onClick={() => setChatOpen(false)}>关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}

function hiddenSameRoomCount(game: GameSnapshot, meId: string): number {
  const me = game.players.find((p) => p.id === meId);
  if (!me) return 0;
  return game.players.filter((p) => p.alive && p.id !== meId && p.room === me.room && p.hidden).length;
}

// ── 角色卡（游戏王风卡面 + 动态数据） ─────────────────────

const FX_ICON: Record<string, string> = { attack: '⚔️', heal: '💊', move: '🚶', milk: '🥛', skill: '✨' };

function CharCardView({ p, game, meId, isMine, isTargetable, submitted, flashDelta, fx, onClick }: {
  p: SnapPlayer;
  game: GameSnapshot;
  meId: string;
  isMine: boolean;
  isTargetable: boolean;
  submitted: boolean;
  flashDelta?: number;
  fx?: string;
  onClick: () => void;
}) {
  const meta = cardMeta(p.charId);
  const acting = game.currentActor === p.id;
  const dead = !p.alive;
  const cls = [
    'ccard',
    dead ? 'is-dead' : '',
    acting && !dead ? 'is-acting' : '',
    isTargetable ? 'is-targetable clickable' : '',
    isMine ? 'is-mine' : '',
    flashDelta !== undefined ? 'flash-dmg' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} onClick={onClick} title={`${p.name} · ${p.charName}（点击查看卡牌详情）`}>
      <div className="ccard-frame">
        <div className="ccard-art">
          {meta?.img ? <img src={meta.img} alt={p.charName} /> : <div className="ccard-art-ph">拔</div>}
        </div>
        <div className="ccard-plate">
          <span className="ccard-name">{p.name}</span>
          <span className="ccard-no">{meta?.no || '--'}</span>
        </div>
        <div className="ccard-stats">
          <span className="ccard-hp">❤ {fmtHp(p.hp)}/{fmtHp(p.maxHp)}</span>
          <span className="ccard-atk">⚔ {atkOf(p)}</span>
        </div>
      </div>
      <div className="ccard-badges">
        {acting && !dead && <span className="cbadge cbadge-acting">行动中</span>}
        {isMine && <span className="cbadge cbadge-mine">我</span>}
        {submitted && !dead && <span className="cbadge cbadge-submitted">已出拳</span>}
        {p.hidden && !dead && <span className="cbadge cbadge-hide">🙈 躲藏</span>}
        {p.invisible && !dead && <span className="cbadge cbadge-hide">👻 隐身</span>}
      </div>
      {flashDelta !== undefined && !dead && (
        <span className="dmg-float">-{fmtHp(flashDelta)}</span>
      )}
      {fx && !dead && (
        <span className={`fx-anim fx-${fx}`} key={`${p.id}-${fx}`}>
          <span className="fx-icon">{FX_ICON[fx] || '✨'}</span>
        </span>
      )}
    </div>
  );
}

// ── 卡牌详情弹层 ─────────────────────────────────────────

function CardDetail({ p, onClose, canKick, onKick }: { p: SnapPlayer; onClose: () => void; canKick?: boolean; onKick?: () => void }) {
  const meta = cardMeta(p.charId);
  return (
    <div className="card-detail" onClick={onClose}>
      <div className="card-detail-inner" onClick={(e) => e.stopPropagation()}>
        {meta?.img && <img src={meta.img} alt={p.charName} />}
        <h3>{meta ? `No.${meta.no} · ${p.charName}` : p.charName}</h3>
        <div className="cd-skills">{meta?.skills || '无特殊技能'}</div>
        <div className="cd-mech">{meta?.mech || '无被动（原稿：未选上角色者默认此角色）。血量3，攻击1。'}</div>
        {meta?.quote && <div className="cd-quote">「{meta.quote}」</div>}
        <div style={{ marginTop: 12, fontSize: 13, color: '#6b5a3a' }}>
          当前状态：HP {fmtHp(p.hp)}/{fmtHp(p.maxHp)} · 房间 {p.room} · {p.alive ? (p.hidden ? '躲藏中' : p.invisible ? '隐身中' : '存活') : '已淘汰'}
        </div>
        <button className="tcg-btn" style={{ marginTop: 12, width: '100%' }} onClick={onClose}>关闭</button>
        {canKick && onKick && (
          <button className="tcg-btn danger" style={{ marginTop: 8, width: '100%' }} onClick={onKick}>⚖ 房主踢出该玩家</button>
        )}
      </div>
    </div>
  );
}

// ── 隐藏出拳（交设备遮罩，卡背式选择） ────────────────────

function ThrowPrivacy({ myIds, game, lobby }: {
  myIds: { playerId: string; name: string; token: string }[];
  game: GameSnapshot;
  lobby: LobbyState;
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [error, setError] = useState('');

  if (activeIdx === null) {
    return (
      <div className="privacy-veil">
        <p>🎲 隐藏出拳阶段 — 以下身份还未出拳</p>
        <div style={{ margin: '8px 0', display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {myIds.map((i) => <span key={i.playerId} className="pv-name" style={{ fontSize: 14 }}>{i.name}</span>)}
        </div>
        <p className="tcg-chip" style={{ display: 'inline-block' }}>为防止偷看，请依次传递设备，由本人亲自出拳</p>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {myIds.map((i, idx) => (
            <button key={i.playerId} className="tcg-btn" onClick={() => setActiveIdx(idx)}>
              我是 {i.name}，开始出拳
            </button>
          ))}
        </div>
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
    <div className="privacy-veil">
      <p>请 <span className="pv-name">{me.name}</span> 出拳（{p?.charName} · 房间 {p?.room}）</p>
      <div className="throw-row">
        {(['rock', 'scissors', 'paper'] as const).map((t) => (
          <button key={t} className="throw-card" onClick={() => throwIt(t)}>
            {THROW_ICON[t]}
            <small>{THROW_LABEL[t]}</small>
          </button>
        ))}
      </div>
      {error && <div className="error-text">{error}</div>}
      <button className="tcg-btn ghost" onClick={() => setActiveIdx(null)}>返回（暂不出拳）</button>
    </div>
  );
}

// ── 日志面板 ─────────────────────────────────────────────

function LogPanel({ logs }: { logs: { seq: number; text: string; important?: boolean; type?: string; data?: Record<string, unknown> }[] }) {
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
        </div>
      </div>
      <div className="log-scroll">
        {shown.slice().reverse().map((l) => (
          <div key={l.seq} className={`log-line ${l.important ? 'imp' : 'dim'}`}>
            <span className="log-icon">{ICON[l.type] || '·'}</span>{l.text}
          </div>
        ))}
      </div>
    </>
  );
}
