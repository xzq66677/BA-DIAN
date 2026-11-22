/** MAP-103 精简模式性能采样：标准/精简双模式 × 多局对局的帧耗时、上下文与资源对账。
 * 前置：npm run build（本脚本走 server/dist + client/dist 编译产物）
 * 运行：node scripts/map-sample.mjs [tag]
 * 输出：${MAP_EVIDENCE_DIR ?? docs/screenshots-map103}/${tag}-samples.json + 双模式截图
 * 环境变量：MAP_SAMPLE_GAMES（默认 2）、MAP_SAMPLE_FRAMES_MS（默认 4000）、MAP_EVIDENCE_DIR
 * 采样页使用 deviceScaleFactor=2 记录高分屏环境；本机 SwiftShader 软渲染会把场景 pixelRatio 锁到 1，
 * 因此「精简模式降分辨率」这一项在本机不可测，必须在真实 GPU 设备上补验。
 * JSON 中 hardwareAcceptance='not-performed'：相对量纲可信、绝对帧率不代表真机。
 */
import { chromium } from 'playwright';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const repo = resolve(import.meta.dirname, '..');
const { httpServer, io, startServer } = await import(pathToFileURL(resolve(repo, 'server/dist/server/src/index.js')).href);

const tag = process.argv[2] ?? 'map103';
const out = process.env.MAP_EVIDENCE_DIR ?? 'docs/screenshots-map103';
const jsonOut = process.env.MAP_SAMPLE_JSON ?? resolve(out, `${tag}-samples.json`);
const FRAME_MS = Number(process.env.MAP_SAMPLE_FRAMES_MS ?? 4000);
const GAMES = Math.max(1, Number(process.env.MAP_SAMPLE_GAMES ?? 2));
const viewport = { width: 1440, height: 900 };
const HANDS = ['石头', '剪刀', '石头', '剪刀']; // 每轮必判出行动者（石头组胜剪刀组）

let lastRoom = null; // socket 权威状态桥
const game = () => lastRoom?.game ?? null;

async function wait(message, predicate, timeout = 20000) {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeout) throw new Error(`等待超时: ${message}`);
    await new Promise(r => setTimeout(r, 200));
  }
}

