import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  net, type LobbyState, type GameSnapshot, type SnapPlayer, type RevealInfo,
  type PlayerStats, type InteractionEvent, type InteractionKind,
} from '../net.js';
import type { SessionInfo } from '../App.js';
import { CHARACTERS } from '../../../shared/src/characters/index.js';
import { cardMeta } from '../cards.js';
import ReplayViewer from './Replay.js';
import {
  useBattlePresentation,
  type FxView, type HitView, type HealView, type DeathView, type ReviveView,
} from '../battle/useBattlePresentation.js';
import { sfx } from '../audio/sfx.js';

const THROW_LABEL: Record<string, string> = { rock: '石头', scissors: '剪刀', paper: '布' };
const THROW_ICON: Record<string, string> = { rock: '✊', scissors: '✌️', paper: '✋' };
const AI_LABEL: Record<string, string> = { easy: '休闲', normal: '普通', hard: '硬核' };
const INTERACT_ICON: Record<InteractionKind, string> = { tomato: '🍅', egg: '🥚', flower: '🌹' };
const INTERACT_NAME: Record<InteractionKind, string> = { tomato: '丢番茄', egg: '丢鸡蛋', flower: '献花' };

interface ActionOption {
  key: string;
  label: string;
  desc: string;
  typeLabel: string;
  targetHint?: string;
  roomHint?: boolean;
}

