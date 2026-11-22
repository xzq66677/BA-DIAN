/// <reference lib="dom" />
/** npm run build && npx tsx scripts/map-match.ts
 * Isolated loopback server, real Socket.IO traffic and browser UI inputs.
 * Set CHROMIUM_PATH to a local Chromium/Edge executable when needed.
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { expect } from '@playwright/test';
import { httpServer, io, startServer } from '../server/src/index.js';
import type { RoomUpdate, SnapLog } from '../client/src/net.js';
import type { BattleScene3D } from '../client/src/battle3d/scene.js';

declare global {
  interface Window {
    __b3scene?: BattleScene3D;
    mapFirstScene?: WeakRef<BattleScene3D>;
    mapContexts: { created: number; lost: number; active: number; peak: number };
  }
}

const out = process.env.MAP_EVIDENCE_DIR ?? 'docs/screenshots-v5-map';
const evidence: Record<string, unknown> = {};
const logs = new Map<number, SnapLog>();
const errors: string[] = [];
let last: RoomUpdate | undefined;
let step = 'initial';
const game = () => { assert(last?.game); return last.game; };
const player = (id: string) => game().players.find(p => p.id === id)!;
const wait = (message: string, predicate: () => boolean) =>
  expect.poll(predicate, { message, timeout: 30000 }).toBe(true);
const viewport = { width: 1440, height: 900 };

async function attach(page: Page) {
  page.on('pageerror', error => errors.push(String(error)));
  page.on('websocket', wire => {
    wire.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string' || !payload.startsWith('42["room:update",')) return;
      [, last] = JSON.parse(payload.slice(2)) as [string, RoomUpdate];
      for (const log of last.newLogs) logs.set(log.seq, log);
    });
  });
  await page.addInitScript(() => {
    const counts = window.mapContexts = { created: 0, lost: 0, active: 0, peak: 0 };
    const get = HTMLCanvasElement.prototype.getContext;
    const seen = new WeakSet<object>();
    HTMLCanvasElement.prototype.getContext = function(this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      const context = Reflect.apply(get, this, [type, ...args]);
      if (type.startsWith('webgl') && context && !seen.has(context)) {
        seen.add(context);
        counts.created++;
        counts.active++;
        counts.peak = Math.max(counts.peak, counts.active);
        this.addEventListener('webglcontextlost', () => { counts.lost++; counts.active--; });
        this.addEventListener('webglcontextrestored', () => { counts.active++; });
      }
      return context;
    } as typeof get;
  });
}

async function sample(page: Page, label: string, photo = false) {
  const state = await page.evaluate(() => {
    const scene = window.__b3scene;
    return {
      map: scene?.debugMap(),
      players: scene?.debugCharacters(),
      stats: scene?.debugStats(),
      contexts: { ...window.mapContexts },
      reuse: scene === window.mapFirstScene?.deref(),
      finale: Boolean(document.querySelector('.win-modal')),
    };
  });
  evidence[label] = state;
  if (photo) await shot(page, `${out}/${label}.png`);
  return state;
}

/** MAP-105：CDP 直接抓合成帧。Playwright 截图要等字体/帧稳定（主线程 evaluate），
 * SwiftShader 饱和时会连 30s 都等不到；合成器表面始终存在，CDP 抓帧不受主线程饥饿影响。 */
async function shot(page: Page, path: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let session: import('playwright').CDPSession | null = null;
    try {
      session = await page.context().newCDPSession(page);
      const { data } = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await writeFile(path, Buffer.from(data, 'base64'));
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(2000);
    } finally {
      await session?.detach().catch(() => {});
    }
  }
}

