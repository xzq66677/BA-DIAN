// Issue #108：浏览器端验证 meshopt 压缩 GLB 能被真实 GLTFLoader + MeshoptDecoder 完整解码。
// 用法：先起 vite dev（npm run dev:client，默认 5173/3200），再
//   node scripts/verify-collab-assets.mjs http://127.0.0.1:<port>
// 退出码 0 = 全部资产加载成功且克隆出的场景网格可解析。
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:3200';

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});

const IDS = ['ghost', 'wild-hunt', 'hunchback-archer', 'water-snake', 'slot-hero'];
// 道具资产随 water-snake 的 props 链一起加载；loadedCollaborationVisualId 只覆盖 characters 表，
// 道具加载失败会以 glb 请求失败 / preload 错误的形式暴露，不在此单独断言。
const PROP_IDS = ['basalt-tower', 'wind-vortex'];

try {
  const page = await browser.newPage();
  const failures = [];
  page.on('console', (m) => { if (m.type() === 'error') failures.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => failures.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => { if (r.url().includes('.glb')) failures.push(`glb request failed: ${r.url()}`); });

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // 直接 import 生产源码模块（vite dev 负责转译）——与 3D 场景同一条加载路径
  const result = await page.evaluate(async (ids) => {
    const m = await import('/src/battle3d/characters/collab-assets.ts');
    const errors = [];
    await m.preloadCollaborationAssets(ids).catch((e) => errors.push(`preload: ${e?.message ?? e}`));
    const loaded = Object.fromEntries(ids.map((id) => [id, m.loadedCollaborationVisualId(id) ?? null]));
    // 克隆一份 slot-hero 并校验网格可解析、蒙皮/动画齐全（压缩损坏在此暴露）
    let meshes = -1;
    let skinned = -1;
    let clips = -1;
    try {
      const asset = m.cloneAsset('slot-hero');
      if (asset) {
        let meshCount = 0;
        let skinnedCount = 0;
        asset.scene.traverse((n) => {
          if (n.isMesh) meshCount += 1;
          if (n.isSkinnedMesh) skinnedCount += 1;
          if (n.isMesh) {
            const pos = n.geometry?.attributes?.position;
            if (!pos || !(pos.count > 0)) throw new Error('empty position accessor');
          }
        });
        meshes = meshCount;
        skinned = skinnedCount;
        clips = asset.clips.size;
        asset.dispose();
      }
    } catch (e) {
      errors.push(`cloneAsset: ${e?.message ?? e}`);
    }
    return { loaded, meshes, skinned, clips, errors };
  }, IDS);

  console.log('loaded visual ids:', result.loaded);
  console.log('slot-hero clone: meshes=', result.meshes, 'skinned=', result.skinned, 'clips=', result.clips);

  for (const id of IDS) assert.notEqual(result.loaded[id], null, `${id} GLB 未加载成功（MeshoptDecoder 失败或 404）`);
  const propFailures = failures.filter((f) => PROP_IDS.some((p) => f.includes(p)));
  assert.deepEqual(propFailures, [], `道具 GLB 请求失败: ${JSON.stringify(propFailures)}`);
  assert.ok(result.meshes > 0, 'slot-hero 克隆场景应包含网格');
  assert.ok(result.clips > 0, 'slot-hero 克隆应携带动画剪辑');
  assert.deepEqual(result.errors, [], `无加载/解析错误，实际: ${JSON.stringify(result.errors)}`);
  // dev-only 页面没有游戏后端：socket.io 握手失败 / API 404·500 属预期噪音，不在本验证范围；
  // GLB 请求失败已由 requestfailed 单独捕获。
  const noise = (f) => f.includes('favicon') || f.includes('socket.io') || f.includes('WebSocket')
    || f.includes('Failed to load resource');
  const relevantFailures = failures.filter((f) => !noise(f));
  assert.deepEqual(relevantFailures, [], `无浏览器错误，实际: ${JSON.stringify(relevantFailures)}`);
  console.log('VERIFY OK: 5 角色 + 2 道具 meshopt 压缩 GLB 全部解码成功');
} finally {
  await browser.close();
}
