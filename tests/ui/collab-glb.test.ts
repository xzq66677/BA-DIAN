import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Issue #108：专属角色 GLB 已用 meshopt 压缩几何（gltf-transform optimize，
 * 总体积 16.99MB → 4.33MB）。本组测试锁定「压缩必须真的落盘」：
 * 若有人重新导出未压缩资产，这里立刻报警。
 * 解码正确性由 collab-assets.ts 接入的 MeshoptDecoder 在浏览器 3D 场景验证
 * （scripts/verify-collab-assets.mjs）。
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** [目录, 文件名]；与 collab-assets.ts 的 URL 表一一对应 */
const ASSETS: readonly [string, string][] = [
  ['ghost', 'ghost'],
  ['wild-hunt-heathcliff', 'wild-hunt-heathcliff-wraith'],
  ['skeleton-archer', 'skeleton-archer'],
  ['flying-leech', 'flying-leech'],
  ['flying-leech', 'basalt-tower'],
  ['flying-leech', 'wind-vortex'],
  ['slot-hero', 'slot-hero'],
  ['chuixiao', 'chuixiao'],
  ['wuliuqi', 'wuliuqi'],
  ['bagun', 'bagun'],
  ['ivan-girl', 'ivan-girl'],
  ['dajianke', 'dajianke'],
  ['laodaye', 'laodaye'],
  ['nobody', 'nobody'],
  ['gojo', 'gojo'],
];

/** 压缩后体积上限（宽松值；只要重新导出成未压缩资产就会超标报警） */
const SIZE_CAP_BYTES: Record<string, number> = {
  ghost: 300_000,
  'wild-hunt-heathcliff-wraith': 2_500_000,
  'skeleton-archer': 2_000_000,
  'flying-leech': 220_000,
  'basalt-tower': 500_000,
  'wind-vortex': 80_000,
  'slot-hero': 1_500_000,
  chuixiao: 900_000,
  wuliuqi: 900_000,
  bagun: 850_000,
  'ivan-girl': 1_200_000,
  dajianke: 850_000,
  laodaye: 1_000_000,
  nobody: 900_000,
  gojo: 450_000,
};

interface GlbJson {
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  meshes?: unknown[];
  animations?: unknown[];
}

function readGlb(dir: string, name: string): { json: GlbJson; byteLength: number } {
  const file = path.join(root, 'artifacts', 'collab', dir, 'model', `${name}.glb`);
  const buf = readFileSync(file);
  expect(buf.readUInt32LE(0)).toBe(0x46546c67); // 'glTF' magic
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as GlbJson;
  return { json, byteLength: buf.byteLength };
}

describe('专属角色 GLB 资产（meshopt 压缩，Issue #108）', () => {
  it.each(ASSETS)('%s / %s.glb：meshopt 扩展落盘且结构完整', (dir, name) => {
    const { json, byteLength } = readGlb(dir, name);
    // meshopt 压缩必须真的存在：used + required，缺解码器时 GLTFLoader 会大声报错而非静默渲染坏模型
    expect(json.extensionsUsed).toContain('EXT_meshopt_compression');
    expect(json.extensionsRequired).toContain('EXT_meshopt_compression');
    expect(json.meshes?.length).toBeGreaterThan(0);
    expect(byteLength).toBeLessThan(SIZE_CAP_BYTES[name]);
  });

  it('未引用的谱系变体（flying-leech-spectral）仍为未压缩资产，不在解码器约束内', () => {
    const { json } = readGlb('flying-leech', 'flying-leech-spectral');
    expect(json.extensionsUsed?.includes('EXT_meshopt_compression')).toBe(false);
  });
});
