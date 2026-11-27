import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  net, type LobbyState, type GameSnapshot, type SnapPlayer,
  type PlayerStats, type InteractionEvent, type InteractionKind, type AnnounceItem,
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
import { PlayerInventory, PlayerStatusList, PlayerStatusModal } from '../battle/player-status.js';
import { slotMachineRoomLabel, slotMachineState } from '../battle/slot-machine-state.js';
import { statusBlockingAction } from '../../../shared/src/statuses.js';
import { formatHp as fmtHp } from '../battle/status-types.js';
import { sfx } from '../audio/sfx.js';
import { Battle3D, detectWebGL, preferredRenderer, setPreferredRenderer } from '../battle3d/Battle3D.js';
import { clearSessionDegraded } from '../battle3d/gl-policy.js';
import { AnnounceDrawer, GlobalAnnounceBanner } from '../battle/announce-view.js';
import {
  hasThrown, namesOf, RevealBoard, THROW_ICON, THROW_LABEL, throwViewOf, ThrowPrivacy, type ThrowView,
} from '../battle/throw-view.js';
import '../battle3d/battle3d.css';

export { ThrowPrivacy, type ThrowView } from '../battle/throw-view.js';

const AI_LABEL: Record<string, string> = { easy: '休闲', normal: '普通', hard: '硬核' };
const INTERACT_ICON: Record<InteractionKind, string> = { tomato: '🍅', egg: '🥚', flower: '🌹' };
const INTERACT_NAME: Record<InteractionKind, string> = { tomato: '丢番茄', egg: '丢鸡蛋', flower: '献花' };

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

