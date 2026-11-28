import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CARD_META, cardMeta, extraCardIds } from '../../client/src/cards.js';
import { CHARACTER_LIST } from '../../shared/src/characters/index.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/public');

describe('角色卡注册表（CARD_META）', () => {
  it('每条 img/thumb 指向真实存在的卡面文件（防空链）', () => {
    const entries = Object.entries(CARD_META);
    expect(entries.length).toBeGreaterThanOrEqual(17); // 16 入册角色 + 水蛭图鉴条目
    for (const [id, m] of entries) {
      if (m.img) expect(existsSync(path.join(publicDir, m.img)), `${id} img`).toBe(true);
      if (m.thumb) expect(existsSync(path.join(publicDir, m.thumb)), `${id} thumb`).toBe(true);
    }
  });

  it('四个新角色（#95 四角色图片包）已入册且卡面图齐备、卡号按卡面原文', () => {
    const rosterIds = CHARACTER_LIST.map((c) => c.id);
    for (const id of ['wild-hunt', 'ghost', 'slot-hero', 'water-snake'] as const) {
      expect(rosterIds, `${id} 应在引擎花名册`).toContain(id);
      const m = cardMeta(id)!;
      expect(m.img).toBe(`./cards/${id}.webp`);
      expect(m.thumb).toBe(`./cards/${id}-thumb.webp`);
    }
    expect(cardMeta('wild-hunt')?.no).toBe('69');
    expect(cardMeta('ghost')?.no).toBe('36');
    expect(cardMeta('slot-hero')?.no).toBe('106');
    expect(cardMeta('water-snake')?.no).toBe('73');
  });

  it('水蛭（飞天水蛭另一形态，No.70）未入册，作为图鉴条目补位展示', () => {
    const extras = extraCardIds(CHARACTER_LIST.map((c) => c.id));
    expect(extras).toEqual(['leech']);
    const m = cardMeta('leech')!;
    expect(m.name).toBe('水蛭');
    expect(m.panel).toBe('HP ? / 攻 -'); // 原稿未标血量与攻击，卡面按原文显示
    expect(m.no).toBe('70');
    expect(existsSync(path.join(publicDir, m.img!))).toBe(true);
    expect(existsSync(path.join(publicDir, m.thumb!))).toBe(true);
  });
});
