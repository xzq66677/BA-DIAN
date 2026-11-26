import type { BattleEvent } from '../battle/events.js';

export interface ActionPresentationScene {
  playAction(pid: string, kind: string, targetId?: string): void;
}

export interface ActionPresenterContext {
  scene: ActionPresentationScene;
  event: BattleEvent;
  durationMs: number;
}

export type ActionPresenter = (context: ActionPresenterContext) => boolean;

const presenters = new Map<string, ActionPresenter>();

export function registerActionPresenter(kind: string, presenter: ActionPresenter): void {
  presenters.set(kind, presenter);
}

export function playActionPresenter(
  scene: ActionPresentationScene,
  event: BattleEvent,
  durationMs: number,
): boolean {
  if (!event.fx) return false;
  const presenter = presenters.get(event.fx);
  if (!presenter) return false;
  return presenter({ scene, event, durationMs });
}