export default function GamePage({ lobby, game, session, logs, onExit, onBackToLobby }: {
  lobby: LobbyState;
  game: GameSnapshot | null;
  session: SessionInfo;
  logs: { seq: number; text: string; important?: boolean; type?: string; data?: Record<string, unknown> }[];
  onExit: () => void;
  /** 对局结束后返回房间大厅（房间仍保留） */
  onBackToLobby?: () => void;
}) {
  if (!game) return <div className="tcg-app"><div className="tcg-panel" style={{ margin: 20 }}>等待游戏状态…</div></div>;
  return <GameInner lobby={lobby} game={game} session={session} logs={logs} onExit={onExit} onBackToLobby={onBackToLobby} />;
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

function GameInner({ lobby, game, session, logs, onExit, onBackToLobby }: {
  lobby: LobbyState;
  game: GameSnapshot;
  session: SessionInfo;
  logs: { seq: number; text: string; important?: boolean; type?: string; data?: Record<string, unknown> }[];
  onExit: () => void;
  onBackToLobby?: () => void;
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

  // 战绩面板 / 回放
  const [statsOpen, setStatsOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayId, setReplayId] = useState<string | null>(null);
  /**
   * 回放功能（录制 + 播放器）已实现但**暂不启用**：不发布、不纳入本次改动范围。
   * 置为 true 即可恢复入口（服务端录制逻辑保持原样，历史回放数据不受影响）。
   */
  const REPLAY_ENABLED = false;

  // 横屏紧凑模式：牌桌占满一屏，战斗日志改为抽屉、发言默认收起
  const compact = useCompactLandscape();
  const narrow = useNarrowScreen();
  const [logOpen, setLogOpen] = useState(!compact && !narrow);
  const [chatOpen, setChatOpen] = useState(!compact && !narrow);
  useEffect(() => { setLogOpen(!compact && !narrow); setChatOpen(!compact && !narrow); }, [compact, narrow]);

  // 局内小互动（丢番茄等）
  const interactions = lobby.interactions ?? [];
  const interactCounts = lobby.interactionCounts ?? {};
  const interactBusy = useRef(false);
  async function throwAt(targetId: string, kind: InteractionKind) {
    if (interactBusy.current) return;
    interactBusy.current = true;
    const r = await net.interact(lobby.code, meId, myIds[0].token, targetId, kind) as { ok: boolean; error?: string };
    if (!r.ok) setActMsg(r.error || '互动失败');
    setTimeout(() => { interactBusy.current = false; }, 400);
  }

  // ── 战斗演出（BattleEventQueue）：全部由服务端结构化事件驱动，
  //    不再用快照 HP 差分猜测伤害；快照仍是显示权威，叠加层只做视觉。 ──
  const { pres, queue: queueState, api: presApi } = useBattlePresentation(logs, lobby.gameNo);
  const reducedMotion = useReducedMotion();
  // 移动演出的 FLIP 卡片飞行动画（跟随快照房间变化，不依赖队列时序）
  useCardRoomFlip(game.players, reducedMotion);

  // 角色详情弹层
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailPlayer = detailId ? game.players.find((p) => p.id === detailId) : null;
  // 胜负判定弹层（新对局自动复位）
  const [winDismissed, setWinDismissed] = useState(false);
  useEffect(() => { if (game.phase !== 'over') setWinDismissed(false); }, [game.phase]);
  // 终局音效：胜利短琶音（平局不播；静音/无 WebAudio 环境自动静默）
  const prevPhase = useRef(game.phase);
  useEffect(() => {
    if (game.phase === 'over' && prevPhase.current !== 'over' && game.winner) sfx.play('victory', { major: true });
    prevPhase.current = game.phase;
  }, [game.phase, game.winner]);
  // 音效开关（localStorage 持久化）
  const [sfxMuted, setSfxMuted] = useState(sfx.isMuted());
  // 局内发言（底部常驻面板，实时显示）
  const [chatText, setChatText] = useState('');
  const chat: { name: string; text: string; ts: number }[] = (lobby as unknown as { chat?: { name: string; text: string; ts: number }[] }).chat || [];
  async function sendChat() {
    const text = chatText.trim();
    if (!text) return;
    setChatText('');
    await net.chat(lobby.code, meId, myIds[0].token, text);
  }
  async function kickPlayer(targetId: string, name: string) {
    const r = await net.kick(lobby.code, meId, myIds[0].token, targetId) as { ok: boolean; error?: string };
    if (!r.ok) setActMsg(r.error || `踢出 ${name} 失败`);
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
    if (me.charId === 'chuixiao') list[0].desc = '仅能远程攻击异房间目标（伤害1），无需瞄准；无法近战';
    if (hiddenSameRoomCount(game, me.id) > 0) list.push({ key: 'seek', label: '找出来', desc: '找出同房间躲藏的玩家', typeLabel: '基础', targetHint: 'seek' });
    if (cd.rangedNeedsAim && !(cd.aimExemptWhenDomain && me.char.domain === true)) {
      list.push({ key: 'aim', label: '瞄准', desc: '锁定一名玩家（远程攻击前必须瞄准）', typeLabel: '基础', targetHint: 'aim' });
    }
    list.push({ key: 'skip', label: '跳过', desc: '不做任何事', typeLabel: '基础' });
    for (const a of cd.actions || []) {
      list.push({
        key: a.name, label: a.label, desc: a.desc, typeLabel: '技能',
        // 'none' 表示自身技能（领域展开 / 抽取今日运势 / 强化攻击等）：不选目标、不设房间，直接确认发动
        targetHint: a.targetHint && a.targetHint !== 'none' ? a.targetHint : undefined,
        roomHint: a.roomHint,
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
        const at = cd.attackType || 'both';
        const meleeOk = at !== 'ranged' && at !== 'none';
        const rangedOk = !!cd.rangedCapable && at !== 'none';
        const sameRoom = meleeOk ? others.filter((p) => p.room === me.room && (!p.hidden || cd.ignoreHide)) : [];
        const otherRoom = rangedOk ? others.filter((p) => p.room !== me.room && !p.hidden) : [];
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
  const opponents = game.players.filter((p) => p.id !== meId);
  const livingCount = game.players.filter((p) => p.alive).length;

  function pickTargetOrDetail(pid: string) {
    if (selAction?.targetHint && validTargets.some((t) => t.id === pid)) setSelTarget(pid);
    else setDetailId(pid);
  }

  return (
    <div className="tcg-app has-chat">
      <header className="tcg-header">
        <span className="tcg-logo">拔典</span>
        <span className="tcg-chip hide-sm">房间 {lobby.code}</span>
        <span className="tcg-chip">第 <b>{game.roundNo}</b> 回合</span>
        <span className="tcg-chip hot">{phaseText()}</span>
        <span className="tcg-chip">存活 {game.aliveCount}</span>
        {lobby.seats.some((s) => s.type === 'ai') && (
          <span className="tcg-chip" title="AI 难度（房主可在房间里调整）">
            🤖 AI {AI_LABEL[lobby.aiDifficulty || 'normal']}
          </span>
        )}
        <span className="tcg-chip hide-sm">种子 {game.seed}</span>
        <span style={{ flex: 1 }} />
        <button
          className={`tcg-btn ghost tiny ${sfxMuted ? 'off' : ''}`}
          title={sfxMuted ? '开启音效' : '关闭音效'}
          onClick={() => {
            const next = !sfxMuted;
            setSfxMuted(next);
            sfx.setMuted(next);
            if (!next) sfx.play('heal', { major: true }); // 开启时给一个确认反馈音
          }}
        >{sfxMuted ? '🔇' : '🔊'}</button>
        <button className="tcg-btn ghost tiny" onClick={() => setStatsOpen(true)}>📊 战绩</button>
        <button className={`tcg-btn ghost tiny ${logOpen ? '' : 'off'}`} onClick={() => setLogOpen((v) => !v)}>
          📜 日志
        </button>
        <button className={`tcg-btn ghost tiny ${chatOpen ? '' : 'off'}`} onClick={() => setChatOpen((v) => !v)}>
          💬 发言{chat.length > 0 ? `（${chat.length}）` : ''}
        </button>
        {REPLAY_ENABLED && (
          <button className="tcg-btn ghost tiny" onClick={() => { setReplayId(lobby.replays?.[0]?.id ?? null); setReplayOpen(true); }}>🎬 回放</button>
        )}
        {isHost && game.phase === 'over' && (
          <button className="tcg-btn" onClick={() => net.restart(lobby.code, meId, myIds[0].token)}>重新开始</button>
        )}
        <button className="tcg-btn ghost" onClick={onExit}>退出房间</button>
      </header>

      {game.phase === 'over' && !winDismissed && (
        <div className="win-overlay" onClick={() => setWinDismissed(true)}>
          <div className={`win-modal anim-in ${game.winner ? '' : 'draw'}`} onClick={(e) => e.stopPropagation()}>
            {game.winner ? (
              <>
                {/* 终局舞台：聚光 + 一次性金色光屑（不常驻、reduced-motion 降级为静态） */}
                <span className="win-rays" aria-hidden />
                <span className="win-particles" aria-hidden>
                  {Array.from({ length: 12 }, (_, i) => (
                    <i key={i} style={{ ['--i' as string]: String(i) } as React.CSSProperties} />
                  ))}
                </span>
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
                <div className="win-summary">
                  第 {game.roundNo} 回合终局 · {game.players.length - game.aliveCount}/{game.players.length} 人出局 · 最后存活 {game.aliveCount} 人
                </div>
              </>
            ) : (
              <>
                <div className="win-title">☠ 平 局</div>
                <h1 className="win-name">全员同时淘汰</h1>
                <div className="win-summary">第 {game.roundNo} 回合终局 · 无人幸存</div>
              </>
            )}
            <div className="win-btns">
              {isHost && <button className="tcg-btn" onClick={() => { setWinDismissed(true); net.restart(lobby.code, meId, myIds[0].token); }}>🔄 再来一局</button>}
              {REPLAY_ENABLED && (
                <button className="tcg-btn ghost" onClick={() => { setReplayId(lobby.replays?.[0]?.id ?? null); setReplayOpen(true); }}>🎬 观看回放</button>
              )}
              <button className="tcg-btn ghost" onClick={() => { setWinDismissed(true); setStatsOpen(true); }}>📊 本局战绩</button>
              <button className="tcg-btn ghost" onClick={onExit}>离开房间</button>
              <button className="tcg-btn ghost" onClick={() => setWinDismissed(true)}>查看战场</button>
            </div>
          </div>
        </div>
      )}
      {game.phase === 'over' && winDismissed && (
        <div className="winner-banner">
          {game.winner
            ? <>🏆 <b>{game.players.find((p) => p.id === game.winner)?.name}</b> 获胜 · 使用「{game.players.find((p) => p.id === game.winner)?.charName}」 · 第 {game.roundNo} 回合终局</>
            : '☠ 平局 · 全员同时淘汰'}
        </div>
      )}

      <div className={`tcg-main ${logOpen ? '' : 'no-log'}`}>
        {/* ── 牌桌（斗地主式：上方对手座位 / 中央牌桌 / 下方我的手牌） ── */}
        <section className={`battlefield ddz-table anim-in ${game.phase === 'over' ? 'is-over' : ''}`}>
          <div className="bf-turn">第 <b>{game.roundNo}</b> 回合 · {phaseText()}</div>

          {/* 大伊万投掷物飞行层 */}
          <IvanProjectile throwView={pres.ivanThrow} game={game} />

          {/* 演出控制：仅在演出进行中浮现；终局后不再显示（避免「对局结束了还在播演出」的错觉） */}
          {game.phase !== 'over' && (queueState.playing || queueState.depth > 0) && (
            <div className="battle-ctl" data-testid="battle-ctl">
              <span className="bc-depth">🎬 {queueState.depth}</span>
              {[1, 2, 4].map((s) => (
                <button
                  key={s}
                  className={`bc-btn ${queueState.speed === s ? 'on' : ''}`}
                  onClick={() => presApi.setSpeed(s as 1 | 2 | 4)}
                >{s}×</button>
              ))}
              <button className="bc-btn" onClick={presApi.skipCurrent}>⏭ 跳过本段</button>
              <button className="bc-btn" onClick={presApi.skipAll}>⏹ 全部跳过</button>
            </div>
          )}

          <div className="ddz-opponents">
            {opponents.length === 0 && <div className="ddz-empty">等待其他玩家入座…</div>}
            {opponents.map((p) => (
              <SeatChip
                key={p.id}
                p={p}
                game={game}
                acting={game.currentActor === p.id}
                mine={myIds.some((i) => i.playerId === p.id)}
                submitted={game.phase === 'rps1' && game.submittedIds.includes(p.id)}
                throwView={throwViewOf(game, p.id)}
                targetable={!!selAction?.targetHint && validTargets.some((t) => t.id === p.id)}
                hit={pres.hits[p.id]}
                gotCount={interactCounts[p.id]?.got ?? 0}
                onInteract={game.phase !== 'over' ? () => throwAt(p.id, 'tomato') : undefined}
                onClick={() => pickTargetOrDetail(p.id)}
              />
            ))}
          </div>

          <div className="ddz-center">
            <RevealBoard game={game} />
            {pres.moveBanner && (
              <div className="move-banner" key={pres.moveBanner.key}>
                🚶 <b>{game.players.find((p) => p.id === pres.moveBanner?.pid)?.name || '?'}</b>
                &nbsp;{pres.moveBanner.from} → {pres.moveBanner.to}
              </div>
            )}
            <div className="zones">
              {game.roomIds.map((rid) => {
                // 淘汰演出窗口内保留死亡卡位（动画播完后自然移出桌面，座位区仍有灰化标识）
                const members = game.players.filter((p) => (p.alive || pres.deaths[p.id]) && p.room === rid);
                const hasActor = members.some((m) => m.id === game.currentActor);
                const alertHere = pres.zoneAlert?.room === rid;
                const moveHere = pres.moveBanner?.to === rid;
                const boomHere = pres.ivanBoom?.room === rid;
                // 待爆警示（快照 deferred 驱动：真实游戏状态，非装饰）
                const pendingIvan = game.deferred?.find((d) => d.kind === 'ivan' && d.room === rid);
                const isWinnerRoom = game.phase === 'over' && game.winner && members.some((m) => m.id === game.winner);
                return (
                  <div
                    key={rid}
                    data-room={rid}
                    className={`zone ${hasActor ? 'zone-acting' : ''} ${alertHere ? `zone-alert zone-alert-${pres.zoneAlert?.kind}` : ''} ${moveHere ? 'zone-move' : ''} ${boomHere ? 'zone-boom' : ''} ${pendingIvan ? 'zone-pending-ivan' : ''} ${isWinnerRoom ? 'zone-winner' : ''}`}
                  >
                    <div className="zone-title">
                      <span>◈ {rid}</span>
                      <span className="zone-n">
                        {members.length > 0 ? `${members.length} 人${hasActor ? ' · 行动中' : ''}` : '空房间'}
                      </span>
                    </div>
                    <div className="zone-cards">
                      {members.length === 0 && <div className="zone-empty">{pendingIvan ? '💣 待爆炸' : '空房间'}</div>}
                      {members.map((p) => (
                        <CharCardView
                          key={p.id}
                          p={p}
                          game={game}
                          isMine={myIds.some((i) => i.playerId === p.id)}
                          isTargetable={!!selAction?.targetHint && validTargets.some((t) => t.id === p.id)}
                          submitted={game.phase === 'rps1' && game.submittedIds.includes(p.id)}
                          throwView={throwViewOf(game, p.id)}
                          fx={pres.fx[p.id]}
                          hit={pres.hits[p.id]}
                          heal={pres.heals[p.id]}
                          miss={pres.misses[p.id]}
                          death={pres.deaths[p.id]}
                          revive={pres.revives[p.id]}
                          isWinner={game.phase === 'over' && game.winner === p.id}
                          onClick={() => pickTargetOrDetail(p.id)}
                        />
                      ))}
                    </div>
                    {pendingIvan && (
                      <span className="ivan-pending" title={`大伊万将在第 ${pendingIvan.explodeRound} 回合末爆炸`}>
                        💣 第 {pendingIvan.explodeRound} 回合末爆炸
                      </span>
                    )}
                    {boomHere && <span key={pres.ivanBoom?.key} className="ivan-boom-fx" aria-hidden />}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <aside className={`log-side ${logOpen ? 'log-open' : 'log-closed'}`}>
          <LogPanel logs={logs} />
        </aside>

        {/* ── 我的席位 + 手牌 ── */}
        <section className="action-dock ddz-hand anim-in">
          <div className="hand-layout">
            <MySeat p={me} isHost={isHost} acting={game.currentActor === meId} throwView={me ? throwViewOf(game, me.id) : null} hit={pres.hits[meId]} />
            <div className="hand-main">
              <div className="dock-title">
                ⚔ 行动坞 · 手牌
                {game.phase === 'act' && (
                  myTurnId
                    ? <span className="cbadge cbadge-acting">轮到 {myTurnId.name}</span>
                    : <span className="tcg-chip">等待 {game.players.find((p) => p.id === game.currentActor)?.name || '?'} 行动…</span>
                )}
                {game.phase === 'rps1' && <span className="tcg-chip">存活 {livingCount} 人 · 全员出拳后统一揭示</span>}
              </div>

              {game.phase === 'rps1' && (
                pendingLocalIds.length > 0
                  ? <ThrowPrivacy myIds={pendingLocalIds} game={game} lobby={lobby} />
                  : <div className="privacy-veil">✅ 本机身份全部提交完毕（已提交 {game.submittedIds.length} 人，拳种保密）…</div>
              )}

              {game.phase === 'act' && myTurnId && (
                <>
                  {(() => {
                    const cur = myIds.find((i) => i.playerId === myTurnId.playerId);
                    const p = cur ? game.players.find((x) => x.id === cur.playerId) : null;
                    if (!p) return null;
                    const cd = CHARACTERS[p.charId] || CHARACTERS['default'];
                    if (!cd.rangedNeedsAim) return null;
                    const exempt = cd.aimExemptWhenDomain && p.char.domain === true;
                    const aimId = p.char.aim as string | undefined;
                    const aimName = aimId ? game.players.find((x) => x.id === aimId)?.name : null;
                    return (
                      <div className={`aim-bar ${exempt || aimName ? 'ok' : 'need'}`}>
                        {exempt
                          ? '✨ 领域生效：远程攻击免瞄准'
                          : aimName
                            ? `🎯 当前瞄准：${aimName}（远程攻击将消耗瞄准）`
                            : '🎯 该角色远程攻击需先瞄准：选「瞄准」卡锁定目标，下回合再攻击'}
                      </div>
                    );
                  })()}
                  <div className="scard-row hand-fan">
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
                      {(() => {
                        if (selAction.key !== 'attack' || !selTarget || !me) return null;
                        const cd = CHARACTERS[me.charId] || CHARACTERS['default'];
                        const tgt = game.players.find((x) => x.id === selTarget);
                        if (!tgt || !cd.rangedNeedsAim || tgt.room === me.room) return null;
                        if (cd.aimExemptWhenDomain && me.char.domain === true) return null;
                        if (me.char.aim === selTarget) return null;
                        return (
                          <span className="aim-warn">⚠ 远程攻击需先瞄准
                            <button className="tcg-btn" style={{ padding: '3px 10px', fontSize: 12, marginLeft: 6 }}
                              onClick={async () => {
                                const r = await net.submitAction(lobby.code, myTurnId!.playerId, myTurnId!.token, { type: 'aim', targetId: selTarget }) as { ok: boolean; error?: string };
                                if (!r.ok) setActMsg(r.error || '瞄准失败'); else resetSelection();
                              }}>一键瞄准该目标</button>
                          </span>
                        );
                      })()}
                      <button className="tcg-btn" disabled={!!selAction.targetHint && !selTarget} onClick={confirmAction}>确认发动</button>
                      <button className="tcg-btn ghost" onClick={resetSelection}>取消</button>
                      {actMsg && <span className="error-text">{actMsg}</span>}
                    </div>
                  )}
                  {!selAction && <div className="confirm-bar soft">
                    <span className="tcg-chip">🃏 点击下方手牌选择行动；需要目标时，战场上的可选目标会发绿光</span>
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
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {onBackToLobby && <button className="tcg-btn" onClick={onBackToLobby}>返回房间大厅</button>}
                    <button className="tcg-btn ghost" onClick={onExit}>退出房间</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {detailPlayer && (
        <CardDetail
          p={detailPlayer}
          onClose={() => setDetailId(null)}
          canKick={isHost && detailPlayer.id !== meId && detailPlayer.alive}
          onKick={() => kickPlayer(detailPlayer.id, detailPlayer.name)}
          stats={game.stats?.[detailPlayer.id]}
          gotCount={interactCounts[detailPlayer.id]?.got ?? 0}
          onInteract={game.phase !== 'over' && detailPlayer.alive && detailPlayer.id !== meId
            ? (kind) => throwAt(detailPlayer.id, kind)
            : undefined}
        />
      )}

      <InteractFx interactions={interactions} />

      {statsOpen && (
        <StatsPanel
          game={game}
          meId={meId}
          counts={interactCounts}
          onClose={() => setStatsOpen(false)}
        />
      )}

      {replayOpen && (
        <ReplayViewer
          code={lobby.code}
          autoOpenId={replayId}
          onClose={() => setReplayOpen(false)}
        />
      )}

      {chatOpen && (
        <ChatDock
          chat={chat}
          chatText={chatText}
          setChatText={setChatText}
          onSend={sendChat}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  );
}

/** 底部常驻局内发言（实时滚动；横屏默认收起，由顶栏「💬 发言」展开） */
function ChatDock({ chat, chatText, setChatText, onSend, onClose }: {
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

function hiddenSameRoomCount(game: GameSnapshot, meId: string): number {
  const me = game.players.find((p) => p.id === meId);
  if (!me) return 0;
  return game.players.filter((p) => p.alive && p.id !== meId && p.room === me.room && p.hidden).length;
}

// ── 出拳揭示数据 ─────────────────────────────────────────

export interface ThrowView {
  t: string;
  result: 'win' | 'lose' | 'tie';
}

/** 该玩家在「最近一次已揭示子轮」中的出拳与胜负结果；提交阶段返回 null（不泄露） */
function throwViewOf(game: GameSnapshot, pid: string): ThrowView | null {
  const rv: RevealInfo | null | undefined = game.reveal;
  if (!rv || !rv.throws[pid]) return null;
  const result: ThrowView['result'] = rv.winners.includes(pid) ? 'win' : rv.losers.includes(pid) ? 'lose' : 'tie';
  return { t: rv.throws[pid], result };
}

function namesOf(game: GameSnapshot, ids: string[]): string {
  return ids.map((id) => game.players.find((p) => p.id === id)?.name || '?').join('、');
}

function verdictText(game: GameSnapshot, rv: RevealInfo): string {
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

function RevealBoard({ game }: { game: GameSnapshot }) {
  const rv: RevealInfo | null = game.reveal ?? null;
  const alive = game.players.filter((p) => p.alive);
  const submitted = game.submittedIds;
  const waiting = game.phase === 'rps1';
  const submittedCount = alive.filter((p) => submitted.includes(p.id)).length;
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
      </div>
    );
  }

  return (
    <div className={`reveal-board ${rv ? 'has-reveal' : ''}`}>
      <div className="rb-head">
        <span className="rb-title">🎴 出拳揭示</span>
        {waiting ? (
          <span className="rb-stat">已出拳 {submittedCount}/{alive.length}（提交期间保密）</span>
        ) : rv ? (
          <span className="rb-stat">{rv.stage === 'rps1' ? '初次判定' : `排序判定 · 子轮 ${rv.sub}`}</span>
        ) : (
          <span className="rb-stat">等待判定</span>
        )}
      </div>

      {waiting && (
        <div className="rb-waiting">
          {alive.map((p) => {
            const ok = submitted.includes(p.id);
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

// ── 对手座位（斗地主式顶部座位条） ─────────────────────

function SeatChip({ p, game, acting, mine, submitted, throwView, targetable, hit, gotCount, onInteract, onClick }: {
  p: SnapPlayer;
  game: GameSnapshot;
  acting: boolean;
  mine: boolean;
  submitted: boolean;
  throwView: ThrowView | null;
  targetable: boolean;
  hit?: HitView;
  gotCount?: number;
  onInteract?: () => void;
  onClick: () => void;
}) {
  const meta = cardMeta(p.charId);
  const dead = !p.alive;
  const cls = [
    'seat',
    dead ? 'is-dead' : '',
    acting ? 'is-acting' : '',
    targetable ? 'is-targetable' : '',
    !dead && throwView ? `has-throw rv-${throwView.result}` : '',
    hit ? 'seat-hit' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls} data-pid={p.id} onClick={onClick} title={`${p.name} · ${p.charName}`}>
      <div className="seat-avatar">
        {meta?.img ? <img src={meta.img} alt={p.charName} /> : <span className="seat-ph">拔</span>}
        {throwView && (
          <span className={`seat-throw t-${throwView.t}`} title={`出了${THROW_LABEL[throwView.t]}`}>
            {THROW_ICON[throwView.t]}
          </span>
        )}
        {!throwView && submitted && !dead && <span className="seat-throw pending" title="已出拳（保密）">🎴</span>}
        {!!gotCount && <span className="seat-got" title={`被丢了 ${gotCount} 次`}>🍅{gotCount}</span>}
        {!dead && p.char?.domain === true && (
          <span className="seat-domain" title="领域生效中（判定平局算其胜）">✨</span>
        )}
      </div>
      <div className="seat-info">
        <div className="seat-name">
          {p.name}
          {mine && <span className="seat-tag">本机</span>}
          {dead && <span className="seat-tag dead">淘汰</span>}
        </div>
        <div className="seat-sub">
          <span className="seat-hp">❤ {fmtHp(p.hp)}/{fmtHp(p.maxHp)}</span>
          <span className="seat-room">📍{p.room}</span>
        </div>
      </div>
      {acting && !dead && <span className="seat-acting">行动中</span>}
      {hit && !dead && <span className="dmg-float" key={hit.key}>-{fmtHp(hit.amount)}</span>}
      {game.phase === 'over' && game.winner === p.id && <span className="seat-crown">🏆</span>}
      {onInteract && !dead && (
        <button
          className="seat-tomato"
          title="丢番茄（纯娱乐，不影响对局）"
          onClick={(e) => { e.stopPropagation(); onInteract(); }}
        >🍅</button>
      )}
    </div>
  );
}

// ── 我的席位（底部手牌左侧） ───────────────────────────

function MySeat({ p, isHost, acting, throwView, hit }: { p?: SnapPlayer; isHost: boolean; acting: boolean; throwView: ThrowView | null; hit?: HitView }) {
  if (!p) return <div className="my-seat is-empty">未入座</div>;
  const meta = cardMeta(p.charId);
  return (
    <div className={`my-seat ${p.alive ? '' : 'is-dead'} ${acting ? 'is-acting' : ''} ${hit && p.alive ? 'seat-hit' : ''}`} data-pid={p.id}>
      <div className="ms-art">
        {meta?.img ? <img src={meta.img} alt={p.charName} /> : <span>拔</span>}
        {throwView && p.alive && (
          <span className={`ms-throw t-${throwView.t}`} title={`你出了${THROW_LABEL[throwView.t]}`}>
            {THROW_ICON[throwView.t]}
          </span>
        )}
      </div>
      <div className="ms-meta">
        <div className="ms-name">{p.name}{isHost && <span className="seat-tag">房主</span>}</div>
        <div className="ms-char">{p.charName}</div>
        <div className="ms-hp">❤ {fmtHp(p.hp)}/{fmtHp(p.maxHp)} · 📍{p.room}</div>
        {p.alive && p.char?.domain === true && <div className="ms-domain">✨ 领域生效中</div>}
        {!p.alive && <div className="ms-dead">已淘汰</div>}
      </div>
      {hit && p.alive && <span className="dmg-float" key={hit.key}>-{fmtHp(hit.amount)}</span>}
    </div>
  );
}

// ── 角色卡（游戏王风卡面 + 动态数据 + 结构化事件演出） ─────────

const FX_ICON: Record<string, string> = {
  attack: '⚔️', heal: '💊', move: '🚶', milk: '🥛', skill: '✨',
  aim: '🎯', hide: '🙈', seek: '🔍', skip: '⏭️',
};

function CharCardView({ p, game, isMine, isTargetable, submitted, throwView, fx, hit, heal, miss, death, revive, isWinner, onClick }: {
  p: SnapPlayer;
  game: GameSnapshot;
  isMine: boolean;
  isTargetable: boolean;
  submitted: boolean;
  throwView: ThrowView | null;
  fx?: FxView;
  hit?: HitView;
  heal?: HealView;
  miss?: { key: number; sourceId?: string };
  death?: DeathView;
  revive?: ReviveView;
  /** 终局胜者（金色光环 + 皇冠） */
  isWinner?: boolean;
  onClick: () => void;
}) {
  const meta = cardMeta(p.charId);
  const acting = game.currentActor === p.id;
  const dead = !p.alive;
  const dying = !!death;
  const cls = [
    'ccard',
    dead ? 'is-dead' : '',
    dying ? 'is-dying' : '',
    acting && !dead ? 'is-acting' : '',
    isTargetable ? 'is-targetable clickable' : '',
    isMine ? 'is-mine' : '',
    hit ? 'flash-dmg' : '',
    heal ? 'heal-glow' : '',
    throwView ? 'has-throw' : '',
    isWinner ? 'is-winner' : '',
  ].filter(Boolean).join(' ');
  // HP 条（真实快照值；CSS 过渡延迟让斩击先落下、血条随后平滑变化）
  const hpPct = Math.max(0, Math.min(100, (p.hp / Math.max(1, p.maxHp)) * 100));

  return (
    <div className={cls} data-pid={p.id} onClick={onClick} title={`${p.name} · ${p.charName}（点击查看卡牌详情）`}>
      <div className="ccard-frame">
        <div className="ccard-art">
          {meta?.img ? <img src={meta.img} alt={p.charName} /> : <div className="ccard-art-ph">拔</div>}
          {throwView && !dead && (
            <span className={`card-throw rv-${throwView.result}`} title={`出了${THROW_LABEL[throwView.t]}`}>
              <span className="ct-icon">{THROW_ICON[throwView.t]}</span>
              <span className="ct-tag">{throwView.result === 'win' ? '胜' : throwView.result === 'lose' ? '负' : '平'}</span>
            </span>
          )}
        </div>
        <div className="ccard-plate">
          <span className="ccard-name">{p.name}</span>
          <span className="ccard-no">{meta?.no || '--'}</span>
        </div>
        <div className="ccard-stats">
          <span className="ccard-hp">❤ {fmtHp(p.hp)}/{fmtHp(p.maxHp)}</span>
          <span className="ccard-atk">⚔ {atkOf(p)}</span>
        </div>
        <div className={`ccard-hpbar ${dead ? 'empty' : ''}`} aria-hidden>
          <div className={`ccard-hpbar-fill ${heal ? 'rising' : ''}`} style={{ width: `${hpPct}%` }} />
        </div>
      </div>
      <div className="ccard-badges">
        {acting && !dead && <span className="cbadge cbadge-acting">行动中</span>}
        {isMine && <span className="cbadge cbadge-mine">我</span>}
        {isWinner && <span className="cbadge cbadge-winner">👑 胜者</span>}
        {submitted && !dead && !throwView && <span className="cbadge cbadge-submitted">已出拳</span>}
        {!dead && typeof p.char.livesLeft === 'number' && (p.char.livesLeft as number) > 1 && (
          <span className="cbadge cbadge-lives">💫 {p.char.livesLeft} 命</span>
        )}
        {p.hidden && !dead && <span className="cbadge cbadge-hide">🙈 躲藏</span>}
        {p.invisible && !dead && <span className="cbadge cbadge-hide">👻 隐身</span>}
      </div>

      {/* ── 演出叠加层（全部 key=事件 seq：同类事件重复触发会重播动画） ── */}
      {hit && (
        <span className="hitcut" key={`hc-${hit.key}`} data-testid="hitcut">
          <span className={`hitcut-slash ${hit.lethal || hit.instakill ? 'lethal' : ''}`} />
          <span className="hitcut-flash" />
          {hit.segment && hit.segment.total > 1 && (
            <span className="hitcut-seg">{hit.segment.index}/{hit.segment.total}段</span>
          )}
        </span>
      )}
      {hit && (
        <span className={`dmg-float ${hit.lethal || hit.instakill ? 'lethal' : ''}`} key={`df-${hit.key}`}>
          -{fmtHp(hit.amount)}
        </span>
      )}
      {heal && (
        <>
          <span className="healfx" key={`hl-${heal.key}`} data-testid="healfx">
            <span className="healfx-icon">✚</span>
          </span>
          {typeof heal.amount === 'number' && heal.amount > 0 && (
            <span className="heal-float" key={`hf-${heal.key}`}>+{fmtHp(heal.amount)}</span>
          )}
        </>
      )}
      {miss && !dead && (
        <span className="miss-float" key={`ms-${miss.key}`}>未命中</span>
      )}
      {revive && (
        <span className="revive-burst" key={`rv-${revive.key}`}>💫 {revive.livesLeft} 命复活</span>
      )}
      {death && (
        <span className="death-stamp" key={`dt-${death.key}`}>💀 淘汰</span>
      )}
      {fx && !dead && (
        <span className={`fx-anim fx-${fx.kind}`} key={`fx-${fx.key}`}>
          <span className="fx-icon">{FX_ICON[fx.kind] || '✨'}</span>
        </span>
      )}
    </div>
  );
}

// ── 卡牌详情弹层 ─────────────────────────────────────────

function CardDetail({ p, onClose, canKick, onKick, stats, onInteract, gotCount }: {
  p: SnapPlayer;
  onClose: () => void;
  canKick?: boolean;
  onKick?: () => void;
  stats?: PlayerStats;
  onInteract?: (kind: InteractionKind) => void;
  gotCount?: number;
}) {
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
        {p.char?.domain === true && p.alive && (
          <div className="cd-domain">✨ 领域生效中：判定平局算其胜（持续保留，直至被其他领域覆盖）</div>
        )}
        {stats && (
          <div className="cd-stats">
            <span>🎴 出拳胜/负/平 <b>{stats.throwWin}/{stats.throwLose}/{stats.throwTie}</b></span>
            <span>⚔ 造成伤害 <b>{fmtHp(stats.damageDealt)}</b></span>
            <span>🛡 承受伤害 <b>{fmtHp(stats.damageTaken)}</b></span>
            <span>💀 击杀 <b>{stats.kills}</b></span>
            <span>🎬 行动 <b>{stats.actions}</b></span>
            <span>🕯 存活回合 <b>{stats.roundsAlive}</b></span>
            {!!gotCount && <span>🍅 被丢 <b>{gotCount}</b> 次</span>}
          </div>
        )}
        {onInteract && (
          <div className="cd-interact">
            <span className="cd-interact-label">局内小互动（不影响对局）</span>
            <div className="cd-interact-row">
              {(['tomato', 'egg', 'flower'] as InteractionKind[]).map((k) => (
                <button key={k} className="tcg-btn ghost tiny" onClick={() => onInteract(k)}>
                  {INTERACT_ICON[k]} {INTERACT_NAME[k]}
                </button>
              ))}
            </div>
          </div>
        )}
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
        <div className="pv-names" style={{ margin: '8px 0', display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          {myIds.map((i) => <span key={i.playerId} className="pv-name" style={{ fontSize: 14 }}>{i.name}</span>)}
        </div>
        <p className="pv-hint tcg-chip" style={{ display: 'inline-block' }}>为防止偷看，请依次传递设备，由本人亲自出拳</p>
        <div className="pv-actions" style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
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
    <div className="privacy-veil hand-throw-veil">
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
            <span className="log-icon">{ICON[l.type || ''] || '·'}</span>{l.text}
          </div>
        ))}
      </div>
    </>
  );
}

// ── 大伊万投掷物飞行（V3）：从投掷者卡面飞向目标房间 ────────

function IvanProjectile({ throwView, game }: { throwView: { key: number; pid: string; room: string } | null; game: GameSnapshot }) {
  const [flight, setFlight] = useState<{ key: number; x0: number; y0: number; x1: number; y1: number } | null>(null);
  const lastKey = useRef<number | null>(null);

  useEffect(() => {
    if (!throwView || throwView.key === lastKey.current) return;
    lastKey.current = throwView.key;
    const from = document.querySelector(`[data-pid="${throwView.pid}"] .ccard-frame, [data-pid="${throwView.pid}"]`) as HTMLElement | null;
    const zone = document.querySelector(`.zone[data-room="${throwView.room}"]`) as HTMLElement | null;
    const fr = from?.getBoundingClientRect();
    const zr = zone?.getBoundingClientRect();
    const x0 = fr && fr.width > 0 ? fr.left + fr.width / 2 : window.innerWidth / 2;
    const y0 = fr && fr.width > 0 ? fr.top + fr.height / 2 : window.innerHeight / 2;
    const x1 = zr && zr.width > 0 ? zr.left + zr.width / 2 : window.innerWidth / 2;
    const y1 = zr && zr.height > 0 ? zr.top + zr.height / 2 : window.innerHeight / 2;
    setFlight({ key: throwView.key, x0, y0, x1, y1 });
    const t = setTimeout(() => setFlight(null), 1100);
    return () => clearTimeout(t);
  }, [throwView, game]);

  if (!flight) return null;
  return (
    <div className="ivan-fly-layer" aria-hidden>
      <span
        key={flight.key}
        className="ivan-bomb"
        style={{
          left: flight.x0, top: flight.y0,
          ['--dx' as string]: `${flight.x1 - flight.x0}px`,
          ['--dy' as string]: `${flight.y1 - flight.y0}px`,
        } as React.CSSProperties}
      >💣</span>
    </div>
  );
}

// ── 局内小互动飞行特效（丢番茄/鸡蛋/献花） ───────────────

interface FxItem { key: number; icon: string; x0: number; y0: number; x1: number; y1: number; }

function InteractFx({ interactions }: { interactions: InteractionEvent[] }) {
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

function StatsPanel({ game, meId, counts, onClose }: {
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

// ── 横屏紧凑模式检测（手机横放：高度很小） ────────────────

const COMPACT_QUERY = '(orientation: landscape) and (max-height: 560px)';

// ── reduced-motion 检测（系统减少动态效果） ────────────────

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

function useReducedMotion(): boolean {
  const [on, setOn] = useState(() => matchMediaSafe(REDUCED_QUERY));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(REDUCED_QUERY);
    const handler = () => setOn(mq.matches);
    handler();
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', handler);
    else if (typeof mq.addListener === 'function') mq.addListener(handler);
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', handler);
      else if (typeof mq.removeListener === 'function') mq.removeListener(handler);
    };
  }, []);
  return on;
}

// ── 移动演出：卡片跨房间 FLIP 飞行动画 ─────────────────────
//
// 快照到达时房间成员已经重排（React 直接把卡渲染进新 zone）。
// 本 hook 在布局提交后测量新旧位置差，用 transform 把卡片从旧位置"放回"再过渡到新位置。
// 与演出队列解耦：即使队列处于快进/清空状态，移动落位动画依然正确、不会错位。

const FLIP_MS = 560;

function useCardRoomFlip(players: SnapPlayer[], reduced: boolean): void {
  const prevRef = useRef<Map<string, { x: number; y: number; room: string }>>(new Map());
  useLayoutEffect(() => {
    const cards = document.querySelectorAll<HTMLElement>('.zone-cards .ccard[data-pid]');
    const next = new Map<string, { x: number; y: number; room: string }>();
    for (const el of cards) {
      const pid = el.getAttribute('data-pid');
      if (!pid) continue;
      const r = el.getBoundingClientRect();
      next.set(pid, { x: r.left + r.width / 2, y: r.top + r.height / 2, room: players.find((p) => p.id === pid)?.room ?? '' });
    }
    const prev = prevRef.current;
    if (!reduced) {
      for (const el of cards) {
        const pid = el.getAttribute('data-pid');
        if (!pid) continue;
        const p = players.find((x) => x.id === pid);
        const old = prev.get(pid);
        if (!old || !p || p.room === old.room || !p.alive) continue;
        const cur = next.get(pid);
        if (!cur) continue;
        const dx = old.x - cur.x;
        const dy = old.y - cur.y;
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
        el.classList.add('flip-flying');
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.style.transition = `transform ${FLIP_MS}ms cubic-bezier(0.22, 0.9, 0.3, 1)`;
            el.style.transform = '';
            setTimeout(() => {
              el.style.transition = '';
              el.style.transform = '';
              el.classList.remove('flip-flying');
            }, FLIP_MS + 60);
          });
        });
      }
    }
    prevRef.current = next;
  }, [players, reduced]);
}

function matchMediaSafe(q: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(q).matches;
}

function useCompactLandscape(): boolean {
  const [on, setOn] = useState(() => matchMediaSafe(COMPACT_QUERY));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(COMPACT_QUERY);
    const handler = () => setOn(mq.matches);
    handler();
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', handler);
    else if (typeof mq.addListener === 'function') mq.addListener(handler);
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', handler);
      else if (typeof mq.removeListener === 'function') mq.removeListener(handler);
    };
  }, []);
  return on;
}

const NARROW_QUERY = '(max-width: 900px)';

function useNarrowScreen(): boolean {
  const [on, setOn] = useState(() => matchMediaSafe(NARROW_QUERY));
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(NARROW_QUERY);
    const handler = () => setOn(mq.matches);
    handler();
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', handler);
    else if (typeof mq.addListener === 'function') mq.addListener(handler);
    return () => {
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', handler);
      else if (typeof mq.removeListener === 'function') mq.removeListener(handler);
    };
  }, []);
  return on;
}
