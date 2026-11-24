import { useEffect, useId, useRef } from 'react';
import type { SnapPlayer } from '../../../shared/src/protocol.js';
import { playerStatusItems } from './status-readers.js';
import { formatHp } from './status-types.js';

export function PlayerStatusList({ p, players }: { p: SnapPlayer; players?: readonly SnapPlayer[] }) {
  return (
    <div className="player-status-list" aria-label="角色状态">
      {playerStatusItems(p, players).map((item) => (
        <div className={`player-status-item tone-${item.tone}`} key={item.key} data-status={item.key}>
          <span className="psi-icon" aria-hidden>{item.icon}</span>
          <span className="psi-body">
            <span className="psi-heading"><b>{item.label}</b><strong>{item.value}</strong></span>
            <span className="psi-detail">{item.detail}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function PlayerStatusModal({ p, players, onClose }: { p: SnapPlayer; players: readonly SnapPlayer[]; onClose: () => void }) {
  const titleId = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  useEffect(() => {
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeHandler.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  const hpPct = Math.max(0, Math.min(100, (p.hp / Math.max(1, p.maxHp)) * 100));

  return (
    <div className="status-detail" onClick={onClose}>
      <section className="status-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
        <header className="status-head">
          <div>
            <span className="status-eyebrow">角色状态 · {p.room}</span>
            <h2 id={titleId}>{p.name} <small>{p.charName}</small></h2>
          </div>
          <button ref={closeButton} className="tcg-btn ghost tiny" aria-label="关闭状态详情" onClick={onClose}>关闭 ✕</button>
        </header>
        <div className="status-hp-summary">
          <div className="status-hp-numbers"><span>❤ 生命</span><strong>{formatHp(p.hp)} <small>/ {formatHp(p.maxHp)}</small></strong></div>
          <div className="status-hpbar" aria-hidden>
            <div className={`status-hp-fill ${hpPct > 50 ? 'high' : hpPct > 25 ? 'mid' : 'low'}`} style={{ width: `${hpPct}%` }} />
          </div>
        </div>
        <PlayerStatusList p={p} players={players} />
        <p className="status-privacy">仅显示当前公开快照，不包含未揭示出拳或判定历史。</p>
      </section>
    </div>
  );
}
