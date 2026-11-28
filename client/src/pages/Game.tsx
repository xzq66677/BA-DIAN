import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  net, type LobbyState, type GameSnapshot, type SnapPlayer,
  type InteractionEvent, type InteractionKind, type AnnounceItem,
} from '../net.js';
import type { ActionRequest, JudgeStep } from '../../../shared/src/types.js';
import type { SessionInfo } from '../App.js';
import { CHARACTERS } from '../../../shared/src/characters/index.js';
import { canOpenSluice, mudBlocksEntry, RUINS_WEATHER_NAME } from '../../../shared/src/floating-ruins.js';
import { cardMeta } from '../cards.js';
import ReplayViewer from './Replay.js';
import {
  useBattlePresentation,
  type FxView, type HitView, type HealView, type DeathView, type ReviveView,
  type PresentationState,
} from '../battle/useBattlePresentation.js';
import { useCardRoomFlip } from '../battle/flip.js';
import { resolvePresentationPace } from '../battle/pace-policy.js';
import { resolveActionPresentation } from '../battle/action-presentation.js';
import { FxOverlayHost, fxOverlayView, type FxOverlayView } from '../battle/fx-overlays.js';
import '../battle/presentation-plugins.js';
import { PlayerInventory, PlayerStatusModal } from '../battle/player-status.js';
import { slotMachineRoomLabel, slotMachineState } from '../battle/slot-machine-state.js';
import { statusBlockingAction } from '../../../shared/src/statuses.js';
import { formatHp as fmtHp } from '../battle/status-types.js';
import { sfx } from '../audio/sfx.js';
import { Battle3D, detectWebGL, preferredRenderer, setPreferredRenderer } from '../battle3d/Battle3D.js';
import { clearSessionDegraded } from '../battle3d/gl-policy.js';
import { AnnounceDrawer, GlobalAnnounceBanner } from '../battle/announce-view.js';
import { atkOf, CardDetail, CharCardView, MySeat, RoomSlotMachines } from '../battle/game-cards.js';
import { BtRoom, IvanProjectile } from '../battle/game-table.js';
import { ChatDock, InteractFx, LogPanel, StatsPanel } from '../battle/game-panels.js';
import { useCompactLandscape, useNarrowScreen, useReducedMotion, dockNeedsLocalInput } from '../battle/game-hooks.js';
import {
  hasThrown, namesOf, RevealBoard, throwViewOf, ThrowPrivacy, type ThrowView,
} from '../battle/throw-view.js';
import '../battle3d/battle3d.css';

export { ThrowPrivacy, type ThrowView } from '../battle/throw-view.js';

const AI_LABEL: Record<string, string> = { easy: '休闲', normal: '普通', hard: '硬核' };

interface ActionOption {
  key: string;
  label: string;
  desc: string;
  typeLabel: string;
  targetHint?: string;
  /** 多目标行动：可同时选择多名玩家（如吸/吹） */
  multiTarget?: boolean;
  roomHint?: boolean;
  roomExcludeCurrent?: boolean;
  presentationFx?: string;
  manual?: boolean;
  disabledReason?: string;
  /** 需要二级选择：要封印的目标行动（钥匙） */
  sealHint?: boolean;
}

/** 钥匙封印候选：与引擎 sealableActions 对齐（攻击不可封印；已封印的排除） */
function sealCandidates(target: SnapPlayer | undefined): { action: string; label: string }[] {
  if (!target) return [];
  const cd = CHARACTERS[target.charId] || CHARACTERS['default'];
  const items: { action: string; label: string }[] = [
    { action: 'move', label: '移动' },
    { action: 'heal', label: '回复' },
    { action: 'milk', label: '喝牛奶' },
    { action: 'hide', label: '躲藏' },
    { action: 'seek', label: '找出来' },
    { action: 'skip', label: '跳过' },
  ];
  if (cd.rangedNeedsAim) items.push({ action: 'aim', label: '瞄准' });
  for (const a of cd.actions ?? []) items.push({ action: a.name, label: a.label });
  const sealed = new Set((target.actionLocks ?? []).map((l) => l.action));
  return items.filter((x) => !sealed.has(x.action) && !cd.blockBaseActions?.includes(x.action));
}

export default function GamePage({ lobby, game, session, logs, announces, resync, onExit, onBackToLobby }: {
  lobby: LobbyState;
  resync?: { cursor: number };
  game: GameSnapshot | null;
  session: SessionInfo;
  logs: { seq: number; text: string; important?: boolean; type?: string; data?: Record<string, unknown> }[];
  /** 全局播报（服务端权威增量，App 层累积）：横幅 + 播报抽屉的数据源 */
  announces?: AnnounceItem[];
  onExit: () => void;
  /** 对局结束后返回房间大厅（房间仍保留） */
  onBackToLobby?: () => void;
}) {
  if (!game) return <div className="tcg-app"><div className="tcg-panel" style={{ margin: 20 }}>等待游戏状态…</div></div>;
  return <GameInner lobby={lobby} game={game} session={session} logs={logs} announces={announces} resync={resync} onExit={onExit} onBackToLobby={onBackToLobby} />;
}


/**
 * 连判进度提示：按最近两次判定结果推断「下一次判定会引发暴走还是自爆」。
 * 纯数据驱动（快照里的 judgeStreak），不含角色名分支。
 */
function judgeStreakHint(streak: readonly JudgeStep[]): string {
  const label = (s: JudgeStep) => (s === 'win' ? '赢' : s === 'tie' ? '平' : '输');
  if (streak.length === 0) return '';
  if (streak.length === 1) return '还需 2 次判定';
  const a = streak[streak.length - 2];
  const b = streak[streak.length - 1];
  if (a === b) return `再来一个「${label(a)}」→ 自爆`;
  const missing = (['win', 'tie', 'lose'] as const).find((x) => x !== a && x !== b)!;
  return `再来一个「${label(missing)}」→ 暴走`;
}