/** MAP-105：共享交互助手——主流程与边角场景复用同一套驱动与断言，避免行为口径分叉 */
function makeHelpers(page: Page) {
  const settle = () => expect(page.getByTestId('battle-ctl')).toHaveCount(0, { timeout: 17000 });
  const room = (id: string) => page.locator(`.b3-roomlabel[data-room="${id}"]`);
  const plate = (id: string) => page.locator(`.b3-plate[data-pid="${id}"]`);
  const mapWait = (pid: string, target: string) =>
    page.waitForFunction(({ pid, target }) => window.__b3scene?.debugCharacters().some(p => p.pid === pid && p.room === target)
      && window.__b3scene.debugStats().walks === 0, { pid, target });
  const choose = async (actor: string | null) => {
    const start = game();
    for (const seat of start.players.filter(p => p.alive)) {
      // dispatchEvent：揭示台待出拳列表持续重渲染会让按钮位移，
      // 普通点击受稳定性检查/坐标漂移双重限制，直接在元素上派发 click 最稳
      await page.getByRole('button', { name: `我是 ${seat.name}，开始出拳` }).dispatchEvent('click');
      await page.locator('.throw-card').filter({ hasText: !actor || seat.id === actor ? '石头' : '剪刀' }).click();
    }
    if (actor) {
      await wait('server accepted actor', () => game().currentActor === actor);
      assert.deepEqual(game().queue, [actor]);
    } else await wait('tie advanced round', () => game().roundNo > start.roundNo);
    return start.roundNo;
  };
  const action = async (actor: string, label: string, target?: { room: string } | { pid: string }) => {
    step = `R${game().roundNo} ${label}`;
    const round = await choose(actor);
    await page.locator('.scard').filter({ has: page.getByText(label, { exact: true }) }).click();
    if (target && 'room' in target) {
      const button = page.locator(`.b3-roomlabel.is-pickable[data-room="${target.room}"]`);
      await button.press('Enter');
      await expect(button).toHaveClass(/is-selected/);
    }
    if (target && 'pid' in target) {
      const targetPlate = page.locator(`.b3-plate.is-targetable[data-pid="${target.pid}"]`);
      await targetPlate.evaluate(el => (el as HTMLElement).click());
      await expect(targetPlate).toHaveClass(/is-selected/);
    }
    const cursor = Math.max(0, ...logs.keys());
    await page.getByRole('button', { name: '确认发动' }).click();
    await wait('server settled action', () => game().roundNo > round || game().phase === 'over');
    return [...logs.values()].filter(l => l.seq > cursor);
  };
  // MAP-105：展示与权威一致的全量对账——每名玩家名牌 data-hp 必须等于权威 HP
  const platesMatchAuthority = async () => {
    for (const p of game().players) {
      await expect(plate(p.id)).toHaveAttribute('data-hp', String(p.hp), { timeout: 15000 });
    }
  };
  return { settle, room, plate, mapWait, choose, action, platesMatchAuthority };
}

