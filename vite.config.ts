import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { attachRaceRoomServer } from './server/raceRoomServer.mjs';

function isValidCircuitData(data: any): boolean {
  return Boolean(data && Array.isArray(data.controlPoints) && data.controlPoints.length >= 2);
}

function listValidCircuits(dir: string): any[] {
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('.'));
  const circuits = files
    .map((file) => {
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf8');
        const parsed = JSON.parse(raw);
        if (!isValidCircuitData(parsed)) return null;
        parsed.fileName = file;
        return parsed;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  circuits.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  return circuits;
}

function saveCircuitToDisk(
  circuitsDir: string,
  circuit: any,
  { preserveSavedAt = false }: { preserveSavedAt?: boolean } = {}
) {
  if (!isValidCircuitData(circuit)) {
    throw new Error('O circuito está vazio (mínimo 2 pontos).');
  }
  if (!fs.existsSync(circuitsDir)) fs.mkdirSync(circuitsDir, { recursive: true });

  const safeName =
    (circuit.name || 'circuito')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_-]/g, '_')
      .replace(/_+/g, '_') || 'circuito';

  const filename = safeName + '.json';
  const filePath = path.join(circuitsDir, filename);

  const savedAt =
    preserveSavedAt && Number.isFinite(Number(circuit.savedAt))
      ? Number(circuit.savedAt)
      : Date.now();

  const nextCircuit = {
    ...circuit,
    id: circuit.id || 'circuit_' + Date.now(),
    fileName: filename,
    savedAt,
  };
  const nextRaw = JSON.stringify(nextCircuit, null, 2);

  if (fs.existsSync(filePath)) {
    try {
      const existingRaw = fs.readFileSync(filePath, 'utf8');
      const existingParsed = JSON.parse(existingRaw);
      if (isValidCircuitData(existingParsed) && existingRaw !== nextRaw) {
        const backupsDir = path.join(circuitsDir, '.backups');
        if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
        const backupName = `${safeName}_${Date.now()}.json`;
        fs.writeFileSync(path.join(backupsDir, backupName), existingRaw, 'utf8');
        const prefix = `${safeName}_`;
        const matching = fs
          .readdirSync(backupsDir)
          .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
          .sort();
        if (matching.length > 5) {
          for (const oldFile of matching.slice(0, matching.length - 5)) {
            try {
              fs.unlinkSync(path.join(backupsDir, oldFile));
            } catch {}
          }
        }
      }
    } catch {}
  }

  fs.writeFileSync(filePath, nextRaw, 'utf8');
  return { circuit: nextCircuit, filename };
}

function circuitsApiPlugin(): Plugin {
  return {
    name: 'circuits-api',
    configureServer(server) {
      const circuitsDir = path.resolve(process.cwd(), 'circuits');
      if (server.httpServer) {
        attachRaceRoomServer(server.httpServer, {
          circuitsDir,
        });
      }
      server.middlewares.use((req, res, next) => {
        const url = req.url || '';
        const pathname = url.split('?')[0];

        // 1. GET /api/circuits
        if (req.method === 'GET' && pathname === '/api/circuits') {
          if (!fs.existsSync(circuitsDir)) fs.mkdirSync(circuitsDir, { recursive: true });
          try {
            const circuits = listValidCircuits(circuitsDir);
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = 200;
            res.end(JSON.stringify(circuits));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
          }
          return;
        }

        // 1b. GET /api/circuits/export-all
        if (req.method === 'GET' && pathname === '/api/circuits/export-all') {
          if (!fs.existsSync(circuitsDir)) fs.mkdirSync(circuitsDir, { recursive: true });
          try {
            const circuits = listValidCircuits(circuitsDir);
            const dateStr = new Date().toISOString().slice(0, 10);
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader(
              'Content-Disposition',
              `attachment; filename="minirace3d_circuits_backup_${dateStr}.json"`
            );
            res.statusCode = 200;
            res.end(
              JSON.stringify({
                version: 1,
                exportedAt: Date.now(),
                circuits,
              })
            );
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(err) }));
          }
          return;
        }

        // 2. POST /api/circuits
        if (req.method === 'POST' && pathname === '/api/circuits') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const circuit = JSON.parse(body);
              if (!isValidCircuitData(circuit)) {
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'O circuito está vazio (mínimo 2 pontos).' }));
                return;
              }
              const saved = saveCircuitToDisk(circuitsDir, circuit, { preserveSavedAt: false });
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(
                JSON.stringify({
                  success: true,
                  circuit: saved.circuit,
                  filename: saved.filename,
                  path: 'circuits/' + saved.filename,
                })
              );
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(err) }));
            }
          });
          return;
        }

        // 2b. POST /api/circuits/bulk
        if (req.method === 'POST' && pathname === '/api/circuits/bulk') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              const items = Array.isArray(parsed) ? parsed : parsed?.circuits;
              if (!Array.isArray(items)) {
                res.setHeader('Content-Type', 'application/json');
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Formato inválido: esperado array de circuitos.' }));
                return;
              }
              const savedList: any[] = [];
              let skippedCount = 0;
              for (const item of items) {
                if (!isValidCircuitData(item)) {
                  skippedCount++;
                  continue;
                }
                const saved = saveCircuitToDisk(circuitsDir, item, { preserveSavedAt: true });
                savedList.push(saved.circuit);
              }
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 200;
              res.end(
                JSON.stringify({
                  success: true,
                  savedCount: savedList.length,
                  skippedCount,
                  circuits: savedList,
                })
              );
            } catch (err) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(err) }));
            }
          });
          return;
        }

        // 3. DELETE /api/circuits/:id
        if (req.method === 'DELETE' && pathname.startsWith('/api/circuits/')) {
          const id = decodeURIComponent(pathname.replace('/api/circuits/', '').trim());
          let deleted = false;
          if (fs.existsSync(circuitsDir)) {
            const files = fs
              .readdirSync(circuitsDir)
              .filter((f) => f.endsWith('.json') && !f.startsWith('.'));
            for (const file of files) {
              const fullPath = path.join(circuitsDir, file);
              try {
                const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                if (
                  data.id === id ||
                  file === id + '.json' ||
                  file === id ||
                  (data.name && data.name.toLowerCase() === id.toLowerCase())
                ) {
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
        if (req.method === 'POST' && pathname === '/api/upload-map') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
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
    },
  };
}

export default defineConfig({
  plugins: [react(), circuitsApiPlugin()],
  server: {
    port: 5173,
    host: true,
  },
});
