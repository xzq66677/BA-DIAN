import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { AnimationMixer, Box3, LoopOnce, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createServer } from 'vite';

const bundle = new URL('../', import.meta.url);
const evidence = new URL('evidence/', bundle);
const spec = JSON.parse(await readFile(new URL('asset-spec.json', bundle), 'utf8'));
const assets = {};
await mkdir(evidence, { recursive: true });

for (const asset of spec.assets) {
  const bytes = await readFile(new URL(asset.file, bundle));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(bytes.length, asset.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  assert.ok(asset.bytes < 4_000_000 && asset.triangles <= 65_000);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const json = gltf.parser.json;
  assert.ok(json.buffers.every((buffer) => buffer.uri === undefined));
  assert.equal(json.images, undefined);
  assert.deepEqual(gltf.animations.map((clip) => clip.name), asset.animations.map((clip) => clip.name));
  const nodeNames = new Set();
  let triangles = 0;
  gltf.scene.traverse((node) => {
    if (node.name) {
      assert.ok(!nodeNames.has(node.name), `Duplicate name ${node.name}`);
      nodeNames.add(node.name);
    }
    if (!node.isMesh) return;
    triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
    assert.ok(node.geometry.attributes.position.array.every(Number.isFinite));
  });
  assert.equal(triangles, asset.triangles);
  for (const [i, clip] of gltf.animations.entries()) {
    assert.ok(Math.abs(clip.duration - asset.animations[i].duration) < 0.0001);
    assert.ok(clip.tracks.length > 0 && clip.validate());
    for (const track of clip.tracks) assert.ok(track.values.every(Number.isFinite));
  }
  assets[asset.file.split('/').at(-1)] = gltf;
}

function find(gltf, name) {
  const value = gltf.scene.getObjectByName(name);
  assert.ok(value, `Missing node ${name}`);
  return value;
}

function sample(gltf, name, t, check) {
  const clip = gltf.animations.find((clip) => clip.name === name);
  assert.ok(clip);
  const mixer = new AnimationMixer(gltf.scene);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1).play();
  action.paused = true;
  action.time = t;
  mixer.update(0);
  gltf.scene.updateMatrixWorld(true);
  const result = check();
  mixer.stopAllAction();
  mixer.uncacheRoot(gltf.scene);
  return result;
}