function GameInner({ lobby, game, session, logs, announces, resync, onExit, onBackToLobby }: {
  lobby: LobbyState;
  game: GameSnapshot;
  resync?: { cursor: number };
  session: SessionInfo;
  logs: { seq: number; text: string; important?: boolean; type?: string; data?: Record<string, unknown> }[];
  announces?: AnnounceItem[];
  onExit: () => void;
  onBackToLobby?: () => void;
}) {
  const myIds = session.identities;
  const meId = myIds[0].playerId;
  const isHost = lobby.hostSeat === meId;
  const me = game.players.find((p) => p.id === meId);

  // 行动坞交互状态（纯 UI 状态；最终合法性由服务器校验）
  const [selAction, setSelAction] = useState<ActionOption | null>(null);
  /** 钥匙封印的二级选择：要封禁的目标行动名 */
  const [selSeal, setSelSeal] = useState('');
  const [selTarget, setSelTarget] = useState('');
  /** 多目标行动的已选玩家（如吸/吹） */
  const [selTargets, setSelTargets] = useState<string[]>([]);
  const [selRoom, setSelRoom] = useState('');
  const [actMsg, setActMsg] = useState('');
  const [berserkMsg, setBerserkMsg] = useState('');
  const [manualCue, setManualCue] = useState<FxOverlayView | null>(null);
  const [manualAction, setManualAction] = useState<ActionRequest | null>(null);
  const [manualBusy, setManualBusy] = useState(false);
  const [rematchPending, setRematchPending] = useState(false);
  const [rematchError, setRematchError] = useState('');

  async function prepareRematch() {
    if (!isHost || game.phase !== 'over' || rematchPending) return;
    setRematchPending(true);
    setRematchError('');
    try {
      const result = await net.restart(lobby.code, meId, myIds[0].token, false);
      if (!result.ok) setRematchError(typeof result.error === 'string' ? result.error : '无法进入下一局选角');
    } catch {
      setRematchError('无法进入下一局选角，请重试');
    } finally {
      setRematchPending(false);
    }
  }

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
  // 日志未读计数（抽屉收起时新增日志数）：3D 模式日志默认收起，徽标提醒「看得到入口」
  const [logUnread, setLogUnread] = useState(0);
  // 初始已见=挂载时已有日志数（重连恢复/进入对局的历史日志不算未读）
  const logSeenRef = useRef(logs.length);
  useEffect(() => {
    if (logOpen) {
      logSeenRef.current = logs.length;
      setLogUnread(0);
    } else {
      setLogUnread(Math.max(0, logs.length - logSeenRef.current));
    }
  }, [logs.length, logOpen]);

  // ── 全局播报抽屉（代替翻日志）──
  // 与战斗日志互补：日志是完整档案，播报是「谁做了什么 + 几点几分 + 停留多久」的公开动态。
  const [announceOpen, setAnnounceOpen] = useState(false);
  const [announceUnread, setAnnounceUnread] = useState(0);
  const announceSeenRef = useRef(announces?.length ?? 0);
  useEffect(() => {
    const n = announces?.length ?? 0;
    if (announceOpen) {
      announceSeenRef.current = n;
      setAnnounceUnread(0);
    } else {
      setAnnounceUnread(Math.max(0, n - announceSeenRef.current));
    }
  }, [announces?.length, announceOpen]);

  // 顶栏高度写进 CSS 变量：窄屏顶栏按钮会换行（390px 下从 50px 变 93px），
  // 播报抽屉与其它浮层的 top 用 --app-header-h 跟随，避免压住第二行按钮。
  const headerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const root = document.documentElement;
    const write = () => root.style.setProperty('--app-header-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    write();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
  //    不再用快照 HP 差分猜测伤害；快照仍是显示权威，叠加层只做视觉。
  //    终局延迟呈现：规则立即结算（快照 over），终局弹层等最后关键演出播完再登场。 ──
  const presentationPace = useMemo(() => resolvePresentationPace(lobby.seats), [lobby.seats]);
  const { pres, queue: queueState, api: presApi, finaleWaiting } = useBattlePresentation(logs, lobby.gameNo, game.phase, resync, announces, presentationPace);
  const reducedMotion = useReducedMotion();
  // 移动演出的 FLIP 卡片飞行动画（跟随快照房间变化，不依赖队列时序）
  useCardRoomFlip(game.players, reducedMotion, '.bt-room-cards .ccard[data-pid], .bt-mine-cards .ccard[data-pid]', 'flip-flying');

  // 角色详情 / 血量状态弹层
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailPlayer = detailId ? game.players.find((p) => p.id === detailId) : null;
  const [statusId, setStatusId] = useState<string | null>(null);
  const statusPlayer = statusId ? game.players.find((p) => p.id === statusId) : null;
  // 胜负判定弹层（新对局自动复位）
  const [winDismissed, setWinDismissed] = useState(false);
  useEffect(() => { if (game.phase !== 'over') setWinDismissed(false); }, [game.phase]);
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

  const actor = game.players.find(p => p.id === myTurnId?.playerId) ?? me;
  const mud = game.ruins?.mud;
  const blockedRoom = selAction?.key === 'move' && mud && actor && mudBlocksEntry(game.ruins, actor.room, mud.room) ? mud.room : '';

  const targetsFor = useCallback((hint?: string): SnapPlayer[] => {
    if (!actor || !hint) return [];
    const others = game.players.filter((p) => p.alive && p.id !== actor.id);
    const cd = CHARACTERS[actor.charId] || CHARACTERS['default'];
    const sameRoom = (p: SnapPlayer) => p.room === actor.room && (p.char.inTower === true) === (actor.char.inTower === true);
    switch (hint) {
      case 'attack': {
        // 高塔内外隔绝：只有同侧（同在塔内或同在塔外）才能互相攻击
        const sameTowerSide = (p: SnapPlayer) => (p.char.inTower === true) === (actor.char.inTower === true);
        // 骑乘中（如狂猎）：攻击无视距离，可突进任意房间
        if (actor.char.mounted === true) return others.filter((p) => !p.hidden && !p.invisible && sameTowerSide(p));
        const at = cd.attackType || 'both';
        const meleeOk = at !== 'ranged' && at !== 'none';
        const rangedOk = !!cd.rangedCapable && at !== 'none';
        // 无视距离（如大贱客辱骂）：任意房间的目标均可选，躲藏按 ignoreHide 口径放行
        if (cd.attackAllRooms) {
          return meleeOk ? others.filter((p) => !p.hidden || cd.ignoreHide) : [];
        }
        const sameRoomMelee = meleeOk ? others.filter((p) => sameRoom(p) && (!(p.hidden || p.invisible) || cd.ignoreHide)) : [];
        // 允许远程打同房间的角色（如佝偻弓箭手近距离放箭）
        const sameRoomRanged = rangedOk && cd.rangedSameRoom
          ? others.filter((p) => sameRoom(p) && (!(p.hidden || p.invisible) || cd.ignoreHide))
          : [];
        const nearby = [
          ...sameRoomMelee,
          ...sameRoomRanged.filter((p) => !sameRoomMelee.some((m) => m.id === p.id)),
        ];
        const otherRoom = rangedOk
          ? others.filter((p) => p.room !== actor.room && !p.hidden && !p.invisible && p.char.inTower !== true && actor.char.inTower !== true
            && (!cd.rangedNeedsAim || (cd.aimExemptWhenDomain && actor.char.domain === true) || actor.char.aim === p.id))
          : [];
        return [...nearby, ...otherRoom];
      }
      case 'aim': return others.filter((p) => !p.hidden && !p.invisible);
      case 'seek': return others.filter(p => sameRoom(p) && p.hidden);
      case 'sameRoomPlayer': return others.filter(sameRoom);
      case 'sameRoomOrTowerPlayer': return others.filter((p) => p.room === actor.room && !p.hidden && !p.invisible);
      case 'anyPlayer': return others;
      case 'otherRoomPlayer': return others.filter((p) => p.room !== actor.room);
      default: return [];
    }
  }, [game.players, actor]);

  // 可选行动列表（基础 + 角色）
  const options: ActionOption[] = useMemo(() => {
    if (!actor) return [];
    const cd = CHARACTERS[actor.charId] || CHARACTERS['default'];
    const disabled = game.currentActor === actor.id ? game.actionDisabledReasons : undefined;
    const list: ActionOption[] = [
      { key: 'attack', label: '攻击', desc: cd.attackDesc ?? `近战攻击同房间目标（伤害 ${atkOf(actor)}）${cd.rangedCapable ? `；可远程${cd.rangedNeedsAim ? ((cd.aimExemptWhenDomain && actor.char.domain === true) ? '（领域生效免瞄准）' : '（远程需先瞄准）') : '（默认免瞄准）'}` : ''}${cd.ignoreHide ? '；无视躲藏' : ''}`, typeLabel: '基础', ...(cd.attackRoomHint ? { roomHint: true } : { targetHint: 'attack' as const }) },
      { key: 'move', label: '移动', desc: '移动到任意玩家的初始房间（移动后现身）', typeLabel: '基础', roomHint: true },
      { key: 'heal', label: '回复', desc: '回复至满血', typeLabel: '基础' },
      { key: 'milk', label: '喝牛奶', desc: '嘲讽，无实际作用', typeLabel: '基础' },
      { key: 'hide', label: '躲藏', desc: '指向性攻击无法锁定；AOE与无视躲避攻击仍可命中', typeLabel: '基础' },
    ];
    if (actor.charId === 'chuixiao') list[0].desc = '仅能远程攻击异房间目标（伤害1），无需瞄准；无法近战';
    if (game.ruins) {
      list.push({ key: 'openSluice', label: '开启泄水闸', desc: '排空本房积水，解除下一回合的泥潭预警。消耗本次行动。', typeLabel: '地图',
        disabledReason: canOpenSluice(game.ruins, actor.room) ? undefined : '本房间没有可排放的积水' });
    }
    list.push({ key: 'seek', label: '找出来', desc: '找出同房间躲藏的玩家', typeLabel: '基础', targetHint: 'seek' });
    if (cd.rangedNeedsAim && !(cd.aimExemptWhenDomain && actor.char.domain === true)) {
      list.push({ key: 'aim', label: '瞄准', desc: '锁定一名玩家（远程攻击前必须瞄准）', typeLabel: '基础', targetHint: 'aim' });
    }
    list.push({ key: 'skip', label: '跳过', desc: '不做任何事', typeLabel: '基础' });
    for (const a of cd.actions || []) {
      const presentation = resolveActionPresentation(a.name);
      list.push({
        key: a.name, label: a.label,
        desc: a.desc,
        sealHint: a.name === 'slotKey',
        typeLabel: '技能',
        // 'none' 表示自身技能（领域展开 / 抽取今日运势 / 强化攻击等）：不选目标、不设房间，直接确认发动
        targetHint: a.targetHint && a.targetHint !== 'none' ? a.targetHint : undefined,
        multiTarget: a.multiTarget,
        roomHint: a.roomHint,
        roomExcludeCurrent: a.roomExcludeCurrent,
        presentationFx: presentation?.fx,
        manual: presentation?.mode === 'manual',
      });
    }
    // 状态 / 在场角色提供的附加行动（服务端权威列表：燃烧扑灭、引燃骷髅、取燃烧箭…）
    for (const a of game.extraActions ?? []) {
      list.push({
        key: a.key, label: a.label, desc: a.desc,
        typeLabel: a.typeLabel ?? '环境',
        targetHint: a.targetHint,
        roomHint: a.roomHint,
        roomExcludeCurrent: a.roomExcludeCurrent,
      });
    }
    return list.map(option => {
      let reason = disabled?.[option.key] ?? option.disabledReason;
      if (!reason && !disabled) {
        const status = statusBlockingAction(actor.effects, option.key);
        if (actor.actionLocks?.some(lock => lock.action === option.key)) reason = '已被封印';
        else if (status) reason = `${status}时无法使用该行动`;
        else if (cd.blockBaseActions?.includes(option.key)) reason = '该角色无法使用此行动';
      }
      if (!reason && option.targetHint) {
        const targets = targetsFor(option.targetHint);
        if (!targets.length) reason = option.key === 'seek' ? '同房间没有躲藏的玩家'
          : option.key === 'attack' && cd.rangedNeedsAim && !(cd.aimExemptWhenDomain && actor.char.domain === true)
            ? '当前没有可攻击目标，远程攻击需要先瞄准'
            : '当前没有可选目标';
      }
      return { ...option, disabledReason: reason };
    });
  }, [game, actor, targetsFor]);

  const validTargets = useMemo(() => targetsFor(selAction?.targetHint), [targetsFor, selAction?.targetHint]);
  const selectedDisabledReason = selAction && options.find(option => option.key === selAction.key)?.disabledReason;

  useEffect(() => {
    setSelTarget('');
    setSelTargets([]);
    setSelRoom('');
    setSelSeal('');
  }, [selAction]);

  function resetSelection() {
    setManualCue(null);
    setManualAction(null);
    setManualBusy(false);
    setSelAction(null);
    setSelTarget('');
    setSelTargets([]);
    setActMsg('');
  }

  useEffect(() => {
    setManualCue(null);
    setManualAction(null);
    setManualBusy(false);
  }, [lobby.gameNo, game.phase, myTurnId?.playerId]);

  function prepareAction(): ActionRequest | null {
    if (!selAction || !myTurnId) return null;
    const currentOption = options.find(option => option.key === selAction.key);
    if (!currentOption || currentOption.disabledReason) {
      setActMsg(currentOption?.disabledReason ?? '当前无法使用该行动');
      return null;
    }
    setActMsg('');
    const action: ActionRequest = { type: selAction.key };
    const needTarget = !!selAction.targetHint;
    const needRoom = !!selAction.roomHint || selAction.key === 'move';
    if (needTarget) {
      if (selAction.multiTarget) {
        if (selTargets.length === 0) { setActMsg('请先选择至少一个目标'); return null; }
        action.targetIds = [...selTargets];
      } else {
        if (!selTarget) { setActMsg('请先选择目标'); return null; }
        action.targetId = selTarget;
      }
    }
    if (needRoom) {
      if (!selRoom) { setActMsg('请先点击战场中发绿光的房间'); return null; }
      if (selRoom === blockedRoom) { setActMsg(`${selRoom} 泥潭封路，请选择其他房间`); return null; }
      if (selAction.roomExcludeCurrent && selRoom === actor?.room) { setActMsg('落点房间不能是当前房间'); return null; }
      action.room = selRoom;
    }
    if (selAction.key === 'attack') {
      const cd = actor ? (CHARACTERS[actor.charId] || CHARACTERS['default']) : undefined;
      const targetRoom = validTargets.find((t) => t.id === selTarget)?.room;
      // 异房间远程，或角色支持「远程打同房间」（如佝偻弓箭手）
      if (targetRoom !== actor?.room || (cd?.rangedSameRoom && cd.rangedCapable)) action.ranged = true;
    }
    if (selAction.sealHint) {
      if (!selSeal) { setActMsg('请选择要封印的行动'); return null; }
      action.params = { action: selSeal };
    }
    return action;
  }

  async function submitPreparedAction(action: ActionRequest): Promise<void> {
    if (!myTurnId) return;
    const r = await net.submitAction(lobby.code, myTurnId.playerId, myTurnId.token, action) as { ok: boolean; error?: string };
    if (!r.ok) {
      setActMsg(r.error || '行动失败');
      setManualCue(null);
      setManualAction(null);
      return;
    }
    resetSelection();
  }

  function confirmAction() {
    if (!selAction || !myTurnId || manualBusy) return;
    const action = prepareAction();
    if (!action) return;
    const presentation = resolveActionPresentation(selAction.key);
    if (presentation?.mode === 'manual') {
      setManualAction(action);
      setManualCue({
        key: -1,
        kind: presentation.fx,
        pid: myTurnId.playerId,
        targetId: action.targetId,
        room: action.room,
        playerName: myTurnId.name,
        durationMs: presentation.durationMs,
      });
      return;
    }
    void submitPreparedAction(action);
  }

  async function completeManualAction(): Promise<void> {
    if (!manualAction || manualBusy) return;
    setManualBusy(true);
    try {
      await submitPreparedAction(manualAction);
    } finally {
      setManualBusy(false);
    }
  }

  function cancelManualAction(): void {
    if (manualBusy) return;
    setManualCue(null);
    setManualAction(null);
    setActMsg('');
  }

  function phaseText(): string {
    switch (game.phase) {
      case 'rps1': return `隐藏出拳 · 已提交 ${game.submittedIds.length}`;
      case 'rps2': return `行动排序出拳 · 子轮 ${(game.orderSub ?? 0) + 1} · 已提交 ${(game.orderSubmittedIds ?? []).length}/${(game.orderGroup ?? []).length}`;
      case 'judge': {
        const j = game.judge;
        return j ? `${j.label} · 第 ${j.round}/${j.rounds} 局 · 已出拳 ${j.submittedIds.length}/${j.submittedIds.length + j.waitingIds.length}` : '技能判定';
      }
      case 'act': return '行动阶段';
      case 'trigger': return game.trigger ? `暴走触发 · ${namesOf(game, [game.trigger.actor])} 选择目标` : '回合前触发结算';
      case 'roundEnd': return '回合末结算';
      case 'over': return '游戏结束';
    }
  }

  const pendingLocalIds = myIds.filter((i) => game.players.find((p) => p.id === i.playerId)?.alive && !game.submittedIds.includes(i.playerId));
  // 二次判定（行动排序）：只有「当前子轮参与组」里的本机身份需要出拳
  const orderGroup = game.orderGroup ?? [];
  const orderSubmittedIds = game.orderSubmittedIds ?? [];
  const orderPendingLocalIds = myIds.filter((i) => orderGroup.includes(i.playerId)
    && game.players.find((p) => p.id === i.playerId)?.alive
    && !orderSubmittedIds.includes(i.playerId));
  // 技能内判定（马保国太极/五连鞭/不讲武德）：只有当前在等出拳的本机身份需要出拳
  const judge = game.judge ?? null;
  const judgePendingLocalIds = judge ? myIds.filter((i) => judge.waitingIds.includes(i.playerId)) : [];
  // 暴走触发（回合最前）：本机身份是否为当前暴走权持有者（持有者必须能选目标，Issue #110）
  const triggerLocalActor = game.phase === 'trigger' && !!game.trigger
    && myIds.some((i) => i.playerId === game.trigger!.actor);
  // 伍六七三刀：下一回合末落于指定房间（回合末结算，先于大伊万爆炸）
  const pendingSlashes = (game.deferred ?? []).filter((d) => d.kind === 'wuliuqi-slash');
  const livingCount = game.players.filter((p) => p.alive).length;
  const crowdedArena = game.roomIds.length > 10 || game.players.filter(p => p.alive && p.room === actor?.room).length > 6;

  // ── 沉浸牌桌派生值：弧形远端房间 / 我的房间成员 / 中央事件播报 ──
  const myRoom = me?.room ?? null;
  const farRooms = useMemo(() => {
    const rooms = game.roomIds.filter((r) => r !== myRoom);
    // 稳定排序：按房间内人数（多人的房间居中）与名称
    return rooms.slice().sort((a, b) => {
      const na = game.players.filter((p) => p.alive && p.room === a).length;
      const nb = game.players.filter((p) => p.alive && p.room === b).length;
      if (na !== nb) return nb - na;
      return a.localeCompare(b);
    });
  }, [game.roomIds, game.players, myRoom]);
  const roomMembersOf = (rid: string) => game.players.filter((p) => (p.alive || pres.deaths[p.id]) && p.room === rid);
  const myRoomMembers = myRoom ? roomMembersOf(myRoom) : [];
  const myRoomPendingIvan = myRoom ? game.deferred?.find((d) => d.kind === 'ivan' && d.room === myRoom) : undefined;
  const eventTicker = pres.ivanBoom
    ? '💥 大伊万爆炸！'
    : pres.ivanThrow
      ? '💣 大伊万投掷！'
      : pres.zoneAlert
        ? '⚔️ 范围事件！'
        : '';
  const tickerKey = pres.ivanBoom?.key ?? pres.ivanThrow?.key ?? pres.zoneAlert?.key ?? 0;

  function pickTargetOrDetail(pid: string) {
    if (selAction?.targetHint) {
      if (validTargets.some((t) => t.id === pid)) {
        if (selAction.multiTarget) {
          setSelTargets((prev) => prev.includes(pid) ? prev.filter((id) => id !== pid) : [...prev, pid]);
        } else {
          setSelTarget(pid);
        }
        return;
      }
      // 点击了不可选目标：明确说明原因（而非默默打开详情让玩家困惑）
      const p = game.players.find((x) => x.id === pid);
      const m = actor;
      if (p && p.alive && p.id !== m?.id && m) {
        const cd = CHARACTERS[m.charId] || CHARACTERS['default'];
        if (p.invisible) { setActMsg(`👻 ${p.name} 处于隐身状态，无法被选中`); return; }
        if (p.hidden) { setActMsg(`🙈 ${p.name} 正在躲藏：指向性攻击无法锁定（范围效果与无视躲藏的攻击仍可命中）`); return; }
        if (selAction.key === 'attack' && p.room !== m.room && !cd.rangedCapable) {
          setActMsg(`⚔ ${p.name} 在 ${p.room}：近战攻击无法触及异房间目标`); return;
        }
        if (selAction.key === 'attack' && p.room !== m.room && cd.rangedNeedsAim
          && !(cd.aimExemptWhenDomain && m.char.domain === true) && m.char.aim !== p.id) {
          setActMsg(`🎯 远程攻击需先瞄准：先使用「瞄准」锁定 ${p.name}，下回合攻击`); return;
        }
      }
    }
    setDetailId(pid);
  }

  // ── 3D 战场渲染器：WebGL 可用时默认 3D；?r=2d / localStorage / 舞台按钮可切回 2D 牌桌 ──
  // 挂载在 pickTargetOrDetail/validTargets 之后（依赖二者）。
  const [rendererMode, setRendererModeState] = useState<'3d' | '2d'>(() => preferredRenderer());
  const webglOk = useMemo(() => detectWebGL(), []);
  const [automaticCamera, setAutomaticCamera] = useState(true);
  const [lowEffects, setLowEffects] = useState(false);
  const [finaleCanvasDone, setFinaleCanvasDone] = useState(false);
  const finaleReady = game.phase === 'over' && !finaleWaiting;
  const targetablePids = useMemo(
    () => (selAction?.targetHint && myTurnId ? validTargets.map((t) => t.id) : []),
    [selAction, validTargets, myTurnId],
  );
  const roomPickMode = !!myTurnId && (!!selAction?.roomHint || selAction?.key === 'move');
  const sceneIds = useMemo(() => myIds.map(i => i.playerId), [myIds]);
  const battle3d = Battle3D({
    game,
    gameNo: lobby.gameNo,
    resync,
    playback: presApi,
    finaleReady,
    myIds: sceneIds,
    targetablePids,
    roomPickMode,
    selectedRoom: selRoom,
    blockedRoom,
    excludedRoom: selAction?.roomExcludeCurrent ? actor?.room : undefined,
    selectedPlayer: selTargets[selTargets.length - 1] ?? selTarget,
    reducedMotion,
    automaticCamera,
    lowEffects,
    // active 与 failed 分离：active 由渲染器偏好决定（2D 模式 → dispose 场景释放
    // raf/WebGL 上下文）；failed 是 WebGL 层面的失败（上下文丢失未恢复等）
    active: rendererMode === '3d' && webglOk,
    onPickPlayer: pickTargetOrDetail,
    onShowStatus: (pid) => setStatusId(pid),
    onPickRoom: (rid) => setSelRoom(rid),
  });
  const use3d = rendererMode === '3d' && webglOk && !battle3d.failed;
  const presentationOverlays = Object.values(pres.fx).map((view) => fxOverlayView(
    view,
    game.players.find((player) => player.id === view.pid)?.name,
  ));
  useEffect(() => {
    if (!finaleReady || !use3d || reducedMotion || !automaticCamera) return;
    const t = window.setTimeout(() => setFinaleCanvasDone(true), 760);
    return () => window.clearTimeout(t);
  }, [finaleReady, use3d, reducedMotion, automaticCamera, lobby.gameNo]);
  useEffect(() => { setFinaleCanvasDone(false); }, [lobby.gameNo]);
  const finaleCameraPending = finaleReady && use3d && !reducedMotion && automaticCamera && !finaleCanvasDone;
  const soundedFinale = useRef<number>();
  useEffect(() => {
    if (!finaleReady || !game.winner || soundedFinale.current === (lobby.gameNo ?? 0)) return;
    soundedFinale.current = lobby.gameNo ?? 0;
    sfx.play('victory', { major: true });
  }, [finaleReady, game.winner, lobby.gameNo]);
  const skipFinale = () => {
    presApi.skipFinaleWait();
    setFinaleCanvasDone(true);
  };
  // 房间预选：2D 牌桌无战场点击 → 保留下拉与默认预选；3D 模式走「点击战场房间」，
  // 2D 模式预填合法房间；3D 必须显式点击战场房间
  useEffect(() => {
    if (use3d || !selAction || !actor) return;
    if (!selAction.roomHint && selAction.key !== 'move') return;
    const valid = game.roomIds.find((r) => r !== blockedRoom
      && (!selAction.roomExcludeCurrent || r !== actor.room));
    if (selRoom && game.roomIds.includes(selRoom) && selRoom !== blockedRoom
      && (!selAction.roomExcludeCurrent || selRoom !== actor.room)) return;
    setSelRoom(valid ?? '');
  }, [use3d, game.roomIds, selRoom, selAction, actor, blockedRoom]);
  // 3D 模式下进入选房行动时清掉残留房间选择（必须显式点击战场房间）
  useEffect(() => {
    if (use3d && selAction && (selAction.roomHint || selAction.key === 'move')) setSelRoom('');
  }, [use3d, selAction]);
  function toggleRenderer() {
    const next = use3d ? '2d' : '3d';
    setRendererModeState(next);
    setPreferredRenderer(next);
    // 用户主动切回 3D：清除会话级降级标记（明确选择优先，重新开始丢失计数）
    if (next === '3d') clearSessionDegraded();
  }
  // 3D 沉浸模式：日志/发言默认收起（辅助层），可从顶栏展开
  useEffect(() => {
    if (use3d) { setLogOpen(false); setChatOpen(false); }
    else { setLogOpen(!compact && !narrow); setChatOpen(!compact && !narrow); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [use3d]);

  return (
    <div className={`tcg-app has-chat ${use3d ? 's3d-mode' : ''}`}>
      <header className="tcg-header" ref={headerRef}>
        <span className="tcg-logo">拔典</span>
        <span className="tcg-chip hide-sm">房间 {lobby.code}</span>
        <span className="tcg-chip">第 <b>{game.roundNo}</b> 回合</span>
        <span className="tcg-chip hot">{phaseText()}</span>
        <span className="tcg-chip">存活 {game.aliveCount}</span>
        {game.players.map(player => {
          const machine = slotMachineState(player);
          if (!machine) return null;
          return (
            <span key={player.id} className="tcg-chip slot-machine-location" data-room={machine.room} title={player.name}>
              <span aria-hidden>🎰 </span><b>{machine.room}</b> · {slotMachineRoomLabel(machine)}
            </span>
          );
        })}
        {game.ruins && (
          <span className="tcg-chip ruins-weather-chip" data-weather={game.ruins.weather} role="status">
            {RUINS_WEATHER_NAME[game.ruins.weather]}
            {mud && <span className="ruins-mud-chip" data-active={mud.active}> · {mud.room} {mud.active ? '泥潭封路' : `第 ${mud.activeRound} 回合泥潭预警`}</span>}
          </span>
        )}
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
        <button
          className={`tcg-btn ghost tiny ${announceOpen ? '' : 'off'} ${announceUnread > 0 ? 'has-unread' : ''}`}
          title="全局播报：所有公开动作 + 服务端时间戳 + 展示时长"
          onClick={() => setAnnounceOpen((v) => !v)}
        >
          📣 播报{announceUnread > 0 ? <span className="unread-badge">{announceUnread > 99 ? '99+' : announceUnread}</span> : ''}
        </button>
        <button
          className={`tcg-btn ghost tiny ${logOpen ? '' : 'off'} ${logUnread > 0 ? 'has-unread' : ''}`}
          aria-expanded={logOpen}
          aria-controls="battle-log"
          onClick={() => setLogOpen((v) => !v)}
        >
          📜 日志{logUnread > 0 ? <span className="unread-badge">{logUnread > 99 ? '99+' : logUnread}</span> : ''}
        </button>
        <button className={`tcg-btn ghost tiny ${chatOpen ? '' : 'off'}`} onClick={() => setChatOpen((v) => !v)}>
          💬 发言{chat.length > 0 ? `（${chat.length}）` : ''}
        </button>
        {REPLAY_ENABLED && (
          <button className="tcg-btn ghost tiny" onClick={() => { setReplayId(lobby.replays?.[0]?.id ?? null); setReplayOpen(true); }}>🎬 回放</button>
        )}
        {isHost && game.phase === 'over' && (
          <button className="tcg-btn" onClick={prepareRematch} disabled={rematchPending}>再来一局 · 重新选角</button>
        )}
        {rematchError && (winDismissed || !finaleReady || finaleCameraPending) && (
          <span role="alert" className="error-banner">{rematchError}</span>
        )}
        <button className="tcg-btn ghost" onClick={onExit}>退出房间</button>
      </header>

      {finaleReady && !finaleCameraPending && !winDismissed && (
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
              {isHost && <button className="tcg-btn" onClick={prepareRematch} disabled={rematchPending}>再来一局 · 重新选角</button>}
              {REPLAY_ENABLED && (
                <button className="tcg-btn ghost" onClick={() => { setReplayId(lobby.replays?.[0]?.id ?? null); setReplayOpen(true); }}>🎬 观看回放</button>
              )}
              <button className="tcg-btn ghost" onClick={() => { setWinDismissed(true); setStatsOpen(true); }}>📊 本局战绩</button>
              <button className="tcg-btn ghost" onClick={onExit}>离开房间</button>
              <button className="tcg-btn ghost" onClick={() => setWinDismissed(true)}>查看战场</button>
            </div>
            {rematchError && <p role="alert" className="error-banner">{rematchError}</p>}
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
        {/* ── 战场主体：3D 战场（WebGL 可用时默认）或沉浸牌桌 2D 回退 ── */}
        <section className={`battlefield ${use3d ? 'bt3d-stage' : 'bt-table'} anim-in ${game.phase === 'over' ? 'is-over' : ''}`} data-pace={queueState.pace}>
          {/* 全局播报：所有公开动作的战场中央横幅（服务端权威，带时间戳与停留时长） */}
          {pres.globalAnnounce && <GlobalAnnounceBanner item={pres.globalAnnounce} />}
          {pres.moveBanner && (
            <div className="move-banner battle-movement" key={pres.moveBanner.key} role="status">
              {pres.moveBanner.moves.map(move => (
                <span key={move.pid}>🚶 <b>{game.players.find(p => p.id === move.pid)?.name ?? move.pid}</b>{' '}
                  {move.tower === 'enter' ? `进入 ${move.toRoom} 的高塔` : move.tower === 'exit' && move.fromRoom === move.toRoom
                    ? `离开 ${move.toRoom} 的高塔` : `${move.fromRoom} → ${move.toRoom}`}
                </span>
              ))}
            </div>
          )}
          <FxOverlayHost
            views={presentationOverlays}
            mode={use3d ? '3d' : '2d'}
            interactive={false}
            reducedMotion={reducedMotion}
          />
          {manualCue && (
            <FxOverlayHost
              views={[manualCue]}
              mode={use3d ? '3d' : '2d'}
              interactive
              reducedMotion={reducedMotion}
              onSubmit={() => { void completeManualAction(); }}
              onCancel={cancelManualAction}
            />
          )}
          {(queueState.playing || queueState.depth > 0 || finaleWaiting || finaleCameraPending) && (
            <div className="battle-ctl" data-testid="battle-ctl" data-queue-depth={String(queueState.depth)} data-queue-playing={queueState.playing ? '1' : '0'}>
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
              {(finaleWaiting || finaleCameraPending) && <button className="bc-btn bc-finish" onClick={skipFinale}>⏩ 直接结算</button>}
            </div>
          )}
          {(finaleWaiting || finaleCameraPending) && <div className="finale-wait-chip">⚔ 终局演出呈现中…</div>}

          {!use3d && (
            <>
          {/* 切回 3D 入口（WebGL 可用且未失败时；3D 侧按钮对称提供「2D」） */}
          {webglOk && !battle3d.failed && (
            <div className="bt3d-corner">
              <button className="tcg-btn ghost tiny" title="切换到 3D 战场" onClick={toggleRenderer}>3D</button>
            </div>
          )}
          {/* 大伊万投掷物飞行层 */}
          <IvanProjectile throwView={pres.ivanThrow} game={game} />

          {/* 弧形远端房间（我的房间在桌沿区） */}
          <div className="bt-arc">
            {farRooms.map((rid, i) => (
              <BtRoom
                key={rid}
                rid={rid}
                pos={i}
                arcLen={farRooms.length}
                game={game}
                pres={pres}
                fx={pres.fx}
                hits={pres.hits}
                heals={pres.heals}
                misses={pres.misses}
                deaths={pres.deaths}
                revives={pres.revives}
                myIds={myIds}
                selActionHint={!!selAction?.targetHint}
                validTargets={validTargets}
                pickTargetOrDetail={pickTargetOrDetail}
                onShowStatus={setStatusId}
                interactCounts={interactCounts}
                throwAt={game.phase !== 'over' ? throwAt : undefined}
              />
            ))}
            {farRooms.length === 0 && <div className="bt-arc-empty">等待其他房间入座…</div>}
          </div>

          {/* 中央桌：出拳揭示（rps 完整 / act 收缩）+ 事件播报 + 移动横幅 */}
          <div className="bt-center">
            <RevealBoard game={game} />
            {eventTicker && (
              <div className="bt-ticker" key={tickerKey}>{eventTicker}</div>
            )}
          </div>

          {/* 桌沿：我的房间区（我的卡 + 同房间玩家，目标点选与演出一致） */}
          {me && (
            <div
              data-room={me.room}
              className={`bt-mine ${myRoomMembers.some((m) => m.id === game.currentActor) ? 'zone-acting' : ''} ${pres.zoneAlert?.room === me.room ? `zone-alert zone-alert-${pres.zoneAlert?.kind}` : ''} ${pres.ivanBoom?.room === me.room ? 'zone-boom' : ''} ${myRoomPendingIvan ? 'zone-pending-ivan' : ''}`}
            >
              <div className="bt-mine-head">
                <span className="bt-mine-icon">🏠</span>
                <span>◈ {me.room} · 我的房间</span>
                <span className="zone-n">{myRoomMembers.length} 人{myRoomMembers.some((m) => m.id === game.currentActor) ? ' · 行动中' : ''}</span>
                {mud?.room === me.room && <span className="ruins-mud-chip" data-active={mud.active}>{mud.active ? '泥潭封路' : '积水预警'}</span>}
                <RoomSlotMachines room={me.room} players={game.players} />
                {myRoomPendingIvan && (
                  <span className="ivan-pending bt-mine-pending" title={`大伊万预计在第 ${myRoomPendingIvan.explodeRound} 回合末爆炸（平局回合顺延）`}>
                    💣 预计第 {myRoomPendingIvan.explodeRound} 回合末爆炸
                  </span>
                )}
              </div>
              <div className="bt-mine-cards">
                {myRoomMembers.length === 0 && <div className="zone-empty">空房间</div>}
                {myRoomMembers.map((p) => (
                  <CharCardView
                    key={p.id}
                    p={p}
                    game={game}
                    isMine={myIds.some((i) => i.playerId === p.id)}
                    isTargetable={!!selAction?.targetHint && validTargets.some((t) => t.id === p.id)}
                    submitted={hasThrown(game, p.id)}
                    throwView={throwViewOf(game, p.id)}
                    fx={pres.fx[p.id]}
                    hit={pres.hits[p.id]}
                    heal={pres.heals[p.id]}
                    miss={pres.misses[p.id]}
                    death={pres.deaths[p.id]}
                    revive={pres.revives[p.id]}
                    isWinner={game.phase === 'over' && game.winner === p.id}
                    gotCount={interactCounts[p.id]?.got ?? 0}
                    onInteract={game.phase !== 'over' && p.alive && p.id !== meId ? () => throwAt(p.id, 'tomato') : undefined}
                    onClick={() => pickTargetOrDetail(p.id)}
                    onShowStatus={() => setStatusId(p.id)}
                  />
                ))}
              </div>
              {pres.ivanBoom?.room === me.room && <span key={pres.ivanBoom?.key} className="ivan-boom-fx" aria-hidden />}
            </div>
          )}
            </>
          )}
          {use3d && (
            <>
              {battle3d.view}
              <div className="bt3d-corner">
                <button className="tcg-btn ghost tiny" title="恢复默认视角（也可拖动旋转 / 滚轮缩放）" onClick={battle3d.resetView}>⛶ 视角</button>
                <details className="bt3d-settings">
                  <summary className="tcg-btn ghost tiny">画面</summary>
                  <div className="bt3d-settings-menu">
                    <button className="tcg-btn ghost tiny" aria-pressed={automaticCamera}
                      onClick={() => setAutomaticCamera(v => !v)}>自动镜头 {automaticCamera ? '开' : '关'}</button>
                    <button className="tcg-btn ghost tiny" aria-pressed={lowEffects}
                      onClick={() => setLowEffects(v => !v)}>精简特效 {lowEffects ? '开' : '关'}</button>
                  </div>
                </details>
                <button className="tcg-btn ghost tiny" title="切换到 2D 牌桌" onClick={toggleRenderer}>2D</button>
              </div>
              <div className="bt3d-reveal-wrap"><RevealBoard game={game} /></div>
            </>
          )}
        </section>

        <aside
          id="battle-log"
          aria-hidden={!logOpen}
          className={`log-side ${logOpen ? 'log-open' : 'log-closed'}`}
        >
          <LogPanel logs={logs} onClose={() => setLogOpen(false)} />
        </aside>

        {announceOpen && <AnnounceDrawer items={announces ?? []} onClose={() => setAnnounceOpen(false)} />}

        {/* ── 我的席位 + 手牌（3D 模式：底部悬浮操作坞） ── */}
        <section className={`action-dock ddz-hand anim-in ${use3d ? (dockNeedsLocalInput({
          myTurn: !!myTurnId,
          rps1: game.phase === 'rps1',
          orderPendingLocal: game.phase === 'rps2' && orderPendingLocalIds.length > 0,
          judgePendingLocal: game.phase === 'judge' && judgePendingLocalIds.length > 0,
          triggerLocalActor,
        }) ? 'is-my-turn' : 'is-waiting') : ''}`}>
          <div className="hand-layout">
            <MySeat p={me} isHost={isHost} acting={game.currentActor === meId} throwView={me ? throwViewOf(game, me.id) : null} hit={pres.hits[meId]} />
            <div className="hand-main">
              {myTurnId && actor && actor.id !== meId && <PlayerInventory p={actor} />}
              <div className="dock-title">
                ⚔ 行动坞 · 手牌
                {game.phase === 'act' && (
                  myTurnId
                    ? <span className="cbadge cbadge-acting">轮到 {myTurnId.name}</span>
                    : <span className="tcg-chip">等待 {game.players.find((p) => p.id === game.currentActor)?.name || '?'} 行动…</span>
                )}
                {game.phase === 'rps1' && <span className="tcg-chip">存活 {livingCount} 人 · 全员出拳后统一揭示</span>}
                {game.phase === 'rps2' && <span className="tcg-chip">行动排序 · 子轮 {(game.orderSub ?? 0) + 1} · 仅资格者出拳（不剥夺资格）</span>}
                {game.phase === 'judge' && judge && <span className="tcg-chip">⚡ {judge.label} · 第 {judge.round}/{judge.rounds} 局 · 双方各自出拳</span>}
                {game.phase === 'trigger' && game.trigger && <span className="tcg-chip">🌀 暴走 · {namesOf(game, [game.trigger.actor])} 指定目标</span>}
                {pendingSlashes.length > 0 && (
                  <span className="tcg-chip">🗡️ 三刀 · {pendingSlashes.map((d) => `${d.room}（第 ${d.explodeRound} 回合末）`).join('，')}</span>
                )}
              </div>

              {me && me.judgeStreak && me.judgeStreak.length > 0 && (
                <div className="judge-streak" role="status" aria-label="连判进度">
                  <span className="js-label">🌀 连判</span>
                  <span className="js-slots">
                    {[0, 1, 2].map((i) => {
                      const step = me.judgeStreak![i];
                      return (
                        <span key={i} className={`js-slot${step ? ` is-${step}` : ' is-empty'}`}>
                          {step === 'win' ? '赢' : step === 'tie' ? '平' : step === 'lose' ? '输' : '·'}
                        </span>
                      );
                    })}
                  </span>
                  <span className="js-hint">{judgeStreakHint(me.judgeStreak)}</span>
                </div>
              )}

              {game.phase === 'judge' && judge && (
                judgePendingLocalIds.length > 0
                  ? <ThrowPrivacy
                      myIds={judgePendingLocalIds}
                      game={game}
                      lobby={lobby}
                      stage="judge"
                      judgeLabel={judge.label}
                      judgeRound={judge.round}
                      judgeRounds={judge.rounds}
                    />
                  : <div className="privacy-veil">
                      {judge.waitingIds.length > 0
                        ? `⏳ 等待 ${namesOf(game, judge.waitingIds)} 出拳（${judge.label} · 第 ${judge.round}/${judge.rounds} 局，提交期间保密）…`
                        : `✅ 本机身份已出拳，等待${judge.label}判定结果…`}
                    </div>
              )}

              {game.phase === 'rps2' && (
                orderPendingLocalIds.length > 0
                  ? <ThrowPrivacy myIds={orderPendingLocalIds} game={game} lobby={lobby} stage="rps2" />
                  : <div className="privacy-veil">
                      {(() => {
                        const rest = orderGroup.filter((id) => !orderSubmittedIds.includes(id));
                        return rest.length > 0
                          ? `⏳ 等待 ${namesOf(game, rest)} 出拳（${game.orderPurpose === 'berserk' ? '暴走权排序' : '排序判定'}，输者先${game.orderPurpose === 'berserk' ? '暴走' : '动'}；领域与角色判定不参与）…`
                          : '✅ 本机身份已完成排序出拳，等待判定结果…';
                      })()}
                    </div>
              )}

              {game.phase === 'trigger' && game.trigger && (() => {
                const trig = game.trigger!;
                const mine = myIds.find((i) => i.playerId === trig.actor);
                const targets = game.players.filter((p) => p.alive && p.id !== trig.actor);
                return (
                  <div className="privacy-veil">
                    <p>🌀 暴走（回合最前）· {namesOf(game, [trig.actor])} 指定目标</p>
                    {mine ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 10 }}>
                        {targets.map((p) => (
                          <button
                            key={p.id}
                            className="tcg-btn"
                            onClick={async () => {
                              setBerserkMsg('');
                              const r = await net.submitBerserk(lobby.code, mine.playerId, mine.token, p.id) as { ok: boolean; error?: string };
                              if (!r.ok) setBerserkMsg(r.error || '暴走释放失败');
                            }}
                          >
                            {p.name}（{p.charName} · {fmtHp(p.hp)} HP · {p.room}）
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="pv-hint tcg-chip" style={{ display: 'inline-block', marginTop: 8 }}>
                        ⏳ 等待 {namesOf(game, [trig.actor])} 选择暴走目标…
                      </p>
                    )}
                    {berserkMsg && <div className="error-text">{berserkMsg}</div>}
                  </div>
                );
              })()}

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
                        className={`scard ${selAction?.key === o.key && !o.disabledReason ? 'selected' : ''}`}
                        disabled={!!o.disabledReason}
                        title={o.disabledReason}
                        onClick={() => { setManualCue(null); setManualAction(null); setSelAction(o); setActMsg(''); }}
                      >
                        <div className="scard-head">
                          <span className="scard-name">{o.label}</span>
                          <span className="scard-type">{o.typeLabel}</span>
                        </div>
                        <div className="scard-desc">{o.desc.length > 44 ? o.desc.slice(0, 44) + '…' : o.desc}</div>
                        <div className="scard-need">{o.disabledReason ?? (o.manual ? '🎰 手动拉杆' : o.targetHint ? (o.roomHint ? '🎯 目标 + 🗺️ 房间' : o.multiTarget ? '🎯 可多选目标' : '🎯 需选择目标') : o.roomHint ? '🗺️ 需选择房间' : o.key === 'milk' ? '🥛 嘲讽' : '')}</div>
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
                            {selAction.multiTarget
                              ? (selTargets.length > 0
                                ? `${selTargets.map((id) => game.players.find((p) => p.id === id)?.name).filter(Boolean).join('、')}（已选 ${selTargets.length} 人）`
                                : '（可点击多个战场高亮卡牌）')
                              : (selTarget ? game.players.find((p) => p.id === selTarget)?.name : '（点击战场高亮卡牌）')}
                          </b>
                        </span>
                      )}
                      {use3d && crowdedArena && selAction.targetHint && !selAction.multiTarget && validTargets.length > 0 && (
                        <select aria-label="目标玩家" value={selTarget} onChange={e => setSelTarget(e.target.value)}>
                          <option value="">选择目标玩家</option>
                          {validTargets.map(p => <option key={p.id} value={p.id}>{p.name} · {p.room}</option>)}
                        </select>
                      )}
                      {(selAction.roomHint || selAction.key === 'move') && (use3d && !crowdedArena ? (
                        // 3D：直接点击战场中发绿光的房间（石台绿光高亮），不再依赖下拉框
                        <span className="room-pick-hint">
                          {selRoom
                            ? <>已选房间 <b>{selRoom}</b> · 点击其他发绿光房间可更改</>
                            : '🗺️ 点击战场中发绿光的房间'}
                        </span>
                      ) : (
                        <select aria-label="目标房间" value={selRoom} onChange={(e) => setSelRoom(e.target.value)}>
                          {use3d && <option value="">选择目标房间</option>}
                          {game.roomIds.map((r) => (
                            <option key={r} value={r} disabled={r === blockedRoom || (!!selAction.roomExcludeCurrent && r === actor?.room)}>
                              {r}（{game.players.filter((p) => p.alive && p.room === r).map((p) => p.name).join('、') || '空'}{r === blockedRoom ? ' · 泥潭封路' : selAction.roomExcludeCurrent && r === actor?.room ? ' · 当前房间不可选' : ''}）
                            </option>
                          ))}
                        </select>
                      ))}
                      {(() => {
                        if (selAction.key !== 'attack' || !selTarget || !actor) return null;
                        const cd = CHARACTERS[actor.charId] || CHARACTERS['default'];
                        const tgt = game.players.find((x) => x.id === selTarget);
                        if (!tgt || !cd.rangedNeedsAim || tgt.room === actor.room) return null;
                        if (cd.aimExemptWhenDomain && actor.char.domain === true) return null;
                        if (actor.char.aim === selTarget) return null;
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
                      {selAction.sealHint && (
                        <select aria-label="要封印的行动" value={selSeal} onChange={(e) => setSelSeal(e.target.value)}>
                          <option value="">选择要封印的行动</option>
                          {sealCandidates(game.players.find((p) => p.id === selTarget)).map((a) => (
                            <option key={a.action} value={a.action}>{a.label}</option>
                          ))}
                        </select>
                      )}
                      {blockedRoom && <span className="ruins-mud-chip" data-active="true">{blockedRoom} 泥潭封路，下回合恢复</span>}
                      <button className="tcg-btn" disabled={!!selectedDisabledReason || (!!selAction.targetHint && (selAction.multiTarget ? selTargets.length === 0 : !selTarget)) || ((selAction.roomHint || selAction.key === 'move') && (!selRoom || selRoom === blockedRoom || (selAction.roomExcludeCurrent && selRoom === actor?.room))) || (!!selAction.sealHint && !selSeal)} onClick={confirmAction}>{selAction.manual ? '确认并拉杆' : '确认发动'}</button>
                      <button className="tcg-btn ghost" onClick={resetSelection}>取消</button>
                      {(selectedDisabledReason || actMsg) && <span className="error-text">{selectedDisabledReason || actMsg}</span>}
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

      {statusPlayer && (
        <PlayerStatusModal p={statusPlayer} players={game.players} onClose={() => setStatusId(null)} />
      )}

      {detailPlayer && (
        <CardDetail
          p={detailPlayer}
          players={game.players}
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