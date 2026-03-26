'use strict';

const express  = require('express');
const initSqlJs = require('sql.js');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');

const app = express();

// ── Middleware ────────────────────────────────────────────────────────
app.use(cors());
// JSON parser excludes /api/image (binary stream)
app.use((req, res, next) => {
  if (req.path === '/api/image') return next();
  express.json({ limit: '10mb' })(req, res, next);
});
app.use(express.static(path.join(__dirname, 'public')));

// ── Paths & Files ─────────────────────────────────────────────────────
const PIC_DIR    = path.join(__dirname, 'pic');
const SENSOR_LOG = path.join(__dirname, 'sensor.log');
const EVENT_LOG  = path.join(__dirname, 'event.log');
const DEBUG_LOG  = path.join(__dirname, 'debug.log');

if (!fs.existsSync(PIC_DIR)) fs.mkdirSync(PIC_DIR, { recursive: true });

// ── Database ──────────────────────────────────────────────────────────
let db = null;
const DB_PATH = path.join(__dirname, 'sensor.db');

// Helper: Save database to disk
function saveDatabase() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(DB_PATH, data);
  }
}

// Helper: Execute query and return results
function dbAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: Execute insert/update and return lastID
function dbRun(sql, params = []) {
  db.run(sql, params);
  saveDatabase();
  const result = dbAll('SELECT last_insert_rowid() as lastID');
  return result[0].lastID;
}

