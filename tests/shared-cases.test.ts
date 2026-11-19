/**
 * 共享测试用例自动化运行（vitest）
 * 与机制测试场（网页）共用 shared/src/testcases 中的同一份用例数据。
 */

import { describe, it, expect } from 'vitest';
import { ALL_CASES } from '../shared/src/testcases/index.js';

describe('拔典 · 核心规则引擎测试', () => {
  for (const tc of ALL_CASES.filter((c) => c.category === 'engine')) {
    it(`${tc.id} ${tc.name}`, () => {
      const r = tc.run();
      if (!r.pass) {
        throw new Error(`[${tc.id}] 期望: ${r.expected} | 实际: ${r.actual}${r.error ? '\n' + r.error : ''}`);
      }
      expect(r.pass).toBe(true);
    });
  }
});

describe('拔典 · 角色机制测试（9角色样本）', () => {
  for (const tc of ALL_CASES.filter((c) => c.category === 'character')) {
    it(`${tc.id} ${tc.name}`, () => {
      const r = tc.run();
      if (!r.pass) {
        throw new Error(`[${tc.id}] 期望: ${r.expected} | 实际: ${r.actual}${r.error ? '\n' + r.error : ''}`);
      }
      expect(r.pass).toBe(true);
    });
  }
});

describe('拔典 · 复杂交互测试', () => {
  for (const tc of ALL_CASES.filter((c) => c.category === 'complex')) {
    it(`${tc.id} ${tc.name}`, () => {
      const r = tc.run();
      if (!r.pass) {
        throw new Error(`[${tc.id}] 期望: ${r.expected} | 实际: ${r.actual}${r.error ? '\n' + r.error : ''}`);
      }
      expect(r.pass).toBe(true);
    });
  }
});
