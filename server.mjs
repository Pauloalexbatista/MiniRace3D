import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { attachRaceRoomServer } from './server/raceRoomServer.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DIST_DIR = path.resolve(__dirname, 'dist');
const SEED_CIRCUITS_DIR = path.resolve(__dirname, 'circuits');
const SEED_MAPS_DIR = path.resolve(__dirname, 'public', 'maps');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, 'data');
const CIRCUITS_DIR = path.join(DATA_DIR, 'circuits');
const UPLOADED_MAPS_DIR = path.join(DATA_DIR, 'maps');
const SEED_MANIFEST_PATH = path.join(DATA_DIR, '.seeded_circuits.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function isValidCircuitData(data) {
  return Boolean(data && Array.isArray(data.controlPoints) && data.controlPoints.length >= 2);
}

function listValidCircuits(dir) {
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

function saveCircuitToDisk(circuitsDir, circuit, { preserveSavedAt = false } = {}) {
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

function initPersistentStorage() {
  fs.mkdirSync(CIRCUITS_DIR, { recursive: true });
  fs.mkdirSync(UPLOADED_MAPS_DIR, { recursive: true });

  let seededList = [];
  if (fs.existsSync(SEED_MANIFEST_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(SEED_MANIFEST_PATH, 'utf8'));
      if (Array.isArray(parsed)) {
        seededList = parsed.filter((item) => typeof item === 'string');
      }
    } catch {
      seededList = [];
    }
  }
  const seededSet = new Set(seededList);
  let manifestChanged = false;

  if (fs.existsSync(SEED_CIRCUITS_DIR)) {
    const seedFiles = fs
      .readdirSync(SEED_CIRCUITS_DIR)
      .filter((f) => f.endsWith('.json') && !f.startsWith('.'));
    for (const file of seedFiles) {
      try {
        const raw = fs.readFileSync(path.join(SEED_CIRCUITS_DIR, file), 'utf8');
        const parsed = JSON.parse(raw);
        if (!isValidCircuitData(parsed)) continue;
        if (!seededSet.has(file)) {
          const targetPath = path.join(CIRCUITS_DIR, file);
          if (!fs.existsSync(targetPath)) {
            fs.writeFileSync(targetPath, raw, 'utf8');
          }
          seededSet.add(file);
          manifestChanged = true;
        }
      } catch {
        // Ignore malformed seed file
      }
    }
  }

  if (manifestChanged || !fs.existsSync(SEED_MANIFEST_PATH)) {
    try {
      fs.writeFileSync(
        SEED_MANIFEST_PATH,
        JSON.stringify(Array.from(seededSet).sort(), null, 2),
        'utf8'
      );
    } catch {}
  }

  const validCount = listValidCircuits(CIRCUITS_DIR).length;
  const mapsCount = fs
    .readdirSync(UPLOADED_MAPS_DIR)
    .filter((f) => !f.startsWith('.')).length;
  console.log(
    `[Storage] DATA_DIR=${DATA_DIR} | circuits=${validCount} | uploadedMaps=${mapsCount}`
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(extraHeaders)) {
    res.setHeader(k, v);
  }
  res.end(JSON.stringify(payload));
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
}

initPersistentStorage();

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
      const circuits = listValidCircuits(CIRCUITS_DIR);
      sendJson(res, 200, circuits);
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // 1b. GET /api/circuits/export-all
  if (req.method === 'GET' && pathname === '/api/circuits/export-all') {
    try {
      const circuits = listValidCircuits(CIRCUITS_DIR);
      const dateStr = new Date().toISOString().slice(0, 10);
      sendJson(
        res,
        200,
        {
          version: 1,
          exportedAt: Date.now(),
          circuits,
        },
        {
          'Content-Disposition': `attachment; filename="minirace3d_circuits_backup_${dateStr}.json"`,
        }
      );
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // 1c. GET /api/storage-status
  if (req.method === 'GET' && pathname === '/api/storage-status') {
    try {
      const circuitsCount = listValidCircuits(CIRCUITS_DIR).length;
      const uploadedMapsCount = fs.existsSync(UPLOADED_MAPS_DIR)
        ? fs.readdirSync(UPLOADED_MAPS_DIR).filter((f) => !f.startsWith('.')).length
        : 0;
      sendJson(res, 200, {
        dataDir: DATA_DIR,
        circuitsDir: CIRCUITS_DIR,
        uploadedMapsDir: UPLOADED_MAPS_DIR,
        circuitsCount,
        uploadedMapsCount,
      });
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
      if (!isValidCircuitData(circuit)) {
        sendJson(res, 400, { error: 'O circuito está vazio (mínimo 2 pontos).' });
        return;
      }
      const saved = saveCircuitToDisk(CIRCUITS_DIR, circuit, { preserveSavedAt: false });
      sendJson(res, 200, {
        success: true,
        circuit: saved.circuit,
        filename: saved.filename,
        path: 'circuits/' + saved.filename,
      });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // 2b. POST /api/circuits/bulk
  if (req.method === 'POST' && pathname === '/api/circuits/bulk') {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body);
      const items = Array.isArray(parsed) ? parsed : parsed?.circuits;
      if (!Array.isArray(items)) {
        sendJson(res, 400, { error: 'Formato inválido: esperado array de circuitos.' });
        return;
      }

      const savedList = [];
      let skippedCount = 0;
      for (const item of items) {
        if (!isValidCircuitData(item)) {
          skippedCount++;
          continue;
        }
        const saved = saveCircuitToDisk(CIRCUITS_DIR, item, { preserveSavedAt: true });
        savedList.push(saved.circuit);
      }

      sendJson(res, 200, {
        success: true,
        savedCount: savedList.length,
        skippedCount,
        circuits: savedList,
      });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // 3. DELETE /api/circuits/:id
  if (req.method === 'DELETE' && pathname.startsWith('/api/circuits/')) {
    let id = '';
    try {
      id = decodeURIComponent(pathname.replace('/api/circuits/', '').trim());
    } catch {
      sendJson(res, 400, { error: 'Invalid circuit identifier' });
      return;
    }
    let deleted = false;
    if (fs.existsSync(CIRCUITS_DIR)) {
      const files = fs
        .readdirSync(CIRCUITS_DIR)
        .filter((f) => f.endsWith('.json') && !f.startsWith('.'));
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
      const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches || matches.length !== 3) {
        sendJson(res, 400, { error: 'Invalid dataUrl format' });
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

      if (!fs.existsSync(UPLOADED_MAPS_DIR)) fs.mkdirSync(UPLOADED_MAPS_DIR, { recursive: true });
      const buffer = Buffer.from(matches[2], 'base64');
      fs.writeFileSync(path.join(UPLOADED_MAPS_DIR, finalFileName), buffer);

      sendJson(res, 200, { success: true, url: '/maps/' + finalFileName });
    } catch (err) {
      sendJson(res, 500, { error: String(err) });
    }
    return;
  }

  // 5. Serve static files from persistent uploaded maps, dist/, and public/maps/
  if (req.method === 'GET' || req.method === 'HEAD') {
    let decodedPathname = pathname;
    try {
      decodedPathname = decodeURIComponent(pathname);
    } catch {
      res.statusCode = 400;
      res.end('Bad Request');
      return;
    }

    if (decodedPathname.startsWith('/maps/')) {
      const mapName = path.basename(decodedPathname);
      const uploadedTarget = path.resolve(UPLOADED_MAPS_DIR, mapName);
      if (
        uploadedTarget.startsWith(UPLOADED_MAPS_DIR + path.sep) &&
        fs.existsSync(uploadedTarget) &&
        fs.statSync(uploadedTarget).isFile()
      ) {
        serveFile(res, uploadedTarget);
        return;
      }
    }

    const safeRel = path.normalize(decodedPathname).replace(/^(\.\.[/\\])+/, '');
    const relPath = safeRel === '/' || safeRel === '\\' ? 'index.html' : safeRel.replace(/^[/\\]+/, '');
    const distTarget = path.resolve(DIST_DIR, relPath);

    if (distTarget.startsWith(DIST_DIR) && fs.existsSync(distTarget) && fs.statSync(distTarget).isFile()) {
      serveFile(res, distTarget);
      return;
    }

    if (decodedPathname.startsWith('/maps/')) {
      const mapName = path.basename(decodedPathname);
      const seedMapTarget = path.resolve(SEED_MAPS_DIR, mapName);
      if (
        seedMapTarget.startsWith(SEED_MAPS_DIR + path.sep) &&
        fs.existsSync(seedMapTarget) &&
        fs.statSync(seedMapTarget).isFile()
      ) {
        serveFile(res, seedMapTarget);
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
