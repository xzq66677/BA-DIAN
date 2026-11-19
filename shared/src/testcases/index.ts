/**
 * 拔典 · 测试用例注册表
 * vitest 与机制测试场（网页）共用同一数据源。
 */

import type { TestCase } from './helpers.js';
import { ENGINE_CASES } from './engine-cases.js';
import { CHARACTER_CASES } from './character-cases.js';
import { COMPLEX_CASES } from './complex-cases.js';

export const ALL_CASES: TestCase[] = [...ENGINE_CASES, ...CHARACTER_CASES, ...COMPLEX_CASES];

export function getCase(id: string): TestCase | undefined {
  return ALL_CASES.find((c) => c.id === id);
}

export function casesByCategory(cat: TestCase['category']): TestCase[] {
  return ALL_CASES.filter((c) => c.category === cat);
}
