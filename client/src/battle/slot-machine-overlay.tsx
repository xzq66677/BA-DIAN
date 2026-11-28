import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { SLOT_DROP_FX, SLOT_PULL_FX, SLOT_SPIN_PRESENTATIONS } from './slot-machine-presentation.js';
import { registerFxOverlay, type FxOverlayProps } from './fx-overlays.js';
import { normalizeSlotReelCount, normalizeSlotReels, SLOT_SYMBOLS, slotReelsFor, slotSymbolForDigit, type SlotReelCount } from './slot-machine-reels.js';
import { SlotSymbolIcon } from './slot-symbol-icon.js';
import './slot-machine.css';

type PullPhase = 'idle' | 'pulling' | 'spinning' | 'result';

function reelFrames(digit: number): readonly number[] {
  return [(digit + 9) % 10, digit, (digit + 1) % 10];
}

function SlotSymbolLegend() {
  return (
    <ul className="slot-symbol-legend" aria-label="老虎机数字符号对照">
      {SLOT_SYMBOLS.map((symbol) => (
        <li key={symbol.kind} data-symbol={symbol.kind}>
          <SlotSymbolIcon kind={symbol.kind} />
          <span><strong>{symbol.digits}</strong>{symbol.label}</span>
        </li>
      ))}
    </ul>
  );
}

