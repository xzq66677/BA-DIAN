import { registerActionPresentation } from './action-presentation.js';

export const characterActionPresentations = [
  { action: 'possess', fx: 'ghostAttach', clip: 'attach', durationMs: 750 },
  { action: 'possessStrike', fx: 'ghostDrain', clip: 'drain', durationMs: 1350 },
  { action: 'possessControl', fx: 'ghostControl', clip: 'drain', durationMs: 1150 },
  { action: 'ghostSiphon', fx: 'ghostSiphon', clip: 'drain', durationMs: 1050 },
  { action: 'mount', fx: 'wildMount', clip: 'mount', durationMs: 1200 },
  { action: 'buildTower', fx: 'waterTower', clip: 'cast', durationMs: 1250 },
  { action: 'inhale', fx: 'waterInhale', clip: 'inhale', durationMs: 1400 },
  { action: 'blow', fx: 'waterExhale', clip: 'exhale', durationMs: 1280 },
] as const;

for (const { action, fx, durationMs } of characterActionPresentations) {
  registerActionPresentation(action, { fx, mode: 'automatic', durationMs, major: false });
}