// Initialize database
async function initDatabase() {
  const SQL = await initSqlJs();
  
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log('Database loaded: sensor.db');
  } else {
    db = new SQL.Database();
    console.log('Database created: sensor.db');
  }

  // Create tables
  db.run(`CREATE TABLE IF NOT EXISTS sensor_data (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp    TEXT    NOT NULL,
    temperature  REAL,
    humidity     REAL,
    soil_moisture REAL,
    pressure     REAL,
    light        REAL,
    received_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT    NOT NULL,
    event       TEXT    NOT NULL,
    detail      TEXT,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS debug_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT    NOT NULL,
    level       TEXT    NOT NULL DEFAULT 'INFO',
    message     TEXT    NOT NULL,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  saveDatabase();
}

// ── SSE Clients ───────────────────────────────────────────────────────
const sseClients = new Set();

// Heartbeat tracking
let lastHeartbeatTime = null;
let nextHeartbeatTime = null;
let heartbeatInterval = 60;

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => {
    try { res.write(payload); } catch (_) { sseClients.delete(res); }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────
function normalizeTimestamp(ts) {
  if (!ts) return new Date().toISOString();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function appendLog(filePath, line) {
  fs.appendFile(filePath, line + '\n', err => {
    if (err) console.error(`Log write error [${filePath}]:`, err.message);
  });
}

function sendError(res, status, message) {
  return res.status(status).json({ status: 'error', message });
}

// ── SSE Stream ─────────────────────────────────────────────────────────
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');
  sseClients.add(res);
  console.log(`SSE client connected (total: ${sseClients.size})`);
  req.on('close', () => {
    sseClients.delete(res);
    console.log(`SSE client disconnected (total: ${sseClients.size})`);
  });
});

// ── POST /api/image ────────────────────────────────────────────────────
// ESP32-CAM sends raw JPEG binary in the request body.
// Optional query param: ?timestamp=<ISO8601>
// Optional header:      X-Timestamp: <ISO8601>
app.post('/api/image', (req, res) => {
  const ts       = normalizeTimestamp(req.query.timestamp || req.headers['x-timestamp']);
  const filename = ts.replace(/[:.]/g, '-') + '.jpg';
  const filepath = path.join(PIC_DIR, filename);
  const writer   = fs.createWriteStream(filepath);

  req.pipe(writer);

  writer.on('finish', () => {
    console.log(`Image saved: ${filename}`);
    broadcast('image', { filename, timestamp: ts });
    res.json({ status: 'ok', file: filename, timestamp: ts });
  });

  writer.on('error', err => {
    console.error('Image save error:', err.message);
    sendError(res, 500, err.message);
  });

  req.on('error', err => {
    console.error('Image request error:', err.message);
    writer.destroy();
  });
});

// ── GET /api/images ────────────────────────────────────────────────────
// Query params: limit (default 100), offset (default 0)
app.get('/api/images', (req, res) => {
  const limit  = Math.max(1, Math.min(parseInt(req.query.limit)  || 100, 500));
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  try {
    const files = fs.readdirSync(PIC_DIR)
      .filter(f => /\.(jpg|jpeg|png|bmp)$/i.test(f))
      .sort((a, b) => b.localeCompare(a));
    res.json({ total: files.length, files: files.slice(offset, offset + limit) });
  } catch (err) {
    sendError(res, 500, err.message);
  }
});

// Static image access
app.use('/pic', express.static(PIC_DIR));

// ── POST /api/heartbeat ────────────────────────────────────────────────
// ESP32 sends heartbeat with interval and next expected time
app.post('/api/heartbeat', (req, res) => {
  const ts = normalizeTimestamp(req.body?.timestamp || req.query.timestamp || req.headers['x-timestamp']);
  const interval = req.body?.interval || req.query.interval || 60;
  const nextTime = req.body?.nextHeartbeat || req.query.nextHeartbeat;
  
  lastHeartbeatTime = Date.now();
  heartbeatInterval = parseInt(interval) || 60;
  
  // 计算下一次预期心跳时间
  if (nextTime) {
    nextHeartbeatTime = new Date(nextTime).getTime();
  } else {
    nextHeartbeatTime = lastHeartbeatTime + (heartbeatInterval * 1000);
  }
  
  console.log(`[${ts}] Heartbeat received, interval=${heartbeatInterval}s, next=${new Date(nextHeartbeatTime).toISOString()}`);
  
  broadcast('heartbeat', { 
    timestamp: ts, 
    interval: heartbeatInterval,
    nextHeartbeat: new Date(nextHeartbeatTime).toISOString(),
    serverTime: new Date().toISOString() 
  });
  
  res.json({ 
    status: 'ok', 
    timestamp: ts, 
    interval: heartbeatInterval,
    nextHeartbeat: new Date(nextHeartbeatTime).toISOString(),
    serverTime: new Date().toISOString() 
  });
});

// ── GET /api/heartbeat ─────────────────────────────────────────────────
// Get last heartbeat status
app.get('/api/heartbeat', (req, res) => {
  if (!lastHeartbeatTime) {
    return res.json({ 
      status: 'no_heartbeat', 
      lastHeartbeat: null,
      nextHeartbeat: null,
      interval: null,
      elapsedSeconds: null,
      isOnline: false
    });
  }

  const elapsed = Math.floor((Date.now() - lastHeartbeatTime) / 1000);
  const nextElapsed = nextHeartbeatTime ? Math.floor((Date.now() - nextHeartbeatTime) / 1000) : null;
  
  res.json({
    status: 'ok',
    lastHeartbeat: new Date(lastHeartbeatTime).toISOString(),
    nextHeartbeat: nextHeartbeatTime ? new Date(nextHeartbeatTime).toISOString() : null,
    interval: heartbeatInterval,
    elapsedSeconds: elapsed,
    nextElapsedSeconds: nextElapsed,
    isOnline: nextElapsed !== null ? nextElapsed <= 15 : elapsed <= heartbeatInterval
  });
});

// ── POST /api/data ─────────────────────────────────────────────────────
// Body (JSON): { timestamp, temperature, humidity, soil_moisture, pressure, light }
// At least one numeric sensor field is required.
app.post('/api/data', (req, res) => {
  const { timestamp, temperature, humidity, soil_moisture, pressure, light } = req.body || {};
  const ts  = normalizeTimestamp(timestamp);
  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);

  const T  = num(temperature);
  const H  = num(humidity);
  const SM = num(soil_moisture);
  const P  = num(pressure);
  const L  = num(light);

  if ([T, H, SM, P, L].every(v => v === null)) {
    return sendError(res, 400, 'At least one numeric sensor field is required');
  }

  try {
    const id = dbRun(
      `INSERT INTO sensor_data (timestamp, temperature, humidity, soil_moisture, pressure, light)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ts, T, H, SM, P, L]
    );

    const record = { id, timestamp: ts, temperature: T, humidity: H, soil_moisture: SM, pressure: P, light: L };
    const logLine = `[${ts}] T=${T ?? 'N/A'} H=${H ?? 'N/A'} SM=${SM ?? 'N/A'} P=${P ?? 'N/A'} L=${L ?? 'N/A'}`;
    appendLog(SENSOR_LOG, logLine);
    broadcast('data', record);
    res.json({ status: 'ok', id, timestamp: ts });
  } catch (err) {
    return sendError(res, 500, err.message);
  }
});

