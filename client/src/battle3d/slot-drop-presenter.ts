import { SLOT_DROP_FX } from '../battle/slot-machine-presentation.js';
import { registerActionPresenter, type ActionPresentationScene } from './action-presenters.js';

interface SlotDropScene extends ActionPresentationScene {
  playSlotDrop?(pid: string, room: string, seconds: number): void;
}

registerActionPresenter(SLOT_DROP_FX, ({ scene, event, durationMs }) => {
  const targetScene = scene as SlotDropScene;
  if (!event.pid || !event.room || !targetScene.playSlotDrop) return false;
  targetScene.playSlotDrop(event.pid, event.room, Math.max(0.8, durationMs / 1000));
  return true;
});
