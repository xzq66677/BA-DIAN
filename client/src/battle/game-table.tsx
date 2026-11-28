/**
 * 沉浸牌桌 2D 渲染（自 pages/Game.tsx 拆分，Issue #107）：
 * 弧形远端房间 + 大伊万投掷物飞行层。3D 战场见 battle3d/。
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GameSnapshot, SnapPlayer } from '../net.js';
import { hasThrown, throwViewOf } from './throw-view.js';
import {
  type FxView, type HitView, type HealView, type DeathView, type ReviveView,
  type PresentationState,
} from './useBattlePresentation.js';
import { CharCardView, RoomSlotMachines } from './game-cards.js';

// ── 弧形远端房间（沉浸牌桌：地形图腾 + 房间成员卡 + 状态聚焦） ──

const ROOM_TOTEM: Record<string, string> = { R1: '🏔', R2: '🌲', R3: '🏘', R4: '🏰', R5: '🌋', R6: '🌊' };

export function BtRoom({ rid, pos, arcLen, game, pres, myIds, selActionHint, validTargets, pickTargetOrDetail, onShowStatus, interactCounts, throwAt, fx, hits, heals, misses, deaths, revives }: {
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

// ── 大伊万投掷物飞行（V3）：从投掷者卡面飞向目标房间 ────────

export function IvanProjectile({ throwView, game }: { throwView: { key: number; pid: string; room: string } | null; game: GameSnapshot }) {
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