async function match(page: Page, url: string) {
  await attach(page);
  await page.goto(url);
  await page.getByPlaceholder('输入昵称').fill('遗迹验收');
  await page.getByLabel('选择角色卡').selectOption('ivan-girl');
  await page.getByLabel(/单设备多人/).selectOption('4');
  await page.getByRole('button', { name: /仅创建/ }).click();
  const roster = ['ivan-girl', 'wuliuqi', 'default', 'default'];
  for (let index = 1; index < roster.length; index++) {
    await page.locator('.seat-slot').filter({ hasText: `遗迹验收${index + 1}` }).locator('select').selectOption(roster[index]);
  }
  await wait('server roster', () => last?.lobby.seats.map(s => s.charId).join() === roster.join());
  await page.getByRole('button', { name: /开始对局/ }).click();
  await wait('rps1', () => last?.game?.phase === 'rps1');
  await page.waitForFunction(() => (window.__b3scene?.debugStats().calls ?? 0) > 0);
  await page.evaluate(() => { window.mapFirstScene = new WeakRef(window.__b3scene!); });
  const [a, b, c, d] = game().players.map(p => p.id);
  const [r1, r2, r3] = game().players.map(p => p.originRoom);
  const initial = await sample(page, '01-overview', true);
  assert.equal(initial.contexts.active, 1);
  assert.equal(initial.map?.rooms.length, 4);

  const { choose, action, settle, room, plate, mapWait, platesMatchAuthority } = makeHelpers(page);

  const throwLabel = '投掷大伊万';
  await action(a, throwLabel, { room: r2 });
  await expect(room(r2)).toHaveClass(/is-pending/, { timeout: 15000 });
  await sample(page, '02-pending', true);
  await settle();
  await choose(null);
  assert.equal(game().deferred.find(e => e.kind === 'ivan')?.room, r2);
  await expect(room(r2)).toHaveClass(/is-pending/, { timeout: 15000 });
  const emptyBlast = await action(b, '移动', { room: r3 });
  assert.equal(player(b).room, r3);
  assert(emptyBlast.some(l => l.type === 'deferred' && l.data?.room === r2));
  assert(!emptyBlast.some(l => l.type === 'damage' && l.data?.tag === 'ivan'));
  await mapWait(b, r3);
  await settle();
  await expect(room(r2)).not.toHaveClass(/is-pending/, { timeout: 15000 });

  await action(d, '移动', { room: r3 });
  await mapWait(d, r3);
  await settle();
  const together = await sample(page, '03-same-room', true);
  assert.equal(together.map?.rooms.find(r => r.id === r3)?.slots.length, 3);
  assert.deepEqual(together.map?.rooms.map(r => [r.id, r.center]), initial.map?.rooms.map(r => [r.id, r.center]));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /视角/ }).click();
  await page.waitForFunction(() => document.querySelector('.b3-canvas')?.getBoundingClientRect().width === 390);
  await sample(page, '04-portrait', true);
  await page.setViewportSize(viewport);
  const chat = page.locator('.chat-dock');
  if (await chat.getByRole('button', { name: /收起/ }).isVisible()) await chat.getByRole('button', { name: /收起/ }).click();

  const damage = await action(c, '攻击', { pid: b });
  const single = damage.find(l => l.type === 'damage' && l.data?.target === b && l.data?.hpAfter !== undefined);
  assert(single);
  await expect(plate(b)).toHaveAttribute('data-hp', String(single.data?.hpAfter), { timeout: 15000 });
  await settle();
  await action(b, '回复');
  await expect(room(r3)).toHaveAttribute('data-effect', 'heal', { timeout: 15000 });
  await expect(plate(b)).toHaveAttribute('data-hp', String(player(b).maxHp), { timeout: 15000 });
  await settle();

  const aoe = await action(b, '攻击', { pid: c });
  const hits = aoe.filter(l => l.type === 'damage' && l.data?.tag === 'wuliuqi-aoe');
  assert(hits.length >= 4);
  assert.deepEqual(new Set(hits.map(l => l.data?.target)), new Set([c, d]));
  await expect(room(r3)).toHaveAttribute('data-effect', 'aoe', { timeout: 15000 });
  // MAP-105：受击展示与权威一致（用日志里的 hpAfter 对账；旧断言 !== '0' 是种子脆弱的）
  const cHit = hits.find(l => l.data?.target === c);
  assert(cHit && cHit.data?.hpAfter !== undefined);
  await expect(plate(c)).toHaveAttribute('data-hp', String(cHit.data.hpAfter), { timeout: 15000 });
  await sample(page, '05-aoe', true);
  await settle();
  assert.equal(player(c).alive, false);
  assert.equal(player(d).alive, false);

  await action(a, throwLabel, { room: r2 });
  await expect(room(r2)).toHaveClass(/is-pending/, { timeout: 15000 });
  await settle();
  const terminal = await action(b, '移动', { room: r2 });
  assert.deepEqual(terminal.filter(l => l.type === 'damage' && l.data?.tag === 'ivan').map(l => l.data?.target), [b]);
  assert.equal(game().phase, 'over');
  assert.equal(game().winner, a);
  await expect(room(r2)).toHaveAttribute('data-effect', 'blast', { timeout: 15000 });
  await expect(plate(b)).toHaveAttribute('data-hp', String(player(b).maxHp), { timeout: 15000 });
  await expect(page.locator('.win-modal')).toHaveCount(0);
  await sample(page, '06-blast', true);
  await expect(plate(b)).toHaveAttribute('data-hp', '0', { timeout: 15000 });
  await expect(page.locator('.win-modal')).toBeVisible({ timeout: 16000 });
  await sample(page, '07-result', true);
  await page.getByRole('button', { name: '查看战场' }).click();
  await page.waitForFunction(() => window.__b3scene?.debugMap().shot === 'winner');
  const winner = await sample(page, '08-winner', true);
  assert(winner.players?.some(p => p.pid === a && p.pose === 'cheer'));

  await page.getByRole('button', { name: '重新开始' }).click();
  await wait('new match', () => last?.lobby.gameNo === 2 && game().roundNo === 1);
  await page.waitForFunction(() => window.__b3scene?.debugCharacters().every(p => p.alive && p.pose === 'idle'));
  const rematch = await sample(page, '09-rematch');
  assert(rematch.reuse);
  assert.equal(rematch.contexts.active, 1);
  // The upstream rps2 phase is a private, player-driven sorting round.
  step = '3D action sorting';
  for (const seat of game().players) {
    await selectThrow(page, seat.name, seat.id === a || seat.id === b ? '石头' : '剪刀');
  }
  await wait('entered action sorting', () => game().phase === 'rps2');
  assert.deepEqual(new Set(game().orderGroup), new Set([a, b]));
  await selectThrow(page, player(a).name, '石头');
  await selectThrow(page, player(b).name, '剪刀');
  await wait('sorting settled', () => game().phase === 'act');
  assert.deepEqual(game().queue, [b, a]);
  evidence.actionSorting = { phase: game().phase, queue: game().queue, canvas: await page.locator('.b3-canvas').count() };
  for (const pid of [b, a]) {
    await wait('sorted actor turn', () => game().currentActor === pid);
    await page.locator('.scard').filter({ has: page.getByText('跳过', { exact: true }) }).click();
    await page.getByRole('button', { name: '确认发动' }).click();
  }
  await wait('next round after sorted actions', () => game().roundNo === 2);
  await settle();

  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: '2D', exact: true }).click();
    await expect(page.locator('.b3-canvas')).toHaveCount(0);
    await page.waitForFunction(() => window.mapContexts.active === 0);
    await expect(page.locator('.action-dock')).toBeVisible();
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await page.waitForFunction(() => window.__b3scene?.debugStats().rooms === 4);
    const state = await sample(page, `toggle-${i + 1}`);
    assert.equal(state.contexts.active, 1);
    assert.equal(state.contexts.peak, 1);
  }

  // ── MAP-105 · WebGL 上下文丢失 → 恢复：4s（B3D_RESTORE_WAIT_MS）内恢复则保持 3D，不重复创建上下文 ──
  await page.waitForFunction(() => {
    const s = window.__b3scene;
    // 等到新 renderer 完成几何上传再采样基线（切换后首帧可能滞后）
    return (s?.debugStats().calls ?? 0) > 0 && s!.renderer.info.memory.geometries > 100;
  });
  const ctxBefore = await page.evaluate(() => ({ ...window.mapContexts }));
  const geoBefore = await page.evaluate(() => window.__b3scene!.renderer.info.memory.geometries);
  await page.evaluate(() => {
    const gl = document.querySelector<HTMLCanvasElement>('.b3-canvas')!.getContext('webgl2')!;
    // 丢失前缓存扩展句柄：lost 状态下 getExtension 会返回 null，restore 时无法重取
    const ext = gl.getExtension('WEBGL_lose_context');
    (window as unknown as { __loseCtx?: WEBGL_lose_context }).__loseCtx = ext ?? undefined;
    ext!.loseContext();
  });
  await page.waitForFunction(() => window.mapContexts.lost >= 1);
  await page.evaluate(() => {
    (window as unknown as { __loseCtx?: WEBGL_lose_context }).__loseCtx!.restoreContext();
  });
  await page.waitForFunction(() => window.mapContexts.active >= 1 && window.mapContexts.lost >= 1);
  await page.waitForTimeout(4600); // > 4000ms：若恢复流程失败，此处必然已降级 2D
  await expect(page.locator('.b3-canvas')).toHaveCount(1);
  const restored = await sample(page, '12-webgl-restored');
  assert.equal(restored.contexts.created, ctxBefore.created); // 不重复创建 WebGL 上下文
  assert.equal(restored.contexts.active, 1);
  assert.equal(restored.contexts.lost, ctxBefore.lost + 1);
  assert.equal(restored.contexts.peak, ctxBefore.peak);
  await page.waitForFunction(() => (window.__b3scene?.debugStats().calls ?? 0) > 0); // 恢复后继续渲染
  assert.equal((await sample(page, '12-webgl-restored-render')).map?.rooms.length, 4); // 场景完整
  const geoAfter = await page.evaluate(() => window.__b3scene!.renderer.info.memory.geometries);
  assert.ok(Math.abs(geoAfter - geoBefore) <= 2, `geometry leak after restore: ${geoBefore} -> ${geoAfter}`);
  evidence.webglRestore = { path: '3d-restored', before: ctxBefore, after: restored.contexts, geoBefore, geoAfter };

  await page.locator('.bt3d-settings summary').click();
  await page.getByRole('button', { name: '自动镜头 开' }).click();
  await page.getByRole('button', { name: '精简特效 关' }).click();
  await page.locator('.bt3d-settings summary').click();
  const canvas = page.locator('.b3-canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.88, box.y + box.height * 0.44);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.79, box.y + box.height * 0.41, { steps: 4 });
  await page.mouse.up();
  await page.mouse.wheel(0, -120);
  await page.getByRole('button', { name: /视角/ }).click();
  // ── MAP-105 · 4× 倍速事件播报：播放中途切 4×，顺序与关键事件不因倍速丢失/重复 ──
  // battle-ctl（含倍速按钮）仅在演出队列忙碌时挂载，必须播放中切换。
  step = 'R2 4× 投掷大伊万';
  const round4x = await choose(a);
  await page.locator('.scard').filter({ has: page.getByText(throwLabel, { exact: true }) }).click();
  const doomedButton = page.locator(`.b3-roomlabel.is-pickable[data-room="${r3}"]`);
  await doomedButton.press('Enter');
  await expect(doomedButton).toHaveClass(/is-selected/, { timeout: 15000 });
  await page.getByRole('button', { name: '确认发动' }).click();
  // 播放中切 4×：忙碌窗口 ≈1.3s（SwiftShader 饥饿只会拉长它），轮询抢点 + on 类确认生效
  const t0 = Date.now();
  let engaged = false;
  while (Date.now() - t0 < 20000 && !engaged) {
    engaged = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.battle-ctl .bc-btn')]
        .find(b => b.textContent === '4×') as HTMLButtonElement | undefined;
      if (btn) btn.click();
      return [...document.querySelectorAll('.battle-ctl .bc-btn.on')].some(b => b.textContent === '4×');
    }).catch(() => false);
    if (!engaged) await page.waitForTimeout(120);
  }
  assert(engaged, '未能切入 4× 倍速（battle-ctl 忙碌窗口错过）');
  await wait('server settled 4x action', () => game().roundNo > round4x || game().phase === 'over');
  // 4× 下队列可能已自行排空（battle-ctl 卸载）：跳过按钮尽力而为
  await page.getByRole('button', { name: /全部跳过/ }).click({ timeout: 3000 }).catch(() => {});
  await settle();
  await expect(room(r3)).toHaveClass(/is-pending/, { timeout: 15000 });
  const skipped = await sample(page, '10-skip');
  assert.equal(skipped.map?.shot, 'overview');
  assert.equal(skipped.stats?.fx, 0);
  await platesMatchAuthority(); // 最终 UI 与权威日志一致（全员 HP 对账）
  await page.evaluate(() => {
    const gl = document.querySelector<HTMLCanvasElement>('.b3-canvas')!.getContext('webgl2')!;
    gl.getExtension('WEBGL_lose_context')!.loseContext();
  });
  await expect(page.locator('.b3-canvas')).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('.action-dock')).toBeVisible();
  const fallback = await sample(page, '11-webgl-fallback');
  assert.equal(fallback.contexts.active, 0);
  assert.deepEqual(errors, []);
}

