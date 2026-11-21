/**
 * 原型 A · 中央竞技场式
 *
 * 核心构图：战场是环绕「事件核心」的环形竞技场。房间不再是并排面板，
 * 而是围绕中央核心的四个方位据点（12/3/6/9 点位）；中央核心展示阶段/回合/
 * 事件流，事件发生时核心脉冲并向事件房间投射光束——「哪里发生」有空间指向。
 * 玩家只存在于房间据点中（无独立座位条重复）。
 * 操作区 = 底部指令台；日志 = 右侧细轨（辅助层级）。
 */

import { useState } from 'react';
import type { SnapPlayer } from '../net.js';
import { useCardRoomFlip } from '../battle/flip.js';
import { ProtoBar, ProtoCard, ProtoDock, ProtoFinale, ProtoFlight, ProtoLog, fmtHp, useProtoDock, useProtoGame, type ProtoArch } from './runtime.js';

const SLOT: Record<string, string> = { R1: 'pa-room-left', R2: 'pa-room-top', R3: 'pa-room-right', R4: 'pa-room-bottom' };

export default function ProtoA({ onBack }: { onBack: () => void; onSwitch?: (a: ProtoArch) => void }) {
  const rt = useProtoGame();
  const dock = useProtoDock(rt);
  const [logOpen, setLogOpen] = useState(true);
  const { snap, bp } = rt;
  const reduced = false;
  useCardRoomFlipLocal(rt.snap?.players ?? [], reduced);

  // 事件光束：核心 → 事件房间（AOE/伊万/爆炸）
  const alertRoom = bp.pres.zoneAlert?.room ?? bp.pres.ivanBoom?.room;
  const alertKind = bp.pres.ivanBoom ? 'boom' : bp.pres.zoneAlert?.kind;

  function members(rid: string): SnapPlayer[] {
    return snap.players.filter((p) => (p.alive || bp.pres.deaths[p.id]) && p.room === rid);
  }
  const pendingIvan = (rid: string) => snap.deferred?.find((d) => d.kind === 'ivan' && d.room === rid);
  const coreEvent = bp.pres.ivanBoom
    ? '💥 大伊万爆炸！'
    : bp.pres.ivanThrow
      ? '💣 大伊万投掷！'
      : bp.pres.moveBanner
        ? `🚶 ${snap.players.find((p) => p.id === bp.pres.moveBanner?.pid)?.name} → ${bp.pres.moveBanner.to}`
        : bp.pres.zoneAlert
          ? '⚔️ 范围攻击！'
          : '';

  if (!snap || !snap.players) {
    return <div className="proto-root"><div className="pbar"><span className="pbar-title">原型 A</span><span className="pbar-chip">初始化…</span></div></div>;
  }
  return (
    <div className="proto-root">
      <ProtoBar arch="A" paused={rt.paused} setPaused={rt.setPaused} restart={rt.restart} speedMs={rt.speedMs} setSpeedMs={rt.setSpeedMs} snap={snap} />
      <div className="proto-a">
        {/* 中央核心 */}
        <div className={`pa-core ${alertRoom ? 'alert' : ''}`}>
          <span className="pa-core-phase">{snap.phase === 'rps1' ? '🎲 出拳' : snap.phase === 'act' ? '⚔ 行动' : snap.phase === 'roundEnd' ? '💥 结算' : '🏁 终局'}</span>
          <span className="pa-core-round">第 {snap.roundNo} <small>回合</small></span>
          <span className="pa-core-event" key={coreEvent}>{coreEvent}</span>
          <span className="pbar-chip" style={{ marginTop: 4 }}>存活 {snap.aliveCount}</span>
        </div>
        {/* 事件光束 */}
        {alertRoom && <span className="pa-beam" key={`beam-${alertRoom}`} style={{ width: beamWidth(alertRoom), transform: `rotate(${beamAngle(alertRoom)}deg)` }} />}
        {/* 房间据点环 */}
        {snap.roomIds.map((rid) => {
          const ms = members(rid);
          const pending = pendingIvan(rid);
          const boomHere = bp.pres.ivanBoom?.room === rid;
          const alertHere = bp.pres.zoneAlert?.room === rid;
          const acting = ms.some((m) => m.id === snap.currentActor);
          return (
            <div
              key={rid}
              data-room={rid}
              className={`pa-room ${SLOT[rid] ?? 'pa-room-top'} ${ms.length === 0 ? 'empty' : ''} ${acting ? 'zone-acting' : ''} ${alertHere ? `zone-alert zone-alert-${bp.pres.zoneAlert?.kind}` : ''} ${boomHere ? 'zone-boom' : ''} ${pending ? 'zone-pending' : ''}`}
            >
              {pending && <span className="pa-pending-tag">💣 预计第 {pending.explodeRound} 回合末爆炸（平局顺延）</span>}
              <div className="pa-room-title">
                <span>◈ {rid}</span>
                <span>{ms.length > 0 ? `${ms.length} 人${acting ? ' · 行动中' : ''}` : '空'}</span>
              </div>
              <div className="pa-room-cards">
                {ms.length === 0 && <div className="pa-room-empty">空 拠 点</div>}
                {ms.map((p) => (
                  <ProtoCard
                    key={p.id}
                    p={p}
                    snap={snap}
                    bp={bp}
                    size="md"
                    targetable={dock.targetable(p.id)}
                    onClick={() => {
                      if (dock.targetable(p.id)) dock.setTarget(p.id);
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {/* 投掷物飞行 */}
        <ProtoFlight throwView={bp.pres.ivanThrow} />
        {/* 我的席位提示（我在哪个据点） */}
        {snap.players.find((p) => p.id === rt.myId) && (
          <div className="finale-chip" style={{ top: 'auto', bottom: 132 }}>
            我 · {snap.players.find((p) => p.id === rt.myId)?.charName} · ❤ {fmtHp(snap.players.find((p) => p.id === rt.myId)?.hp ?? 0)} · 📍{snap.players.find((p) => p.id === rt.myId)?.room}
          </div>
        )}
        {/* 指令台 */}
        <ProtoDock rt={rt} dock={dock} wrapperClass="pa-dock" title="⚔ 指令台" />
        {/* 日志细轨 */}
        <div className="pa-log">
          <ProtoLog logs={rt.logs} open={logOpen} onToggle={() => setLogOpen(!logOpen)} />
        </div>
        {/* 终局（延迟呈现受 gate 控制） */}
        <ProtoFinale rt={rt} onDismiss={() => onBack()} />
      </div>
    </div>
  );
}

/** 光束几何：从中心指向四点位 */
function beamAngle(room: string): number {
  switch (room) {
    case 'R2': return -90;
    case 'R3': return 0;
    case 'R4': return 90;
    default: return 180;
  }
}
function beamWidth(room: string): string {
  return room === 'R2' || room === 'R4' ? '30vh' : '38vw';
}

/** 局部 FLIP：房间重排时卡片飞行（复用共享 hook，选择器指向 pcard） */
function useCardRoomFlipLocal(players: SnapPlayer[], reduced: boolean) {
  useCardRoomFlip(players, reduced, '.pa-room-cards .pcard[data-pid]', 'flip-flying');
}
