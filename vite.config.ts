import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { attachRaceRoomServer } from './server/raceRoomServer.mjs';

function circuitsApiPlugin(): Plugin {
  return {
    name: 'circuits-api',
    configureServer(server) {
      if (server.httpServer) {
        attachRaceRoomServer(server.httpServer, {
          circuitsDir: path.resolve(process.cwd(), 'circuits'),
        });
      }
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';

        // 1. GET /api/circuits
        if (req.method === 'GET' && (url === '/api/circuits' || url.startsWith('/api/circuits?'))) {
          const circuitsDir = path.resolve(process.cwd(), 'circuits');
          if (!fs.existsSync(circuitsDir)) fs.mkdirSync(circuitsDir, { recursive: true });

          try {
            const files = fs.readdirSync(circuitsDir).filter(f => f.endsWith('.json'));
            const circuits = files.map(file => {
              try {
                const raw = fs.readFileSync(path.join(circuitsDir, file), 'utf8');
                const parsed = JSON.parse(raw);
                parsed.fileName = file;
                return parsed;
              } catch (e) {
                return null;
              }
            }).filter(Boolean);

            circuits.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));

            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(JSON.stringify(circuits));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
          }
          return;
        }

        // 2. POST /api/circuits
        if (req.method === 'POST' && url === '/api/circuits') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const circuit = JSON.parse(body);
              const circuitsDir = path.resolve(process.cwd(), 'circuits');
              if (!fs.existsSync(circuitsDir)) fs.mkdirSync(circuitsDir, { recursive: true });

              const safeName = (circuit.name || 'circuito')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9_-]/g, '_')
                .replace(/_+/g, '_');

              const filename = safeName + '.json';
              const filePath = path.join(circuitsDir, filename);

              if (!circuit.id) circuit.id = 'circuit_' + Date.now();
              circuit.fileName = filename;
              circuit.savedAt = Date.now();

              fs.writeFileSync(filePath, JSON.stringify(circuit, null, 2), 'utf8');

              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({ success: true, circuit, filename, path: 'circuits/' + filename }));
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(err) }));
            }
          });
          return;
        }

        // 3. DELETE /api/circuits/:id
        if (req.method === 'DELETE' && url.startsWith('/api/circuits/')) {
          const id = decodeURIComponent(url.replace('/api/circuits/', '').trim());
          const circuitsDir = path.resolve(process.cwd(), 'circuits');
          let deleted = false;
          if (fs.existsSync(circuitsDir)) {
            const files = fs.readdirSync(circuitsDir).filter(f => f.endsWith('.json'));
            for (const file of files) {
              const fullPath = path.join(circuitsDir, file);
              try {
                const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                if (data.id === id || file === (id + '.json') || file === id || (data.name && data.name.toLowerCase() === id.toLowerCase())) {
                  fs.unlinkSync(fullPath);
                  deleted = true;
                  break;
                }
              } catch {}
            }
          }
          res.setHeader('Content-Type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify({ success: deleted }));
          return;
        }

        // 4. POST /api/upload-map
        if (req.method === 'POST' && url === '/api/upload-map') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const { dataUrl, fileName } = JSON.parse(body);
              if (!dataUrl) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Missing dataUrl' }));
                return;
              }
              const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
              if (!matches || matches.length !== 3) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Invalid dataUrl format' }));
                return;
              }
              const mimeType = matches[1].toLowerCase();
              const ext = mimeType.includes('svg')
                ? '.svg'
                : mimeType.includes('png')
                ? '.png'
                : mimeType.includes('webp')
                ? '.webp'
                : mimeType.includes('avif')
                ? '.avif'
                : mimeType.includes('gif')
                ? '.gif'
                : mimeType.includes('bmp')
                ? '.bmp'
                : '.jpg';
              const cleanBase = (fileName || 'map')
                .replace(/\.[^/.]+$/, '')
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9_-]/g, '_');
              const finalFileName = 'upload_' + cleanBase + '_' + Date.now() + ext;
              const mapsDir = path.resolve(process.cwd(), 'public', 'maps');
              if (!fs.existsSync(mapsDir)) fs.mkdirSync(mapsDir, { recursive: true });

              const buffer = Buffer.from(matches[2], 'base64');
              fs.writeFileSync(path.join(mapsDir, finalFileName), buffer);

              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(JSON.stringify({ success: true, url: '/maps/' + finalFileName }));
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(err) }));
            }
          });
          return;
        }

        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), circuitsApiPlugin()],
  server: {
    port: 5173,
    host: true
  }
});