function SlotMachineCabinet({ digits, spinning, pull = 0, stopped = 0, concealed = false }: {
  digits: readonly number[];
  spinning: boolean;
  pull?: number;
  stopped?: number;
  concealed?: boolean;
}) {
  return (
    <div className="slot-cabinet" style={{ '--pull': pull } as CSSProperties}>
      <div className="slot-cabinet-crown"><span>拔典</span><strong>好运</strong><span>拔典</span></div>
      <div className="slot-marquee">
        <div className="slot-reels" data-spinning={spinning ? '1' : '0'} style={{ gridTemplateColumns: `repeat(${digits.length}, minmax(0, 1fr))` }}>
          {digits.map((digit, index) => (
            <span
              className="slot-reel"
              key={index}
              data-digit={digit}
              data-symbol={slotSymbolForDigit(digit).kind}
              data-stopped={index < stopped ? '1' : '0'}
              data-concealed={concealed ? '1' : '0'}
              aria-hidden="true"
            >
              {reelFrames(digit).map((frame, frameIndex) => (
                <span className="slot-reel-cell" key={frameIndex}>
                  <strong>{frame}</strong>
                  <SlotSymbolIcon kind={slotSymbolForDigit(frame).kind} />
                </span>
              ))}
            </span>
          ))}
        </div>
        <div className="slot-marquee-lights" aria-hidden="true">
          {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
        </div>
      </div>
      <div className="slot-cabinet-panel">
        <span className="slot-coin-slot" aria-hidden="true" />
        <span className="slot-panel-mark">LUCKY</span>
        <span className="slot-coin-return" aria-hidden="true" />
      </div>
      <div className="slot-cabinet-base"><span /><span /><span /></div>
      <div className="slot-lever-pivot" aria-hidden="true"><i /></div>
    </div>
  );
}

function SlotReelModeSelector({ value, disabled, onChange }: {
  value: SlotReelCount;
  disabled: boolean;
  onChange: (count: SlotReelCount) => void;
}) {
  return (
    <div className="slot-reel-modes" role="group" aria-label="卷轴模式，结算由玩法负责">
      {([3, 4] as const).map((count) => (
        <button
          key={count}
          type="button"
          aria-pressed={value === count}
          disabled={disabled}
          onClick={() => onChange(count)}
        >
          {count} 数字
        </button>
      ))}
    </div>
  );
}

function SlotPullOverlay({ view, interactive, reducedMotion, onSubmit, onCancel, onComplete }: FxOverlayProps) {
  const spin = SLOT_SPIN_PRESENTATIONS.find(mode => mode.fx === view.kind);
  const [phase, setPhase] = useState<PullPhase>(interactive ? 'idle' : 'spinning');
  const [reelCount, setReelCount] = useState<SlotReelCount>(() => (
    spin?.reelCount ?? normalizeSlotReels(view.presentation?.reels)?.length ?? normalizeSlotReelCount(view.presentation?.reelCount) ?? 3
  ));
  const [stopped, setStopped] = useState(0);
  const [pull, setPull] = useState(0);
  const pullRef = useRef(0);
  const committed = useRef(false);
  const drag = useRef<{ pointerId: number; startY: number; moved: boolean } | null>(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;
  const spinning = phase === 'spinning';
  const presenting = phase === 'spinning' || phase === 'result';
  const eventReels = normalizeSlotReels(view.presentation?.reels);
  const { digits, source } = slotReelsFor({ key: view.key, reels: spin && eventReels?.length !== reelCount ? null : eventReels, reelCount });
  const awaitingResult = !!spin && source !== 'event';
  const resultLabel = digits.map((digit) => `${digit} ${slotSymbolForDigit(digit).label}`).join('、');

  useEffect(() => {
    if (!presenting || (interactive && awaitingResult)) return;
    const duration = reducedMotion ? 520 : Math.max(1500, view.durationMs ?? spin?.durationMs ?? 2200);
    const stops = !reducedMotion && spin ? spin.stopAt.map((at, index) => window.setTimeout(() => setStopped(index + 1), duration * at)) : [];
    const resultTimer = window.setTimeout(() => setPhase('result'), duration * (reducedMotion ? .72 : spin?.stopAt.at(-1) ?? .72));
    const completeTimer = window.setTimeout(() => completeRef.current?.(), duration);
    return () => {
      window.clearTimeout(resultTimer);
      window.clearTimeout(completeTimer);
      stops.forEach(timer => window.clearTimeout(timer));
    };
  }, [presenting, reducedMotion, view.durationMs, view.key, spin, interactive, awaitingResult]);

  useEffect(() => {
    const cancel = () => {
      drag.current = null;
      if (!committed.current) {
        pullRef.current = 0;
        setPull(0);
        setPhase('idle');
      }
    };
    const visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  function commit(): void {
    if (committed.current || !interactive) return;
    committed.current = true;
    drag.current = null;
    pullRef.current = 1;
    setPull(1);
    setPhase('spinning');
    onSubmit?.();
  }

  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (phase !== 'idle' || !interactive) return;
    committed.current = false;
    drag.current = { pointerId: event.pointerId, startY: event.clientY, moved: false };
    setPhase('pulling');
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const distance = event.clientY - current.startY;
    current.moved ||= Math.abs(distance) > 5;
    const next = Math.max(0, Math.min(1, distance / 92));
    pullRef.current = next;
    setPull(next);
  }

  function pointerUp(event: ReactPointerEvent<HTMLButtonElement>): void {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const shouldCommit = pullRef.current >= 0.3 || !current.moved;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (shouldCommit) commit();
    else {
      pullRef.current = 0;
      setPull(0);
      setPhase('idle');
    }
  }

  function cancelPointer(): void {
    drag.current = null;
    if (committed.current) return;
    pullRef.current = 0;
    setPull(0);
    setPhase('idle');
  }

  return (
    <div
      className="slot-machine-overlay slot-pull-overlay"
      data-testid="slot-pull-overlay"
      data-kind={view.kind}
      data-phase={phase}
      data-reduced-motion={reducedMotion ? '1' : '0'}
      data-reel-source={source}
      data-reel-count={digits.length}
      role="group"
      aria-label={`${view.playerName ?? '玩家'}的${spin ? `${spin.reelCount} 格` : ''}老虎机演出`}
    >
      {spin && <div className="slot-spin-title">{spin.reelCount} 格摇奖</div>}
      <div className="slot-machine-stage">
        <SlotMachineCabinet digits={digits} spinning={spinning} pull={pull} stopped={stopped} concealed={awaitingResult} />
        <button
          type="button"
          className="slot-lever-handle"
          aria-label="拉动老虎机拉杆"
          aria-disabled={!interactive || phase !== 'idle'}
          disabled={!interactive || phase !== 'idle'}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={cancelPointer}
          onLostPointerCapture={cancelPointer}
          onClick={(event) => { if (event.detail === 0) commit(); }}
        >
          <span className="slot-lever-knob" />
          <span className="slot-lever-shaft" />
        </button>
      </div>
      <div className="slot-machine-caption" aria-live="polite">
        {phase === 'idle' && (interactive ? '向下拖动或点击拉杆' : '老虎机准备就绪')}
        {phase === 'pulling' && `拉杆 ${Math.round(pull * 100)}%`}
        {phase === 'spinning' && (awaitingResult ? '等待结算' : '卷轴转动中')}
        {phase === 'result' && (awaitingResult ? '结果未同步' : `卷轴结果：${digits.join(' · ')}`)}
      </div>
      {interactive && !spin && phase === 'idle' && (
        <SlotReelModeSelector value={digits.length} disabled={source === 'event'} onChange={setReelCount} />
      )}
      <SlotSymbolLegend />
      <span className="sr-only" aria-live="polite">{phase === 'result' ? resultLabel : ''}</span>
      {interactive && phase === 'idle' && onCancel && (
        <button type="button" className="slot-machine-cancel" onClick={onCancel}>取消演出</button>
      )}
    </div>
  );
}

function SlotDropOverlay({ view, mode, reducedMotion, onComplete }: FxOverlayProps) {
  const completeRef = useRef(onComplete);
  const { digits } = slotReelsFor({
    key: view.key,
    reels: view.presentation?.reels,
    reelCount: view.presentation?.reelCount,
  });
  completeRef.current = onComplete;
  useEffect(() => {
    const timer = window.setTimeout(() => completeRef.current?.(), reducedMotion ? 700 : Math.max(1500, view.durationMs ?? 2200));
    return () => window.clearTimeout(timer);
  }, [reducedMotion, view.durationMs, view.key]);

  return (
    <div
      className={`slot-machine-overlay slot-drop-overlay ${mode === '3d' ? 'is-scene-drop' : ''}`}
      data-testid="slot-drop-overlay"
      data-kind={SLOT_DROP_FX}
      data-reel-count={digits.length}
      data-reduced-motion={reducedMotion ? '1' : '0'}
      role="status"
      aria-label={`${view.room ?? '目标房间'}有老虎机从天而降`}
    >
      <div className="slot-drop-trajectory">
        <div className="slot-machine-stage">
          <SlotMachineCabinet digits={digits} spinning={false} />
        </div>
        <span className="slot-impact-ring" aria-hidden="true" />
      </div>
      <div className="slot-machine-caption">老虎机从天而降{view.room ? ` · ${view.room}` : ''}</div>
    </div>
  );
}

function SlotMachineOverlay(props: FxOverlayProps) {
  return props.view.kind === SLOT_DROP_FX ? <SlotDropOverlay {...props} /> : <SlotPullOverlay {...props} />;
}

registerFxOverlay(SLOT_PULL_FX, SlotMachineOverlay);
for (const { fx } of SLOT_SPIN_PRESENTATIONS) registerFxOverlay(fx, SlotMachineOverlay);
registerFxOverlay(SLOT_DROP_FX, SlotMachineOverlay);
