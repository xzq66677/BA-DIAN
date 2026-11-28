/**
 * 角色卡面组件（自 pages/Game.tsx 拆分，Issue #107）。
 * 只做展示：数据均来自服务端权威快照；动画演出由 useBattlePresentation 的事件视图驱动。
 */
import type { GameSnapshot, SnapPlayer, PlayerStats, InteractionKind } from '../net.js';
import { CHARACTERS } from '../../../shared/src/characters/index.js';
import { cardMeta } from '../cards.js';
import { PlayerInventory, PlayerStatusList } from './player-status.js';
import { THROW_ICON, THROW_LABEL, type ThrowView } from './throw-view.js';
import type { FxView, HitView, HealView, DeathView, ReviveView } from './useBattlePresentation.js';
import { deathStamp } from './death-presentation.js';
import { slotMachineRoomLabel, slotMachineState } from './slot-machine-state.js';
import { formatHp as fmtHp } from './status-types.js';

export const INTERACT_ICON: Record<InteractionKind, string> = { tomato: '🍅', egg: '🥚', flower: '🌹' };
const INTERACT_NAME: Record<InteractionKind, string> = { tomato: '丢番茄', egg: '丢鸡蛋', flower: '献花' };

export function atkOf(p: SnapPlayer): string {
  const cd = CHARACTERS[p.charId] || CHARACTERS['default'];
  const override = p.char.attackOverride;
  if (typeof override === 'number') return fmtHp(override);
  const v = cd.meleeDamage ?? cd.attack ?? 1;
  return fmtHp(v);
}

export function RoomSlotMachines({ room, players }: { room: string; players: readonly SnapPlayer[] }) {
  return players.map(player => {
    const machine = slotMachineState(player);
    if (machine?.room !== room) return null;
    return <span key={player.id} className="room-slot-machine" data-landed={machine.landed} title={player.name}>
      <span aria-hidden>🎰 </span>{slotMachineRoomLabel(machine)}
    </span>;
  });
}

export function MySeat({ p, isHost, acting, throwView, hit }: { p?: SnapPlayer; isHost: boolean; acting: boolean; throwView: ThrowView | null; hit?: HitView }) {
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

export function CharCardView({ p, game, isMine, isTargetable, submitted, throwView, fx, hit, heal, miss, death, revive, isWinner, gotCount, onInteract, onClick, onShowStatus }: {
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
        <span className={deathStamp(death.cause).cls} key={`dt-${death.key}`}>{deathStamp(death.cause).text}</span>
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

export function CardDetail({ p, players, onClose, canKick, onKick, stats, onInteract, gotCount }: {
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