// ── GET /api/data ──────────────────────────────────────────────────────
// Query params: limit (default 200, max 1000), start (ISO), end (ISO)
app.get('/api/data', (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 200, 1000));
  const conditions = [];
  const params     = [];
  if (req.query.start) { conditions.push('timestamp >= ?'); params.push(req.query.start); }
  if (req.query.end)   { conditions.push('timestamp <= ?'); params.push(req.query.end);   }

  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  params.push(limit);

  try {
    const rows = dbAll(`SELECT * FROM sensor_data${where} ORDER BY timestamp DESC LIMIT ?`, params);
    res.json(rows);
  } catch (err) {
    return sendError(res, 500, err.message);
  }
});

// ── POST /api/event ────────────────────────────────────────────────────
// Body (JSON): { timestamp, event, detail }
// event examples: "watering_start", "watering_stop", "refill_water"
app.post('/api/event', (req, res) => {
  const { timestamp, event, detail } = req.body || {};
  if (!event || typeof event !== 'string') {
    return sendError(res, 400, '"event" string field is required');
  }
  const ts = normalizeTimestamp(timestamp);
  const dt = (detail || '').toString().trim();

  try {
    const id = dbRun(
      'INSERT INTO events (timestamp, event, detail) VALUES (?, ?, ?)',
      [ts, event.trim(), dt]
    );
    const record = { id, timestamp: ts, event: event.trim(), detail: dt };
    appendLog(EVENT_LOG, `[${ts}] ${event}: ${dt}`);
    broadcast('event', record);
    res.json({ status: 'ok', id, timestamp: ts });
  } catch (err) {
    return sendError(res, 500, err.message);
  }
});

// ── GET /api/events ────────────────────────────────────────────────────
// Query params: limit (default 100, max 500)
app.get('/api/events', (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 100, 500));
  try {
    const rows = dbAll('SELECT * FROM events ORDER BY timestamp DESC LIMIT ?', [limit]);
    res.json(rows);
  } catch (err) {
    return sendError(res, 500, err.message);
  }
});

// ── POST /api/log ──────────────────────────────────────────────────────
// Body (JSON): { timestamp, level, message }
// level: "DEBUG" | "INFO" | "WARN" | "ERROR"  (default: "INFO")
app.post('/api/log', (req, res) => {
  const { timestamp, level, message } = req.body || {};
  if (!message || typeof message !== 'string') {
    return sendError(res, 400, '"message" string field is required');
  }
  const ts  = normalizeTimestamp(timestamp);
  const lvl = ['DEBUG', 'INFO', 'WARN', 'ERROR'].includes((level || '').toUpperCase())
    ? level.toUpperCase()
    : 'INFO';

  try {
    const id = dbRun(
      'INSERT INTO debug_logs (timestamp, level, message) VALUES (?, ?, ?)',
      [ts, lvl, message]
    );
    const record = { id, timestamp: ts, level: lvl, message };
    appendLog(DEBUG_LOG, `[${ts}] [${lvl}] ${message}`);
    broadcast('log', record);
    res.json({ status: 'ok', id, timestamp: ts });
  } catch (err) {
    return sendError(res, 500, err.message);
  }
});

// ── GET /api/logs ──────────────────────────────────────────────────────
// Query params: limit (default 300, max 1000), level
app.get('/api/logs', (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 300, 1000));
  const conditions = [];
  const params     = [];
  if (req.query.level) { conditions.push('level = ?'); params.push(req.query.level.toUpperCase()); }
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';
  params.push(limit);

  try {
    const rows = dbAll(`SELECT * FROM debug_logs${where} ORDER BY timestamp DESC LIMIT ?`, params);
    res.json(rows);
  } catch (err) {
    return sendError(res, 500, err.message);
  }
});

// ── GET /api/status ────────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const picCount = fs.existsSync(PIC_DIR)
    ? fs.readdirSync(PIC_DIR).filter(f => /\.(jpg|jpeg|png)$/i.test(f)).length
    : 0;
  res.json({
    status:      'ok',
    uptime:      process.uptime(),
    sseClients:  sseClients.size,
    picCount,
    serverTime:  new Date().toISOString()
  });
});

// ── 404 & Error Handlers ───────────────────────────────────────────────
app.use((req, res) => sendError(res, 404, `Route not found: ${req.method} ${req.path}`));

app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  sendError(res, 500, 'Internal server error');
});

// ── Start ──────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT) || 3000;

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🌱 Hyacinth Farm Server running on http://localhost:${PORT}`);
    console.log(`   Dashboard  → http://localhost:${PORT}`);
    console.log(`   API Status → http://localhost:${PORT}/api/status\n`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

process.on('SIGINT',  () => { saveDatabase(); process.exit(0); });
process.on('SIGTERM', () => { saveDatabase(); process.exit(0); });
