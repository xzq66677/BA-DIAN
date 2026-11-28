import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 把 artifacts/collab/verify-assets.mjs 挂进 npm test：每个入库 GLB 的 GLB 头、声明长度、
 * sha256 与 asset-spec.json 一致性、无外链、锚点节点、动画剪辑名/时长、内嵌预览一致性。
 * 背景：Issue #108 压缩时没同步 spec sha，verify-assets.mjs 静默脱钩近一个月（没进 CI），
 * 本次修复并锁进测试，防止再次腐烂。
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('collab GLB 资产契约脚本（verify-assets.mjs）', () => {
  it('全部 collab 资产通过 sha256 / 头部 / 剪辑 / 锚点校验', () => {
    let stdout: string;
    try {
      stdout = execFileSync(process.execPath, ['verify-assets.mjs'], {
        cwd: path.join(root, 'artifacts', 'collab'),
        encoding: 'utf8',
        timeout: 60_000,
      });
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      throw new Error(`verify-assets.mjs 未通过：\n${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message}`);
    }
    expect(stdout).toContain('assets OK');
  });
});
