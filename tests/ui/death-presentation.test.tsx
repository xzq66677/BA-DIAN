// @vitest-environment jsdom
/**
 * Issue #79 回归：大屁孩三连平自爆的表现层。
 *
 * 引擎三连平 → 自爆（cause='selfdestruct'）此前一直正常，但客户端把所有
 * 淘汰渲染成通用「💀 淘汰」——自爆没有任何爆炸演出。本组测试锁定：
 *  - 死因表现注册表（2D 盖章 / 3D 演出 / 音效的共同扩展点）；
 *  - 3D 播放层把 eliminate.cause 传给场景（爆炸演出入口）；
 *  - 2D 牌桌对自爆淘汰渲染 💥 自爆盖章（真实对局事件驱动）。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { deathStamp, isExplosionDeath } from '../../client/src/battle/death-presentation.js';
import { playMapEvent, type MapPlaybackScene } from '../../client/src/battle3d/map-playback.js';
import { makeGame, playThrows } from '../../shared/src/testcases/helpers.js';
import type { GameSnapshot } from '../../client/src/net.js';
import GamePage from '../../client/src/pages/Game.js';

const LOBBY = {
  code: 'TEST',
  state: 'playing' as const,
  hostSeat: 'P',
  seats: [
    { playerId: 'P', name: 'P', charId: 'dapihuai', type: 'human' as const, connected: true },
    { playerId: 'A', name: 'A', charId: 'default', type: 'human' as const, connected: true },
    { playerId: 'B', name: 'B', charId: 'default', type: 'ai' as const, connected: true },
  ],
  config: { submitTimeoutMs: 30000, turnTimeoutMs: 30000 },
};

describe('死因表现注册表', () => {
  it('爆炸类死因（selfdestruct）→ 💥 自爆盖章，普通死因 → 💀 淘汰', () => {
    expect(deathStamp('selfdestruct')).toEqual({ text: '💥 自爆', cls: 'death-stamp is-boom' });
    expect(deathStamp('damage')).toEqual({ text: '💀 淘汰', cls: 'death-stamp' });
    expect(deathStamp('ivan')).toEqual({ text: '💀 淘汰', cls: 'death-stamp' });
    expect(deathStamp(undefined)).toEqual({ text: '💀 淘汰', cls: 'death-stamp' });
    expect(deathStamp('selfdestruct').text).toContain('自爆');
  });

  it('isExplosionDeath：仅注册过的爆炸类死因为真，未知/缺省安全降级', () => {
    expect(isExplosionDeath('selfdestruct')).toBe(true);
    expect(isExplosionDeath('damage')).toBe(false);
    expect(isExplosionDeath('insult')).toBe(false);
    expect(isExplosionDeath(undefined)).toBe(false);
    expect(isExplosionDeath('')).toBe(false);
  });
});

describe('3D 播放层：eliminate 携带死因', () => {
  it('playMapEvent 把 eliminate.cause 传给场景 playEliminate', () => {
    const playEliminate = vi.fn();
    const scene = { playEliminate } as unknown as MapPlaybackScene;
    playMapEvent(scene, { kind: 'eliminate', seq: 1, targetId: 'P', cause: 'selfdestruct' }, 800);
    expect(playEliminate).toHaveBeenCalledWith('P', 'selfdestruct');

    const generic = { playEliminate: vi.fn() } as unknown as MapPlaybackScene;
    playMapEvent(generic, { kind: 'eliminate', seq: 2, targetId: 'A', cause: 'damage' }, 800);
    expect(generic.playEliminate).toHaveBeenCalledWith('A', 'damage');
  });
});

describe('2D 牌桌：自爆淘汰渲染 💥 自爆盖章', () => {
  it('大屁孩三连平自爆的对局日志驱动 is-boom 盖章（真实引擎事件链）', async () => {
    window.history.replaceState(null, '', '/?pace=fast'); // 调试覆盖：压缩演出时长，事件能播到 eliminate
    const g = makeGame([{ id: 'P', char: 'dapihuai' }, { id: 'A', char: 'default' }, { id: 'B', char: 'default' }], 915);
    g.judgeHistory('P').push('tie', 'tie');
    playThrows(g, [{ P: 'rock', A: 'scissors', B: 'paper' }]); // 三人循环 → P 记第三条 tie → 自爆
    expect(g.players.P.alive).toBe(false); // 引擎自爆正常（回归前置断言）

    const allLogs = g.logs.map((l) => ({
      seq: l.seq, text: `[R${l.round}] ${l.text}`, important: l.important,
      type: l.type, data: l.data as Record<string, unknown>,
    }));
    const ui = ({ logs }: { logs: typeof allLogs }) => (
      <GamePage
        lobby={LOBBY}
        game={g.snapshot() as unknown as GameSnapshot}
        session={{ code: 'TEST', identities: [{ playerId: 'A', name: 'A', token: 't' }] }}
        logs={logs}
        onExit={() => {}}
      />
    );
    // 挂载时已有日志按「已见历史」处理（重连不回放），只推游标；
    // 先渲染到 eliminate 之前（不回放），再增量推入含 eliminate 的日志模拟实时到达
    // （自爆后还有回合翻页 phase 日志，不能简单地切最后一条）。
    const boomIdx = g.logs.findIndex((l) => l.type === 'eliminate' && (l.data as { pid?: string }).pid === 'P');
    expect(boomIdx).toBeGreaterThan(0);
    const { rerender } = render(ui({ logs: allLogs.slice(0, boomIdx) })); // 启动游标停在 eliminate 之前
    rerender(ui({ logs: allLogs }));
    await waitFor(() => {
      const stamp = document.querySelector('.death-stamp.is-boom');
      expect(stamp).toBeTruthy();
      expect(stamp!.textContent).toContain('自爆');
    }, { timeout: 5000 });
  });
});
