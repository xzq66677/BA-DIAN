import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { Box3, Group, Scene, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createAttachment } from './attachment.mjs';
import { createGhostVisual } from './ghost-visual.mjs';

const evidence = new URL('../evidence/', import.meta.url);
await mkdir(evidence, { recursive: true });
const bytes = await readFile(new URL('../model/ghost.glb', import.meta.url));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const gltf = await new GLTFLoader().parseAsync(arrayBuffer, '');
const clipNames = ['idle', 'attach', 'attached_idle', 'drain', 'flinch', 'dead'];
assert.deepEqual(gltf.animations.map((clip) => clip.name), clipNames);
const root = gltf.scene.getObjectByName('GhostRoot');
assert.equal(root.userData.forward, '+Z');
assert.equal(root.userData.rootMotion, false);
assert.ok(gltf.animations.every((clip) => clip.tracks.every((track) => !track.name.startsWith('GhostRoot.'))));
assert.equal(gltf.parser.json.images, undefined);
const bounds = new Box3().setFromObject(root.getObjectByName('BodyPivot'), true);
assert.ok(Math.abs(bounds.min.y) < 1e-5);
assert.ok(bounds.max.y > 1.55 && bounds.max.y < 2.0);
let triangles = 0;
let meshCount = 0;
gltf.scene.traverse((node) => {
  if (!node.isMesh) return;
  meshCount++;
  triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
});
assert.ok(bytes.length < 4_194_304 && triangles < 65_000);

const scene = new Scene();
const branch = new Group();
branch.position.set(2, 0.4, -3);
branch.rotation.y = -0.31;
const host = new Group();
host.position.set(0, 0.6, 5);
host.rotation.y = 1.37;
host.scale.setScalar(1.2);
scene.add(branch, host);
const ghost = createGhostVisual(gltf);
const other = createGhostVisual(gltf);
branch.add(ghost.root, other.root);
const mask = (visual) => visual.root.getObjectByName('PorcelainMask');
const baseOpacity = mask(ghost).material.opacity;
const attachment = createAttachment(ghost);
const anchor = new Group();
anchor.position.set(0.32, 0.23, 0);
host.add(anchor);
const checkOffset = (parent, expected) => {
  const actual = parent.worldToLocal(ghost.root.getWorldPosition(new Vector3()));
  assert.ok(actual.distanceTo(new Vector3(...expected)) < 1e-5, `${actual.toArray()} should be ${expected}`);
};

assert.equal(attachment.attach(null), false);
assert.equal(attachment.attach({ root: ghost.root }), false);
assert.equal(attachment.attach({ root: host, anchor: new Group() }), false);
assert.equal(attachment.attach({ root: host, offset: [0, 0, NaN] }), false);
assert.equal(attachment.attach({ root: host }), true);
assert.equal(attachment.update(0.36), 0.5);
assert.ok(mask(ghost).material.opacity < baseOpacity);
assert.equal(attachment.attach({ root: host }), true);
assert.equal(attachment.update(0), 0.5);
assert.equal(attachment.update(0.36), 1);
checkOffset(host, [0.38, 0.12, -0.86]);
host.position.x += 2.1;
host.rotation.y -= 0.51;
attachment.update(0);
checkOffset(host, [0.38, 0.12, -0.86]);
const attachedOpacity = mask(ghost).material.opacity;
assert.ok(Math.abs(attachedOpacity - baseOpacity * .36) < 1e-6);
assert.equal(mask(other).material.opacity, baseOpacity);
assert.equal(mask(other).geometry, mask(ghost).geometry);
assert.equal(attachment.attach({ root: host, anchor, offset: [0.02, 0.15, -0.64] }), true);
attachment.update(0);
assert.equal(mask(ghost).material.opacity, attachedOpacity);
attachment.update(1);
checkOffset(anchor, [0.02, 0.15, -0.64]);
scene.attach(anchor);
assert.equal(attachment.update(0), 0);
assert.equal(attachment.active, false);
assert.equal(mask(ghost).material.opacity, baseOpacity);
assert.equal(attachment.attach({ root: host }), true);
attachment.update(1);
host.removeFromParent();
attachment.update(0);
assert.equal(attachment.active, false);
assert.equal(ghost.root.parent, branch);

const fx = (name) => ghost.root.getObjectByName(name);
ghost.sample('unknown', 0.4);
assert.equal(fx('DrainFX').visible, false);
const head = fx('HeadPivot').quaternion.clone();
ghost.sample('flinch', 0.15625);
assert.ok(fx('HeadPivot').quaternion.angleTo(head) > 0.19);
ghost.sample('drain', 0.52);
assert.ok(fx('DrainFX').visible && fx('DrainFX').scale.x > 0.9);
ghost.sample('dead', 0.36);
assert.ok(fx('SmokeFX').visible && mask(ghost).material.opacity < baseOpacity * 0.5);
const earlySmokeY = fx('SmokeFX').position.y;
fx('SmokeFX').traverse((node) => {
  if (!node.isMesh) return;
  const { r, g, b } = node.material.color;
  assert.ok(g > b && b > r);
});
ghost.sample('dead', 0.72);
assert.ok(fx('SmokeFX').position.y > earlySmokeY);
ghost.sample('dead', 1);
assert.ok(!fx('SmokeFX').visible && !fx('BodyPivot').visible);
ghost.sample('idle', 0);
assert.ok(fx('BodyPivot').visible && mask(ghost).material.opacity === baseOpacity);
const resource = mask(ghost).material;
let disposed = 0;
resource.addEventListener('dispose', () => disposed++);
ghost.dispose();
ghost.dispose();
assert.equal(disposed, 1);
assert.equal(ghost.root.parent, null);
assert.equal(other.root.parent, branch);
other.dispose();

