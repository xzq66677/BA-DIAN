/** DJK-46 大贱客「出招」画质样片驱动：固定房间/站位/默认镜头/1440x900。
 * 前置：npm run build（本脚本走 server/dist + client/dist 编译产物）
 * 运行：node scripts/djk-match.mjs before|after
 * 输出：docs/screenshots-djk/<tag>/（姿态截图、全 UI 截图、录像、djk-<tag>.json）
 * 流程：热座大厅（host=陪练，座位2=大贱客，座位3=受骂者）→ 跨房辱骂① → 受骂者移入同房
 *       → 同房辱骂② → 辱骂③致死 → 待机复归/连续触发不叠偏检查。
 * 每次辱骂固定 RPS（石头胜剪刀）让大贱客行动；三次分别抓 蓄势/戳指峰值/收势 姿态窗口。
 */
import { chromium } from 'playwright';
import { once } from 'node:events';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const repo = resolve(import.meta.dirname, '..');
const { httpServer, io, startServer } = await import(pathToFileURL(resolve(repo, 'server/dist/server/src/index.js')).href);

const tag = process.argv[2] ?? 'before';
assert(['before', 'after'].includes(tag), 'usage: node scripts/djk-match.mjs before|after');
const out = resolve(repo, `docs/screenshots-djk/${tag}`);
const viewport = { width: 1440, height: 900 };
const NICK = '样片员';

let lastRoom = null;
const game = () => lastRoom?.game ?? null;
const logs = new Map();

async function wait(message, predicate, timeout = 30000) {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeout) throw new Error(`等待超时: ${message}`);
    await new Promise(r => setTimeout(r, 150));
  }
}

/** 页内帧耗时采样（同 map-sample 口径）：rAF 间隔分位数 + 卡顿计数 */
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
          sampleMs: Math.round(last - start), frames: deltas.length, avgFrameMs: +avg.toFixed(2),
          p50FrameMs: +pick(0.5).toFixed(2), p95FrameMs: +pick(0.95).toFixed(2),
          p99FrameMs: +pick(0.99).toFixed(2), maxFrameMs: +sorted[sorted.length - 1].toFixed(2),
          hitches: deltas.filter(d => d > 40).length,
          fpsEquivalent: +(1000 / Math.max(0.001, avg)).toFixed(1),
        });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), ms);
}

/** 姿态抓拍（v50b 口径）：RAF 轮询 debugCharacters，命中 pose 且 fraction∈[lo,hi] 时
 * 拷贝一帧非空 canvas，并投影可见网格得到角色屏幕包围盒（保留完整画幅与实际大小）。 */
