import { registerActionPresentation } from './action-presentation.js';

export const SLOT_PULL_FX = 'slotPull';
export const SLOT_DROP_FX = 'slotDrop';

registerActionPresentation(SLOT_PULL_FX, {
  fx: SLOT_PULL_FX,
  mode: 'manual',
  durationMs: 2600,
  major: true,
});

// 老虎机侠的两种抽奖：都复用同一套拉杆演出（3 格 / 4 格由 presentation.reelCount 决定）
for (const spin of ['slotSpin3', 'slotSpin4']) {
  registerActionPresentation(spin, { fx: SLOT_PULL_FX, mode: 'manual', durationMs: 2600, major: true });
}

registerActionPresentation(SLOT_DROP_FX, {
  fx: SLOT_DROP_FX,
  mode: 'automatic',
  durationMs: 2200,
  major: true,
});
