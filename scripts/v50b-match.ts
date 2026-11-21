/// <reference lib="dom" />
/** After the build signal only: npx tsx scripts/v50b-match.ts [baseUrl]
 * Existing HTTP service, fresh Chromium profile, no AI or timeouts. HEADED=1 enables hardware rendering.
 * All game inputs use the shipped UI. WebSocket traffic and renderer probes are read-only evidence.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { expect } from '@playwright/test';
import type { RoomUpdate, SnapLog } from '../client/src/net.js';

const BASE = process.argv[2] ?? process.env.BASE ?? 'http://127.0.0.1:3250';
const out = fileURLToPath(new URL(`../docs/screenshots-v50b/${new Date().toISOString().replace(/[:.]/g, '-')}/`, import.meta.url));
const viewport = { width: 1440, height: 900 };
type Character = { pid: string; charId: string; asset: string; pose: string; t: number; dur: number;
  room: string; alive: boolean; visible: boolean; x: number; y: number; z: number };
type Scene = { debugStats(): Record<string, number>; debugCharacters(): Character[];
  camera: import('three').Camera; camMoving: boolean;
  entities: Map<string, { rig: { root: import('three').Object3D } }> };
declare global {
  interface Window { __b3scene?: Scene; __v50bFirst?: WeakRef<Scene> }
}
const errors: string[] = [];
const evidence: Record<string, unknown> = {};
const rounds: unknown[] = [];
const logs = new Map<number, SnapLog>();
let last: RoomUpdate | undefined;
let step = 'launch';
let passed = false;
let page: Page | undefined;
const wait = async (description: string, pred: () => boolean) =>
  expect.poll(pred, { message: description, timeout: 10_000, intervals: [40, 100, 200] }).toBe(true);
const game = () => { assert(last?.game, 'No server game snapshot'); return last.game; };

// Normal screenshots can miss a 400 ms pose under SwiftShader. Read the *actual* rendered canvas
// on RAF with both probes, copying only one matching, nonblank frame. No extra render or pose call.
async function capturePose(p: Page, pid: string, pose: string, file: string) {
  const handle = await p.waitForFunction(({ pid, pose }) => {
    const s = window.__b3scene;
    const chars = s?.debugCharacters();
    const c = chars?.find(c => c.pid === pid && c.asset === 'gojo-v1' && c.pose === pose);
    const canvas = document.querySelector<HTMLCanvasElement>('.b3-canvas');
    if (!s || !canvas || !c?.visible) return false;
    const fraction = c.t / (pose === 'dead' ? 0.55 : c.dur);
    if (pose === 'idle' ? (s.camMoving || c.t < 1.5) : !(fraction >= 0.35 && fraction <= 0.8)) return false;
    const box = canvas.getBoundingClientRect();
    if (!(c.x > 0 && c.x < box.width && c.y > 0 && c.y < box.height)) return false;
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    const ctx = copy.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(canvas, 0, 0);
    const thumb = document.createElement('canvas'); thumb.width = 32; thumb.height = 24;
    const tiny = thumb.getContext('2d')!; tiny.drawImage(copy, 0, 0, 32, 24);
    const colors = new Set(new Uint32Array(tiny.getImageData(0, 0, 32, 24).data.buffer)).size;
    if (colors < 16) return false; // drawing buffer already discarded; try the next rendered frame
    // Project the visible rig's mesh vertices with the rendered world matrices, not a
    // nameplate/center point. This is a projected envelope, not a depth-tested silhouette.
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, vertices = 0;
    s.entities.get(pid)!.rig.root.traverseVisible(o => {
      const mesh = o as import('three').Mesh;
      const pos = mesh.geometry?.attributes.position;
      if (!mesh.isMesh || !pos) return;
      const v = o.position.clone();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).project(s.camera);
        const x = (1 + v.x) * box.width / 2, y = (1 - v.y) * box.height / 2;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y); vertices++;
      }
    });
    if (!vertices || right <= left || bottom <= top) return false;
    const visibleFraction = Math.max(0, Math.min(right, box.width) - Math.max(0, left)) *
      Math.max(0, Math.min(bottom, box.height) - Math.max(0, top)) / ((bottom-top)*(right-left));
    const overlaps = Array.from(document.querySelectorAll<HTMLElement>(
      '.b3-plate,.b3-roomlabel,.bt3d-corner,.bt3d-reveal-wrap,.action-dock,.win-modal,.battle-ctl,header')).flatMap(el => {
      const r = el.getBoundingClientRect(), style = getComputedStyle(el);
      const area = Math.max(0, Math.min(box.left+right, r.right) - Math.max(box.left+left, r.left)) *
        Math.max(0, Math.min(box.top+bottom, r.bottom) - Math.max(box.top+top, r.top));
      return area > 0 && style.visibility !== 'hidden' && Number(style.opacity) > 0 ?
        [{ element: el.className, pid: el.dataset.pid, rect: r.toJSON(), fraction: area / ((bottom-top)*(right-left)) }] : [];
    });
    return { chars, stats: s.debugStats(), colors, css: { width: box.width, height: box.height },
      bitmap: { width: copy.width, height: copy.height }, canvasRect: box.toJSON(),
      meshCss: { left, top, right, bottom }, meshBitmap: { left: left*copy.width/box.width, right: right*copy.width/box.width,
        top: top*copy.height/box.height, bottom: bottom*copy.height/box.height }, vertices, visibleFraction, overlaps,
      fraction: pose === 'idle' ? null : fraction, cameraMoving: s.camMoving, at: performance.now(), png: copy.toDataURL('image/png') };
  }, { pid, pose }, { polling: 'raf', timeout: 20_000 });
  try {
    const frame = await handle.jsonValue(); assert(frame);
    const { png, ...info } = frame;
    await writeFile(path.join(out, file + '.png'), Buffer.from(png.split(',')[1], 'base64'));
    evidence[file] = { ...info, pid, pose, gameNo: last?.lobby.gameNo };
  } finally { await handle.dispose(); }
}

async function run(p: Page) {
  p.setDefaultTimeout(12_000);
  p.on('pageerror', e => errors.push(String(e)));
  p.on('websocket', ws => {
    if (new URL(ws.url()).pathname !== '/socket.io/') return;
    ws.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string' || !payload.startsWith('42["room:update",')) return;
      const [, u] = JSON.parse(payload.slice(2)) as [string, RoomUpdate];
      last = u;
      for (const log of u.newLogs) logs.set(log.seq, log);
    });
  });
  const shot = (name: string, fullPage = false) => p.screenshot({ path: path.join(out, name + '.png'), fullPage, timeout: 60_000 });
  const sample = async (name: string) => {
    const s = await p.evaluate(() => {
      const s = window.__b3scene!;
      return { chars: s.debugCharacters(), stats: s.debugStats(), reused: s === window.__v50bFirst?.deref() };
    });
    evidence[name] = s;
    for (const key of ['entities', 'rooms', 'geometries', 'textures', 'calls', 'triangles']) {
      assert(Number.isFinite(s.stats[key]) && s.stats[key] >= 0, `${name}: invalid ${key}`);
    }
    assert(s.stats.calls > 0 && s.stats.triangles > 0 && s.stats.geometries > 0, `${name}: empty renderer`);
    assert.equal(s.stats.entities, 3); assert.equal(s.stats.rooms, 3);
    return s;
  };
  step = 'create local seats';
  await p.goto(BASE, { waitUntil: 'domcontentloaded' });
  await p.getByPlaceholder('输入昵称').fill('V50B');
  await p.getByLabel('选择角色卡').selectOption('gojo');
  await p.getByLabel(/单设备多人/).selectOption('3');
  await p.getByRole('button', { name: /仅创建/ }).click();
  await p.locator('.seat-slot').filter({ hasText: 'V50B3' }).locator('select').selectOption('default');
  await wait('server accepts local roster', () => last?.lobby.seats.map(s => s.charId).join() === 'gojo,gojo,default');
  assert.deepEqual(last!.lobby.seats.map(s => s.type), ['human', 'local', 'local']);
  const code = last!.lobby.code;
  await shot('00-local-lobby');
  await p.getByRole('button', { name: /开始对局/ }).click();
  await wait('first game starts', () => last?.game?.phase === 'rps1');
  await p.waitForFunction(() => window.__b3scene?.debugCharacters?.().length === 3, undefined, { timeout: 15_000 });
  await p.evaluate(() => { window.__v50bFirst = new WeakRef(window.__b3scene!); });
  // In hot-seat mode Game.tsx submits as currentActor, but computes validTargets from
  // identities[0]. Keep the host (b) alive and never target it; film the second Gojo (a).
  const [b, a, c] = game().players.map(p => p.id);
  evidence.seats = last!.lobby.seats.map(({ playerId, name, type, charId }) => ({ playerId, name, type, charId }));
  evidence.subject = a;
  const player = (id: string) => game().players.find(p => p.id === id)!;
  const room = player(b).originRoom;
  const firstNo = last!.lobby.gameNo!;
  assert.equal(firstNo, 1);
  const clickBoard = async (selector: string) => {
    // The real room labels/nameplates follow the camera every frame. Invoke the HTML button/label's
    // native click handler, not a scene hook or fabricated network packet.
    const el = p.locator(selector); await el.waitFor({ state: 'visible' });
    await el.evaluate(el => (el as HTMLElement).click());
  };
  let flat = false;
  async function act(actor: string, kind: 'move' | 'attack', target: string, capture?: [string, string]) {
    const start = game(); const n = start.roundNo; const gameNo = last!.lobby.gameNo;
    step = `game ${gameNo}, round ${n}: ${actor} ${kind} ${target}`;
    assert.equal(start.phase, 'rps1'); assert.equal(start.submittedIds.length, 0);
    const throws: Record<string, string> = {};
    for (const seat of start.players.filter(s => s.alive)) {
      throws[seat.id] = seat.id === actor ? 'rock' : 'scissors';
      await p.getByRole('button', { name: `我是 ${seat.name}，开始出拳` }).click();
      await p.locator('.throw-card').filter({ hasText: seat.id === actor ? '石头' : '剪刀' }).click();
    }
    await wait(step + ': actor', () => game().phase === 'act' && game().currentActor === actor);
    assert.deepEqual(game().queue, [actor]);
    assert.deepEqual(game().reveal?.throws, throws);
    const label = kind === 'move' ? '移动' : '攻击';
    await p.locator('button.scard').filter({ has: p.getByText(label, { exact: true }) }).click();
    if (kind === 'move') {
      if (flat) await p.locator('.confirm-bar select').selectOption(target);
      else await clickBoard(`.b3-roomlabel.is-pickable[data-room="${target}"]`);
    } else {
      await clickBoard(flat ? `.ccard[data-pid="${target}"]` : `.b3-plate.is-targetable[data-pid="${target}"]`);
    }
    const cursor = Math.max(0, ...logs.keys());
    await Promise.all([
      capture && capturePose(p, a, capture[0], capture[1]),
      p.getByRole('button', { name: '确认发动' }).click(),
      wait(step + ': settlement', () => game().roundNo > n || game().phase === 'over'),
    ]);
    const fresh = [...logs.values()].filter(l => l.seq > cursor);
    const proof = fresh.find(l => kind === 'move' ? l.type === 'move' && l.data?.pid === actor && l.data.to === target
      : l.type === 'damage' && !l.data?.declared && l.data?.source === actor && l.data.target === target);
    assert(proof, `${step}: missing authoritative ${kind} log`);
    rounds.push({ gameNo, seed: start.seed, round: n, actor, kind, target, throws, logs: fresh.map(l => l.seq),
      players: game().players.map(({ id, room, alive, hp, char }) => ({ id, room, alive, hp, lives: char.livesLeft })) });
    return fresh;
  }
  await capturePose(p, a, 'idle', '01-idle');
  const baseline = await sample('game1-initial');
  assert.deepEqual(baseline.chars.map(x => x.asset).sort(), ['gojo-v1', 'gojo-v1', 'humanoid']);
  await shot('02-separated-rooms');
  await act(a, 'move', room); assert.equal(player(a).room, room);
  await act(c, 'move', room);
  await p.waitForFunction(room => {
    const s = window.__b3scene!;
    return s.debugStats().walks === 0 && s.debugCharacters().every(c => c.room === room && c.visible);
  }, room);
  await sample('same-room'); await shot('03-same-room');
  await shot('03-same-room-full', true);
  const mobile = { width: 390, height: 844 };
  await p.setViewportSize(mobile);
  await p.waitForFunction(w => window.innerWidth === w && !window.__b3scene?.camMoving &&
    document.querySelector('.b3-canvas')!.getBoundingClientRect().width <= w, mobile.width);
  await capturePose(p, a, 'idle', '03-mobile-idle');
  const mobileFrame = evidence['03-mobile-idle'] as { visibleFraction: number; overlaps: { element: string }[] };
  assert(mobileFrame.visibleFraction >= 0.99, 'portrait: subject cut off by stage');
  assert(!mobileFrame.overlaps.some(o => o.element.includes('action-dock')), 'portrait: action dock covers subject');
  await shot('03-mobile-viewport');
  await shot('03-mobile-full', true);
  evidence.mobile = { viewport: mobile, document: await p.evaluate(() => ({ width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight })), gameNo: last!.lobby.gameNo, roundNo: game().roundNo };
  await p.setViewportSize(viewport);
  await act(c, 'attack', a, ['flinch', '04-hit']); assert.equal(player(a).hp, 2);
  await act(a, 'attack', c, ['attack', '05-attack']); assert.equal(player(c).alive, false);
  const revived = await act(b, 'attack', a, ['revive', '06-revive']);
  assert(revived.some(l => l.type === 'trigger' && l.data?.pid === a && l.data.livesLeft === 1));
  assert.equal(player(a).hp, 3); assert.equal(player(a).alive, true);
  const died = await act(b, 'attack', a, ['dead', '07-death']);
  assert(died.some(l => l.type === 'eliminate' && l.data?.pid === a));
  assert.equal(player(a).alive, false); assert.equal(game().winner, b);
  await p.locator('.win-modal').waitFor({ timeout: 25_000 });
  await p.waitForFunction(id => window.__b3scene?.debugCharacters().some(x => x.pid === id &&
    x.pose === 'dead' && !x.alive && !x.visible), a, { timeout: 30_000 });
  const over = await sample('game1-over'); assert.equal(over.stats.bodiesHidden, 2);
  await shot('08-finale');
  step = 'restart in the same scene';
  await p.getByRole('button', { name: /再来一局/ }).click();
  await wait(step, () => last?.lobby.gameNo === firstNo + 1 && game().phase === 'rps1');
  assert.equal(last!.lobby.code, code); assert.equal(game().roundNo, 1);
  await p.waitForFunction(() => {
    const s = window.__b3scene;
    return s && s.debugStats().fx === 0 && s.debugStats().walks === 0 && s.debugStats().tweens === 0 &&
      s.debugCharacters().every(c => c.visible && c.alive && c.pose === 'idle');
  }, undefined, { timeout: 20_000 });
  const next = await sample('game2-initial'); assert(next.reused, 'restart unexpectedly replaced the scene');
  assert.deepEqual(next.chars.map(c => [c.pid, c.room, c.asset]), baseline.chars.map(c => [c.pid, c.room, c.asset]));
  for (const key of ['geometries', 'textures']) {
    assert(next.stats[key] <= baseline.stats[key], `restart grew ${key}: ${baseline.stats[key]} -> ${next.stats[key]}`);
  }
  await shot('09-reused-scene');
  step = '2D renderer and real gameplay';
  await p.getByRole('button', { name: '2D', exact: true }).click(); flat = true;
  await p.waitForFunction(() => !window.__b3scene && !document.querySelector('.b3-canvas'));
  await expect(p.locator('.ccard[data-pid]')).toHaveCount(3);
  await act(a, 'move', room); await act(c, 'move', room);
  await shot('10-2d-same-room');
  await act(c, 'attack', a); assert.equal(player(a).hp, 2);
  await act(a, 'attack', c); await act(b, 'attack', a); await act(b, 'attack', a);
  assert.equal(game().winner, b); assert.equal(last!.lobby.gameNo, 2);
  await p.locator('.win-modal').waitFor({ timeout: 25_000 }); await shot('11-2d-finale');
  assert.deepEqual(errors, []);
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: !process.env.HEADED,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: process.env.HEADED ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failure: string | undefined;
try {
  page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  await run(page); passed = true;
} catch (error) {
  failure = String(error); process.exitCode = 1;
  await page?.screenshot({ path: path.join(out, 'failure.png'), timeout: 4000 }).catch(() => {});
  console.error(step, error);
} finally {
  // Closing a tab alone leaves disconnected seats. Release only this run's room through the UI.
  if (last && page) {
    try {
      const leave = page.getByRole('button', { name: /^(退出房间|离开房间)$/ }).first();
      await leave.evaluate(el => (el as HTMLButtonElement).click(), undefined, { timeout: 3000 });
      await page.getByPlaceholder('输入昵称').waitFor({ timeout: 3000 });
    } catch (e) { errors.push(`room cleanup: ${String(e)}`); passed = false; process.exitCode = 1; }
  }
  await writeFile(path.join(out, 'match.json'), JSON.stringify({ passed, failure, step, base: BASE,
    chromium: browser.version(), viewport, code: last?.lobby.code, seed: last?.game?.seed,
    errors, rounds, logs: [...logs.values()], evidence }, null, 2));
  await browser.close();
  console.log(`${passed ? 'PASS' : 'FAIL'} ${out}`);
}
