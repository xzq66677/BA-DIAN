import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

// 校验 artifacts/collab 下每个入库 GLB：GLB 头、声明长度、sha256 与 asset-spec.json 一致、
// 无外链 buffer/image、锚点节点存在、动画剪辑名/时长与契约一致、内嵌预览与 GLB 字节一致。
// 由 tests/ui/collab-verify-script.test.ts 调用（npm test 全量执行），防止 spec 与资产再脱钩。
const read = (folder, file) => readFileSync(new URL(`${folder}/${file}`, import.meta.url));
const spec = folder => JSON.parse(read(folder, 'asset-spec.json'));
const regular = (folder, make) => make(spec(folder)).map(asset => ({ folder, ...asset }));
const assets = [
  ...regular('ghost', s => [{ file: s.generatedAsset, sha256: s.sha256, clips: s.clips.map(c => [c.name, c.seconds]), anchors: Object.values(s.anchors), preview: s.preview }]),
  ...regular('wild-hunt-heathcliff', s => [{ file: s.generatedAsset, sha256: s.sha256, clips: s.clips.map(c => [c.name, c.seconds]), anchors: Object.values(s.anchors), preview: s.preview }]),
  ...regular('skeleton-archer', s => [{ file: s.generatedAsset, sha256: s.sha256, clips: Object.entries(s.animationContract.durationsSeconds), anchors: s.skeletonContract.importantBones }]),
  ...regular('flying-leech', s => s.assets.map(a => ({ ...a, clips: a.animations.map(c => [c.name, c.duration]),
    anchors: a.file.endsWith('basalt-tower.glb') ? s.towerAnchors
      : a.file.endsWith('wind-vortex.glb') ? [s.directionalWind.targetNode]
        : a.file.endsWith('flying-leech.glb') ? s.characterAnchors : [],
  }))),
  // Issue #117 批次：chuixiao/wuliuqi 带 skeletonContract；第二批（含 slot-hero/gojo 补派生 clips）clips 为数组、无锚点契约
  ...regular('chuixiao', s => [{ file: s.generatedAsset, sha256: s.sha256, clips: Object.entries(s.animationContract.durationsSeconds), anchors: s.skeletonContract.importantBones }]),
  ...regular('wuliuqi', s => [{ file: s.generatedAsset, sha256: s.sha256, clips: Object.entries(s.animationContract.durationsSeconds), anchors: s.skeletonContract.importantBones }]),
  ...['slot-hero', 'bagun', 'ivan-girl', 'dajianke', 'laodaye', 'nobody', 'gojo'].map(folder =>
    regular(folder, s => [{ file: s.generatedAsset, sha256: s.sha256, clips: (s.clips ?? []).map(c => [c.name, c.seconds]), anchors: [] }])).flat(),
];
let checked = 0;
for (const asset of assets) {
  const name = `${asset.folder}/${asset.file}`;
  const bytes = read(asset.folder, asset.file);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF', name);
  assert.equal(bytes.readUInt32LE(4), 2, name);
  assert.equal(bytes.readUInt32LE(8), bytes.length, name);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, name);
  const doc = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.ok([...doc.buffers, ...(doc.images ?? [])].every(entry => !entry.uri), name);
  const nodes = new Set(doc.nodes.map(node => node.name));
  for (const anchor of asset.anchors) assert.ok(nodes.has(anchor), `${name}: ${anchor}`);
  if (asset.clips.length) {
    assert.equal(doc.animations.length, asset.clips.length, name);
    for (const [clip, duration] of asset.clips) {
      const animation = doc.animations.find(value => value.name === clip);
      assert.ok(animation, `${name}: ${clip}`);
      const clipDuration = Math.max(...animation.samplers.map(s => doc.accessors[s.input].max[0]));
      assert.ok(Math.abs(clipDuration - duration) < .001, `${name}: ${clip} duration ${clipDuration}`);
    }
  }
  if (asset.preview) {
    const html = read(asset.folder, asset.preview).toString('utf8');
    const embedded = html.match(/id="asset">([^<]+)<\/script>/)?.[1];
    // 内嵌式预览（wild-hunt）：base64 必须与 GLB 字节一致。外链式预览（ghost 等 preview.mjs
    // 经 import.meta.url 运行时加载 model/*.glb）的完整性由上方 sha256 校验覆盖，跳过内嵌断言。
    if (embedded) assert.ok(bytes.equals(Buffer.from(embedded, 'base64')), name);
  }
  checked += 1;
  console.log(`${name}: ${asset.clips.length} clips verified`);
}
console.log(`verify-assets: ${checked} assets OK`);
