import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const localDependencies = path.resolve(here, '../../../node_modules');
const fallbackDependencies = path.resolve(here, '../../../../badian-game/node_modules');
const dependencies = existsSync(path.join(localDependencies, 'three/examples/jsm/controls/OrbitControls.js'))
  ? localDependencies
  : fallbackDependencies;
const modelDirectory = path.join(here, 'model');
const evidenceDirectory = path.join(here, 'evidence');
const evidenceFiles = new Set([
  'preview-idle.png', 'preview-face.png', 'preview-walk.png', 'preview-cast.png',
  'preview-attack.png', 'preview-flinch.png', 'preview-cheer.png', 'preview-dead.png',
  'preview-revive.png', 'preview-mobile-390.png',
]);

async function readBody(request, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error(`Payload exceeds ${limit} byte local limit`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify(payload));
}

export default {
  root: path.join(here, 'preview'),
  resolve: {
    alias: [
      { find: /^three$/, replacement: path.join(dependencies, 'three/build/three.module.js') },
      { find: /^three\/addons\/(.*)$/, replacement: path.join(dependencies, 'three/examples/jsm/$1') },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5209,
    strictPort: true,
    fs: { allow: [here, dependencies] },
  },
  plugins: [{
    name: 'wuliuqi-local-evidence',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split('?')[0];
        if (!['/__export', '/__validation', '/__evidence'].includes(pathname)) return next();
        const host = request.headers.host?.replace(/^\[|\](?::\d+)?$/g, '').replace(/:\d+$/, '');
        if (!['127.0.0.1', 'localhost', '::1'].includes(host)
          || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? '')) {
          response.statusCode = 403;
          response.end('Local access only');
          return;
        }
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.setHeader('Allow', 'POST');
          response.end('POST required');
          return;
        }
        try {
          if (pathname === '/__export') {
            const buffer = await readBody(request, 8 * 1024 * 1024);
            if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'glTF'
              || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) {
              throw new Error('Export is not a valid GLB');
            }
            await mkdir(modelDirectory, { recursive: true });
            await writeFile(path.join(modelDirectory, 'wuliuqi.glb'), buffer);
            sendJson(response, 200, {
              file: 'model/wuliuqi.glb', bytes: buffer.length,
              sha256: createHash('sha256').update(buffer).digest('hex'),
            });
            return;
          }
          if (pathname === '/__validation') {
            const payload = JSON.parse((await readBody(request, 8 * 1024 * 1024)).toString('utf8'));
            if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
              throw new Error('Validation report must be a JSON object');
            }
            await mkdir(evidenceDirectory, { recursive: true });
            await writeFile(path.join(evidenceDirectory, 'validation.json'), `${JSON.stringify(payload, null, 2)}\n`);
            sendJson(response, 200, { file: 'evidence/validation.json' });
            return;
          }
          const payload = JSON.parse((await readBody(request, 17 * 1024 * 1024)).toString('utf8'));
          if (!evidenceFiles.has(payload.name ?? '')) throw new Error('Invalid evidence filename');
          if (typeof payload.data !== 'string' || !payload.data.startsWith('data:image/png;base64,')) {
            throw new Error('PNG data URL required');
          }
          const data = payload.data.slice('data:image/png;base64,'.length);
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) throw new Error('Invalid base64 PNG');
          const png = Buffer.from(data, 'base64');
          if (png.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Evidence is not a PNG');
          await mkdir(evidenceDirectory, { recursive: true });
          await writeFile(path.join(evidenceDirectory, payload.name), png);
          sendJson(response, 200, { file: `evidence/${payload.name}`, bytes: png.length });
        } catch (error) {
          sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  }],
};