async function selectThrow(page: Page, name: string, hand: string) {
  await page.getByRole('button', { name: `我是 ${name}，开始出拳` }).click();
  await page.locator('.throw-card').filter({ hasText: hand }).click();
}

async function onlineMatch(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string) {
  step = 'multiplayer reconnect';
  const host = await browser.newPage({ viewport });
  const guest = await browser.newPage({ viewport });
  const resumed: RoomUpdate[] = [];
  try {
    await attach(host);
    await guest.addInitScript(() => localStorage.setItem('badian-renderer', '3d'));
    guest.on('pageerror', error => errors.push(String(error)));
    guest.on('websocket', wire => wire.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string' || !payload.startsWith('42["room:update",')) return;
      const [, update] = JSON.parse(payload.slice(2)) as [string, RoomUpdate];
      if (update.catchUp) resumed.push(update);
    }));
    await host.goto(url);
    await host.getByPlaceholder('输入昵称').fill('在线甲');
    await host.getByRole('button', { name: /仅创建/ }).click();
    await wait('host opened room', () => last?.lobby.seats[0]?.name === '在线甲');
    await guest.goto(url);
    await guest.getByPlaceholder('输入昵称').fill('在线乙');
    await guest.getByPlaceholder('4位邀请码').fill(last!.lobby.code);
    await guest.getByRole('button', { name: '加入房间', exact: true }).click();
    await wait('two browsers joined', () => last?.lobby.seats.length === 2);
    await host.getByRole('button', { name: /开始对局/ }).click();
    await wait('online match started', () => last?.game?.phase === 'rps1');
    const [a, b] = game().players;
    await guest.waitForFunction(() => window.__b3scene?.debugStats().rooms === 2);
    await selectThrow(guest, b.name, '剪刀');
    await wait('guest submitted', () => game().submittedIds.includes(b.id));
    await guest.context().setOffline(true);
    await selectThrow(host, a.name, '石头');
    await wait('acting host', () => game().currentActor === a.id);
    await host.locator('.scard').filter({ has: host.getByText('移动', { exact: true }) }).click();
    await host.locator(`.b3-roomlabel[data-room="${b.room}"]`).press('Enter');
    await host.getByRole('button', { name: '确认发动' }).click();
    await wait('remote move settled', () => game().roundNo === 2);
    await guest.context().setOffline(false);
    await wait('guest receives targeted catch-up', () => resumed.length > 0);
    const catchUp = resumed.at(-1)!;
    assert(catchUp.newLogs.some(l => l.type === 'move'));
    await guest.waitForFunction(({ id, room }) => window.__b3scene?.debugCharacters().some(p => p.pid === id && p.room === room)
      && window.__b3scene.debugStats().walks === 0, { id: a.id, room: b.room });
    await expect(guest.getByTestId('battle-ctl')).toHaveCount(0);
    await selectThrow(guest, b.name, '剪刀');
    await wait('new turn broadcast after reconnect', () => game().submittedIds.includes(b.id));
    evidence.multiplayer = { catchUpLastSeq: catchUp.newLogs.at(-1)?.seq, room: catchUp.lobby.code,
      players: catchUp.game?.players.map(p => [p.name, p.room]), resumedRound: catchUp.game?.roundNo,
      acceptedNewThrow: true, guestScene: await guest.evaluate(() => window.__b3scene?.debugMap()) };
    // 清理性退出：负载饱和时按钮可能点不动，页面在 finally 关闭即可
    await host.getByRole('button', { name: '退出房间', exact: true }).click({ timeout: 5000 }).catch(() => {});
    await guest.getByRole('button', { name: '退出房间', exact: true }).click({ timeout: 5000 }).catch(() => {});
  } finally {
    await guest.close();
    await host.close();
  }
}

