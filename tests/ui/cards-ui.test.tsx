// @vitest-environment jsdom
/**
 * 首页卡池墙：Issue #95 四角色卡面收录
 * - 已入册角色（狂猎等）卡面图直接替换占位块，详情用花名册面板
 * - 未入册角色（水蛭 Q 版）作为图鉴补位上墙，详情按卡面原文显示 HP ? 并注明未实装
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

afterEach(cleanup);
import Home from '../../client/src/pages/Home.js';

describe('首页卡池墙：#95 四角色卡面', () => {
  it('狂猎卡面出现在卡池墙，点击弹出详情（入册角色用花名册面板）', () => {
    render(<Home onEnter={() => {}} onArena={() => {}} />);
    const card = screen.getByAltText('狂猎') as HTMLImageElement;
    expect(card.getAttribute('src')).toBe('./cards/wild-hunt-thumb.webp');
    fireEvent.click(card);
    expect(screen.getByText(/No\.69 · 狂猎（HP 4 \/ 攻 1）/)).toBeTruthy();
    expect(screen.getByText(/骑乘突进/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByText(/No\.69 · 狂猎/)).toBeNull();
  });

  it('老虎机侠 / 鬼影 / 飞天水螅缩略图上墙', () => {
    render(<Home onEnter={() => {}} onArena={() => {}} />);
    expect((screen.getByAltText('老虎机侠') as HTMLImageElement).getAttribute('src')).toBe('./cards/slot-hero-thumb.webp');
    expect((screen.getByAltText('鬼影') as HTMLImageElement).getAttribute('src')).toBe('./cards/ghost-thumb.webp');
    expect((screen.getByAltText('飞天水螅') as HTMLImageElement).getAttribute('src')).toBe('./cards/water-snake-thumb.webp');
  });

  it('水蛭未入册：墙上有缩略图，详情按卡面显示 HP ? 并注明未实装', () => {
    render(<Home onEnter={() => {}} onArena={() => {}} />);
    const card = screen.getByAltText('水蛭') as HTMLImageElement;
    expect(card.getAttribute('src')).toBe('./cards/leech-thumb.webp');
    fireEvent.click(card);
    expect(screen.getByText(/No\.70 · 水蛭（HP \? \/ 攻 -）/)).toBeTruthy();
    expect(screen.getByText(/尚未实装入局/)).toBeTruthy();
    expect(screen.getByText(/多根缠吸/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByText(/No\.70 · 水蛭/)).toBeNull();
  });
});
