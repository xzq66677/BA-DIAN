import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BattleScene3D, SnapLite } from './scene.js';
import { playMapEvent, projectMapSnapshot } from './map-playback.js';
import { gllog } from './gllog.js';
import { recordContextLost, markSessionDegraded, isSessionDegraded, clearSessionDegraded } from './gl-policy.js';
import type { BattlePresentationApi } from '../battle/useBattlePresentation.js';
import type { BattleEvent } from '../battle/events.js';
import type { GameSnapshot } from '../net.js';

export { clearSessionDegraded };

/** Cheap API availability check. The mounted renderer handles actual context creation failure. */
export function detectWebGL(): boolean {
  return typeof WebGL2RenderingContext !== 'undefined';
}

export function preferredRenderer(): '3d' | '2d' {
  try {
    if (typeof window === 'undefined') return '2d';
    const q = new URLSearchParams(window.location.search).get('r');
    if (q === '2d') return '2d';
    if (q === '3d') return '3d';
    if (isSessionDegraded()) return '2d';
    return localStorage.getItem('badian-renderer') === '2d' ? '2d' : '3d';
  } catch {
    return '3d';
  }
}

export function setPreferredRenderer(v: '3d' | '2d'): void {
  try { localStorage.setItem('badian-renderer', v); } catch { /* optional preference */ }
}

export interface Battle3DProps {
  game: GameSnapshot;
  gameNo?: number;
  resync?: { cursor: number };
  myIds: string[];
  playback: BattlePresentationApi;
  finaleReady: boolean;
  targetablePids: string[];
  roomPickMode: boolean;
  selectedRoom: string;
  blockedRoom?: string;
  selectedPlayer: string;
  reducedMotion: boolean;
  lowEffects: boolean;
  automaticCamera: boolean;
  active: boolean;
  onPickPlayer: (pid: string) => void;
  onShowStatus: (pid: string) => void;
  onPickRoom: (rid: string) => void;
}

export function Battle3D(props: Battle3DProps): { view: React.ReactNode; failed: boolean; resetView: () => void } {
  const { active, game, gameNo, resync, myIds, playback, finaleReady, targetablePids, roomPickMode, selectedRoom, blockedRoom,
    selectedPlayer, reducedMotion, lowEffects, automaticCamera } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<BattleScene3D | null>(null);
  const [failed, setFailed] = useState(false);
  const [sceneModule, setSceneModule] = useState<typeof import('./scene.js')>();
  const hooksRef = useRef(props);
  hooksRef.current = props;
  const authority = useRef<SnapLite | null>(null);
  const shown = useRef<SnapLite | null>(null);
  const match = useRef(gameNo);
  const snapshotSync = useRef(resync);
  const ending = useRef(false);

  function present(scene: BattleScene3D, event?: BattleEvent, immediate = false, durationMs = 600) {
    if (!authority.current || !sceneModule) return;
    // 辱骂计数按战局代（gameNo）跨场景实例存续：2D/3D 切换会重建场景实例，换代（重开新局）才清零
    sceneModule.setInsultGeneration(String(match.current ?? ''));
    const current = authority.current;
    const finale = ending.current && !playback.busy();
    const next = projectMapSnapshot(current, playback.remaining(), shown.current, event, finale);
    scene.syncSnapshot(next, immediate, Math.max(0.1, durationMs * 0.0009));
    shown.current = next;
    if (event) playMapEvent(scene, event, durationMs);
    if (finale) scene.showFinale(String(match.current ?? 'match'), next.winner);
  }

  useEffect(() => {
    if (!active || failed || sceneModule) return;
    let cancelled = false;
    void import('./scene.js').then((module) => {
      if (!cancelled) setSceneModule(module);
    }, (error: unknown) => {
      if (cancelled) return;
      gllog.push('scene-load-error', { error: String(error) }, true);
      setFailed(true);
    });
    return () => { cancelled = true; };
  }, [active, failed, sceneModule]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || failed || !active || !sceneModule) return;
    let scene: BattleScene3D;
    try {
      scene = new sceneModule.BattleScene3D(host, {
        onPickPlayer: (pid) => hooksRef.current.onPickPlayer(pid),
        onShowStatus: (pid) => hooksRef.current.onShowStatus(pid),
        onPickRoom: (rid) => hooksRef.current.onPickRoom(rid),
        onContextLost: () => {
          const state = recordContextLost();
          gllog.push('fallback-2d', { lostCount: state.count, degrade: state.degrade, reason: state.reason || 'no-restore' }, true);
          if (state.degrade) markSessionDegraded();
          setFailed(true);
        },
        onContextRestored: () => {
          const state = recordContextLost();
          if (state.degrade) {
            gllog.push('degrade-after-restore', { lostCount: state.count, reason: state.reason || 'total' }, true);
            setFailed(true);
          }
        },
      });
    } catch (error) {
      gllog.push('scene-init-error', { error: String(error) }, true);
      setFailed(true);
      return;
    }
    sceneRef.current = scene;
    const probe = window as unknown as { __b3scene?: BattleScene3D };
    probe.__b3scene = scene;
    gllog.setContext(() => ({ round: hooksRef.current.game.roundNo, phase: hooksRef.current.game.phase }));
    gllog.setStats(() => sceneRef.current?.debugStats() ?? null);
    gllog.push('scene-created', {}, false);
    const stop = playback.subscribe(signal => {
      if ('event' in signal) present(scene, signal.event, false, signal.durationMs);
      else {
        scene.resetPresentation();
        present(scene, undefined, true);
      }
    });
    return () => {
      stop();
      scene.dispose();
      sceneRef.current = null;
      authority.current = null;
      shown.current = null;
      delete probe.__b3scene;
      gllog.setContext(() => ({ round: -1, phase: '' }));
      gllog.setStats(() => null);
    };
    // The subscription and scene lifetime follow the renderer, not each snapshot.
  }, [failed, active, playback, sceneModule]);

  useLayoutEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setReducedMotion(reducedMotion);
    scene.setLowEffects(lowEffects);
    scene.setAutomaticCamera(automaticCamera);
  }, [active, sceneModule, reducedMotion, lowEffects, automaticCamera]);

  useLayoutEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setTargetable(targetablePids);
    scene.setSelection(roomPickMode, selectedRoom, selectedPlayer, blockedRoom);
  }, [active, sceneModule, targetablePids, roomPickMode, selectedRoom, selectedPlayer, blockedRoom]);

  useLayoutEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (match.current !== gameNo) {
      scene.resetPresentation(true);
      shown.current = null;
      match.current = gameNo;
    }
    if (snapshotSync.current !== resync) {
      snapshotSync.current = resync;
      if (resync) shown.current = null;
    }
    authority.current = {
      players: game.players,
      roomIds: game.roomIds,
      currentActor: game.currentActor,
      phase: game.phase,
      winner: game.winner,
      domainHolder: game.domainHolder ?? null,
      deferred: game.deferred ?? [],
      ruins: game.ruins,
      submittedIds: game.phase === 'rps2' ? game.orderSubmittedIds : game.submittedIds,
      myIds,
    };
    ending.current = finaleReady && game.phase === 'over';
    present(scene, undefined, !shown.current);
  }, [active, sceneModule, game, gameNo, resync, myIds, finaleReady, playback]);

  const view = (
    <div className="b3-host" data-testid="battle3d" data-failed={failed ? '1' : '0'} ref={hostRef}>
      {active && !failed && !sceneModule && <div className="b3-loading" role="status">正在加载 3D 战场…</div>}
    </div>
  );
  return { view, failed, resetView: () => sceneRef.current?.resetView() };
}