async function aiMatch(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string) {
  step = 'solo AI full match';
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  try {
    await attach(page);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.getByPlaceholder('输入昵称').fill('单人验收');
    await page.getByLabel('选择角色卡').selectOption('laodaye');
    await page.getByLabel(/AI 数量/).selectOption('1');
    await page.getByRole('button', { name: /单人开局/ }).click();
    await wait('AI match started', () => last?.lobby.seats[0]?.name === '单人验收' && !!last.game);
    const [human, bot] = game().players;
    let input = 0;
    while (game().phase !== 'over' && input < 40) {
      const { phase, roundNo, currentActor } = game();
      if (phase === 'rps1') {
        await selectThrow(page, human.name, ['石头', '剪刀', '布'][input % 3]);
      } else if (currentActor === human.id) {
        const self = player(human.id);
        const opponent = player(bot.id);
        const label = self.room === opponent.room ? '攻击' : '移动';
        await page.locator('.scard').filter({ has: page.getByText(label, { exact: true }) }).click();
        if (label === '移动') await page.locator(`.b3-roomlabel[data-room="${opponent.room}"]`).press('Enter');
        else await page.locator(`.b3-plate[data-pid="${bot.id}"]`).press('Enter');
        await page.getByRole('button', { name: '确认发动' }).click();
      }
      await wait('AI round progression', () => game().phase !== phase || game().roundNo > roundNo || game().currentActor !== currentActor);
      const skip = page.getByRole('button', { name: /全部跳过/ });
      if (await skip.isVisible()) await skip.click().catch(() => {});
      input++;
    }
    assert.equal(game().phase, 'over');
    if (await page.getByRole('button', { name: /直接结算/ }).isVisible()) {
      await page.getByRole('button', { name: /直接结算/ }).click().catch(() => {});
    }
    await expect(page.locator('.win-modal')).toBeVisible({ timeout: 20000 });
    evidence.ai = { rounds: game().roundNo, winner: game().players.find(p => p.id === game().winner)?.name ?? null,
      canvas: await page.locator('.b3-canvas').count(), inputs: input, reducedMotion: true };
    await page.getByRole('button', { name: '离开房间', exact: true }).click();
  } finally {
    await page.close();
  }
}

