/**
 * 拔典 · 原型运行时（Phase B 设计探索专用，?proto=A|B|C 访问）
 *
 * 在浏览器内直接运行真实规则引擎（与 vitest / Arena 同源），由自动驱动器
 * 完成出拳与行动（候选链：技能/攻击/回复/移动/跳过，逐个尝试直到被引擎接受），
 * 产生的日志流入与正式对局完全相同的演出管线（BattleEventQueue / useBattlePresentation /
 * 终局延迟呈现）。三个架构原型共享该运行时，仅布局层不同。
 *
 * 非生产路径：仅 query 参数进入；构建体积增加约 20KB，可在方案定稿后移除或保留为演示模式。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Game } from '../../../shared/src/engine.js';
import { CHARACTERS } from '../../../shared/src/characters/index.js';
import { randomThrow } from '../../../shared/src/rng.js';
import type { ActionRequest, Throw } from '../../../shared/src/types.js';
import type { GameSnapshot, SnapPlayer } from '../net.js';
import { useBattlePresentation, type BattlePresentation } from '../battle/useBattlePresentation.js';
import { useCardRoomFlip } from '../battle/flip.js';
import type { LogLike } from '../battle/events.js';
import { cardMeta } from '../cards.js';
import { THROW_ICON, THROW_LABEL } from './labels.js';
import './proto.css';

export type ProtoArch = 'A' | 'B' | 'C';

export interface ProtoRuntime {
  snap: GameSnapshot;
  logs: LogLike[];
  bp: BattlePresentation;
  paused: boolean;
  setPaused: (v: boolean) => void;
  restart: () => void;
  speedMs: number;
  setSpeedMs: (v: number) => void;
  finished: boolean;
  myId: string;
  /** 玩家手动行动（原型交互验证用）：直接向引擎提交 */
  submitMyAction: (req: ActionRequest) => { ok: boolean; error?: string };
  /** 接管开关：true 时驱动器不再代打 P1 */
  setManual: (v: boolean) => void;
}

const SCENARIO: { id: string; name: string; charId: string }[] = [
  { id: 'P1', name: '你', charId: 'wuliuqi' },      // 三段 AOE
  { id: 'P2', name: '伊万酱', charId: 'ivan-girl' }, // 大伊万
  { id: 'P3', name: '马老师', charId: 'mabaoguo' },  // 太极反弹
  { id: 'P4', name: '五条老师', charId: 'gojo' },    // 领域
];

/** 从引擎候选动作构造一条「尽量制造丰富事件」的行动链（被拒则尝试下一条，最差为跳过） */
function actionChain(g: Game, pid: string): ActionRequest[] {
  const me = g.players[pid];
  const cd = g.charDef(pid);
  const others = g.aliveIds().filter((p) => p !== pid);
  const roll = g.rng.next();
  const chain: ActionRequest[] = [];
  // 角色技能（伊万酱必投掷，其他角色较高概率发动）
  for (const a of cd.actions ?? []) {
    const want = a.name === 'throwIvan' ? roll < 0.85 : roll < 0.4;
    if (!want) continue;
    const req: ActionRequest = { type: a.name } as ActionRequest;
    if (a.targetHint && a.targetHint !== 'none') {
      const pool = a.targetHint === 'sameRoomPlayer'
        ? others.filter((p) => g.players[p].room === me.room)
        : a.targetHint === 'otherRoomPlayer'
          ? others.filter((p) => g.players[p].room !== me.room)
          : others;
      if (pool.length === 0) continue;
      (req as unknown as { targetId: string }).targetId = g.rng.pick(pool);
    }
    if (a.roomHint) (req as unknown as { room: string }).room = g.rng.pick(g.roomIds);
    chain.push(req);
  }
  // 近战同房间目标
  const visibleSame = others.filter((p) => g.players[p].room === me.room && !g.players[p].hidden && !g.players[p].invisible);
  if (visibleSame.length > 0 && (roll < 0.75 || !cd.rangedCapable)) {
    chain.push({ type: 'attack', targetId: g.rng.pick(visibleSame) });
  } else if (cd.rangedCapable) {
    const far = others.filter((p) => !g.players[p].hidden && !g.players[p].invisible);
    if (far.length > 0) chain.push({ type: 'attack', targetId: g.rng.pick(far) });
  }
  if (me.hp < me.maxHp && roll > 0.45) chain.push({ type: 'heal' });
  if (roll > 0.72) {
    const rooms = g.roomIds.filter((r) => r !== me.room);
    if (rooms.length > 0) chain.push({ type: 'move', room: g.rng.pick(rooms) });
  }
  chain.push({ type: 'skip' });
  return chain;
}

