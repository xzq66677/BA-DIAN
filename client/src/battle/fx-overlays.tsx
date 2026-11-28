import type { ComponentType } from 'react';
import type { FxView } from './useBattlePresentation.js';
import type { PresentationData } from './events.js';

export interface FxOverlayView {
  key: number;
  kind: string;
  pid?: string;
  targetId?: string;
  room?: string;
  playerName?: string;
  durationMs?: number;
  presentation?: PresentationData;
}

export interface FxOverlayProps {
  view: FxOverlayView;
  mode: '2d' | '3d';
  interactive: boolean;
  reducedMotion: boolean;
  onSubmit?: () => void;
  onCancel?: () => void;
  onComplete?: () => void;
}

type FxOverlayComponent = ComponentType<FxOverlayProps>;

const overlays = new Map<string, FxOverlayComponent>();

export function registerFxOverlay(kind: string, component: FxOverlayComponent): void {
  overlays.set(kind, component);
}

/** 该 fx 是否为 modal 叠加演出（老虎机转轮等，注册表判定；Issue #104 播报闸门用） */
export function isOverlayFx(kind: string): boolean {
  return overlays.has(kind);
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
    presentation: view.presentation,
  };
}
