/**
 * 拔典 · 3D 战场 React 封装层
 *
 * 职责：
 *  - WebGL 能力检测（不可用 → 渲染 null，由调用方回退 2D 牌桌）；
 *  - 挂载/卸载 BattleScene3D（StrictMode 双调用安全）；
 *  - 快照 → syncSnapshot；pres diff → 场景演出命令；
 *  - 目标高亮 / 房间选择模式 / reduced-motion / myRoom 透传；
 *  - 暴露 resetView（视角恢复按钮）与失败状态。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { BattleScene3D, type SnapLite } from './scene.js';
import { presToCommands, applyCommands } from './pres-adapter.js';
import type { PresentationState } from '../battle/useBattlePresentation.js';
import type { GameSnapshot } from '../net.js';

/** WebGL 能力检测（jsdom / 旧设备 / 被禁用 → false，安全回退 2D） */
export function detectWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') as WebGL2RenderingContext | null
      || c.getContext('webgl') as WebGLRenderingContext | null;
    return !!gl;
  } catch {
    return false;
  }
}

/** 渲染器偏好（localStorage 持久化；?r=2d 查询参数临时强制 2D） */
export function preferredRenderer(): '3d' | '2d' {
  try {
    if (typeof window === 'undefined') return '2d';
    const q = new URLSearchParams(window.location.search).get('r');
    if (q === '2d') return '2d';
    if (q === '3d') return '3d';
    return localStorage.getItem('badian-renderer') === '2d' ? '2d' : '3d';
  } catch {
    return '3d';
  }
}

export function setPreferredRenderer(v: '3d' | '2d'): void {
  try { localStorage.setItem('badian-renderer', v); } catch { /* ignore */ }
}

export interface Battle3DProps {
  game: GameSnapshot;
  /** 本机全部身份（「我」徽标） */
  myIds?: string[];
  pres: PresentationState;
  myRoom: string | null;
  targetablePids: string[];
  roomPickMode: boolean;
  reducedMotion: boolean;
  onPickPlayer: (pid: string) => void;
  onPickRoom: (rid: string) => void;
}

export function Battle3D(props: Battle3DProps): { view: React.ReactNode; failed: boolean; resetView: () => void } {
  const { game, pres, myRoom, myIds, targetablePids, roomPickMode, reducedMotion, onPickPlayer, onPickRoom } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<BattleScene3D | null>(null);
  const [failed, setFailed] = useState(!detectWebGL());
  const presRef = useRef<PresentationState>(pres);
  const hooksRef = useRef({ onPickPlayer, onPickRoom });
  hooksRef.current = { onPickPlayer, onPickRoom };

  // 挂载：创建场景（WebGL 初始化失败 → 通知回退）
  useEffect(() => {
    const host = hostRef.current;
    if (!host || failed) return;
    let scene: BattleScene3D;
    try {
      scene = new BattleScene3D(host, {
        onPickPlayer: (pid) => hooksRef.current.onPickPlayer(pid),
        onPickRoom: (rid) => hooksRef.current.onPickRoom(rid),
      });
    } catch {
      setFailed(true);
      return;
    }
    sceneRef.current = scene;
    scene.setReducedMotion(reducedMotion);
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);

  // 快照同步
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const lite: SnapLite = {
      players: game.players.map((p) => ({
        id: p.id, name: p.name, charId: p.charId, charName: p.charName,
        hp: p.hp, maxHp: p.maxHp, room: p.room, alive: p.alive,
        hidden: p.hidden, invisible: p.invisible, char: p.char,
      })),
      roomIds: game.roomIds,
      currentActor: game.currentActor,
      phase: game.phase,
      winner: game.winner,
      domainHolder: game.domainHolder ?? null,
      deferred: game.deferred ?? [],
      submittedIds: game.submittedIds,
      myIds: myIds ?? [],
    };
    scene.syncSnapshot(lite);
    scene.setMyRoom(myRoom);
  }, [game, myRoom, myIds]);

  // 演出命令（pres diff）
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const cmds = presToCommands(presRef.current, pres);
    presRef.current = pres;
    applyCommands(scene, cmds);
  }, [pres]);

  // 目标高亮 / 房间选择 / reduced-motion
  useEffect(() => { sceneRef.current?.setTargetable(targetablePids); }, [targetablePids]);
  useEffect(() => { sceneRef.current?.setRoomPickMode(roomPickMode); }, [roomPickMode]);
  useEffect(() => { sceneRef.current?.setReducedMotion(reducedMotion); }, [reducedMotion]);

  const resetView = () => sceneRef.current?.resetView();

  const view = useMemo(() => (
    <div className="b3-host" data-testid="battle3d" data-failed={failed ? '1' : '0'} ref={hostRef} />
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [failed]);

  return { view, failed, resetView };
}