const leech = assets['flying-leech.glb'];
const specter = assets['flying-leech-spectral.glb'];
const tower = assets['basalt-tower.glb'];
const wind = assets['wind-vortex.glb'];
for (const name of spec.characterAnchors) find(leech, name);
assert.deepEqual(find(leech, 'GroundAnchor').getWorldPosition(new Vector3()).toArray(), [0, 0, 0]);
assert.ok(find(leech, 'WindOrigin').getWorldPosition(new Vector3()).z > 0.9);
assert.ok(new Box3().setFromObject(leech.scene).min.y > 0.35);
assert.ok(leech.animations.every((clip) => clip.tracks.every((track) => !track.name.startsWith('FlyingLeechRoot.'))));
assert.equal(find(leech, 'RoundedHead').material.transparent, false);
const luminance = ({ r, g, b }) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
for (const form of [leech, specter]) {
  find(form, 'LittleSmile');
  for (const side of ['L', 'R']) {
    const iris = find(form, `Iris${side}`);
    const pupil = find(form, `Pupil${side}`);
    const sclera = find(form, `Sclera${side}`);
    assert.ok(pupil.scale.x / pupil.scale.y > 0.88 && pupil.scale.x / pupil.scale.y < 1.12);
    assert.ok(pupil.scale.x < iris.scale.x * 0.6 && iris.scale.x < sclera.scale.x * 0.78);
    assert.ok(luminance(sclera.material.color) > luminance(pupil.material.color) * 2);
    find(form, `EyeGlint${side}`);
    find(form, `EyeSpark${side}`);
    assert.equal(form.scene.getObjectByName(`EyeDark${side}`), undefined);
  }
}
assert.ok(specter.parser.json.materials.every((material) => material.alphaMode === 'BLEND'));
assert.equal(find(specter, 'RoundedHead').material.opacity, spec.spectralOpacity);
for (const name of spec.towerAnchors) find(tower, name);
assert.equal(tower.scene.getObjectByName('TowerGate'), undefined);
const tiers = Array.from({ length: spec.towerStyle.tierCount }, (_, i) => find(tower, `TowerTier${i + 1}`));
const widths = tiers.map((tier) => new Box3().setFromObject(tier).getSize(new Vector3()).x);
assert.ok(widths.every((width, i) => i === 0 || width < widths[i - 1] * 0.92));
for (const tier of tiers) {
  const slate = tier.children.find((child) => child.material?.name === 'Blue-grey roof tiles');
  assert.ok(slate?.isMesh);
  const positions = slate.geometry.attributes.position;
  const edge = [];
  for (let i = 0; i < positions.count; i++) {
    const radius = Math.hypot(positions.getX(i), positions.getZ(i));
    edge.push({ radius, y: positions.getY(i) });
  }
  const maxRadius = Math.max(...edge.map(({ radius }) => radius));
  const eaveY = edge.filter(({ radius }) => radius > maxRadius * 0.92).map(({ y }) => y);
  assert.ok(Math.max(...eaveY) - Math.min(...eaveY) > 0.16);
  assert.ok(new Box3().setFromObject(slate).getSize(new Vector3()).x > widths[tiers.indexOf(tier)] * 0.94);
}
assert.ok(new Box3().setFromObject(tower.scene).max.y > 5.5);
assert.ok(sample(tower, 'build', 0.3, () => tiers[0].scale.y > 0.3 && tiers[4].scale.y < 0.002));
assert.ok(sample(tower, 'build', 1.75, () => tiers.every((tier) => tier.scale.y === 1)));
assert.ok(sample(tower, 'strike', 0.61, () => find(tower, 'TowerFlight').position.y) > 1.3);
assert.ok(sample(tower, 'strike', spec.towerImpactSeconds, () => find(tower, 'TowerFlight').position.z) > 3.1);
for (const [clip, direction] of [['inhale', -1], ['exhale', 1], ['capture', -1]]) {
  const depth = (t) => sample(wind, clip, t, () => find(wind, 'WindTracer1').position.z);
  assert.ok(direction * (depth(0.7) - depth(0.21)) > 1.5);
}
const windTarget = find(wind, spec.directionalWind.targetNode);
for (const [clip, sign] of [['inhale', -1], ['exhale', 1]]) {
  const position = (seconds) => sample(wind, clip, seconds, () => windTarget.position.clone());
  const start = position(0);
  const finish = position(1.65);
  assert.ok(sign * (finish.z - start.z) > 2.4);
  assert.ok(start.y === 0 && finish.y === 0 && position(0.68).y > 0.28);
  assert.ok(Math.abs(sample(wind, clip, clip === 'inhale' ? 0.83 : 0.67, () => windTarget.rotation.z)) > 0.25);
}

const report = { assets: spec.assets, checks: ['GLB container, SHA-256, no external resources', 'Finite meshes and clip tracks',
  'Character axes, ground pivot and in-place animation', 'Spectral blend material at 40% opacity',
  'Round pupils, light sclera, paired catchlights and curved smile in both leech forms',
  'Five tapering octagonal galleries with upturned slate roofs and a tall finial',
  'Tower rise, impact and central vortex anchor', 'Directional wind has opposite tracer and target motion, airborne roll and landing'] };
const distance = (a, b) => new Vector3(...a).distanceTo(new Vector3(...b));
const groundGap = ({ hero, opponent }) => Math.hypot(opponent[0] - hero[0], opponent[2] - hero[2]);

