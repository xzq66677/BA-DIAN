import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dependencies = 'D:/AI工作区/badian-game/node_modules';
const modelDirectory = path.join(here, 'model');

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
    port: 5211,
    strictPort: true,
    fs: { allow: [here, dependencies] },
  },
  plugins: [{
    name: 'ivan-girl-local-glb-export',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
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
          const file = path.join(modelDirectory, 'ivan-girl.glb');
          await writeFile(file, buffer);
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ file: 'model/ivan-girl.glb', bytes, sha256: createHash('sha256').update(buffer).digest('hex') }));
        } catch (error) {
          response.statusCode = 500;
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ error: error.message }));
        }
      });
    },
  }],
};
