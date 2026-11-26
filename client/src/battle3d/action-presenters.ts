export interface ActionPresentationScene {
  playAction(pid: string, kind: string, targetId?: string): void;
  playSlotDrop?(pid: string, room: string, seconds: number): void;
}

export type ActionPresenter = (
  scene: ActionPresentationScene,
  pid: string,
  targetId: string | undefined,
  durationMs: number,
) => void;

const presenters = new Map<string, ActionPresenter>();

export function registerActionPresenter(kind: string, presenter: ActionPresenter): void {
  presenters.set(kind, presenter);
}

export function playActionPresenter(
  scene: ActionPresentationScene,
  pid: string,
  kind: string,
  targetId: string | undefined,
  durationMs: number,
): boolean {
  const presenter = presenters.get(kind);
  if (!presenter) return false;
  presenter(scene, pid, targetId, durationMs);
  return true;
}
