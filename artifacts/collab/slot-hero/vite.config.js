import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
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
    port: 5199,
    strictPort: true,
    fs: { allow: [here, dependencies] },
  },
  plugins: [{
    name: 'slot-hero-local-glb-export',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url === '/__evidence') {
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
              if (bytes > 16 * 1024 * 1024) throw new Error('Evidence exceeds 16 MB local limit');
              chunks.push(chunk);
            }
            const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!/^[a-z0-9-]+\.png$/.test(payload.name)) throw new Error('Invalid evidence filename');
            if (typeof payload.data !== 'string' || !payload.data.startsWith('data:image/png;base64,')) throw new Error('PNG data URL required');
            const buffer = Buffer.from(payload.data.slice('data:image/png;base64,'.length), 'base64');
            if (buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('Evidence is not a PNG');
            await mkdir(evidenceDirectory, { recursive: true });
            await writeFile(path.join(evidenceDirectory, payload.name), buffer);
            response.statusCode = 200;
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ file: `evidence/${payload.name}`, bytes: buffer.length }));
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
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ error: 'POST required' }));
          return;
        }
        try {
          const chunks = [];
          let bytes = 0;
          for await (const chunk of request) {
            bytes += chunk.length;
            if (bytes > 24 * 1024 * 1024) throw new Error('GLB exceeds 24 MB local export limit');
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);
          if (buffer.toString('ascii', 0, 4) !== 'glTF') throw new Error('Export is not a binary glTF');
          await mkdir(modelDirectory, { recursive: true });
          const file = path.join(modelDirectory, 'slot-hero.glb');
          await writeFile(file, buffer);
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ file: 'model/slot-hero.glb', bytes, sha256: createHash('sha256').update(buffer).digest('hex') }));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ error: error.message }));
        }
      });
    },
  }],
};
