/**
 * 原型页外壳：?proto=A|B|C —— 同一真实引擎对局，三种可切换的视觉架构。
 * 供 Phase B 设计探索比较，也保留为演示模式。
 */

import type { ProtoArch } from './runtime.js';
import ProtoA from './ProtoA.js';
import ProtoB from './ProtoB.js';
import ProtoC from './ProtoC.js';

const NEXT: Record<ProtoArch, ProtoArch> = { A: 'B', B: 'C', C: 'A' };

export default function PrototypePage({ arch }: { arch: ProtoArch }) {
  const back = () => { window.location.search = ''; };
  const switchTo = (a: ProtoArch) => {
    const url = new URL(window.location.href);
    url.searchParams.set('proto', a);
    window.location.href = url.toString();
  };
  const chip = (
    <div style={{ position: 'fixed', left: 12, bottom: 10, zIndex: 60, display: 'flex', gap: 6 }}>
      <button className="pbar-btn" onClick={() => switchTo(NEXT[arch])}>切换原型（当前 {arch}）</button>
    </div>
  );
  if (arch === 'A') return <><ProtoA onBack={back} onSwitch={switchTo} />{chip}</>;
  if (arch === 'B') return <><ProtoB onBack={back} onSwitch={switchTo} />{chip}</>;
  return <><ProtoC onBack={back} onSwitch={switchTo} />{chip}</>;
}
