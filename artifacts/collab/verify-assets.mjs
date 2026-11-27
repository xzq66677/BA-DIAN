import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const read = (folder, file) => readFileSync(new URL(`${folder}/${file}`, import.meta.url));
const spec = folder => JSON.parse(read(folder, 'asset-spec.json'));
const regular = (folder, make) => make(spec(folder)).map(asset => ({ folder, ...asset }));
const assets = [
  ...regular('ghost', s => [{ file: s.generatedAsset, sha256: s.sha256, clips: s.clips.map(c => [c.name, c.seconds]), anchors: Object.values(s.anchors) }]),
  ...regular('wild-hunt-heathcliff', s => [{ file: s.generatedAsset, sha256: s.sha256, clips: s.clips.map(c => [c.name, c.seconds]), anchors: Object.values(s.anchors), preview: s.preview }]),
  ...regular('skeleton-archer', s => [{ file: s.generatedAsset, sha256: s.sha256, clips: Object.entries(s.animationContract.durationsSeconds), anchors: s.skeletonContract.importantBones }]),
  ...regular('flying-leech', s => s.assets.map(a => ({ ...a, clips: a.animations.map(c => [c.name, c.duration]),
    anchors: a.file.endsWith('basalt-tower.glb') ? s.towerAnchors
      : a.file.endsWith('wind-vortex.glb') ? [s.directionalWind.targetNode]
        : a.file.endsWith('flying-leech.glb') ? s.characterAnchors : [],
  }))),
];
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
  assert.equal(doc.animations.length, asset.clips.length, name);
  for (const [clip, duration] of asset.clips) {
    const animation = doc.animations.find(value => value.name === clip);
    assert.ok(animation, `${name}: ${clip}`);
    const clipDuration = Math.max(...animation.samplers.map(s => doc.accessors[s.input].max[0]));
    assert.ok(Math.abs(clipDuration - duration) < .001, `${name}: ${clip} duration ${clipDuration}`);
  }
  if (asset.preview) {
    const embedded = read(asset.folder, asset.preview).toString('utf8').match(/id="asset">([^<]+)<\/script>/)?.[1];
    assert.ok(embedded && bytes.equals(Buffer.from(embedded, 'base64')), name);
  }
  console.log(`${name}: ${asset.clips.length} clips verified`);
}
