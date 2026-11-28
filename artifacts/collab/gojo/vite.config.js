import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dependencies = 'D:/AI工作区/badian-game/node_modules';
const modelDirectory = path.join(here, 'model');
const evidenceDirectory = path.join(here, 'evidence');

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
    port: 5213,
    strictPort: true,
    fs: { allow: [here, dependencies] },
  },
  plugins: [{
    name: 'gojo-local-glb-export',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url === '/model/gojo.glb') {
          try {
            const model = await readFile(path.join(modelDirectory, 'gojo.glb'));
            response.setHeader('Content-Type', 'model/gltf-binary');
            response.setHeader('Content-Length', model.length);
            response.end(model);
          } catch {
            response.statusCode = 404;
            response.end('GLB not exported yet');
          }
          return;
        }
        if (!['/__export', '/__evidence', '/__validation'].includes(request.url)) return next();
        if (request.method !== 'POST') {
          response.statusCode = 405;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ error: 'POST required' }));
          return;
        }
        try {
          const chunks = [];
          let bytes = 0;
          for await (const chunk of request) {
            bytes += chunk.length;
            if (bytes > 24 * 1024 * 1024) throw new Error('Local payload exceeds 24 MB');
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);
          if (request.url === '/__export') {
            if (buffer.toString('ascii', 0, 4) !== 'glTF') throw new Error('Export is not a binary glTF');
            await mkdir(modelDirectory, { recursive: true });
            await writeFile(path.join(modelDirectory, 'gojo.glb'), buffer);
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ file: 'model/gojo.glb', bytes, sha256: createHash('sha256').update(buffer).digest('hex') }));
            return;
          }
          const payload = JSON.parse(buffer.toString('utf8'));
          await mkdir(evidenceDirectory, { recursive: true });
          if (request.url === '/__validation') {
            await writeFile(path.join(evidenceDirectory, 'validation.json'), JSON.stringify(payload, null, 2));
            response.end(JSON.stringify({ file: 'evidence/validation.json', bytes: buffer.length }));
            return;
          }
          if (!/^[a-z0-9-]+\.png$/.test(payload.name)) throw new Error('Invalid evidence filename');
          if (typeof payload.data !== 'string' || !payload.data.startsWith('data:image/png;base64,')) throw new Error('PNG data URL required');
          const png = Buffer.from(payload.data.slice('data:image/png;base64,'.length), 'base64');
          if (png.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Evidence is not a PNG');
          await writeFile(path.join(evidenceDirectory, payload.name), png);
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ file: `evidence/${payload.name}`, bytes: png.length }));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ error: error.message }));
        }
      });
    },
  }],
};