/** MAP-105：场景开局助手（带重试）——前一局的房间/连接残留可能让首次 createRoom 超时 */
async function setupRoom(page: Page, url: string, nickname: string, roster: string[]) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // SwiftShader 下旧页销毁可能阻塞浏览器 GPU 进程，DCL 可能迟迟不触发：放宽到 60s
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.getByPlaceholder('输入昵称').fill(nickname);
      await page.getByLabel('选择角色卡').selectOption(roster[0]);
      await page.getByLabel(/单设备多人/).selectOption('4');
      await page.getByRole('button', { name: /仅创建/ }).click();
      for (let index = 1; index < roster.length; index++) {
        await page.locator('.seat-slot').filter({ hasText: `${nickname}${index + 1}` }).locator('select').selectOption(roster[index]);
      }
      await wait(`${nickname} roster`, () => last?.lobby.seats.map(s => s.charId).join() === roster.join());
      await page.getByRole('button', { name: /开始对局/ }).click();
      await wait(`${nickname} rps1`, () => last?.game?.phase === 'rps1');
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      console.error(`${nickname} setup retry:`, String(error).slice(0, 120));
      // 清残留占用后重试
      await page.getByRole('button', { name: /退出旧房间|退出房间/ }).click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(2500);
    }
  }
}

/** MAP-105 边角场景①：实际未命中——大伊万弹房里的目标在起爆前撤离，爆炸空房、无人受伤 */
async function missMatch(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string) {
  step = 'edge miss: target left the doomed room';
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  activePage = page;
  try {
    await attach(page);
    const roster = ['ivan-girl', 'wuliuqi', 'default', 'default'];
    await setupRoom(page, url, '未命中验收', roster);
    // 场景冷启动：等首帧渲染完成再交互（否则 SwiftShader 饱和期点击饿死）。
    // 60s 仍无 3D 场景 → 可能已降级 2D（场景断言依赖 3D 覆盖层），给出明确报错
    await page.waitForFunction(() => (window.__b3scene?.debugStats().calls ?? 0) > 0, undefined, { timeout: 60000 })
      .catch(() => { throw new Error('3D 场景 60s 未渲染（可能 WebGL 异常降级 2D），边角场景需要 3D 覆盖层'); });
    logs.clear(); // 每个场景独立的权威日志窗口
    const { action, settle, room, plate, mapWait, platesMatchAuthority } = makeHelpers(page);
    const [a, , c] = game().players.map(p => p.id);
    const doomRoom = player(c).room;
    const cursor = Math.max(0, ...logs.keys());
    // R1：a 向 c 所在房间投掷大伊万（引擎 explodeRound = roundNo + 1）
    await action(a, '投掷大伊万', { room: doomRoom });
    await expect(room(doomRoom)).toHaveClass(/is-pending/, { timeout: 15000 });
    assert.equal(game().deferred.find(e => e.kind === 'ivan')?.room, doomRoom);
    // R2：c 撤离弹房（目标已离开原房间）
    await action(c, '移动', { room: player(a).room });
    assert.equal(player(c).room, player(a).room);
    await mapWait(c, player(a).room);
    await expect(room(doomRoom)).toHaveClass(/is-pending/, { timeout: 15000 }); // 起爆未到，危险仍在
    await settle(); // 回合末起爆：弹房已空
    await expect(room(doomRoom)).not.toHaveClass(/is-pending/, { timeout: 15000 });
    // 展示与结算一致：无伊万伤害、c 完好、HP 不变
    assert.equal(player(c).alive, true);
    assert.equal(player(c).hp, player(c).maxHp);
    await expect(plate(c)).toHaveAttribute('data-hp', String(player(c).maxHp), { timeout: 15000 });
    const slice = [...logs.values()].filter(l => l.seq > cursor);
    const ivanDamage = slice.filter(l => l.type === 'damage' && l.data?.tag === 'ivan');
    assert.deepEqual(ivanDamage.map(l => l.data?.target), []);      // 弹房空：零伤害
    const throwLog = slice.find(l => l.type === 'deferred' && l.data?.room === doomRoom && l.data?.pid);
    const boomLog = slice.find(l => l.type === 'deferred' && l.data?.room === doomRoom && l.data?.pid === undefined);
    assert(throwLog && boomLog);                                     // 投掷与爆炸日志成对
    assert(boomLog.text!.includes('无存活玩家'));                     // 权威日志确认空房起爆
    await platesMatchAuthority();
    evidence.missEscape = {
      boomRoom: doomRoom, escaped: c, escapedTo: player(c).room,
      ivanDamageTargets: ivanDamage.map(l => l.data?.target),
      boomText: boomLog.text, hpAfter: game().players.map(p => [p.name, p.hp, p.alive, p.room]),
    };
    await shot(page, `${out}/edge-miss-escaped.png`).catch(() => {});
    await page.getByRole('button', { name: '退出房间', exact: true }).click();
    await page.close(); // 成功才在此关闭；失败时留给主 catch 取证
  } catch (error) {
    throw error;
  }
}

