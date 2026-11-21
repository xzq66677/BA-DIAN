// @vitest-environment jsdom
/**
 * 音效模块安全性测试（jsdom 无 WebAudio）：
 *  - 导入/播放/静音切换在任何环境都不得抛错（任务书 §10：资源失败有 fallback）；
 *  - 静音状态持久化（localStorage）；
 *  - 拥堵模式非重大事件不播放（纯逻辑分支，可观测的是"不抛错"）。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { sfx } from '../../client/src/audio/sfx.js';

describe('轻量原创音效（WebAudio 合成）', () => {
  beforeEach(() => {
    try { localStorage.removeItem('badian-sfx-muted'); } catch { /* ignore */ }
  });

  it('无 AudioContext 环境播放全部音效不抛错', () => {
    const kinds = ['hit', 'heal', 'move', 'eliminate', 'revive', 'throw', 'boom', 'decl', 'victory'] as const;
    expect(() => {
      for (const k of kinds) {
        sfx.play(k, { congestion: false, reduced: false });
        sfx.play(k, { congestion: true, major: true, reduced: true });
      }
    }).not.toThrow();
  });

  it('静音开关持久化到 localStorage', () => {
    sfx.setMuted(true);
    expect(sfx.isMuted()).toBe(true);
    expect(localStorage.getItem('badian-sfx-muted')).toBe('1');
    sfx.setMuted(false);
    expect(sfx.isMuted()).toBe(false);
    expect(localStorage.getItem('badian-sfx-muted')).toBeNull();
  });

  it('静音时播放是空操作（不抛错）', () => {
    sfx.setMuted(true);
    expect(() => sfx.play('boom', { major: true })).not.toThrow();
    sfx.setMuted(false);
  });
});