async function capturePose(page, pid, pose, file, lo = 0.35, hi = 0.8) {
  const handle = await page.waitForFunction(({ pid, pose, lo, hi }) => {
    const s = window.__b3scene;
    const c = s?.debugCharacters()?.find(c => c.pid === pid && c.pose === pose);
    const canvas = document.querySelector('.b3-canvas');
    if (!s || !canvas || !c?.visible) return false;
    const fraction = c.dur > 0 && Number.isFinite(c.dur) ? c.t / c.dur : (c.t >= 1.5 ? 1 : 0);
    if (pose === 'idle' ? (s.camMoving || c.t < 1.2) : !(fraction >= lo && fraction <= hi)) return false;
    const box = canvas.getBoundingClientRect();
    if (!(c.x > 0 && c.x < box.width && c.y > 0 && c.y < box.height)) return false;
    const copy = document.createElement('canvas');
    copy.width = canvas.width; copy.height = canvas.height;
    const ctx = copy.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0);
    const thumb = document.createElement('canvas'); thumb.width = 32; thumb.height = 24;
    const tiny = thumb.getContext('2d'); tiny.drawImage(copy, 0, 0, 32, 24);
    const colors = new Set(new Uint32Array(tiny.getImageData(0, 0, 32, 24).data.buffer)).size;
    if (colors < 16) return false; // 绘制缓冲已被丢弃，等下一帧
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, vertices = 0;
    s.entities.get(pid).rig.root.traverseVisible(o => {
      const mesh = o;
      const pos = mesh.geometry?.attributes?.position;
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
    return { fraction: pose === 'idle' ? null : +fraction.toFixed(3), chars: s.debugCharacters(),
      stats: s.debugStats(), meshCss: { left: +left.toFixed(1), top: +top.toFixed(1), right: +right.toFixed(1), bottom: +bottom.toFixed(1) },
      canvasCss: { width: box.width, height: box.height }, at: performance.now(), png: copy.toDataURL('image/png') };
  }, { pid, pose, lo, hi }, { polling: 'raf', timeout: 30000 });
  try {
    const frame = await handle.jsonValue();
    assert(frame, `${file}: 未捕获到 ${pose} 姿态帧`);
    const { png, ...info } = frame;
    await writeFile(resolve(out, `${file}.png`), Buffer.from(png.split(',')[1], 'base64'));
    return info;
  } finally { await handle.dispose(); }
}

/** 全页面合成截图（含 DOM UI 覆盖层）；SwiftShader 饱和期 Playwright 截图会饿死，用裸 CDP */
async function shot(page, name) {
  const path = resolve(out, `${name}.png`);
  for (let attempt = 0; attempt < 3; attempt++) {
    let session = null;
    try {
      session = await page.context().newCDPSession(page);
      const { data } = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await writeFile(path, Buffer.from(data, 'base64'));
      return path;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(1500);
    } finally { await session?.detach().catch(() => {}); }
  }
}

/** 关节位姿指纹：遍历 rig.root 下所有 Group 的 rotation/position，用于「连续触发不叠偏」对比 */
function poseFingerprint(page, pid) {
  // 只取确定性关节的旋转、1 位小数：idle 的呼吸/摆动是时变的，必须排除——
  // kit.makePoses.idle 会动 pelvis/body/head 和双肘（elbow.x ±.05 摆动，1 位小数即翻转），
  // spin 磁环自转也是时变的；真正在 idle 下确定的只有上臂/大腿/小腿 6 关节。
  return page.evaluate(pid => {
    const e = window.__b3scene.entities.get(pid);
    const want = new Set(['armL', 'armR', 'thighL', 'thighR', 'kneeL', 'kneeR']);
    const out = [];
    e.rig.root.traverse(o => {
      if ((o.isGroup || o.isMesh) && want.has(o.name)) {
        out.push([o.name, +o.rotation.x.toFixed(1), +o.rotation.y.toFixed(1), +o.rotation.z.toFixed(1)]);
      }
    });
    return out;
  }, pid);
}

/** 反馈现场：页面浮字文本 + 活动特效数（结构化 evidence，改前应为空/基线） */
function feedbackSnapshot(page) {
  return page.evaluate(() => ({
    floats: [...document.querySelectorAll('.b3-float')].map(el => el.textContent.trim()).filter(Boolean),
    fx: window.__b3scene?.debugStats().fx ?? -1,
    tweens: window.__b3scene?.debugStats().tweens ?? -1,
  }));
}

/**
 * 反馈追踪（地面真值）：从 Node 侧每 250ms 向页面发一次轻量 evaluate，持续 ms 毫秒。
 * 不在页面内跑长轮询—— insults 致死局的 CDP 截图 + 死亡特效会阻塞页面主线程数秒，
 * 页面内 setTimeout 轮询会被饿死；Node 侧定时器不受影响，evaluate 最多迟到不会丢失。
 * 返回首次见到「被辱骂」浮字的时刻与全程采样。
 */
async function feedbackTrace(page, ms = 9000) {
  const t0 = Date.now();
  const samples = [];
  let firstFloatAt = -1, firstFloats = null;
  while (Date.now() - t0 < ms) {
    const s = await page.evaluate(() => {
      const floats = [...document.querySelectorAll('.b3-float .b3-ticker')].map(e => e.textContent.trim());
      const scene = window.__b3scene;
      let stats = null, chars = null;
      if (scene) {
        try { stats = scene.debugStats(); } catch { }
        try { chars = scene.debugCharacters().map(c => `${c.pid.slice(0, 2)}:${c.pose}${c.alive ? '' : '/dead'}`); } catch { }
      }
      return { floats, fx: stats ? stats.fx : -2, tweens: stats ? stats.tweens : -2, chars };
    }).catch(() => null);
    if (s) {
      const rec = { t: Date.now() - t0, ...s };
      samples.push(rec);
      if (s.floats.length && firstFloatAt < 0) { firstFloatAt = rec.t; firstFloats = s.floats; }
      if (firstFloatAt >= 0 && rec.t - firstFloatAt > 500) break; // 抓到后再采 0.5s 即停
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return { firstFloatAt, firstFloats, samples };
}

// ── 主流程 ──────────────────────────────────────────────
const evidence = { tag, viewport, errors: [], steps: [] };
let step = 'launch';
let page, context, passed = false;
try {
  await mkdir(out, { recursive: true });
  startServer(0);
  await once(httpServer, 'listening');
  const port = httpServer.address().port;
  evidence.server = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'no-preference',
    recordVideo: { dir: out, size: viewport } });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', e => evidence.errors.push(String(e)));
  page.on('websocket', wire => wire.on('framereceived', ({ payload }) => {
    if (typeof payload !== 'string' || !payload.startsWith('42["room:update",')) return;
    const [, update] = JSON.parse(payload.slice(2));
    lastRoom = update;
    for (const log of update.newLogs ?? []) logs.set(log.seq, log);
  }));

  // 冷启动：打开对局页 → 首个可交互战场画面（3 名角色可见 + 渲染器出图 + 相机就位）
  step = 'cold-start + lobby';
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.getByPlaceholder('输入昵称').fill(NICK);
  await page.getByLabel('选择角色卡').selectOption('default'); // 座位1=host 陪练（从不被指）
  await page.getByLabel(/单设备多人/).selectOption('3');
  await page.getByRole('button', { name: /仅创建/ }).click();
  await page.locator('.seat-slot').filter({ hasText: `${NICK}2` }).locator('select').selectOption('dajianke');
  await page.locator('.seat-slot').filter({ hasText: `${NICK}3` }).locator('select').selectOption('default');
  await wait('roster ready', () => lastRoom?.lobby?.seats?.map(s => s.charId).join() === 'default,dajianke,default');
  await page.getByRole('button', { name: /开始对局/ }).click();
  await wait('match started', () => game()?.phase === 'rps1');
  const coldPageMs = await page.waitForFunction(() => {
    const s = window.__b3scene;
    if (!s) return false;
    const chars = s.debugCharacters();
    return chars.length === 3 && chars.every(c => c.visible) && s.debugStats().calls > 0 && !s.camMoving
      ? performance.now() : false;
  }, undefined, { timeout: 60000 }).then(h => h.jsonValue());
  evidence.coldStart = { pageMs: Math.round(await coldPageMs), wallMs: Date.now() - t0,
    definition: '打开对局页 → 3 名角色可见 + 渲染器出图 + 自动相机就位' };
  evidence.players = game().players.map(p => ({ id: p.id, name: p.name, charId: p.charId, originRoom: p.originRoom }));
  const [, djk, victim] = game().players.map(p => p.id);
  const djkRoom = game().players.find(p => p.id === djk).originRoom;
  const victimRoom = game().players.find(p => p.id === victim).originRoom;
  assert.notEqual(djkRoom, victimRoom, '初始房间应不同（跨房辱骂现场）');
  evidence.seats = { djk, victim, djkRoom, victimRoom };
  await wait('scene idle', () => page.evaluate(() => {
    const s = window.__b3scene;
    return s.debugStats().walks === 0 && s.debugCharacters().every(c => c.pose === 'idle' && c.visible);
  }));
  evidence.idleBefore = { chars: await page.evaluate(() => window.__b3scene.debugCharacters()), fingerprint: await poseFingerprint(page, djk) };
  await capturePose(page, djk, 'idle', '01-idle');
  await shot(page, '01-full-ui');
  evidence.steps.push('01 idle 基线');

  /** 确认发动：操作面板偶发逐帧重排会让 actionability 点击挂在 scrollIntoView，改用原生 click 兜底 */
  async function confirmAction() {
    const btn = page.getByRole('button', { name: '确认发动' }).first();
    await btn.waitFor({ state: 'visible' });
    await btn.evaluate(el => el.click());
  }

  /** 通用原生点击兜底：出拳/选卡按钮同样会被逐帧重排卡在 actionability 检查 */
  async function nclick(locator) {
    await locator.waitFor({ state: 'visible' });
    await locator.evaluate(el => el.click());
  }

  /** 一轮辱骂：RPS 固定石头胜剪刀 → 攻击卡 → 目标名牌 → 确认发动；可选抓姿态窗口与帧采样 */
  async function insult({ capture, label }) {
    const g0 = game(); const roundNo = g0.roundNo;
    step = `round ${roundNo}: dajianke 辱骂`;
    for (const seat of g0.players.filter(p => p.alive)) {
      await nclick(page.getByRole('button', { name: `我是 ${seat.name}，开始出拳` }));
      await nclick(page.locator('.throw-card').filter({ hasText: seat.id === djk ? '石头' : '剪刀' }));
    }
    await wait('actor = dajianke', () => game().phase === 'act' && game().currentActor === djk);
    // 先选攻击卡（选中后 targetHint 才会把目标名牌标记为 is-targetable），再等名牌出现
    await nclick(page.locator('button.scard').filter({ has: page.getByText('攻击', { exact: true }) }));
    // 名牌/标签每帧跟随相机：等待可见后用原生 click（v50b 口径），避免可点击性重试落空
    const plate = page.locator(`.b3-plate.is-targetable[data-pid="${victim}"]`);
    await plate.waitFor({ state: 'visible' });
    evidence.targetableProof = evidence.targetableProof ?? [];
    evidence.targetableProof.push({ round: roundNo, victimRoom: game().players.find(p => p.id === victim).room,
      djkRoom: game().players.find(p => p.id === djk).room, crossRoom: game().players.find(p => p.id === victim).room !== game().players.find(p => p.id === djk).room });
    const cursor = Math.max(0, ...logs.keys());
    const profiles = capture ? [capturePose(page, djk, 'attack', capture.file, capture.lo, capture.hi)] : [];
    await plate.evaluate(el => el.click());
    const framesP = frameProfile(page, 2200);
    await confirmAction();
    // 反馈追踪：confirmAction 后页面内轮询 9s，抓「被辱骂 n/3」浮字首次出现时刻与场景状态轨迹
    const feedbackPeakP = feedbackTrace(page, 9000).catch((err) => ({ firstFloatAt: -1, firstFloats: null, samples: [], absent: true, error: String(err?.message ?? err) }));
    const [frames, ...cap] = await Promise.all([framesP, ...profiles]);
    // 姿态窗口捕获完成后才做 CDP 截图，避免截图停顿挤掉姿态帧窗口
    const feedbackPeak = await feedbackPeakP;
    if (capture && feedbackPeak.firstFloatAt >= 0) await shot(page, `06-${capture.file}-fb`);
    await wait('settle', () => game().roundNo > roundNo || game().phase === 'over');
    const fresh = [...logs.values()].filter(l => l.seq > cursor).map(l => ({ seq: l.seq, type: l.type, text: l.text, data: l.data ?? null }));
    const feedback = feedbackSnapshot(page);
    await wait('dajianke 回待机', () => page.evaluate(pid =>
      window.__b3scene.debugCharacters().find(c => c.pid === pid)?.pose === 'idle', djk));
    const idleChar = await page.evaluate(pid => window.__b3scene.debugCharacters().find(c => c.pid === pid), djk);
    const fingerprint = await poseFingerprint(page, djk);
    return { round: roundNo, frames, logs: fresh, feedback, feedbackPeak, idleAfter: { x: idleChar.x, y: idleChar.y, z: idleChar.z, pose: idleChar.pose }, fingerprint, capture: cap[0] ?? null };
  }

  // 辱骂①：跨房（初始异房）——抓「戳指峰值」
  step = 'insult 1 (cross-room, jab peak)';
  const r1 = await insult({ capture: { file: '03-jab-peak', lo: 0.45, hi: 0.85 } });
  evidence.insult1 = r1; evidence.steps.push('03 跨房辱骂·戳指峰值');
  await shot(page, '03-full-ui-peak');

  // 受骂者移入大贱客房间（受骂者赢拳后移动）——构造同房现场
  step = 'victim moves into dajianke room';
  {
    const g0 = game(); const roundNo = g0.roundNo;
    for (const seat of g0.players.filter(p => p.alive)) {
      await nclick(page.getByRole('button', { name: `我是 ${seat.name}，开始出拳` }));
      await nclick(page.locator('.throw-card').filter({ hasText: seat.id === victim ? '石头' : '剪刀' }));
    }
    await wait('actor = victim', () => game().phase === 'act' && game().currentActor === victim);
    await nclick(page.locator('button.scard').filter({ has: page.getByText('移动', { exact: true }) }));
    const label = page.locator(`.b3-roomlabel.is-pickable[data-room="${djkRoom}"]`);
    await label.waitFor({ state: 'visible' });
    await label.evaluate(el => el.click());
    await confirmAction();
    await wait('move settle', () => game().roundNo > roundNo || game().phase === 'over');
    assert.equal(game().players.find(p => p.id === victim).room, djkRoom, '受骂者应已移入大贱客房间');
  }
  evidence.steps.push('02 受骂者移入同房');

  // 辱骂②：同房——抓「蓄势」
  step = 'insult 2 (same room, windup)';
  const r2 = await insult({ capture: { file: '02-windup', lo: 0.12, hi: 0.45 } });
  evidence.insult2 = r2; evidence.steps.push('02 同房辱骂·蓄势');

  // 辱骂③：致死——抓「收势」，并验证真实结算死亡
  step = 'insult 3 (kill, recover)';
  const r3 = await insult({ capture: { file: '04-recover', lo: 0.68, hi: 0.98 } });
  evidence.insult3 = r3; evidence.steps.push('04 辱骂③·收势');
  assert.equal(game().players.find(p => p.id === victim).alive, false, '第三次辱骂应按真实结算淘汰受骂者');
  assert.ok(r3.logs.some(l => l.type === 'eliminate' && l.data?.pid === victim), '应有 eliminate 权威日志');
  await shot(page, '05-after-kill-full-ui');

  // 连续触发不叠偏：三次辱骂后的待机指纹应与初始一致
  evidence.poseDrift = {
    initial: evidence.idleBefore.fingerprint,
    after1: r1.fingerprint, after2: r2.fingerprint, after3: r3.fingerprint,
    identical: JSON.stringify(evidence.idleBefore.fingerprint) === JSON.stringify(r3.fingerprint),
  };
  assert.ok(evidence.poseDrift.identical, '连续三次辱骂后待机位姿应完全复位（不越叠越偏）');

  evidence.hardware = await page.evaluate(async () => {
    const gl = document.querySelector('canvas')?.getContext('webgl2') ?? document.createElement('canvas').getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return { userAgent: navigator.userAgent, platform: navigator.platform,
      webglRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null,
      webglVendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : null,
      devicePixelRatio, screen: `${screen.width}x${screen.height}` };
  });
  passed = true;
} catch (error) {
  evidence.failure = String(error); evidence.step = step;
  process.exitCode = 1;
  console.error(step, error);
  if (page) await shot(page, 'failure').catch(() => {});
} finally {
  if (page && lastRoom) {
    try {
      const leave = page.getByRole('button', { name: /^(退出房间|离开房间)$/ }).first();
      await leave.evaluate(el => el.click(), undefined, { timeout: 3000 });
    } catch { /* 尽力释放房间 */ }
  }
  const videoPath = await page?.video()?.path().catch(() => null);
  await context?.close();
  if (videoPath) await rename(videoPath, resolve(out, `djk-${tag}.webm`)).catch(() => {});
  evidence.passed = passed;
  evidence.logs = [...logs.values()];
  await writeFile(resolve(out, `djk-${tag}.json`), JSON.stringify(evidence, null, 2));
  await io.close();
  console.log(`${passed ? 'PASS' : 'FAIL'} ${out}`);
  process.exit(process.exitCode ?? 0); // httpServer 仍监听会挂住事件循环，产出落盘后强制退出
}
