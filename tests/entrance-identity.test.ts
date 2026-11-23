/**
 * V5.0 电影感入口「取名定身份」回归测试（纯逻辑，无 jsdom 依赖）。
 *
 * 背景 bug：新入口曾把昵称写死为 localStorage 值或默认「棋手」，且桥接协议不带名字，
 * 导致所有游客进游戏后都叫同一个名字；同时丢失了单设备多人 / AI 数量配置能力。
 * 修复后昵称、本机人数在宿主侧设置，这里验证其纯逻辑与经典入口 Home 行为一致。
 */
import { describe, it, expect } from 'vitest';
import { defaultName, resolveName, buildLocalNames } from '../client/src/entrance-identity.js';

describe('默认昵称不再全员同名', () => {
  it('不同随机数产生不同默认名', () => {
    expect(defaultName(0.1)).not.toBe(defaultName(0.9));
    expect(defaultName(0.1)).toMatch(/^棋手\d{4}$/);
  });

  it('resolveName 保留合法昵称', () => {
    expect(resolveName('  张三丰  ')).toBe('张三丰');
    expect(resolveName('李四海')).toBe('李四海');
  });

  it('resolveName 对空/全空格回退到非空默认名（杜绝空名与硬编码同名）', () => {
    expect(resolveName(null, 0.5)).toMatch(/^棋手\d{4}$/);
    expect(resolveName('', 0.5)).toMatch(/^棋手\d{4}$/);
    expect(resolveName('   ', 0.5)).toMatch(/^棋手\d{4}$/);
    expect(resolveName(undefined, 0.5)).toMatch(/^棋手\d{4}$/);
  });
});

describe('单设备多人：本地身份昵称互相独立（与经典入口一致）', () => {
  it('1 人时只有一个昵称，且不加序号', () => {
    expect(buildLocalNames('张三丰', 1)).toEqual(['张三丰']);
  });

  it('多人时按 1/2/3 递增，彼此不同', () => {
    expect(buildLocalNames('张三丰', 3)).toEqual(['张三丰1', '张三丰2', '张三丰3']);
    const names = buildLocalNames('棋手9999', 5);
    expect(names).toHaveLength(5);
    expect(new Set(names).size).toBe(5);
  });

  it('非法人数安全兜底为 1 人', () => {
    expect(buildLocalNames('X', 0)).toEqual(['X']);
    expect(buildLocalNames('X', -3)).toEqual(['X']);
    expect(buildLocalNames('X', NaN)).toEqual(['X']);
  });
});
