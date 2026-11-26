import { SLOT_DROP_FX } from '../battle/action-presentation.js';
import { registerActionPresenter } from './action-presenters.js';

registerActionPresenter(SLOT_DROP_FX, (scene, pid, room, durationMs) => {
  if (!room || !scene.playSlotDrop) return;
  scene.playSlotDrop(pid, room, Math.max(0.8, durationMs / 1000));
});
