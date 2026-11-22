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
  expect.poll(predicate, { message, timeout: 15000 }).toBe(true);
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
  if (photo) await page.screenshot({ path: `${out}/${label}.png`, timeout: 30000 });
  return state;
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

  async function choose(actor: string | null) {
    const start = game();
    for (const seat of start.players.filter(p => p.alive)) {
      await page.getByRole('button', { name: `我是 ${seat.name}，开始出拳` }).click();
      await page.locator('.throw-card').filter({ hasText: !actor || seat.id === actor ? '石头' : '剪刀' }).click();
    }
    if (actor) {
      await wait('server accepted actor', () => game().currentActor === actor);
      assert.deepEqual(game().queue, [actor]);
    } else await wait('tie advanced round', () => game().roundNo > start.roundNo);
    return start.roundNo;
  }

  async function action(actor: string, label: string, target?: { room: string } | { pid: string }) {
    step = `R${game().roundNo} ${label}`;
    const round = await choose(actor);
    await page.locator('.scard').filter({ has: page.getByText(label, { exact: true }) }).click();
    if (target && 'room' in target) {
      const button = page.locator(`.b3-roomlabel.is-pickable[data-room="${target.room}"]`);
      await button.press('Enter');
      await expect(button).toHaveClass(/is-selected/);
    }
    if (target && 'pid' in target) {
      const plate = page.locator(`.b3-plate.is-targetable[data-pid="${target.pid}"]`);
      await plate.evaluate(el => (el as HTMLElement).click());
      await expect(plate).toHaveClass(/is-selected/);
    }
    const cursor = Math.max(0, ...logs.keys());
    await page.getByRole('button', { name: '确认发动' }).click();
    await wait('server settled action', () => game().roundNo > round || game().phase === 'over');
    return [...logs.values()].filter(l => l.seq > cursor);
  }

  const queued = page.getByTestId('battle-ctl');
  const settle = () => expect(queued).toHaveCount(0, { timeout: 17000 });
  const room = (id: string) => page.locator(`.b3-roomlabel[data-room="${id}"]`);
  const plate = (id: string) => page.locator(`.b3-plate[data-pid="${id}"]`);
  const mapWait = (pid: string, target: string) =>
    page.waitForFunction(({ pid, target }) => window.__b3scene?.debugCharacters().some(p => p.pid === pid && p.room === target)
      && window.__b3scene.debugStats().walks === 0, { pid, target });

  const throwLabel = '投掷大伊万';
  await action(a, throwLabel, { room: r2 });
  await expect(room(r2)).toHaveClass(/is-pending/);
  await sample(page, '02-pending', true);
  await settle();
  await choose(null);
  assert.equal(game().deferred.find(e => e.kind === 'ivan')?.room, r2);
  await expect(room(r2)).toHaveClass(/is-pending/);
  const emptyBlast = await action(b, '移动', { room: r3 });
  assert.equal(player(b).room, r3);
  assert(emptyBlast.some(l => l.type === 'deferred' && l.data?.room === r2));
  assert(!emptyBlast.some(l => l.type === 'damage' && l.data?.tag === 'ivan'));
  await mapWait(b, r3);
  await settle();
  await expect(room(r2)).not.toHaveClass(/is-pending/);

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
  await expect(plate(b)).toHaveAttribute('data-hp', String(single.data?.hpAfter));
  await settle();
  await action(b, '回复');
  await expect(room(r3)).toHaveAttribute('data-effect', 'heal');
  await expect(plate(b)).toHaveAttribute('data-hp', String(player(b).maxHp));
  await settle();

  const aoe = await action(b, '攻击', { pid: c });
  const hits = aoe.filter(l => l.type === 'damage' && l.data?.tag === 'wuliuqi-aoe');
  assert(hits.length >= 4);
  assert.deepEqual(new Set(hits.map(l => l.data?.target)), new Set([c, d]));
  await expect(room(r3)).toHaveAttribute('data-effect', 'aoe');
  assert(await plate(c).getAttribute('data-hp') !== '0');
  await sample(page, '05-aoe', true);
  await settle();
  assert.equal(player(c).alive, false);
  assert.equal(player(d).alive, false);

  await action(a, throwLabel, { room: r2 });
  await expect(room(r2)).toHaveClass(/is-pending/);
  await settle();
  const terminal = await action(b, '移动', { room: r2 });
  assert.deepEqual(terminal.filter(l => l.type === 'damage' && l.data?.tag === 'ivan').map(l => l.data?.target), [b]);
  assert.equal(game().phase, 'over');
  assert.equal(game().winner, a);
  await expect(room(r2)).toHaveAttribute('data-effect', 'blast');
  await expect(plate(b)).toHaveAttribute('data-hp', String(player(b).maxHp));
  await expect(page.locator('.win-modal')).toHaveCount(0);
  await sample(page, '06-blast', true);
  await expect(plate(b)).toHaveAttribute('data-hp', '0');
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
  await action(a, throwLabel, { room: r3 });
  await page.getByRole('button', { name: /全部跳过/ }).click();
  await settle();
  await expect(room(r3)).toHaveClass(/is-pending/);
  const skipped = await sample(page, '10-skip');
  assert.equal(skipped.map?.shot, 'overview');
  assert.equal(skipped.stats?.fx, 0);
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
    await host.getByRole('button', { name: '退出房间', exact: true }).click();
    await guest.getByRole('button', { name: '退出房间', exact: true }).click();
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
    await page.goto(url);
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
try {
  const url = `http://127.0.0.1:${address.port}`;
  await match(page, url);
  matchLogs = [...logs.values()];
  await page.close();
  await onlineMatch(browser, url);
  await aiMatch(browser, url);
  assert.deepEqual(errors, []);
} catch (error) {
  failure = String(error);
  await page.screenshot({ path: `${out}/failure.png`, timeout: 4000 }).catch(() => {});
  console.error(step, error);
  process.exitCode = 1;
} finally {
  await writeFile(`${out}/match.json`, JSON.stringify({
    passed: !failure, failure, step, browser: browser.version(), viewport, evidence, errors, logs: matchLogs ?? [...logs.values()],
  }, null, 2));
  await browser.close();
  await io.close();
}
