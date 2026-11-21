/**
 * 原型 B · 空间地图式
 *
 * 核心构图：房间是「有位置关系的地图」——2×2 地图块 + 可见的走廊连接，
 * 每个房间有地形图腾（🏔⛰🏘🏰）作为超越颜色的身份标识；移动以虚线路线
 * 从起点房间画到终点房间（SVG 路线 + 卡片 FLIP 飞行）；AOE/爆炸在对应
 * 地图块上发光。行动坞 = 左下浮动面板；日志 = 右上抽屉（默认收起）。
 */

import { useRef, useState } from 'react';
import type { SnapPlayer } from '../net.js';
import { useCardRoomFlip } from '../battle/flip.js';
import { ProtoBar, ProtoCard, ProtoDock, ProtoFinale, ProtoFlight, ProtoLog, fmtHp, useProtoDock, useProtoGame, type ProtoArch } from './runtime.js';

const TERRAIN: Record<string, string> = { R1: '🏔', R2: '🌲', R3: '🏘', R4: '🏰' };

export default function ProtoB({ onBack }: { onBack: () => void; onSwitch?: (a: ProtoArch) => void }) {
  const rt = useProtoGame();
  const dock = useProtoDock(rt);
  const [logOpen, setLogOpen] = useState(false);
  const { snap, bp } = rt;
  useCardRoomFlip(rt.snap?.players ?? [], false, '.pb-room-cards .pcard[data-pid]', 'flip-flying');
  // 移动路线：SVG 从来源房间中心 → 目的地房间中心
  const mapRef = useRef<HTMLDivElement | null>(null);
  if (!snap || !snap.players) {
    return <div className="proto-root"><div className="pbar"><span className="pbar-title">原型 B</span><span className="pbar-chip">初始化…</span></div></div>;
  }
  const move = bp.pres.moveBanner;

  function members(rid: string): SnapPlayer[] {
    return snap.players.filter((p) => (p.alive || bp.pres.deaths[p.id]) && p.room === rid);
  }
  const pendingIvan = (rid: string) => snap.deferred?.find((d) => d.kind === 'ivan' && d.room === rid);
  const alertRoom = bp.pres.zoneAlert?.room ?? bp.pres.ivanBoom?.room;
  const me = snap.players.find((p) => p.id === rt.myId);

  function roomCenter(rid: string): { x: number; y: number } | null {
    const map = mapRef.current;
    const zone = map?.querySelector(`[data-room="${rid}"]`) as HTMLElement | null;
    const mr = map?.getBoundingClientRect();
    const zr = zone?.getBoundingClientRect();
    if (!mr || !zr || zr.width === 0) return null;
    return { x: zr.left - mr.left + zr.width / 2, y: zr.top - mr.top + zr.height / 2 };
  }
  const from = move ? roomCenter(move.from) : null;
  const to = move ? roomCenter(move.to) : null;

  return (
    <div className="proto-root">
      <ProtoBar arch="B" paused={rt.paused} setPaused={rt.setPaused} restart={rt.restart} speedMs={rt.speedMs} setSpeedMs={rt.setSpeedMs} snap={snap} />
      <div className="proto-b">
        <div className="pb-map" ref={mapRef}>
          {(['R1', 'R2', 'R3', 'R4'] as const).filter((r) => snap.roomIds.includes(r)).map((rid, i) => {
            const area = ['1 / 1', '1 / 3', '3 / 1', '3 / 3'][i];
            return (
              <div key={rid} style={{ display: 'contents' }}>
                <MapRoom gridArea={area} rid={rid} snap={snap} bp={bp} dock={dock} members={members(rid)} pending={pendingIvan(rid)} alert={alertRoom === rid} boom={bp.pres.ivanBoom?.room === rid} />
              </div>
            );
          })}
          <div className="pb-corridor h" style={{ gridArea: '1 / 2' }} />
          <div className="pb-corridor v" style={{ gridArea: '2 / 1' }} />
          <div className="pb-corridor v" style={{ gridArea: '2 / 3' }} />
          <div className="pb-corridor h" style={{ gridArea: '3 / 2' }} />
          {/* 移动路线 */}
          {move && from && to && (
            <svg className="pb-routes" key={move.key}>
              <line
                className="pb-route"
                x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                stroke="#7ec8ff" strokeWidth="3" strokeDasharray="10 8" strokeLinecap="round"
              />
            </svg>
          )}
        </div>
        <ProtoFlight throwView={bp.pres.ivanThrow} />
        {/* 我的身份条 */}
        {me && (
          <div className="finale-chip" style={{ left: 14, top: 'auto', bottom: 118, transform: 'none' }}>
            我 · {me.charName} · ❤ {fmtHp(me.hp)} · 📍{me.room}
          </div>
        )}
        <ProtoDock rt={rt} dock={dock} wrapperClass="pb-dock" title="⚔ 行动面板" />
        {logOpen ? (
          <div className="pb-log">
            <ProtoLog logs={rt.logs} open onToggle={() => setLogOpen(false)} />
          </div>
        ) : (
          <div style={{ position: 'absolute', right: 14, top: 8, zIndex: 6 }}>
            <ProtoLog logs={rt.logs} open={false} onToggle={() => setLogOpen(true)} />
          </div>
        )}
        <ProtoFinale rt={rt} onDismiss={() => onBack()} />
      </div>
    </div>
  );
}

function MapRoom({ rid, snap, bp, dock, members, pending, alert, boom, gridArea }: {
  rid: string;
  snap: ReturnType<typeof useProtoGame>['snap'];
  bp: ReturnType<typeof useProtoGame>['bp'];
  dock: ReturnType<typeof useProtoDock>;
  members: SnapPlayer[];
  pending: { explodeRound: number } | undefined;
  alert: boolean;
  boom: boolean;
  gridArea: string;
}) {
  const acting = members.some((m) => m.id === snap.currentActor);
  return (
    <div
      data-room={rid}
      style={{ gridArea }}
      className={`pb-room ${members.length === 0 ? 'empty' : ''} ${acting ? 'zone-acting' : ''} ${alert ? `zone-alert zone-alert-${bp.pres.zoneAlert?.kind}` : ''} ${boom ? 'zone-boom' : ''} ${pending ? 'zone-pending' : ''}`}
    >
      <div className="pb-room-head">
        <span className="pb-room-icon">{TERRAIN[rid] ?? '◈'}</span>
        <span className="pb-room-name">{rid}</span>
        <span className="pb-room-n">{members.length > 0 ? `${members.length} 人${acting ? ' · 行动中' : ''}` : '空房间'}</span>
      </div>
      <div className="pb-room-cards">
        {members.length === 0 && <div className="pb-room-empty">— 无 人 —</div>}
        {members.map((p) => (
          <ProtoCard
            key={p.id}
            p={p}
            snap={snap}
            bp={bp}
            size="md"
            targetable={dock.targetable(p.id)}
            onClick={() => { if (dock.targetable(p.id)) dock.setTarget(p.id); }}
          />
        ))}
      </div>
    </div>
  );
}
