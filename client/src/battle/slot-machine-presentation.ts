import { registerActionPresentation } from './action-presentation.js';

export const SLOT_PULL_FX = 'slotPull';
export const SLOT_DROP_FX = 'slotDrop';

registerActionPresentation(SLOT_PULL_FX, {
  fx: SLOT_PULL_FX,
  mode: 'manual',
  durationMs: 2200,
  major: true,
});

// 格数和停轮节奏随行动固定，预览仍使用通用拉杆。
// 时长与基础拉杆对齐略提速（Issue #104）：转轮期间播报横幅让位，等待感同步收短。
export const SLOT_SPIN_PRESENTATIONS = [
  { action: 'slotSpin3', fx: 'slotPull3', reelCount: 3, durationMs: 2200, stopAt: [.52, .62, .72] },
  { action: 'slotSpin4', fx: 'slotPull4', reelCount: 4, durationMs: 2800, stopAt: [.44, .54, .64, .78] },
] as const;

for (const { action, fx, durationMs } of SLOT_SPIN_PRESENTATIONS) {
  registerActionPresentation(action, { fx, mode: 'manual', durationMs, major: true });
}

registerActionPresentation(SLOT_DROP_FX, {
  fx: SLOT_DROP_FX,
  mode: 'automatic',
  durationMs: 2200,
  major: true,
});