if (!process.argv.includes('--asset-only')) {
  const server = await createServer({ configFile: false, clearScreen: false,
    server: { host: '127.0.0.1', port: 5219, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  const browserExecutable = process.env.FLYING_LEECH_BROWSER_PATH || [
    chromium.executablePath(),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ].find((path) => existsSync(path));
  let browser;
  try {
    await server.listen();
    const url = `http://127.0.0.1:${server.httpServer.address().port}/artifacts/collab/flying-leech/preview/`;
    browser = await chromium.launch({ executablePath: browserExecutable, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const errors = [];
    async function open(options) {
      const page = await browser.newPage(options);
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      page.on('response', (response) => {
        if (response.status() >= 400) errors.push(response.url());
      });
      page.on('requestfailed', (request) => errors.push(request.url()));
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => Boolean(window.flyingLeechPreview));
      return page;
    }

    const desktop = await open({ viewport: { width: 1280, height: 800 } });
    const read = (page = desktop) => page.evaluate(() => window.flyingLeechPreview.read());
    async function seek(page, shot, t) {
      await page.evaluate(([shot, t]) => window.flyingLeechPreview.seek(shot, t), [shot, t]);
      return read(page);
    }
    const play = desktop.getByRole('button', { name: '播放完整演出' });
    await play.click();
    await desktop.waitForFunction(() => window.flyingLeechPreview.read().shot === 'strike');
    await desktop.getByRole('button', { name: '停止播放' }).click();
    assert.equal((await read()).sequence, false);
    const strike = desktop.getByRole('button', { name: '投塔卷入' });
    await strike.focus();
    await desktop.keyboard.press('Enter');
    await desktop.waitForFunction(() => window.flyingLeechPreview.read().progress === 1);
    const settled = await read();
    assert.ok(!settled.solid && !settled.opponentVisible && !settled.wind);
    assert.ok(distance(settled.hero, settled.impact) < 1e-6);
    assert.ok(distance(settled.opponent, settled.impact) < 1e-6);
    const strikeFrame = await seek(desktop, 'strike', 0.21);
    assert.ok(!strikeFrame.wind && strikeFrame.tower[1] > 1);
    const pullStart = await seek(desktop, 'strike', 0.48);
    const pullEnd = await seek(desktop, 'strike', 0.72);
    assert.ok(pullStart.wind && pullEnd.wind && pullEnd.solid && pullEnd.opponentVisible);
    for (const subject of ['hero', 'opponent']) {
      assert.ok(distance(pullStart[subject], pullStart.impact) - distance(pullEnd[subject], pullEnd.impact) > 0.5);
    }
    for (const [shot, button, sign] of [['inhale', '吸入对手', -1], ['exhale', '吹出对手', 1]]) {
      const first = await seek(desktop, shot, 0);
      const middle = await seek(desktop, shot, 0.45);
      assert.ok(middle.wind && middle.opponentVisible && !middle.towerVisible && middle.opponent[1] > 0.25);
      assert.ok(Math.abs(middle.targetTilt) > 0.1);
      await desktop.getByRole('button', { name: button }).click();
      await desktop.waitForFunction((id) => {
        const frame = window.flyingLeechPreview.read();
        return frame.shot === id && frame.progress === 1;
      }, shot);
      const last = await read();
      assert.ok(last.opponentVisible && !last.wind && Math.abs(last.opponent[1]) < 1e-6);
      assert.ok(sign * (groundGap(last) - groundGap(first)) > 2.4);
      await desktop.getByRole('button', { name: button }).blur();
    }
    const dead = await seek(desktop, 'spectral', 1);
    assert.ok(dead.specter && !dead.solid && dead.specterOpacity === spec.spectralOpacity);
    assert.equal((await seek(desktop, 'idle', 0)).heroOpacity, 1);

    const frames = {};
    await strike.blur();
    for (const [file, shot, t] of [
      ['01-idle.png', 'idle', 0.19], ['02-build.png', 'build', 1], ['03-strike.png', 'strike', 0.27],
      ['04-capture.png', 'strike', 0.58], ['05-settled.png', 'strike', 1],
      ['07-spectral.png', 'spectral', 1], ['09-inhale-opponent.png', 'inhale', 0.51], ['10-exhale-opponent.png', 'exhale', 0.45],
    ]) {
      frames[file] = await seek(desktop, shot, t);
      await desktop.locator('main').screenshot({ path: fileURLToPath(new URL(file, evidence)) });
    }
    const before = (await read()).memory;
    for (let i = 0; i < 3; i++) {
      await seek(desktop, 'strike', 0.27);
      await seek(desktop, 'strike', 0.69);
      await seek(desktop, 'spectral', 1);
    }
    assert.deepEqual((await read()).memory, before);

    const mobile = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await mobile.getByRole('button', { name: '投塔卷入' }).tap();
    const reduced = await read(mobile);
    assert.ok(reduced.reducedMotion && !reduced.wind && reduced.progress === 1 && !reduced.opponentVisible && !reduced.solid);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390);
    await mobile.screenshot({ path: fileURLToPath(new URL('08-mobile.png', evidence)) });
    await mobile.getByRole('button', { name: '吹出对手' }).tap();
    const narrowWind = await read(mobile);
    assert.ok(narrowWind.shot === 'exhale' && narrowWind.opponentVisible && !narrowWind.wind && groundGap(narrowWind) > 4);
    assert.deepEqual(errors, []);
    report.browser = { version: browser.version(), desktop: [1280, 800], mobile: [390, 844],
      errors, frames, reducedMotion: reduced, memoryAfterWarmup: before };
  } finally {
    await browser?.close();
    await server.close();
  }
}
await writeFile(new URL('validation.json', evidence), `${JSON.stringify(report, null, 2)}\n`);
console.log(`${spec.assets.length} GLB assets verified. Chromium preview verified: ${Boolean(report.browser)}.`);