function atkOf(p: SnapPlayer): string {
  const cd = CHARACTERS[p.charId] || CHARACTERS['default'];
  const override = p.char.attackOverride;
  if (typeof override === 'number') return fmtHp(override);
  const v = cd.meleeDamage ?? cd.attack ?? 1;
  return fmtHp(v);
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
        <section className={`action-dock ddz-hand anim-in ${use3d ? ((myTurnId || game.phase === 'rps1' || (game.phase === 'rps2' && orderPendingLocalIds.length > 0) || (game.phase === 'judge' && judgePendingLocalIds.length > 0)) ? 'is-my-turn' : 'is-waiting') : ''}`}>
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

// ── 出拳揭示数据 ─────────────────────────────────────────

// ── 弧形远端房间（沉浸牌桌：地形图腾 + 房间成员卡 + 状态聚焦） ──

const ROOM_TOTEM: Record<string, string> = { R1: '🏔', R2: '🌲', R3: '🏘', R4: '🏰', R5: '🌋', R6: '🌊' };

function BtRoom({ rid, pos, arcLen, game, pres, myIds, selActionHint, validTargets, pickTargetOrDetail, onShowStatus, interactCounts, throwAt, fx, hits, heals, misses, deaths, revives }: {
  rid: string;
  /** 弧形位置（0..n），用于错落变换 */
  pos: number;
  /** 弧形房间总数（错落几何用） */
  arcLen: number;
  game: GameSnapshot;
  pres: PresentationState;
  myIds: { playerId: string }[];
  selActionHint: boolean;
  validTargets: SnapPlayer[];
  pickTargetOrDetail: (pid: string) => void;
  onShowStatus: (pid: string) => void;
  interactCounts: Record<string, { given: number; got: number }>;
  throwAt?: (targetId: string, kind: 'tomato') => void;
  fx: Record<string, FxView>;
  hits: Record<string, HitView>;
  heals: Record<string, HealView>;
  misses: Record<string, { key: number; sourceId?: string }>;
  deaths: Record<string, DeathView>;
  revives: Record<string, ReviveView>;
}) {
  const members = game.players.filter((p) => (p.alive || !!pres.deaths[p.id]) && p.room === rid);
  const hasActor = members.some((m) => m.id === game.currentActor);
  const alertHere = pres.zoneAlert?.room === rid;
  const boomHere = pres.ivanBoom?.room === rid;
  const pendingIvan = game.deferred?.find((d) => d.kind === 'ivan' && d.room === rid);
  const mud = game.ruins?.mud?.room === rid ? game.ruins.mud : null;
  const isWinnerRoom = game.phase === 'over' && game.winner && members.some((m) => m.id === game.winner);
  // 弧形错落：两侧房间略微下沉（中轴最高）
  const mid = (arcLen - 1) / 2;
  const off = Math.abs(pos - mid);
  const drop = off * 14;
  return (
    <div
      data-room={rid}
      style={{ ['--bt-drop' as string]: `${drop}px` }}
      className={`bt-room ${members.length === 0 ? 'empty' : ''} ${hasActor ? 'zone-acting' : ''} ${alertHere ? `zone-alert zone-alert-${pres.zoneAlert?.kind}` : ''} ${boomHere ? 'zone-boom' : ''} ${pendingIvan ? 'zone-pending-ivan' : ''} ${isWinnerRoom ? 'zone-winner' : ''}`}
    >
      <div className="bt-room-head">
        <span className="bt-room-icon">{ROOM_TOTEM[rid] ?? '◈'}</span>
        <span className="bt-room-name">◈ {rid}</span>
        <span className="zone-n">{members.length > 0 ? `${members.length} 人${hasActor ? ' · 行动中' : ''}` : '空房间'}</span>
        {mud && <span className="ruins-mud-chip" data-active={mud.active}>{mud.active ? '泥潭封路' : '积水预警'}</span>}
        <RoomSlotMachines room={rid} players={game.players} />
      </div>
      <div className="bt-room-cards">
        {members.length === 0 && <div className="zone-empty">{pendingIvan ? '💣 待爆炸' : '空房间'}</div>}
        {members.map((p) => (
          <CharCardView
            key={p.id}
            p={p}
            game={game}
            isMine={myIds.some((i) => i.playerId === p.id)}
            isTargetable={selActionHint && validTargets.some((t) => t.id === p.id)}
            submitted={hasThrown(game, p.id)}
            throwView={throwViewOf(game, p.id)}
            fx={fx[p.id]}
            hit={hits[p.id]}
            heal={heals[p.id]}
            miss={misses[p.id]}
            death={deaths[p.id]}
            revive={revives[p.id]}
            isWinner={game.phase === 'over' && game.winner === p.id}
            gotCount={interactCounts[p.id]?.got ?? 0}
            onInteract={throwAt && p.alive && !myIds.some((i) => i.playerId === p.id) ? () => throwAt(p.id, 'tomato') : undefined}
            onClick={() => pickTargetOrDetail(p.id)}
            onShowStatus={() => onShowStatus(p.id)}
          />
        ))}
      </div>
      {pendingIvan && (
        <span className="ivan-pending" title={`大伊万预计在第 ${pendingIvan.explodeRound} 回合末爆炸（平局回合顺延）`}>
          💣 预计第 {pendingIvan.explodeRound} 回合末爆炸
        </span>
      )}
      {boomHere && <span key={pres.ivanBoom?.key} className="ivan-boom-fx" aria-hidden />}
    </div>
  );
}

// ── 我的席位（底部手牌左侧） ───────────────────────────

function RoomSlotMachines({ room, players }: { room: string; players: readonly SnapPlayer[] }) {
  return players.map(player => {
    const machine = slotMachineState(player);
    if (machine?.room !== room) return null;
    return <span key={player.id} className="room-slot-machine" data-landed={machine.landed} title={player.name}>
      <span aria-hidden>🎰 </span>{slotMachineRoomLabel(machine)}
    </span>;
  });
}

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
        <PlayerInventory p={p} />
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

function CharCardView({ p, game, isMine, isTargetable, submitted, throwView, fx, hit, heal, miss, death, revive, isWinner, gotCount, onInteract, onClick, onShowStatus }: {
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
  /** 局内小互动（丢番茄）：卡面快捷按钮 + 被砸计数 */
  gotCount?: number;
  onInteract?: () => void;
  onClick: () => void;
  onShowStatus: () => void;
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
        <button
          type="button"
          className={`ccard-hpbar ${dead ? 'empty' : ''}`}
          aria-label={`查看 ${p.name} 的生命与状态（${fmtHp(p.hp)}/${fmtHp(p.maxHp)}）`}
          title="点击查看生命与角色状态"
          onClick={(event) => { event.stopPropagation(); onShowStatus(); }}
        >
          <span className={`ccard-hpbar-fill ${heal ? 'rising' : ''}`} style={{ width: `${hpPct}%` }} />
          <span className="ccard-hp-text">{fmtHp(p.hp)}/{fmtHp(p.maxHp)}</span>
        </button>
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
        {!!gotCount && <span className="ccard-got" title={`被丢了 ${gotCount} 次`}>🍅{gotCount}</span>}
      </div>
      {onInteract && !dead && (
        <button
          className="ccard-tomato"
          title="丢番茄（纯娱乐，不影响对局）"
          onClick={(e) => { e.stopPropagation(); onInteract(); }}
        >🍅</button>
      )}

      {/* ── 演出叠加层（全部 key=事件 seq：同类事件重复触发会重播动画） ── */}
      {hit && (
        <span className="hitcut" key={`hc-${hit.key}`} data-testid="hitcut">
          <span className={`hitcut-slash ${hit.lethal ? 'lethal' : ''}`} />
          <span className="hitcut-flash" />
          {hit.segment && hit.segment.total > 1 && (
            <span className="hitcut-seg">{hit.segment.index}/{hit.segment.total}段</span>
          )}
        </span>
      )}
      {hit && (
        <span className={`dmg-float ${hit.lethal ? 'lethal' : ''}`} key={`df-${hit.key}`}>
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

function CardDetail({ p, players, onClose, canKick, onKick, stats, onInteract, gotCount }: {
  p: SnapPlayer;
  players: SnapPlayer[];
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
        <div style={{ marginTop: 12 }}>
          <PlayerStatusList p={p} players={players} />
        </div>
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

// ── 日志面板 ─────────────────────────────────────────────

function LogPanel({ logs, onClose }: {
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

// ── 大伊万投掷物飞行（V3）：从投掷者卡面飞向目标房间 ────────

function IvanProjectile({ throwView, game }: { throwView: { key: number; pid: string; room: string } | null; game: GameSnapshot }) {
  const [flight, setFlight] = useState<{ key: number; x0: number; y0: number; x1: number; y1: number } | null>(null);
  const lastKey = useRef<number | null>(null);

  useEffect(() => {
    if (!throwView || throwView.key === lastKey.current) return;
    lastKey.current = throwView.key;
    const from = document.querySelector(`[data-pid="${throwView.pid}"] .ccard-frame, [data-pid="${throwView.pid}"]`) as HTMLElement | null;
    const zone = document.querySelector(`[data-room="${throwView.room}"]`) as HTMLElement | null;
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
