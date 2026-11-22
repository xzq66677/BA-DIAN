/// <reference lib="dom" />
/** npx tsx scripts/map102-shots.ts <tag>
 * MAP-102 名牌/危险标识取证：真实开局挂载 3D 场景（房间数=对局人数）后注入同房快照，
 * 采集 6 人/10 人同房与三种分辨率截图 + 键盘选择事件记录。
 * 6 人局 = 5 本机 + 1 AI（6 房底图）；10 人局 = 5 本机 + 5 AI（10 房底图）。
 * 同房规模按当前产品范围取 ≤ 10 人；快照仅驱动显示层（display-authoritative），
 * 不改服务端规则与动作提交。
 */
import { chromium } from 'playwright';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { httpServer, io, startServer } from '../server/src/index.js';

const tag = process.argv[2] ?? 'map102';
const out = process.env.MAP_EVIDENCE_DIR ?? 'docs/screenshots-map102';
const CHARS = ['ivan-girl', 'wuliuqi', 'gojo', 'bagun', 'chuixiao', 'laodaye', 'mabaoguo', 'hero-today', 'dajianke', 'dapihuai', 'default'];
const VIEWPORTS: [number, number][] = [[1440, 900], [390, 844], [844, 390]];

declare global {
  interface Window {
    __b3scene?: {
      syncSnapshot: (snap: unknown, immediate?: boolean) => void;
      setSelection: (pickMode: boolean, room: string, player: string) => void;
      hooks: { onPickRoom: (rid: string) => void; onPickPlayer: (pid: string) => void };
      debugStats: () => { entities: number };
      debugMap: () => { rooms: { id: string }[] };
    };
    __pickLog: { kind: string; rid?: string; pid?: string; key?: string }[];
    __snapRoomIds: string[];
  }
}

async function mountScene(page: import('playwright').Page, index: number, total: number): Promise<void> {
  const locals = Math.min(5, total);
  const ais = total - locals;
  await page.goto(`http://127.0.0.1:${(httpServer.address() as { port: number }).port}`);
  await page.getByPlaceholder('输入昵称').fill(`标识验收${index}`);
  await page.getByLabel('选择角色卡').selectOption('ivan-girl');
  if (locals > 1) await page.getByLabel(/单设备多人/).selectOption(String(locals));
  if (ais > 0) {
    // 单人开局（+AI）：AI 即时入座并开局，房间数 = 本机 + AI
    await page.getByLabel(/AI 数量/).selectOption(String(ais));
    await page.getByRole('button', { name: /单人开局/ }).click();
  } else {
    await page.getByRole('button', { name: /仅创建/ }).click();
    for (let seat = 1; seat < locals; seat++) {
      await page.locator('.seat-slot').filter({ hasText: `标识验收${index}${seat + 1}` }).locator('select').selectOption('default');
    }
    await page.getByRole('button', { name: /开始对局/ }).click();
  }
  await page.waitForFunction(expected => (window.__b3scene?.debugStats().entities ?? 0) === expected, total);
  await page.evaluate('window.__snapRoomIds = window.__b3scene.debugMap().rooms.map(r => r.id)');
}

/** count 人挤进第一间房，其余房间散布对照成员；末房挂待爆危险。
 * focus=false 时不下发行动者（镜头保持全局机位），用于全景对照。 */
async function inject(page: import('playwright').Page, count: number, focus = true): Promise<void> {
  // evaluate 载荷用字符串传递：tsx 的 keepNames 转换会给函数注入 __name 助手，浏览器上下文未定义会崩
  await page.evaluate(`(() => {
    const CHARS = ${JSON.stringify(CHARS)};
    const total = ${count};
    const focus = ${focus};
    const ids = window.__snapRoomIds;
    const mk = (i, room, hp, alive) => ({
      id: 'P' + i, name: '玩家' + String(i + 1).padStart(2, '0'),
      charId: CHARS[i % CHARS.length], charName: '',
      hp, maxHp: 10, room, alive, hidden: false, invisible: false, char: {},
    });
    const players = Array.from({ length: total }, (_, i) =>
      mk(i, ids[0], i % 5 === 0 ? 2 : 8, i % 7 !== 3));
    players.push(mk(90, ids[1], 10, true), mk(91, ids[1], 4, true), mk(92, ids[2], 0, false));
    window.__b3scene.syncSnapshot({
      players, roomIds: ids, currentActor: focus ? 'P0' : null, phase: 'act', winner: null,
      deferred: [{ id: 'd1', kind: 'ivan', room: ids[ids.length - 1], explodeRound: 4 }],
      submittedIds: [], myIds: focus ? ['P0'] : [],
    }, true);
  })()`);
  await page.waitForFunction(total => (window.__b3scene?.debugStats().entities ?? 0) === total + 3, count);
  // 聚焦注入后等镜头动画收尾，避免拍到飞行中途的机位
  await page.waitForTimeout(focus ? 1800 : 1200);
}

try {
  await mkdir(out, { recursive: true });
  startServer(0);
  await once(httpServer, 'listening');
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const errors: string[] = [];
  const keyboardLog: Record<string, unknown> = {};
  try {
    for (const [index, [vw, vh]] of VIEWPORTS.entries()) {
      // 6 人局（5 本机 + 1 AI → 6 房底图）：全景对照 + 6 人同房 + 键盘记录
      const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
      page.on('pageerror', e => errors.push(`${vw}x${vh}: ${e}`));
      await mountScene(page, index + 1, 6);
      await inject(page, 1, false);
      await page.screenshot({ path: `${out}/${tag}-overview-${vw}x${vh}.png` });
      await inject(page, 6);
      await page.screenshot({ path: `${out}/${tag}-6same-${vw}x${vh}.png` });
      // 键盘选择事件记录：房间标签 Enter 与名牌 Enter（事件日志见 -keyboard.json）
      keyboardLog[`${vw}x${vh}`] = await page.evaluate(`(() => {
        const scene = window.__b3scene;
        window.__pickLog = [];
        scene.hooks.onPickRoom = rid => window.__pickLog.push({ kind: 'pickRoom', rid });
        scene.hooks.onPickPlayer = pid => window.__pickLog.push({ kind: 'pickPlayer', pid });
        scene.setSelection(true, '', '');
        const record = (label, el) => {
          if (!el) return { label, ok: false };
          el.focus();
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          return { label, ok: true, tag: el.dataset.room || el.dataset.pid || '', focus: el === document.activeElement };
        };
        const roomLog = record('room-label-Enter', document.querySelector('.b3-roomlabel.is-pickable'));
        const plateLog = record('plate-Enter', document.querySelector('.b3-plate'));
        return { roomLog, plateLog, picks: window.__pickLog, tabbable: document.querySelectorAll('[tabindex="0"]').length };
      })()`);
      await page.close();
      // 10 人局（5 本机 + 5 AI → 10 房底图）：同房极限档
      const page10 = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
      page10.on('pageerror', e => errors.push(`${vw}x${vh}(10): ${e}`));
      await mountScene(page10, index + 1, 10);
      await inject(page10, 10);
      await page10.screenshot({ path: `${out}/${tag}-10same-${vw}x${vh}.png` });
      await page10.close();
    }
    await writeFile(`${out}/${tag}-keyboard.json`, JSON.stringify({ keyboardLog, errors }, null, 2) + '\n');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, out, keyboardLog, errors }, null, 2));
  } finally {
    await browser.close();
    await io.close();
  }
} finally {
  void 0;
}
