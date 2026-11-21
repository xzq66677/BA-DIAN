/**
 * 拔典 · 3D 战场 React 封装层
 *
 * 职责：
 *  - WebGL 能力检测（不可用 → 渲染 null，由调用方回退 2D 牌桌）；
 *  - 挂载/卸载 BattleScene3D（StrictMode 双调用安全）；
 *  - 快照 → syncSnapshot；pres diff → 场景演出命令；
 *  - 目标高亮 / 房间选择模式 / reduced-motion / myRoom 透传；
 *  - 暴露 resetView（视角恢复按钮）与失败状态；
 *  - 上下文丢失分级处理（B-031）：恢复窗口内恢复→继续；未恢复→本局回退 2D；
 *    会话内反复丢失→按 gl-policy 持久降级 2D（防重建循环）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { BattleScene3D, type SnapLite } from './scene.js';
import { presToCommands, applyCommands } from './pres-adapter.js';
import { gllog } from './gllog.js';
import {
  recordContextLost, markSessionDegraded, isSessionDegraded, clearSessionDegraded,
} from './gl-policy.js';
import { EMPTY_PRESENTATION, type PresentationState } from '../battle/useBattlePresentation.js';
import type { GameSnapshot } from '../net.js';

// 会话降级标记的清除入口（Game.tsx 用户主动切 3D 时调用）
export { clearSessionDegraded };

/** WebGL 能力检测（jsdom / 旧设备 / 被禁用 → false，安全回退 2D） */
export function detectWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') as WebGL2RenderingContext | null
      || c.getContext('webgl') as WebGLRenderingContext | null;
    // 探测上下文必须立即释放：Chromium 对存活 WebGL 上下文数量有上限，
    // 残留的探测上下文会累计并在触顶时「驱逐最旧存活上下文」——主游戏画布
    // 一旦成为最旧者即被驱逐（webglcontextlost），这是 B-031 的实证根因。
    const lose = (gl as { getExtension?: (n: string) => unknown } | null)
      ?.getExtension?.('WEBGL_lose_context') as { loseContext(): void } | null | undefined;
    lose?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/** 渲染器偏好（localStorage 持久化；?r=2d 查询参数临时强制 2D；会话级降级优先于用户偏好） */
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
  /** 场景是否应处于挂载状态（3D 模式）。false → dispose 场景，释放 raf/WebGL 上下文 */
  active?: boolean;
  onPickPlayer: (pid: string) => void;
  onPickRoom: (rid: string) => void;
}

export function Battle3D(props: Battle3DProps): { view: React.ReactNode; failed: boolean; resetView: () => void } {
  const { game, pres, myRoom, myIds, targetablePids, roomPickMode, reducedMotion, onPickPlayer, onPickRoom } = props;
  const active = props.active ?? true;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<BattleScene3D | null>(null);
  // 懒初始化：detectWebGL 每次调用都会创建真实 WebGL 上下文。此前写法
  // useState(!detectWebGL()) 在每次渲染都同步执行（函数组件体每次渲染都会跑），
  // 频繁快照广播的对局中每渲染泄漏一个探测上下文 → 上下文触顶 → 主画布被驱逐。
  // React 的懒初始化器保证只执行一次（B-031 根因修复）。
  const [failed, setFailed] = useState(() => !detectWebGL());
  const presRef = useRef<PresentationState>(pres);
  const gameRef = useRef(game);
  gameRef.current = game;
  const hooksRef = useRef({ onPickPlayer, onPickRoom });
  hooksRef.current = { onPickPlayer, onPickRoom };
  /** 场景创建代数：切换渲染器重建场景后，驱动快照/高亮/偏好等 effect 重新水合 */
  const [epoch, setEpoch] = useState(0);
  const epochRef = useRef(epoch);

  // 挂载/卸载：active=true 且未失败 → 创建场景；false 或失败 → dispose（释放 raf 与 WebGL 上下文）
  useEffect(() => {
    const host = hostRef.current;
    if (!host || failed || !active) return;
    // 诊断日志上下文（回合/阶段/场景统计；只读，不参与游戏逻辑）
    gllog.setContext(() => ({
      round: gameRef.current?.roundNo ?? -1,
      phase: gameRef.current?.phase ?? '',
    }));
    gllog.setStats(() => sceneRef.current?.debugStats() ?? null);
    let scene: BattleScene3D;
    try {
      scene = new BattleScene3D(host, {
        onPickPlayer: (pid) => hooksRef.current.onPickPlayer(pid),
        onPickRoom: (rid) => hooksRef.current.onPickRoom(rid),
        // 恢复窗口内未恢复（上下文已死）：本局回退 2D；
        // 会话累计丢失达阈值 → 持久降级（此后新挂载的 Game 页直接 2D，防重建循环）
        onContextLost: () => {
          const v = recordContextLost();
          gllog.push('fallback-2d', { lostCount: v.count, degrade: v.degrade, reason: v.reason || 'no-restore' }, true);
          if (v.degrade) markSessionDegraded();
          setFailed(true);
        },
        // 恢复成功：继续 3D；但已达降级阈值 → 主动降级（宁可 2D 也不再冒重建循环的风险）
        onContextRestored: () => {
          const v = recordContextLost();
          if (v.degrade) {
            gllog.push('degrade-after-restore', { lostCount: v.count, reason: v.reason || 'total' }, true);
            setFailed(true);
          }
        },
      });
    } catch (e) {
      gllog.push('scene-init-error', { error: String(e) }, true);
      setFailed(true);
      return;
    }
    gllog.push('scene-created', {}, false);
    sceneRef.current = scene;
    scene.setReducedMotion(reducedMotion);
    // E2E/取证探针（只读调试统计，不参与游戏逻辑）
    (window as unknown as { __b3scene?: BattleScene3D }).__b3scene = scene;
    // 场景代数 +1：快照/演出/高亮/房间选择/reduced-motion 各 effect 立即水合当前状态
    // （对局中途切换渲染器时，新场景不能等下一次广播才知道局面）
    setEpoch((n) => n + 1);
    return () => {
      scene.dispose();
      sceneRef.current = null;
      delete (window as unknown as { __b3scene?: BattleScene3D }).__b3scene;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed, active]);

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
  }, [game, myRoom, myIds, epoch]);

  // 演出命令（pres diff；场景重建后首跑以空态为基准 → 全量回放当前叠加层）
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const prev = epochRef.current === epoch ? presRef.current : EMPTY_PRESENTATION;
    epochRef.current = epoch;
    const cmds = presToCommands(prev, pres);
    presRef.current = pres;
    applyCommands(scene, cmds);
  }, [pres, epoch]);

  // 目标高亮 / 房间选择 / reduced-motion
  useEffect(() => { sceneRef.current?.setTargetable(targetablePids); }, [targetablePids, epoch]);
  useEffect(() => { sceneRef.current?.setRoomPickMode(roomPickMode); }, [roomPickMode, epoch]);
  useEffect(() => { sceneRef.current?.setReducedMotion(reducedMotion); }, [reducedMotion, epoch]);

  const resetView = () => sceneRef.current?.resetView();

  const view = useMemo(() => (
    <div className="b3-host" data-testid="battle3d" data-failed={failed ? '1' : '0'} ref={hostRef} />
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [failed]);

  return { view, failed, resetView };
}
