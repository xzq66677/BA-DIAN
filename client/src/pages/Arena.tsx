import { useMemo, useState } from 'react';
import { ALL_CASES } from '../../../shared/src/testcases/index.js';
import type { TestCase, TestRunResult } from '../../../shared/src/testcases/helpers.js';

/**
 * 机制测试场：与 vitest 共用 shared/src/testcases 的同一份测试数据。
 * 在浏览器内直接运行规则引擎，展示 预期 vs 实际 / PASS-FAIL / 日志 / 种子复现。
 */

export default function Arena({ onBack }: { onBack: () => void }) {
  const [results, setResults] = useState<Record<string, TestRunResult & { id: string; name: string }>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'engine' | 'character' | 'complex'>('all');
  const [running, setRunning] = useState(false);

  const cases = useMemo(() => ALL_CASES.filter((c) => filter === 'all' || c.category === filter), [filter]);
  const passCount = Object.values(results).filter((r) => r.pass).length;
  const failCount = Object.values(results).filter((r) => !r.pass).length;

  function runOne(tc: TestCase) {
    const r = tc.run();
    setResults((prev) => ({ ...prev, [tc.id]: { ...r, id: tc.id, name: tc.name } }));
  }

  function runAll() {
    setRunning(true);
    setTimeout(() => {
      const next: Record<string, TestRunResult & { id: string; name: string }> = {};
      for (const tc of ALL_CASES) {
        try {
          const r = tc.run();
          next[tc.id] = { ...r, id: tc.id, name: tc.name };
        } catch (e) {
          next[tc.id] = { id: tc.id, name: tc.name, pass: false, expected: '正常执行', actual: `异常：${(e as Error).message}`, logs: [] };
        }
      }
      setResults(next);
      setRunning(false);
    }, 30);
  }

  const current = selected ? results[selected] : null;
  const currentCase = ALL_CASES.find((c) => c.id === selected);

  return (
    <div className="arena">
      <header className="game-header">
        <button className="btn small" onClick={onBack}>← 返回</button>
        <span className="chip">机制测试场</span>
        <span className="chip">{cases.length} 个用例</span>
        {Object.keys(results).length > 0 && (
          <>
            <span className="chip ok">PASS {passCount}</span>
            <span className="chip err">FAIL {failCount}</span>
          </>
        )}
        <span className="spacer" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">全部用例</option>
          <option value="engine">核心规则</option>
          <option value="character">角色机制</option>
          <option value="complex">复杂交互</option>
        </select>
        <button className="btn small primary" disabled={running} onClick={runAll}>{running ? '运行中…' : '▶ 运行全部'}</button>
      </header>

      <div className="arena-grid">
        <div className="card">
          <h3>测试用例</h3>
          <div className="case-list">
            {cases.map((tc) => {
              const r = results[tc.id];
              return (
                <div key={tc.id} className={`case-row ${selected === tc.id ? 'sel' : ''}`} onClick={() => setSelected(tc.id)}>
                  <span className={`badge ${r ? (r.pass ? 'pass' : 'fail') : 'idle'}`}>{r ? (r.pass ? 'PASS' : 'FAIL') : '待跑'}</span>
                  <span className="case-id">{tc.id}</span>
                  <span className="case-name">{tc.name}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <h3>用例详情</h3>
          {!currentCase && <p className="muted">左侧选择一个测试用例，点击查看详情或运行。</p>}
          {currentCase && (
            <div>
              <h4>{currentCase.id} · {currentCase.name}</h4>
              <p className="muted">{currentCase.desc}{currentCase.seed !== undefined ? `（种子 ${currentCase.seed}）` : ''}</p>
              <button className="btn primary" onClick={() => runOne(currentCase)}>▶ 运行此用例</button>
              {current && (
                <div className={`result-box ${current.pass ? 'pass' : 'fail'}`}>
                  <div><strong>{current.pass ? '✅ PASS' : '❌ FAIL'}</strong></div>
                  <div><strong>预期：</strong>{current.expected}</div>
                  <div><strong>实际：</strong>{current.actual}</div>
                  {current.error && <pre className="error-text">{current.error}</pre>}
                </div>
              )}
              {current?.logs && (
                <div className="log-scroll tall">
                  {current.logs.map((l, i) => <div key={i} className="log-line">{l}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <p className="muted center">
        测试用例数据源：<code>shared/src/testcases/</code>，与自动化测试（vitest）完全同源，保证「机制测试场 ≠ 另一个假模拟器」。
      </p>
    </div>
  );
}
