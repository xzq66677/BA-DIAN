import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const localDependencies = path.resolve(here, '../../..', 'node_modules');
const fallbackDependencies = path.resolve(here, '../../../../badian-game/node_modules');
const dependencies = existsSync(path.join(localDependencies, 'three/examples/jsm/exporters/GLTFExporter.js'))
  ? localDependencies
  : fallbackDependencies;
const modelDirectory = path.join(here, 'model');
const evidenceDirectory = path.join(here, 'evidence');

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
    port: 5215,
    strictPort: true,
    fs: { allow: [here, dependencies] },
  },
  plugins: [{
    name: 'dajianke-local-glb-export',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url === '/__evidence' && request.method === 'POST') {
          try {
            const payload = JSON.parse((await readBody(request, 16 * 1024 * 1024)).toString('utf8'));
            if (!/^[a-z0-9-]+\.png$/.test(payload.name)) throw new Error('Invalid evidence filename');
            if (typeof payload.data !== 'string' || !payload.data.startsWith('data:image/png;base64,')) throw new Error('PNG data URL required');
            const buffer = Buffer.from(payload.data.slice('data:image/png;base64,'.length), 'base64');
            if (buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Evidence is not a PNG');
            await mkdir(evidenceDirectory, { recursive: true });
            await writeFile(path.join(evidenceDirectory, payload.name), buffer);
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ file: `evidence/${payload.name}`, bytes: buffer.length }));
          } catch (error) {
            response.statusCode = 500;
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ error: error.message }));
          }
          return;
        }
        if (request.url === '/__validation' && request.method === 'POST') {
          try {
            const payload = JSON.parse((await readBody(request, 4 * 1024 * 1024)).toString('utf8'));
            await mkdir(evidenceDirectory, { recursive: true });
            await writeFile(path.join(evidenceDirectory, 'validation.json'), `${JSON.stringify(payload, null, 2)}\n`);
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ file: 'evidence/validation.json' }));
          } catch (error) {
            response.statusCode = 500;
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ error: error.message }));
          }
          return;
        }
        if (request.url !== '/__export') return next();
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.end('POST required');
          return;
        }
        try {
          const buffer = await readBody(request, 32 * 1024 * 1024);
          if (buffer.toString('ascii', 0, 4) !== 'glTF') throw new Error('Export is not a binary glTF');
          await mkdir(modelDirectory, { recursive: true });
          const file = path.join(modelDirectory, 'dajianke.glb');
          await writeFile(file, buffer);
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ file: 'model/dajianke.glb', bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') }));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ error: error.message }));
        }
      });
    },
  }],
};