/** MAP-105 边角场景②：同归于尽平局——最后一发大伊万同时带走最后两人，判定平局、无胜者 */
async function drawMatch(browser: Awaited<ReturnType<typeof chromium.launch>>, url: string) {
  step = 'edge draw: mutual elimination';
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  activePage = page;
  try {
    await attach(page);
    const roster = ['ivan-girl', 'wuliuqi', 'default', 'default'];
    await setupRoom(page, url, '平局验收', roster);
    await page.waitForFunction(() => (window.__b3scene?.debugStats().calls ?? 0) > 0, undefined, { timeout: 60000 })
      .catch(() => { throw new Error('3D 场景 60s 未渲染（可能 WebGL 异常降级 2D），边角场景需要 3D 覆盖层'); }); // 场景冷启动
    logs.clear();
    const { action, settle, room, plate, mapWait, platesMatchAuthority } = makeHelpers(page);
    const [a, b, c, d] = game().players.map(p => p.id);
    const [, , r3] = game().players.map(p => p.originRoom);
    // 阶段一：清场到只剩 a + b（复刻主流程编排，伤害展示全程与权威对账）
    await action(b, '移动', { room: r3 });
    await mapWait(b, r3);
    await settle();
    await action(d, '移动', { room: r3 });
    await mapWait(d, r3);
    await settle();
    const damage = await action(c, '攻击', { pid: b });
    const single = damage.find(l => l.type === 'damage' && l.data?.target === b && l.data?.hpAfter !== undefined);
    assert(single);
    await expect(plate(b)).toHaveAttribute('data-hp', String(single.data?.hpAfter), { timeout: 15000 });
    await settle();
    await action(b, '回复');
    await expect(room(r3)).toHaveAttribute('data-effect', 'heal', { timeout: 15000 });
    await expect(plate(b)).toHaveAttribute('data-hp', String(player(b).maxHp), { timeout: 15000 });
    await settle();
    const aoe = await action(b, '攻击', { pid: c });
    const hits = aoe.filter(l => l.type === 'damage' && l.data?.tag === 'wuliuqi-aoe');
    assert.deepEqual(new Set(hits.map(l => l.data?.target)), new Set([c, d]));
    await settle();
    assert.equal(player(c).alive, false);
    assert.equal(player(d).alive, false);
    assert.deepEqual(game().players.filter(p => p.alive).map(p => p.id).sort(), [a, b].sort());
    // 阶段二：同归于尽编排 —— a 本回合投掷，下回合走进弹房，回合末与 b 一起被炸
    await action(a, '投掷大伊万', { room: r3 });
    await expect(room(r3)).toHaveClass(/is-pending/, { timeout: 15000 });
    await settle();
    const cursor = Math.max(0, ...logs.keys());
    await action(a, '移动', { room: r3 }); // 该回合结算即起爆：action 返回时胜负已定
    await mapWait(a, r3);
    // 播放中断言爆炸演出：data-effect 是瞬时效果，settle（队列排空）后会被清除
    await expect(room(r3)).toHaveAttribute('data-effect', 'blast', { timeout: 15000 });
    await settle();
    // 权威判定：全员淘汰 → 平局，无胜者
    assert.equal(game().phase, 'over');
    assert.equal(game().winner, null);
    const slice = [...logs.values()].filter(l => l.seq > cursor);
    const ivanTargets = slice.filter(l => l.type === 'damage' && l.data?.tag === 'ivan').map(l => l.data?.target).sort();
    assert.deepEqual(new Set(ivanTargets), new Set([a, b]));        // 同一发同 groupId 炸死两人
    assert.deepEqual(new Set(slice.filter(l => l.type === 'eliminate').map(l => l.data?.pid)), new Set([a, b]));
    const resultLog = slice.find(l => l.type === 'result');
    assert(resultLog && resultLog.text!.includes('平局'));           // 权威日志：平局
    // 展示与权威一致：双方名牌归零 → 平局弹层（无胜者）
    for (const pid of [a, b]) await expect(plate(pid)).toHaveAttribute('data-hp', '0', { timeout: 15000 });
    await platesMatchAuthority();
    await expect(page.locator('.win-modal')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.win-modal.draw')).toBeVisible();
    // 渲染文本含字间空格（「平 局」），断言无歧义的「全员同时淘汰」
    await expect(page.locator('.win-modal')).toContainText('全员同时淘汰', { timeout: 15000 });
    // 3D 平局镜头：无胜者特写、无人欢呼
    await page.getByRole('button', { name: '查看战场' }).click().catch(() => {});
    await page.waitForFunction(() => window.__b3scene?.debugMap().shot === 'draw', undefined, { timeout: 15000 });
    const chars = await page.evaluate(() => window.__b3scene!.debugCharacters().map(p => [p.pid, p.pose, p.alive]));
    assert(chars.every(([, pose]) => pose !== 'cheer'));
    evidence.draw = {
      winner: game().winner, phase: game().phase, ivanTargets,
      resultText: resultLog.text, characters: chars,
      shot: await page.evaluate(() => window.__b3scene!.debugMap().shot),
    };
    await shot(page, `${out}/edge-draw-field.png`).catch(() => {});
    await page.getByRole('button', { name: '离开房间', exact: true }).click().catch(() => {});
    await page.close(); // 成功才在此关闭；失败时留给主 catch 取证
  } catch (error) {
    throw error;
  }
}

await mkdir(out, { recursive: true });
startServer(0);
await once(httpServer, 'listening');
const address = httpServer.address();
assert(address && typeof address === 'object');
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
let failure: string | undefined;
let matchLogs: SnapLog[] | undefined;
let activePage: Page | undefined; // MAP-105：失败现场定位（scenario 页面与主页面不同）
try {
  const url = `http://127.0.0.1:${address.port}`;
  await match(page, url);
  matchLogs = [...logs.values()];
  await page.close();
  await new Promise(done => setTimeout(done, 2000)); // 旧页 SwiftShader 销毁缓冲
  await missMatch(browser, url);
  await drawMatch(browser, url);
  await onlineMatch(browser, url);
  await aiMatch(browser, url);
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error);
  // MAP-105：失败现场定位——场景页面与主页面不同，抓当前活动页的 URL 与正文摘要
  if (activePage && !activePage.isClosed()) {
    await shot(activePage, `${out}/failure.png`).catch(() => {});
    failure += `\n[url=${activePage.url()}] ` + (await activePage.evaluate(() =>
      document.body.innerText.slice(0, 400)).catch(() => 'body-unreadable'));
  }
  console.error(step, error);
  process.exitCode = 1;
} finally {
  await writeFile(`${out}/match.json`, JSON.stringify({
    passed: !failure, failure, step, browser: browser.version(), viewport, evidence, errors, logs: matchLogs ?? [...logs.values()],
  }, null, 2));
  await browser.close();
  await io.close();
}
