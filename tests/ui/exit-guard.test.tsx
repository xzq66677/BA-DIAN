// @vitest-environment jsdom
/**
 * B-029：首页「占用房间」逃生口
 * mock 网络层，创建/加入被拒（携带 activeCode）时，
 * 首页必须展示「回到房间 / 退出旧房间并继续」两个出口，而不是只留一句报错让玩家卡死。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';

const createRoomMock = vi.fn(async () => ({
  ok: false,
  error: '你已在房间 97FR 中，请先退出该房间（或点「退出旧房间」解除占用）',
  activeCode: '97FR',
}));

vi.mock('../../client/src/net.js', () => ({
  net: {
    onLobbyRooms: () => () => {},
    connect: async () => {},
    createRoom: (...args: unknown[]) => createRoomMock(...args),
    joinRoom: async () => ({ ok: false, error: '加入失败' }),
    requestLobbyRooms: () => {},
  },
}));

afterEach(cleanup);

describe('首页占用房间逃生口（B-029）', () => {
  it('创建被拒（activeCode）时展示 回到房间 / 退出旧房间 逃生口', async () => {
    const { default: HomeMocked } = await import('../../client/src/pages/Home.js');
    render(<HomeMocked onEnter={() => {}} onArena={() => {}} />);
    const nameInput = document.querySelector('input[placeholder="输入昵称"]') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '逃生口测试' } });
    const createBtn = Array.from(document.querySelectorAll('button')).find((b) => /创建房间/.test(b.textContent || ''))!;
    fireEvent.click(createBtn);
    await waitFor(() => {
      expect(document.querySelector('.stuck-panel')).toBeTruthy();
    });
    const text = document.body.textContent || '';
    expect(text).toContain('97FR');
    expect(text).toContain('回到房间 97FR');
    expect(text).toContain('退出旧房间并继续');
  });
});
