import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

/**
 * De brondata staat in ./data (gemaakt door `npm run data`).
 * - Tijdens `npm run dev` wordt /data/* direct uit die map geserveerd.
 * - Bij `npm run build` wordt de map (zonder data/raw) naar dist/data gekopieerd,
 *   zodat de statische build offline werkt voor collega's.
 */
function dataFolder(): Plugin {
  const dataDir = path.resolve(import.meta.dirname, 'data');
  return {
    name: 'bouwplaats-data',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = path.join(dataDir, rel);
        if (!file.startsWith(dataDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
        const ext = path.extname(file).toLowerCase();
        const types: Record<string, string> = {
          '.json': 'application/json', '.geojson': 'application/geo+json', '.jpg': 'image/jpeg',
          '.png': 'image/png', '.bin': 'application/octet-stream', '.f32': 'application/octet-stream',
        };
        res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      if (!fs.existsSync(dataDir)) return;
      const out = path.resolve(import.meta.dirname, 'dist/data');
      fs.cpSync(dataDir, out, { recursive: true, filter: (src) => !src.includes(`${path.sep}raw`) });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [dataFolder()],
  build: { chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