export function useProtoGame(): ProtoRuntime {
  const [tick, setTick] = useState(0);
  const gameRef = useRef<Game | null>(null);
  const logsRef = useRef<LogLike[]>([]);
  const lastSeqRef = useRef(0);
  const [paused, setPaused] = useState(false);
  const [speedMs, setSpeedMs] = useState(520);
  const [snap, setSnap] = useState<GameSnapshot | null>(null);
  /** 局号：重开时 +1，清空演出队列游标（引擎 seq 每局从 1 重算） */
  const [gameNo, setGameNo] = useState(1);
  /** 玩家接管：用户点击行动卡后驱动器不再代打 P1，直到确认/取消 */
  const manualRef = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const speedRef = useRef(speedMs);
  speedRef.current = speedMs;

  const create = () => {
    const g = new Game({
      seed: (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
      chars: CHARACTERS,
      players: SCENARIO.map((s) => ({ id: s.id, name: s.name, charId: s.charId, type: 'local' as const })),
    });
    gameRef.current = g;
    logsRef.current = [];
    lastSeqRef.current = 0;
    manualRef.current = false;
    setGameNo((n) => n + 1);
    publish(g);
  };

  function publish(g: Game) {
    const delta = g.logs.filter((l) => l.seq > lastSeqRef.current);
    if (delta.length > 0) {
      lastSeqRef.current = delta[delta.length - 1].seq;
      logsRef.current = [...logsRef.current, ...delta.map((l) => ({ seq: l.seq, type: l.type, text: l.text, important: l.important, data: l.data }))];
    }
    setSnap(g.snapshot() as unknown as GameSnapshot);
    setLogsInternal(logsRef.current);
  }
  const [, setLogsInternal] = useState<LogLike[]>([]);

  useEffect(() => {
    create();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自动驱动器
  useEffect(() => {
    const iv = setInterval(() => {
      const g = gameRef.current;
      if (!g || pausedRef.current) return;
      if (g.phase === 'rps1') {
        for (const pid of g.aliveIds()) {
          if (!g.submittedIds.includes(pid)) g.submitThrow(pid, randomThrow(g.rng) as Throw);
        }
        publish(g);
      } else if (g.phase === 'act') {
        const cur = g.currentActor();
        // 玩家接管回合：跳过代打（等用户在行动坞确认）
        if (cur && !(cur === 'P1' && manualRef.current)) {
          for (const req of actionChain(g, cur)) {
            const r = g.submitAction(cur, req);
            if (r.ok) break;
          }
        }
        publish(g);
      } else if (g.phase === 'roundEnd') {
        // 引擎在行动耗尽时内部结算回合末；此处仅为保险驱动
        publish(g);
      }
    }, speedRef.current);
    return () => clearInterval(iv);
  }, [speedMs, tick, paused]);

  // 终局后停止驱动
  const finished = snap?.phase === 'over';
  useEffect(() => {
    if (finished) setPaused(true);
  }, [finished]);

  const bp = useBattlePresentation(logsRef.current, gameNo, snap?.phase);

  const restart = () => {
    setPaused(false);
    setTick((t) => t + 1);
    create();
  };

  /** 玩家手动行动（行动坞确认时调用）：绕过驱动器直接向引擎提交 */
  const submitMyAction = (req: ActionRequest): { ok: boolean; error?: string } => {
    const g = gameRef.current;
    if (!g) return { ok: false, error: '引擎未就绪' };
    const r = g.submitAction('P1', req);
    publish(g);
    return r;
  };
  const setManual = (v: boolean) => { manualRef.current = v; };

  if (!snap) {
    return { snap: null as unknown as GameSnapshot, logs: [], bp, paused, setPaused, restart, speedMs, setSpeedMs, finished: false, myId: 'P1', submitMyAction, setManual };
  }
  return { snap, logs: logsRef.current, bp, paused, setPaused, restart, speedMs, setSpeedMs, finished, myId: 'P1', submitMyAction, setManual };
}

// ── 共享小组件 ─────────────────────────────────────────────

export function fmtHp(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** 原型角色卡：卡面 + HP 条 + 状态徽章 + 全套演出叠加层（复用 tcg.css 的演出动画类） */
export function ProtoCard({ p, snap, bp, size = 'md', onClick, targetable, selected }: {
  p: SnapPlayer;
  snap: GameSnapshot;
  bp: BattlePresentation;
  size?: 'md' | 'sm' | 'lg';
  onClick?: () => void;
  targetable?: boolean;
  selected?: boolean;
}) {
  const meta = cardMeta(p.charId);
  const dead = !p.alive;
  const hit = bp.pres.hits[p.id];
  const heal = bp.pres.heals[p.id];
  const miss = bp.pres.misses[p.id];
  const death = bp.pres.deaths[p.id];
  const revive = bp.pres.revives[p.id];
  const fx = bp.pres.fx[p.id];
  const acting = snap.currentActor === p.id && !dead;
  const winner = snap.phase === 'over' && snap.winner === p.id;
  const hpPct = Math.max(0, Math.min(100, (p.hp / Math.max(1, p.maxHp)) * 100));
  const FX_ICON: Record<string, string> = { attack: '⚔️', heal: '💊', move: '🚶', milk: '🥛', skill: '✨', aim: '🎯', hide: '🙈', seek: '🔍', skip: '⏭️' };
  const rv = snap.reveal;
  const throwView = rv && rv.throws[p.id] ? { t: rv.throws[p.id], result: rv.winners.includes(p.id) ? 'win' : rv.losers.includes(p.id) ? 'lose' : 'tie' } : null;
  const cls = [
    'pcard', `pcard-${size}`,
    dead ? 'is-dead' : '', death ? 'is-dying' : '',
    acting ? 'is-acting' : '',
    targetable ? 'is-targetable' : '',
    selected ? 'is-selected' : '',
    winner ? 'is-winner' : '',
    hit ? 'flash-dmg' : '', heal ? 'heal-glow' : '',
  ].filter(Boolean).join(' ');
  return (
    <div className={cls} onClick={onClick} data-pid={p.id} title={`${p.name} · ${p.charName}`}>
      <div className="pcard-art">
        {meta?.img ? <img src={meta.img} alt={p.charName} /> : <div className="pcard-art-ph">拔</div>}
        {throwView && !dead && (
          <span className={`card-throw rv-${throwView.result}`}>
            <span className="ct-icon">{THROW_ICON[throwView.t]}</span>
            <span className="ct-tag">{throwView.result === 'win' ? '胜' : throwView.result === 'lose' ? '负' : '平'}</span>
          </span>
        )}
      </div>
      <div className="pcard-plate">
        <span className="pcard-name">{p.name}</span>
        <span className="pcard-atk">⚔ {cdAtk(p)}</span>
      </div>
      <div className="pcard-hpline">
        <span className="pcard-hp">❤ {fmtHp(p.hp)}/{fmtHp(p.maxHp)}</span>
        <span className="pcard-room">📍{p.room}</span>
      </div>
      <div className={`pcard-hpbar ${dead ? 'empty' : ''}`}><div className="ccard-hpbar-fill" style={{ width: `${hpPct}%` }} /></div>
      <div className="pcard-badges">
        {acting && <span className="cbadge cbadge-acting">行动中</span>}
        {p.hidden && !dead && <span className="cbadge cbadge-hide">🙈</span>}
        {!dead && typeof p.char.livesLeft === 'number' && (p.char.livesLeft as number) > 1 && <span className="cbadge cbadge-lives">💫{p.char.livesLeft}</span>}
        {p.char?.domain === true && !dead && <span className="cbadge cbadge-domain">✨领域</span>}
        {winner && <span className="cbadge cbadge-winner">👑 胜者</span>}
        {dead && <span className="cbadge cbadge-dead">淘汰</span>}
      </div>
      {/* 演出叠加层（与正式对局同一套动画） */}
      {hit && (
        <>
          <span className="hitcut" key={`hc-${hit.key}`}>
            <span className={`hitcut-slash ${hit.lethal ? 'lethal' : ''}`} />
            <span className="hitcut-flash" />
            {hit.segment && hit.segment.total > 1 && <span className="hitcut-seg">{hit.segment.index}/{hit.segment.total}段</span>}
          </span>
          <span className={`dmg-float ${hit.lethal ? 'lethal' : ''}`} key={`df-${hit.key}`}>-{fmtHp(hit.amount)}</span>
        </>
      )}
      {heal && (
        <>
          <span className="healfx" key={`hl-${heal.key}`}><span className="healfx-icon">✚</span></span>
          {!!heal.amount && heal.amount > 0 && <span className="heal-float" key={`hf-${heal.key}`}>+{fmtHp(heal.amount)}</span>}
        </>
      )}
      {miss && !dead && <span className="miss-float" key={`ms-${miss.key}`}>未命中</span>}
      {revive && <span className="revive-burst" key={`rv-${revive.key}`}>💫 {revive.livesLeft} 命复活</span>}
      {death && <span className="death-stamp" key={`dt-${death.key}`}>💀 淘汰</span>}
      {fx && !dead && (
        <span className={`fx-anim fx-${fx.kind}`} key={`fx-${fx.key}`}><span className="fx-icon">{FX_ICON[fx.kind] || '✨'}</span></span>
      )}
    </div>
  );
}

function cdAtk(p: SnapPlayer): string {
  const override = p.char.attackOverride;
  if (typeof override === 'number') return fmtHp(override);
  const cd = CHARACTERS[p.charId] || CHARACTERS['default'];
  return fmtHp(cd.meleeDamage ?? cd.attack ?? 1);
}

/** 原型日志栏（辅助信息：可折叠） */
export function ProtoLog({ logs, open, onToggle }: { logs: LogLike[]; open: boolean; onToggle?: () => void }) {
  const shown = useMemo(() => logs.slice(-40).reverse(), [logs]);
  if (!open) {
    return <button className="plog-tab" onClick={onToggle}>📜 日志</button>;
  }
  return (
    <div className="plog">
      <div className="plog-head">
        <span>📜 战斗日志</span>
        {onToggle && <button className="plog-close" onClick={onToggle}>✕</button>}
      </div>
      <div className="plog-scroll">
        {shown.map((l) => (
          <div key={l.seq} className={`plog-line ${l.important ? 'imp' : 'dim'}`}>{l.text}</div>
        ))}
      </div>
    </div>
  );
}

/** 原型顶栏：切换/暂停/速度/重开 */
export function ProtoBar({ arch, paused, setPaused, restart, speedMs, setSpeedMs, snap }: {
  arch: ProtoArch;
  paused: boolean;
  setPaused: (v: boolean) => void;
  restart: () => void;
  speedMs: number;
  setSpeedMs: (v: number) => void;
  snap: GameSnapshot;
}) {
  const phaseText = snap.phase === 'rps1' ? '隐藏出拳' : snap.phase === 'act' ? '行动阶段' : snap.phase === 'roundEnd' ? '回合末结算' : '对局结束';
  return (
    <div className="pbar">
      <a className="pbar-back" href="/">← 返回</a>
      <span className="pbar-title">原型 {arch}</span>
      <span className="pbar-chip">{phaseText}</span>
      <span className="pbar-chip">第 {snap.roundNo} 回合</span>
      <span className="pbar-chip">存活 {snap.aliveCount}</span>
      <span style={{ flex: 1 }} />
      <button className="pbar-btn" onClick={() => setPaused(!paused)}>{paused ? '▶ 继续' : '⏸ 暂停'}</button>
      <select className="pbar-speed" value={speedMs} onChange={(e) => setSpeedMs(Number(e.target.value))}>
        <option value={900}>0.5×</option>
        <option value={520}>1×</option>
        <option value={260}>2×</option>
      </select>
      <button className="pbar-btn" onClick={restart}>🔁 重开</button>
    </div>
  );
}

export { THROW_ICON, THROW_LABEL };

// ── 共享交互组件（行动坞 / 投掷物飞行 / 终局舞台） ──────────

/** 大伊万投掷物飞行（原型层：测量 .pcard → [data-room] 房间容器） */
export function ProtoFlight({ throwView }: { throwView: { key: number; pid: string; room: string } | null }) {
  const [flight, setFlight] = useState<{ key: number; x0: number; y0: number; x1: number; y1: number } | null>(null);
  const lastKey = useRef<number | null>(null);
  useEffect(() => {
    if (!throwView || throwView.key === lastKey.current) return;
    lastKey.current = throwView.key;
    const from = document.querySelector(`.pcard[data-pid="${throwView.pid}"]`) as HTMLElement | null;
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
  }, [throwView]);
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

export interface ProtoAction { key: string; label: string; typeLabel: string; need: string; targetHint?: string; roomHint?: boolean; }

export function actionsOf(p: SnapPlayer): ProtoAction[] {
  const cd = CHARACTERS[p.charId] || CHARACTERS['default'];
  const list: ProtoAction[] = [
    { key: 'attack', label: '攻击', typeLabel: '基础', need: '🎯 目标' },
    { key: 'move', label: '移动', typeLabel: '基础', need: '🗺️ 房间', roomHint: true },
    { key: 'heal', label: '回复', typeLabel: '基础', need: '' },
    { key: 'milk', label: '喝牛奶', typeLabel: '基础', need: '' },
    { key: 'hide', label: '躲藏', typeLabel: '基础', need: '' },
  ];
  for (const a of cd.actions ?? []) {
    list.push({
      key: a.name,
      label: a.label,
      typeLabel: '技能',
      need: a.targetHint && a.targetHint !== 'none' ? '🎯 目标' : a.roomHint ? '🗺️ 房间' : '✨ 直接发动',
      targetHint: a.targetHint && a.targetHint !== 'none' ? a.targetHint : undefined,
      roomHint: a.roomHint,
    });
  }
  list.push({ key: 'skip', label: '跳过', typeLabel: '基础', need: '' });
  return list;
}

/** 行动坞共享逻辑：选择 → 目标（战场点选）→ 确认（直接向引擎提交） */
export function useProtoDock(rt: ProtoRuntime) {
  const [sel, setSelRaw] = useState<ProtoAction | null>(null);
  const [target, setTarget] = useState('');
  const [room, setRoom] = useState('');
  const [msg, setMsg] = useState('');
  const myTurn = !!rt.snap && rt.snap.phase === 'act' && rt.snap.currentActor === rt.myId;
  const me = rt.snap?.players?.find((p) => p.id === rt.myId);
  const alive = !!me && me.alive;
  const options = useMemo(() => (me && alive ? actionsOf(me) : []), [me?.charId, alive]);
  const validTargets = useMemo(() => {
    if (!me || !sel?.targetHint || !rt.snap) return [];
    const others = rt.snap.players?.filter((p) => p.alive && p.id !== rt.myId) ?? [];
    switch (sel.targetHint) {
      case 'sameRoomPlayer': return others.filter((p) => p.room === me.room);
      case 'otherRoomPlayer': return others.filter((p) => p.room !== me.room);
      default: return others;
    }
  }, [me, sel, rt.snap?.players, rt.myId]);
  const targetable = (pid: string) => myTurn && !!sel?.targetHint && validTargets.some((t) => t.id === pid);

  function setSel(a: ProtoAction | null) {
    setSelRaw(a);
    setTarget('');
    setMsg('');
    rt.setManual(!!a); // 接管：驱动器停止代打 P1
  }

  function confirm() {
    if (!sel || !myTurn || !me || !rt.snap) return;
    const req: ActionRequest = { type: sel.key } as ActionRequest;
    if (sel.targetHint) {
      if (!target) { setMsg('请点击战场上的高亮目标'); return; }
      (req as unknown as { targetId: string }).targetId = target;
    }
    if (sel.roomHint || sel.key === 'move') {
      (req as unknown as { room: string }).room = room || rt.snap.roomIds[0];
    }
    const r = rt.submitMyAction(req);
    if (r.ok) { setSel(null); setMsg(''); }
    else setMsg(r.error || '行动被拒绝');
  }

  return { sel, setSel, target, setTarget, room, setRoom, msg, setMsg, myTurn, me, alive, options, validTargets, targetable, confirm };
}

/** 行动坞 UI（各原型用 wrapper class 决定摆放与质感；交互逻辑共享） */
export function ProtoDock({ rt, dock, wrapperClass, title }: {
  rt: ProtoRuntime;
  dock: ReturnType<typeof useProtoDock>;
  wrapperClass: string;
  title?: string;
}) {
  const snap = rt.snap;
  if (!snap) return null;
  const waitingFor = snap.players.find((p) => p.id === snap.currentActor);
  return (
    <div className={wrapperClass}>
      <div className="pa-dock-head">
        <span>{title ?? '⚔ 行动坞'}</span>
        {snap.phase === 'act' && (
          dock.myTurn
            ? <span className="pbar-chip">轮到 你</span>
            : <span className="pbar-chip">等待 {waitingFor?.name ?? '?'} 行动…</span>
        )}
        {dock.msg && <span className="pa-dock-msg">{dock.msg}</span>}
      </div>
      {dock.myTurn && dock.alive ? (
        <>
          <div className="pactions">
            {dock.options.map((o) => (
              <button
                key={o.key}
                className={`pact ${dock.sel?.key === o.key ? 'selected' : ''}`}
                onClick={() => dock.setSel(o)}
              >
                <div className="pact-head">
                  <span className="pact-name">{o.label}</span>
                  <span className="pact-type">{o.typeLabel}</span>
                </div>
                <div className="pact-need">{o.need}</div>
              </button>
            ))}
          </div>
          {dock.sel && (
            <div className="pa-dock-head" style={{ paddingBottom: 8 }}>
              <span>已选 【{dock.sel.label}】</span>
              {dock.sel.targetHint && (
                <span>{dock.target ? `目标：${rt.snap.players.find((p) => p.id === dock.target)?.name}` : '（点击战场高亮卡牌）'}</span>
              )}
              {(dock.sel.roomHint || dock.sel.key === 'move') && (
                <select className="pbar-speed" value={dock.room} onChange={(e) => dock.setRoom(e.target.value)}>
                  {rt.snap.roomIds.map((r) => (
                    <option key={r} value={r}>{r}（{rt.snap.players.filter((p) => p.alive && p.room === r).map((p) => p.name).join('、') || '空'}）</option>
                  ))}
                </select>
              )}
              <button className="pact-confirm" disabled={!!dock.sel.targetHint && !dock.target} onClick={dock.confirm}>确认发动</button>
              <button className="pbar-btn" onClick={() => dock.setSel(null)}>取消</button>
            </div>
          )}
        </>
      ) : (
        <div className="pa-dock-head" style={{ paddingBottom: 10, justifyContent: 'center' }}>
          {snap.phase === 'rps1' && <span>🎲 隐藏出拳阶段（演示自动出拳）</span>}
          {snap.phase === 'act' && <span>⏳ {waitingFor?.name ?? '?'} 正在行动…</span>}
          {snap.phase === 'roundEnd' && <span>💥 回合末结算中…</span>}
          {snap.phase === 'over' && <span>🏁 对局结束</span>}
        </div>
      )}
    </div>
  );
}

/** 终局舞台（与正式对局同一套 win-modal 样式；受终局延迟呈现 gate 控制） */
export function ProtoFinale({ rt, onDismiss }: { rt: ProtoRuntime; onDismiss: () => void }) {
  const { snap, bp } = rt;
  const [dismissed, setDismissed] = useState(false);
  const wasOver = useRef(false);
  const phase = snap?.phase;
  useEffect(() => {
    if (phase === 'over') wasOver.current = true;
    else if (wasOver.current) { wasOver.current = false; setDismissed(false); }
  }, [phase]);
  if (!snap || snap.phase !== 'over' || dismissed) return null;
  if (bp.finaleWaiting) {
    return (
      <>
        <div className="finale-chip">⚔ 终局演出呈现中…</div>
        <button
          className="pbar-btn" style={{ position: 'absolute', top: 6, right: 12, zIndex: 40 }}
          onClick={() => bp.api.skipFinaleWait()}
        >⏩ 直接结算</button>
      </>
    );
  }
  const wp = snap.players.find((p) => p.id === snap.winner);
  const meta = wp ? cardMeta(wp.charId) : undefined;
  return (
    <div className="win-overlay" onClick={() => setDismissed(true)}>
      <div className={`win-modal anim-in ${snap.winner ? '' : 'draw'}`} onClick={(e) => e.stopPropagation()}>
        {snap.winner ? (
          <>
            <span className="win-rays" aria-hidden />
            <span className="win-particles" aria-hidden>
              {Array.from({ length: 12 }, (_, i) => <i key={i} style={{ ['--i' as string]: String(i) } as React.CSSProperties} />)}
            </span>
            <div className="win-title">🏆 胜 负 判 定</div>
            {meta?.img ? <img className="win-art" src={meta.img} alt={wp?.charName} /> : null}
            <h1 className="win-name">{wp?.name}</h1>
            <div className="win-sub">使用「{wp?.charName}」 · HP {fmtHp(wp?.hp ?? 0)}</div>
            <div className="win-summary">第 {snap.roundNo} 回合终局 · {snap.players.length - snap.aliveCount}/{snap.players.length} 人出局</div>
          </>
        ) : (
          <>
            <div className="win-title">☠ 平 局</div>
            <h1 className="win-name">全员同时淘汰</h1>
            <div className="win-summary">第 {snap.roundNo} 回合终局 · 无人幸存</div>
          </>
        )}
        <div className="win-btns">
          <button className="tcg-btn" onClick={rt.restart}>🔄 再来一局</button>
          <button className="tcg-btn ghost" onClick={onDismiss}>关闭</button>
        </div>
      </div>
    </div>
  );
}
