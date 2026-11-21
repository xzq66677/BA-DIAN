/**
 * 原型 C · 沉浸牌桌式
 *
 * 核心构图：整屏是一张带透视的桌面。三个远端房间呈弧形排列（轻微透视+旋转），
 * 中央椭圆「桌面中央区」融合出拳揭示与事件播报；我的席位与手牌（行动卡扇形）
 * 融合在桌面下沿——操作区就是牌桌的一部分，而不是独立面板。
 * 日志 = 右侧荷官账本。
 */

import { useState } from 'react';
import type { SnapPlayer } from '../net.js';
import { useCardRoomFlip } from '../battle/flip.js';
import { THROW_ICON } from './labels.js';
import { cardMeta } from '../cards.js';
import { ProtoBar, ProtoCard, ProtoDock, ProtoFinale, ProtoFlight, ProtoLog, fmtHp, useProtoDock, useProtoGame, type ProtoArch } from './runtime.js';

export default function ProtoC({ onBack }: { onBack: () => void; onSwitch?: (a: ProtoArch) => void }) {
  const rt = useProtoGame();
  const dock = useProtoDock(rt);
  const [logOpen, setLogOpen] = useState(true);
  const { snap, bp } = rt;
  useCardRoomFlip(rt.snap?.players ?? [], false, '.pc-room-cards .pcard[data-pid]', 'flip-flying');
  if (!snap || !snap.players) {
    return <div className="proto-root"><div className="pbar"><span className="pbar-title">原型 C</span><span className="pbar-chip">初始化…</span></div></div>;
  }


  function members(rid: string): SnapPlayer[] {
    return snap.players.filter((p) => (p.alive || bp.pres.deaths[p.id]) && p.room === rid);
  }
  const pendingIvan = (rid: string) => snap.deferred?.find((d) => d.kind === 'ivan' && d.room === rid);
  const alertRoom = bp.pres.zoneAlert?.room ?? bp.pres.ivanBoom?.room;
  const me = snap.players.find((p) => p.id === rt.myId);
  const rv = snap.reveal;
  const orderChips = snap.phase === 'act' ? snap.queue : [];

  return (
    <div className="proto-root">
      <ProtoBar arch="C" paused={rt.paused} setPaused={rt.setPaused} restart={rt.restart} speedMs={rt.speedMs} setSpeedMs={rt.setSpeedMs} snap={snap} />
      <div className="proto-c">
        <div className="pc-table">
          {/* 弧形远端房间 */}
          <div className="pc-arc">
            {snap.roomIds.filter((r) => r !== me?.room).map((rid, i) => {
              const ms = members(rid);
              const pending = pendingIvan(rid);
              const acting = ms.some((m) => m.id === snap.currentActor);
              return (
                <div
                  key={rid}
                  data-room={rid}
                  className={`pc-room pos-${i} ${ms.length === 0 ? 'empty' : ''} ${acting ? 'zone-acting' : ''} ${alertRoom === rid ? `zone-alert zone-alert-${bp.pres.zoneAlert?.kind}` : ''} ${bp.pres.ivanBoom?.room === rid ? 'zone-boom' : ''} ${pending ? 'zone-pending' : ''}`}
                >
                  <div className="pc-room-title">
                    <span>◈ {rid}</span>
                    <span>{ms.length > 0 ? `${ms.length} 人${acting ? ' · 行动中' : ''}` : '空'}</span>
                  </div>
                  <div className="pc-room-cards">
                    {ms.length === 0 && <div className="pc-room-empty">— 空 位 —</div>}
                    {ms.map((p) => (
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
            })}
          </div>
          {/* 桌面中央 */}
          <div className={`pc-center ${alertRoom ? 'alert' : ''}`}>
            {rv ? (
              <>
                <span className="pc-center-label">🎴 出拳揭示</span>
                <div className="pc-center-order">
                  {Object.entries(rv.throws).map(([pid, t]) => {
                    const p = snap.players.find((x) => x.id === pid);
                    const result = rv.winners.includes(pid) ? '胜' : rv.losers.includes(pid) ? '负' : '平';
                    return (
                      <span key={pid} className="pbar-chip">
                        {THROW_ICON[t]} {p?.name} · {result}
                      </span>
                    );
                  })}
                </div>
                <span className="pc-center-verdict">{rv.stage === 'rps1' ? '初次判定' : '排序判定'} · 子轮 {rv.sub}</span>
              </>
            ) : snap.phase === 'rps1' ? (
              <>
                <span className="pc-center-label">🎲 隐藏出拳</span>
                <span className="pc-center-verdict">已提交 {snap.submittedIds.length}/{snap.aliveCount}（提交期间保密）</span>
              </>
            ) : (
              <>
                <span className="pc-center-label">⚔ 桌面中央</span>
                <span className="pc-center-verdict">
                  {bp.pres.ivanBoom ? '💥 大伊万爆炸！'
                    : bp.pres.ivanThrow ? '💣 大伊万投掷！'
                      : bp.pres.moveBanner
                        ? `🚶 ${snap.players.find((p) => p.id === bp.pres.moveBanner?.pid)?.name} ${bp.pres.moveBanner.from} → ${bp.pres.moveBanner.to}`
                        : bp.pres.zoneAlert ? '⚔️ 范围事件！' : '等待行动…'}
                </span>
              </>
            )}
            {orderChips.length > 0 && (
              <div className="pc-center-order">
                {orderChips.map((pid, i) => {
                  const p = snap.players.find((x) => x.id === pid);
                  const cls = i < snap.actIndex ? 'done' : i === snap.actIndex ? 'now' : '';
                  return <span key={pid} className={`pbar-chip ${cls}`} style={cls === 'done' ? { opacity: 0.4 } : cls === 'now' ? { background: 'var(--gold-2)', color: '#3a2a10' } : undefined}>{p?.name}</span>;
                })}
              </div>
            )}
          </div>
          <ProtoFlight throwView={bp.pres.ivanThrow} />
        </div>
        {/* 我的席位 + 手牌（融合桌面下沿） */}
        <div className="pc-mine">
          {me && (
            <div className={`pcard pcard-lg ${snap.currentActor === rt.myId ? 'is-acting' : ''}`} style={{ cursor: 'default', flexShrink: 0 }}>
              <div className="pcard-badges">
                <span className="cbadge cbadge-mine">我</span>
                {snap.phase === 'over' && snap.winner === rt.myId && <span className="cbadge cbadge-winner">👑 胜者</span>}
              </div>
              <div className="pcard-art">
                {cardMeta(me.charId)?.img ? <img src={cardMeta(me.charId)?.img} alt={me.charName} /> : <div className="pcard-art-ph">拔</div>}
              </div>
              <div className="pcard-plate"><span className="pcard-name">{me.name}</span><span className="pcard-atk">⚔ {fmtHp(me.hp)}❤</span></div>
              <div className="pcard-hpline"><span className="pcard-hp">📍{me.room}</span><span className="pcard-room">{me.charName}</span></div>
            </div>
          )}
          <div className="pc-hand">
            <ProtoDock rt={rt} dock={dock} wrapperClass="" title="🃏 手牌" />
          </div>
        </div>
        <div className="pc-log">
          <ProtoLog logs={rt.logs} open={logOpen} onToggle={() => setLogOpen(!logOpen)} />
        </div>
        <ProtoFinale rt={rt} onDismiss={() => onBack()} />
      </div>
    </div>
  );
}
