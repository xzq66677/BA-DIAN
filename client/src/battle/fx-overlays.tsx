import type { ComponentType } from 'react';
import type { FxView } from './useBattlePresentation.js';
import type { SlotReels } from './slot-machine-reels.js';

export interface FxOverlayView {
  key: number;
  kind: string;
  pid?: string;
  targetId?: string;
  room?: string;
  playerName?: string;
  durationMs?: number;
  reels?: SlotReels;
}

export interface FxOverlayProps {
  view: FxOverlayView;
  mode: '2d' | '3d';
  interactive: boolean;
  reducedMotion: boolean;
  onPull?: () => void;
  onCancel?: () => void;
  onComplete?: () => void;
}

type FxOverlayComponent = ComponentType<FxOverlayProps>;

const overlays = new Map<string, FxOverlayComponent>();

export function registerFxOverlay(kind: string, component: FxOverlayComponent): void {
  overlays.set(kind, component);
}

export function FxOverlayHost({ views, ...props }: Omit<FxOverlayProps, 'view'> & { views: FxOverlayView[] }) {
  return views.map((view) => {
    const Overlay = overlays.get(view.kind);
    return Overlay ? <Overlay key={`${view.kind}:${view.pid ?? 'global'}:${view.key}`} {...props} view={view} /> : null;
  });
}

export function fxOverlayView(view: FxView, playerName?: string): FxOverlayView {
  return {
    key: view.key,
    kind: view.kind,
    pid: view.pid,
    targetId: view.targetId,
    room: view.room,
    playerName,
    durationMs: view.durationMs,
    reels: view.reels,
  };
}