const report = {
  asset: { bytes: bytes.length, sha256, triangles, meshes: meshCount, height: bounds.max.y,
    materialCount: gltf.parser.json.materials.length,
    clips: gltf.animations.map((clip) => ({ name: clip.name, duration: Number(clip.duration.toFixed(2)) })) },
  checks: ['GLB parse and clip tracks', 'foot datum and axes', 'asset budget',
    'default and custom mounts across transformed branches', 'motion and turn tracking',
    'repeated mount and retarget opacity', 'invalid and removed host/anchor',
    'per-instance opacity', 'pose sampling and green smoke rise and fade', 'idempotent disposal'],
};

if (!process.argv.includes('--asset-only')) {
  const externalPreview = process.env.GHOST_PREVIEW_URL;
  const server = externalPreview ? undefined : await createServer({ configFile: false, clearScreen: false,
    server: { host: '127.0.0.1', port: 5197 }, optimizeDeps: { noDiscovery: true, include: [] } });
  let browser;
  try {
    await server?.listen();
    const base = externalPreview ?? `http://127.0.0.1:${server.httpServer.address().port}/artifacts/collab/ghost/preview/`;
    browser = await chromium.launch({ executablePath: process.env.GHOST_BROWSER_PATH || undefined,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    console.log('Chromium launched. Checking the desktop and mobile previews.');
    const errors = [];
    async function open(options) {
      const page = await browser.newPage(options);
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('response', (response) => { if (!response.ok() && response.status() >= 400) errors.push(response.url()); });
      page.on('requestfailed', (request) => errors.push(request.url()));
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 55000 });
      await page.waitForFunction(() => Boolean(window.ghostPreview));
      return page;
    }

    const desktop = await open({ viewport: { width: 1280, height: 860 } });
    const read = () => desktop.evaluate(() => window.ghostPreview.read());
    await desktop.getByRole('button', { name: '附身' }).click();
    await desktop.waitForFunction(() => window.ghostPreview.read().action === 'attached_idle');
    const before = await read();
    await desktop.getByRole('button', { name: '移动宿主' }).click();
    await desktop.waitForFunction(([x]) => Math.abs(window.ghostPreview.read().follower[0] - x) > 0.12, before.follower);
    const moving = await read();
    assert.ok(moving.hostLocal.every((n, i) => Math.abs(n - [0.38, 0.12, -0.86][i]) < 1e-5));
    await desktop.getByRole('button', { name: '石像' }).click();
    await desktop.waitForFunction(() => window.ghostPreview.read().action === 'attached_idle');
    const switched = await read();
    assert.ok(switched.hostLocal.every((n, i) => Math.abs(n - [0.42, 0.15, -0.87][i]) < 1e-5));
    await desktop.getByRole('button', { name: '受伤' }).focus();
    await desktop.keyboard.press('Enter');
    await desktop.waitForFunction(() => window.ghostPreview.read().action === 'attached_idle');

    const capture = async (page, file, action, fraction, target) => {
      await page.evaluate(({ action, fraction, target }) => window.ghostPreview.seek(action, fraction, target),
        { action, fraction, target });
      await page.screenshot({ path: fileURLToPath(new URL(file, evidence)), animations: 'disabled' });
      return page.evaluate(() => window.ghostPreview.read());
    };
    const desktopFrames = {};
    for (const [file, action, fraction, target] of [
      ['01-idle.png', 'idle', 0.15], ['02-attached.png', 'attached_idle', 0.38, 'guard'],
      ['03-drain.png', 'drain', 0.49, 'guard'], ['04-flinch.png', 'flinch', 0.17], ['05-smoke.png', 'dead', 0.52],
    ]) desktopFrames[file] = await capture(desktop, file, action, fraction, target);
    for (let i = 0; i < 4; i++) await desktop.evaluate(() => {
      window.ghostPreview.seek('drain', 0.56, 'guard');
      window.ghostPreview.seek('dead', 0.51, 'guard');
    });
    const warm = await read();
    for (let i = 0; i < 4; i++) await desktop.evaluate(() => {
      window.ghostPreview.seek('drain', 0.56, 'guard');
      window.ghostPreview.seek('dead', 0.51, 'guard');
    });
    assert.deepEqual((await read()).memory, warm.memory);

    const mobile = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await mobile.getByRole('button', { name: '石像' }).tap();
    await mobile.getByRole('button', { name: '附身' }).tap();
    await mobile.waitForFunction(() => window.ghostPreview.read().action === 'attached_idle');
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390);
    await mobile.getByRole('button', { name: '死亡' }).tap();
    await mobile.waitForFunction(() => document.querySelector('#status').value === '烟化消散');
    const narrow = await capture(mobile, '06-mobile.png', 'attached_idle', 0.25, 'idol');
    assert.deepEqual(errors, []);
    report.browser = { desktop: [1280, 860], mobile: [390, 844], errors, desktopFrames, narrow,
      clock: 'actual pointer click, keyboard Enter, mobile touch and reduced motion', warmedMemory: warm.memory };
  } finally {
    await browser?.close();
    await server?.close();
  }
}

await writeFile(new URL('validation.json', evidence), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report.asset, browserVerified: Boolean(report.browser) }, null, 2));
