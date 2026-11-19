import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { attachRaceRoomServer } from './server/raceRoomServer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DIST_DIR = path.resolve(__dirname, 'dist');
const CIRCUITS_DIR = path.resolve(__dirname, 'circuits');
const MAPS_DIR = path.resolve(__dirname, 'public', 'maps');
const DIST_MAPS_DIR = path.resolve(DIST_DIR, 'maps');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const urlStr = req.url || '/';
  let pathname = '/';
  try {
    pathname = new URL(urlStr, 'http://localhost').pathname;
  } catch {
    res.statusCode = 400;
    res.end('Bad Request');
    return;
  }

  // CORS headers for ArcadeHub integration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  // 1. GET /api/circuits
  if (req.method === 'GET' && pathname === '/api/circuits') {
    try {
      if (!fs.existsSync(CIRCUITS_DIR)) fs.mkdirSync(CIRCUITS_DIR, { recursive: true });
      const files = fs.readdirSync(CIRCUITS_DIR).filter((f) => f.endsWith('.json'));
      const circuits = files
        .map((file) => {
          try {
            const raw = fs.readFileSync(path.join(CIRCUITS_DIR, file), 'utf8');
            const parsed = JSON.parse(raw);
            parsed.fileName = file;
            return parsed;
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      circuits.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      sendJson(res, 200, circuits);
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // 2. POST /api/circuits
  if (req.method === 'POST' && pathname === '/api/circuits') {
    try {
      const body = await readBody(req);
      const circuit = JSON.parse(body);
      if (!fs.existsSync(CIRCUITS_DIR)) fs.mkdirSync(CIRCUITS_DIR, { recursive: true });

      const safeName = (circuit.name || 'circuito')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9_-]/g, '_')
        .replace(/_+/g, '_');

      const filename = safeName + '.json';
      const filePath = path.join(CIRCUITS_DIR, filename);

      if (!circuit.id) circuit.id = 'circuit_' + Date.now();
      circuit.fileName = filename;
      circuit.savedAt = Date.now();

      fs.writeFileSync(filePath, JSON.stringify(circuit, null, 2), 'utf8');
      sendJson(res, 200, {
        success: true,
        circuit,
        filename,
        path: 'circuits/' + filename,
      });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // 3. DELETE /api/circuits/:id
  if (req.method === 'DELETE' && pathname.startsWith('/api/circuits/')) {
    const id = decodeURIComponent(pathname.replace('/api/circuits/', '').trim());
    let deleted = false;
    if (fs.existsSync(CIRCUITS_DIR)) {
      const files = fs.readdirSync(CIRCUITS_DIR).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        const fullPath = path.join(CIRCUITS_DIR, file);
        try {
          const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          if (
            data.id === id ||
            file === `${id}.json` ||
            file === id ||
            (data.name && data.name.toLowerCase() === id.toLowerCase())
          ) {
            fs.unlinkSync(fullPath);
            deleted = true;
            break;
          }
        } catch {
          // Ignore invalid JSON file
        }
      }
    }
    sendJson(res, 200, { success: deleted });
    return;
  }

  // 4. POST /api/upload-map
  if (req.method === 'POST' && pathname === '/api/upload-map') {
    try {
      const body = await readBody(req);
      const { dataUrl, fileName } = JSON.parse(body);
      if (!dataUrl) {
        sendJson(res, 400, { error: 'Missing dataUrl' });
        return;
      }
      const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        sendJson(res, 400, { error: 'Invalid dataUrl format' });
        return;
      }
      const ext = matches[1].includes('png')
        ? '.png'
        : matches[1].includes('webp')
        ? '.webp'
        : '.jpg';
      const cleanBase = (fileName || 'map')
        .replace(/\.[^/.]+$/, '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9_-]/g, '_');
      const finalFileName = 'upload_' + cleanBase + '_' + Date.now() + ext;

      if (!fs.existsSync(MAPS_DIR)) fs.mkdirSync(MAPS_DIR, { recursive: true });
      const buffer = Buffer.from(matches[2], 'base64');
      fs.writeFileSync(path.join(MAPS_DIR, finalFileName), buffer);

      if (fs.existsSync(DIST_DIR)) {
        if (!fs.existsSync(DIST_MAPS_DIR)) fs.mkdirSync(DIST_MAPS_DIR, { recursive: true });
        fs.writeFileSync(path.join(DIST_MAPS_DIR, finalFileName), buffer);
      }

      sendJson(res, 200, { success: true, url: '/maps/' + finalFileName });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // 5. Serve static files from dist/ (and fallback to public/maps/ if needed)
  if (req.method === 'GET' || req.method === 'HEAD') {
    const safeRel = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    const relPath = safeRel === '/' || safeRel === '\\' ? 'index.html' : safeRel.replace(/^[/\\]+/, '');
    const distTarget = path.resolve(DIST_DIR, relPath);

    if (distTarget.startsWith(DIST_DIR) && fs.existsSync(distTarget) && fs.statSync(distTarget).isFile()) {
      serveFile(res, distTarget);
      return;
    }

    if (pathname.startsWith('/maps/')) {
      const mapName = path.basename(pathname);
      const mapTarget = path.resolve(MAPS_DIR, mapName);
      if (mapTarget.startsWith(MAPS_DIR) && fs.existsSync(mapTarget) && fs.statSync(mapTarget).isFile()) {
        serveFile(res, mapTarget);
        return;
      }
    }

    const indexHtml = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexHtml)) {
      serveFile(res, indexHtml);
      return;
    }
  }

  res.statusCode = 404;
  res.end('Not found. Run "npm run build" first.');
});

attachRaceRoomServer(server, { circuitsDir: CIRCUITS_DIR });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`MiniRace 3D server listening on http://0.0.0.0:${PORT}`);
});
