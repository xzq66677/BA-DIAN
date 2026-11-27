import { presentationMoves, type PresentationMove } from '../battle/events.js';
import { characterActionPresentations } from '../battle/collaboration-presentations.js';
import { registerActionPresenter, type ActionPresentationScene } from './action-presenters.js';

export interface AssetCue {
  clip: string;
  seconds: number;
  targets: readonly string[];
  moves?: readonly PresentationMove[];
  directional?: 'inhale' | 'exhale';
}
interface AssetPresentationScene extends ActionPresentationScene {
  playAssetCue?(pid: string, cue: AssetCue): boolean;
}

export function publicTargets(presentation: Readonly<Record<string, unknown>> | undefined, targetId?: string): string[] {
  const ids: unknown[] = Array.isArray(presentation?.targetIds) ? presentation.targetIds : [targetId];
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

for (const { fx, clip, durationMs: nominal } of characterActionPresentations) {
  registerActionPresenter(fx, ({ scene, event, durationMs }) => {
    const capable: AssetPresentationScene = scene;
    if (!event.pid || !capable.playAssetCue) return false;
    const directional = clip === 'inhale' || clip === 'exhale' ? clip : undefined;
    return capable.playAssetCue(event.pid, {
      clip, seconds: Math.max(.2, (durationMs || nominal) / 1000),
      targets: publicTargets(event.presentation, event.targetId), moves: presentationMoves(event.presentation), directional,
    });
  });
}
