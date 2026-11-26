import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BattleScene3D, type SnapLite } from './battle3d/scene.js';
import { FxOverlayHost, type FxOverlayView } from './battle/fx-overlays.js';
import './battle/presentation-plugins.js';
import './battle3d/presentation-plugins.js';
import './battle3d/battle3d.css';
import './slot-preview.css';

interface PreviewProbe {
  ready: boolean;
  getState(): { mode: string; kind: string; reducedMotion: boolean; lowEffects: boolean; interactive: boolean; status: string };
  stats(): ReturnType<BattleScene3D['debugStats']> | null;
}

declare global {
  interface Window { __slotPreview?: PreviewProbe; }
}

const snapshot: SnapLite = {
  roomIds: ['中央房'],
  currentActor: '',
  phase: 'act',
  winner: null,
  domainHolder: null,
  players: [],
  ruins: undefined,
};

function App() {
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [lowEffects, setLowEffects] = useState(false);
  const [view, setView] = useState<FxOverlayView | null>(null);
  const [reelCount, setReelCount] = useState<3 | 4>(4);
  const [interactive, setInteractive] = useState(true);
  const [status, setStatus] = useState('选择一种演出开始');
  const [sceneReady, setSceneReady] = useState(false);
  const [dropRun, setDropRun] = useState(0);
  const sceneHost = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<BattleScene3D | null>(null);
  const keyRef = useRef(0);

  useEffect(() => {
    if (mode !== '3d' || !sceneHost.current) return;
    const host = sceneHost.current;
    let scene: BattleScene3D;
    try {
      scene = new BattleScene3D(host, {
        onPickPlayer: () => {},
        onPickRoom: () => {},
      });
      scene.setAutomaticCamera(false);
      scene.syncSnapshot(snapshot, true);
      scene.resetView();
      sceneRef.current = scene;
      setSceneReady(true);
    } catch (error) {
      setStatus(`3D 初始化失败：${String(error)}`);
      return;
    }
    return () => {
      sceneRef.current = null;
      setSceneReady(false);
      scene.dispose();
    };
  }, [mode]);

  useEffect(() => {
    sceneRef.current?.setReducedMotion(reducedMotion);
    sceneRef.current?.setLowEffects(lowEffects);
  }, [reducedMotion, lowEffects, sceneReady]);

  useEffect(() => {
    if (mode !== '3d' || !sceneReady || dropRun === 0) return;
    sceneRef.current?.playSlotDrop('preview', '中央房', 2.2);
    setStatus('3D 老虎机从天而降');
  }, [mode, sceneReady, dropRun]);

  useEffect(() => {
    window.__slotPreview = {
      ready: true,
      getState: () => ({ mode, kind: view?.kind ?? '', reducedMotion, lowEffects, interactive, status }),
      stats: () => sceneRef.current?.debugStats() ?? null,
    };
    return () => { delete window.__slotPreview; };
  }, [mode, view, reducedMotion, lowEffects, interactive, status]);

  function nextView(kind: 'slotPull' | 'slotDrop'): FxOverlayView {
    keyRef.current += 1;
    return {
      key: keyRef.current,
      kind,
      pid: 'A',
      room: '中央房',
      playerName: '阿机',
      durationMs: kind === 'slotPull' ? 2600 : 2200,
      presentation: { reelCount },
    };
  }

  function playPull() {
    setView(nextView('slotPull'));
    setInteractive(true);
    setStatus('等待玩家拉动拉杆');
  }

  function playDrop(nextMode: '2d' | '3d') {
    setView(nextView('slotDrop'));
    setInteractive(false);
    setMode(nextMode);
    if (nextMode === '3d') setDropRun((value) => value + 1);
    else setStatus('2D 老虎机从天而降');
  }

  function reset() {
    sceneRef.current?.resetPresentation();
    setView(null);
    setInteractive(true);
    setDropRun(0);
    setStatus('已清理演出');
  }

  return (
    <main className="slot-preview" data-mode={mode} data-reduced-motion={reducedMotion ? '1' : '0'}>
      <header className="slot-preview-header">
        <div>
          <h1>老虎机侠演出预览</h1>
          <p>生产组件 · 手动输入 · 2D/3D 掉落</p>
        </div>
        <div className="slot-preview-actions">
          <div className="slot-reel-modes" role="group" aria-label="预览卷轴模式">
            {([3, 4] as const).map((count) => (
              <button
                key={count}
                data-testid={`preview-reels-${count}`}
                aria-pressed={reelCount === count}
                onClick={() => setReelCount(count)}
              >
                {count} 数字
              </button>
            ))}
          </div>
          <button data-testid="preview-pull" onClick={playPull}>中央手动拉杆</button>
          <button data-testid="preview-drop-2d" onClick={() => playDrop('2d')}>2D 从天而降</button>
          <button data-testid="preview-drop-3d" onClick={() => playDrop('3d')}>3D 从天而降</button>
          <button data-testid="preview-reset" onClick={reset}>清理</button>
        </div>
      </header>
      <section className="slot-preview-settings" aria-label="预览设置">
        <label><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /> reduced-motion</label>
        <label><input type="checkbox" checked={lowEffects} onChange={(event) => setLowEffects(event.target.checked)} /> low-effects</label>
        <output data-testid="preview-status">{status}</output>
      </section>
      <section className="slot-preview-battlefield">
        {mode === '3d' && <div ref={sceneHost} className="slot-preview-scene" data-testid="preview-scene" />}
        <FxOverlayHost
          views={view ? [view] : []}
          mode={mode}
          interactive={interactive}
          reducedMotion={reducedMotion}
          onSubmit={() => {
            setInteractive(false);
            setStatus('拉杆完成，模拟服务端已受理');
          }}
          onCancel={() => {
            setInteractive(true);
            setStatus('已取消，未提交行动');
          }}
          onComplete={() => setStatus('演出完成')}
        />
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
