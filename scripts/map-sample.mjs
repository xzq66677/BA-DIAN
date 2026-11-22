/** npm run build && node scripts/map-sample.mjs ruins
 * Optional MAP_SAMPLE_REPO points at an independently built baseline checkout.
 */
import { chromium } from 'playwright';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const tag = process.argv[2] ?? 'ruins';
assert.match(tag, /^[a-z0-9_-]+$/i);
const out = process.env.MAP_EVIDENCE_DIR ?? 'docs/screenshots-v5-map';
const repo = process.env.MAP_SAMPLE_REPO ?? resolve(import.meta.dirname, '..');
const { httpServer, io, startServer } = await import(pathToFileURL(resolve(repo, 'server/dist/server/src/index.js')).href);
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  await mkdir(out, { recursive: true });
  startServer(0);
  await once(httpServer, 'listening');
  const address = httpServer.address();
  assert(address && typeof address === 'object');
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    window.glCounts = { created: 0, lost: 0 };
    const get = HTMLCanvasElement.prototype.getContext;
    const observed = new WeakSet();
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      const context = get.call(this, kind, ...args);
      if (kind.startsWith('webgl') && context && !observed.has(context)) {
        observed.add(context);
        window.glCounts.created++;
        this.addEventListener('webglcontextlost', () => window.glCounts.lost++);
      }
      return context;
    };
  });
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByPlaceholder('输入昵称').fill('遗迹演练');
  await page.getByLabel('选择角色卡').selectOption('ivan-girl');
  await page.getByLabel(/单设备多人/).selectOption('4');
  await page.getByRole('button', { name: /仅创建/ }).click();
  const roster = ['ivan-girl', 'wuliuqi', 'default', 'default'];
  for (let index = 1; index < roster.length; index++) {
    await page.locator('.seat-slot').filter({ hasText: `遗迹演练${index + 1}` }).locator('select').selectOption(roster[index]);
  }
  await page.getByRole('button', { name: /开始对局/ }).click();
  await page.waitForFunction(() => window.__b3scene?.debugStats().entities === 4);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${tag}.png` });
  const stats = await page.evaluate(async () => {
    const scene = window.__b3scene;
    const renderer = scene.renderer;
    const gl = renderer.getContext();
    const rates = [];
    for (let i = 0; i < 3; i++) {
      const before = renderer.info.render.frame;
      const start = performance.now();
      await new Promise(done => setTimeout(done, 1600));
      rates.push((renderer.info.render.frame - before) / (performance.now() - start) * 1000);
    }
    return {
      ...scene.debugStats(), canvas: [renderer.domElement.width, renderer.domElement.height],
      gl: window.glCounts, drawCalls: renderer.info.render.calls,
      rate: rates.slice().sort((a, b) => a - b)[1], rates,
      renderer: gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL),
      characters: scene.debugCharacters().map(p => p.charId),
    };
  });
  await writeFile(`${out}/${tag}.json`, JSON.stringify({ tag, stats, errors }, null, 2) + '\n');
  console.log(JSON.stringify({ tag, stats, errors }));
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await io.close();
}