/** 页内帧耗时采样：收集 rAF 间隔，输出均值/分位/卡顿（>40ms 记为可感知卡顿） */
function frameProfile(page, ms) {
  return page.evaluate(duration => new Promise((resolve) => {
    const deltas = [];
    let last = performance.now();
    const start = last;
    const tick = (now) => {
      deltas.push(now - last);
      last = now;
      if (now - start >= duration) {
        const sorted = [...deltas].sort((a, b) => a - b);
        const pick = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
        const avg = deltas.reduce((s, d) => s + d, 0) / Math.max(1, deltas.length);
        resolve({
          sampleMs: Math.round(last - start),
          frames: deltas.length,
          avgFrameMs: +avg.toFixed(2),
          p50FrameMs: +pick(0.5).toFixed(2),
          p95FrameMs: +pick(0.95).toFixed(2),
          p99FrameMs: +pick(0.99).toFixed(2),
          maxFrameMs: +sorted[sorted.length - 1].toFixed(2),
          hitches: deltas.filter(d => d > 40).length,
          hitchRate: +(deltas.filter(d => d > 40).length / Math.max(1, deltas.length)).toFixed(4),
          fpsEquivalent: +(1000 / Math.max(0.001, avg)).toFixed(1),
        });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), ms);
}

/** 状态快照：渲染统计 + GPU 侧资源计数 + CPU 侧遍历计数 + 上下文计数 + 覆盖层功能清单 */
async function sampleState(page) {
  return page.evaluate(() => {
    const scene = window.__b3scene;
    const stats = scene?.debugStats() ?? null;
    const memory = scene ? { ...scene.renderer.info.memory } : null;
    const pixelRatio = scene ? scene.renderer.getPixelRatio() : null;
    let meshes = 0;
    const geos = new Set();
    const mats = new Set();
    if (scene) scene.scene.traverse((node) => {
      if (node.isMesh) {
        meshes++;
        if (node.geometry) geos.add(node.geometry);
        if (Array.isArray(node.material)) node.material.forEach(m => mats.add(m));
        else if (node.material) mats.add(node.material);
      }
    });
    return {
      stats,
      memory,
      pixelRatio,
      canvasBacking: scene ? [scene.renderer.domElement.width, scene.renderer.domElement.height] : null,
      scene: { meshes, geometries: geos.size, materials: mats.size },
      contexts: { ...window.glCounts },
      overlay: {
        roomLabels: document.querySelectorAll('.b3-roomlabel').length,
        pendingRooms: document.querySelectorAll('.b3-roomlabel.is-pending').length,
        effectRooms: document.querySelectorAll('.b3-roomlabel[data-effect]').length,
        plates: document.querySelectorAll('.b3-plate').length,
      },
      canvas3d: document.querySelectorAll('.b3-canvas').length,
      lowEffects: document.querySelector('.b3-host')?.dataset.lowEffects === 'true',
    };
  });
}

/** 精简模式开关：按钮文案显示的是「当前状态」，点击才切换；因此先读状态、只在不一致时点，保证幂等。 */
async function setLowEffects(page, on) {
  // 默认没有 data-low-effects 属性，等价于关闭；只有字面 'true' 才表示开启。
  const current = await page.evaluate(() =>
    document.querySelector('.b3-host')?.dataset.lowEffects === 'true');
  if (current !== on) {
    await page.locator('.bt3d-settings summary').click();
    // 当前关 → 按钮写「关」，当前开 → 按钮写「开」
    await page.getByRole('button', { name: on ? '精简特效 关' : '精简特效 开' }).click();
    await page.locator('.bt3d-settings summary').click();
  }
  await wait(`low-effects=${on}`, () => page.evaluate(expected =>
    (document.querySelector('.b3-host')?.dataset.lowEffects === 'true') === expected, on));
}

async function hardwareProfile(page) {
  return page.evaluate(async () => {
    const gl = document.querySelector('canvas')?.getContext('webgl2')
      ?? document.createElement('canvas').getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGB: navigator.deviceMemory ?? null,
      screen: `${screen.width}x${screen.height}`,
      viewport: `${innerWidth}x${innerHeight}`,
      devicePixelRatio: devicePixelRatio,
      webglRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : null),
      webglVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : (gl ? gl.getParameter(gl.VENDOR) : null),
      webgl2: Boolean(gl),
      language: navigator.language,
    };
  });
}

/** 回合驱动：出拳（HANDS 保证分出胜负）/ 行动（同房攻击、否则移动；首回合伊万埋弹）。每个分支自带结算等待。 */
async function playRound(page) {
  const g = game();
  if (g.phase === 'rps1' || g.phase === 'rps2') {
    // rps2（行动排序轮）只有 orderGroup 成员参与重掷，交替出拳打破平局
    const participants = g.phase === 'rps2'
      ? (g.orderGroup ?? []).map(id => g.players.find(p => p.id === id)).filter(p => p && p.alive)
      : g.players.filter(p => p.alive);
    for (const [i, seat] of participants.entries()) {
      await page.getByRole('button', { name: `我是 ${seat.name}，开始出拳` }).dispatchEvent('click');
      await page.locator('.throw-card').filter({ hasText: HANDS[i % HANDS.length] }).click();
    }
    await wait('judge advanced', () => {
      const cur = game();
      return cur.roundNo > g.roundNo || cur.phase !== g.phase || cur.currentActor !== g.currentActor;
    });
    return 'rps';
  }
  if (g.currentActor) {
    const self = g.players.find(p => p.id === g.currentActor);
    const seatIndex = g.players.findIndex(p => p.id === g.currentActor);
    const foe = g.players.find(p => p.alive && p.id !== self.id && p.room === self.room);
    if (seatIndex === 0 && g.roundNo === 1 && !g.deferred?.some(d => d.kind === 'ivan')) {
      // 首回合伊万埋弹：为危险预警功能检查提供确定性现场（explodeRound = roundNo + 1）
      const targetRoom = g.players.find(p => p.alive && p.id !== self.id).room;
      await page.locator('.scard').filter({ has: page.getByText('投掷大伊万', { exact: true }) }).click();
      await page.locator(`.b3-roomlabel.is-pickable[data-room="${targetRoom}"]`).press('Enter');
      await page.getByRole('button', { name: '确认发动' }).click();
    } else if (foe) {
      await page.locator('.scard').filter({ has: page.getByText('攻击', { exact: true }) }).click();
      await page.locator(`.b3-plate.is-targetable[data-pid="${foe.id}"]`).dispatchEvent('click');
      await page.getByRole('button', { name: '确认发动' }).click();
    } else {
      const other = g.roomIds.find(r => r !== self.room);
      await page.locator('.scard').filter({ has: page.getByText('移动', { exact: true }) }).click();
      await page.locator(`.b3-roomlabel.is-pickable[data-room="${other}"]`).press('Enter');
      await page.getByRole('button', { name: '确认发动' }).click();
    }
    await wait('action settled', () => {
      const cur = game();
      return cur.phase === 'over' || cur.roundNo > g.roundNo || cur.currentActor !== g.currentActor;
    });
    return 'act';
  }
  await page.waitForTimeout(300);
  return 'idle';
}

/** 驱动对局到指定回合（或终局），返回实际推进次数 */
async function playUntil(page, stopRound) {
  for (let input = 0; input < 80; input++) {
    const g = game();
    if (!g || g.phase === 'over') return { inputs: input, over: true };
    if (stopRound && g.roundNo >= stopRound && g.phase !== 'over') return { inputs: input, over: false };
    await playRound(page);
  }
  return { inputs: 80, over: false };
}

try {
  await mkdir(out, { recursive: true });
  startServer(0);
  await once(httpServer, 'listening');
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const errors = [];
  const report = {
    tag, configuredGames: GAMES, framesMs: FRAME_MS, hardware: null,
    environment: {
      renderer: 'SwiftShader (software rendering) on the dev workstation',
      hardwareAcceptance: 'not-performed',
      note: '本机为 SwiftShader 软渲染 + deviceScaleFactor=2：场景因软渲染把 pixelRatio 固定为 1，精简模式的降分辨率效果无法在此验证；同帧窗内的帧耗时相对差值、功能保留与资源趋势可信，绝对帧率不代表真机 GPU，真实目标设备未测，硬件验收未完成。',
    },
    games: [], contexts: null, resources: null, analysis: null, functional: null,
  };
  let page;
  try {
    page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
    page.on('pageerror', e => errors.push(String(e)));
    await page.addInitScript(() => {
      window.glCounts = { created: 0, lost: 0, active: 0, peak: 0 };
      const get = HTMLCanvasElement.prototype.getContext;
      const observed = new WeakSet();
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        const context = get.call(this, kind, ...args);
        if (kind.startsWith('webgl') && context && !observed.has(context)) {
          observed.add(context);
          window.glCounts.created++;
          window.glCounts.active++;
          window.glCounts.peak = Math.max(window.glCounts.peak, window.glCounts.active);
          this.addEventListener('webglcontextlost', () => { window.glCounts.lost++; window.glCounts.active--; });
          this.addEventListener('webglcontextrestored', () => { window.glCounts.active++; });
        }
        return context;
      };
    });
    page.on('websocket', wire => wire.on('framereceived', ({ payload }) => {
      if (typeof payload !== 'string' || !payload.startsWith('42["room:update",')) return;
      const [, update] = JSON.parse(payload.slice(2));
      lastRoom = update;
    }));

    await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    report.hardware = await hardwareProfile(page);

    await page.getByPlaceholder('输入昵称').fill('性能采样员');
    await page.getByLabel('选择角色卡').selectOption('ivan-girl');
    await page.getByLabel(/单设备多人/).selectOption('4');
    await page.getByRole('button', { name: /仅创建/ }).click();
    const roster = ['ivan-girl', 'wuliuqi', 'default', 'default'];
    for (let index = 1; index < roster.length; index++) {
      await page.locator('.seat-slot').filter({ hasText: `性能采样员${index + 1}` }).locator('select').selectOption(roster[index]);
    }
    await wait('roster ready', () => lastRoom?.lobby?.seats.map(s => s.charId).join() === roster.join());
    await page.getByRole('button', { name: /开始对局/ }).click();
    await wait('match started', () => game()?.phase === 'rps1');
    await page.waitForFunction(() => (window.__b3scene?.debugStats().calls ?? 0) > 0, undefined, { timeout: 60000 });

    for (let gameNo = 1; gameNo <= GAMES; gameNo++) {
      if (gameNo > 1) {
        const finish = page.getByRole('button', { name: /直接结算/ });
        if (await finish.isVisible().catch(() => false)) await finish.click().catch(() => {});
        await wait('win modal', () => page.evaluate(() => Boolean(document.querySelector('.win-modal'))), 30000);
        // win-overlay 会拦截弹层外的点击：先「查看战场」收起遮罩，再点场上的「重新开始」（与 map-match 一致）
        await page.getByRole('button', { name: '查看战场' }).click().catch(() => {});
        await wait('win overlay dismissed', async () =>
          (await page.locator('.win-overlay').count()) === 0);
        await page.getByRole('button', { name: '重新开始' }).click();
        await wait(`game ${gameNo} started`, () => lastRoom?.lobby?.gameNo === gameNo
          && game()?.roundNo === 1 && game()?.phase === 'rps1');
        await page.waitForFunction(() => window.__b3scene?.debugCharacters().every(p => p.alive && p.pose === 'idle'), undefined, { timeout: 60000 });
        await page.waitForFunction(() => (window.__b3scene?.debugStats().calls ?? 0) > 0);
      }
      const entry = { game: gameNo, modes: {} };

      // 第一回合：伊万埋弹（提供危险预警现场），推进到第二回合（弹已激活、战斗节拍进行中）
      await playUntil(page, 2);
      // 展示层在投掷动画节拍播放后才显示待爆标记：等它出现再进入采样窗口
      await wait(`pending visible in game ${gameNo}`, () => page.evaluate(() =>
        document.querySelectorAll('.b3-roomlabel.is-pending').length > 0), 25000);
      const pendingNow = (await sampleState(page)).overlay.pendingRooms;
      assert.ok(pendingNow > 0, `第 ${gameNo} 局采样窗口应存在待爆危险房间（实际 ${pendingNow}）`);

      // ── 标准模式采样（战斗进行中：弹房预警 + 角色待战）──
      await setLowEffects(page, false);
      await page.waitForTimeout(400);
      const standardFrames = await frameProfile(page, FRAME_MS);
      const standardState = await sampleState(page);
      await shot(page, `${out}/${tag}-g${gameNo}-standard.png`);
      entry.modes.standard = { frames: standardFrames, state: standardState };

      // ── 精简模式采样（同一对局窗口：预警仍在、节拍仍进行）──
      await setLowEffects(page, true);
      await page.waitForTimeout(400);
      const lowFrames = await frameProfile(page, FRAME_MS);
      const lowState = await sampleState(page);
      await shot(page, `${out}/${tag}-g${gameNo}-low.png`);
      entry.modes.low = {
        frames: lowFrames,
        state: lowState,
        functional: {
          charactersVisible: (await page.evaluate(() =>
            window.__b3scene?.debugCharacters().every(p => p.visible))) ?? false,
          roomLabels: lowState.overlay.roomLabels,
          plates: lowState.overlay.plates,
          pendingRoomsVisible: lowState.overlay.pendingRooms > 0,
          pixelRatio: { standard: standardState.pixelRatio, low: lowState.pixelRatio },
          canvasBacking: { standard: standardState.canvasBacking, low: lowState.canvasBacking },
        },
      };
      entry.pendingRoomsDuringSampling = pendingNow;
      report.games.push(entry);

      // 打到终局
      entry.end = { ...(await playUntil(page, 0)), phase: game()?.phase ?? null };
      const finish = page.getByRole('button', { name: /直接结算/ });
      if (await finish.isVisible().catch(() => false)) await finish.click().catch(() => {});
    }

    // ── 上下文数量：多次 2D/3D 切换后（先收掉终局弹层避免遮挡）──
    if (await page.evaluate(() => Boolean(document.querySelector('.win-modal')))) {
      await page.getByRole('button', { name: '查看战场' }).click().catch(() => {});
      await page.waitForTimeout(500);
    }
    const beforeToggles = await sampleState(page);
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: '2D', exact: true }).click();
      await wait('canvas removed', async () => (await page.locator('.b3-canvas').count()) === 0);
      await page.getByRole('button', { name: '3D', exact: true }).click();
      await wait('3d rebuilt', () => page.evaluate(() => window.__b3scene?.debugStats().rooms === 4), 60000);
    }
    const afterToggles = await sampleState(page);
    report.contexts = {
      beforeToggles: beforeToggles.contexts,
      afterToggles: afterToggles.contexts,
      note: `2D/3D 各切换 2 次后：active 应保持 ${beforeToggles.contexts.active}（1 个探测用 + 1 个当前 3D 场景），created/lost 成对增长即为旧上下文销毁后重建、没有叠加泄漏。`,
    };

    // ── 资源对账：跨局增长（泄漏趋势）──
    const [g1, g2] = report.games;
    const base = g1?.modes.standard.state.scene ?? null;
    const mid = g2?.modes.standard.state.scene ?? null;
    const finalState = await sampleState(page);
    const verdict = base && mid
      ? (Math.abs(mid.geometries - base.geometries) <= 4 && Math.abs(mid.materials - base.materials) <= 4
        && Math.abs((finalState.scene.geometries ?? 0) - (base.geometries ?? 0)) <= 4
        ? 'no-growth' : 'growth-detected')
      : 'insufficient-data';
    report.resources = {
      game1Start: base, game2Start: mid, final: finalState.scene,
      gpuMemory: {
        game1Start: g1?.modes.standard.state.memory ?? null,
        game2DuringSampling: g2?.modes.low.state.memory ?? null,
        after2DToggle: finalState.memory,
      },
      note: '资源对账取 3D 场景内的计数；切到 2D 后 GPU 计数归零属正常销毁，不代表泄漏。',
      verdict,
    };

    // ── 分析：delta = low - standard（负值=精简更快）──
    const pair = g => {
      const standard = g.modes.standard;
      const low = g.modes.low;
      return {
        avgFrameMs: +(low.frames.avgFrameMs - standard.frames.avgFrameMs).toFixed(2),
        p95FrameMs: +(low.frames.p95FrameMs - standard.frames.p95FrameMs).toFixed(2),
        hitches: low.frames.hitches - standard.frames.hitches,
        drawCalls: (low.state.stats?.calls ?? 0) - (standard.state.stats?.calls ?? 0),
        triangles: (low.state.stats?.triangles ?? 0) - (standard.state.stats?.triangles ?? 0),
        pixelRatio: `${standard.state.pixelRatio} -> ${low.state.pixelRatio}`,
      };
    };
    report.analysis = {
      perGame: report.games.map(g => ({ game: g.game, delta: pair(g) })),
      note: 'delta = low - standard；负值=精简更快/开销更低。本机 SwiftShader 把 pixelRatio 锁为 1，降分辨率项未生效，帧耗时差异来自动效/粒子/CSS 动画跳过；真机 GPU 差异需重新采样。',
    };
    report.functional = {
      note: '精简模式功能保留检查（逐局）',
      perGame: report.games.map(g => ({
        game: g.game,
        ...g.modes.low.functional,
        dangerPendingDuringSampling: g.pendingRoomsDuringSampling > 0,
      })),
    };

    await writeFile(jsonOut, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ok: true, json: jsonOut, hardware: report.hardware?.webglRenderer,
      games: report.games.length, resourcesVerdict: report.resources.verdict,
      analysis: report.analysis.perGame }, null, 2));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await io.close();
  }
} catch (error) {
  console.error('MAP-103 采样失败：', error);
  process.exitCode = 1;
}

/** CDP 直接抓合成帧（SwiftShader 饱和期 Playwright 截图可能饿死，见 MAP-105） */
async function shot(page, path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let session = null;
    try {
      session = await page.context().newCDPSession(page);
      const { data } = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await writeFile(path, Buffer.from(data, 'base64'));
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(1500);
    } finally {
      await session?.detach().catch(() => {});
    }
  }
}
