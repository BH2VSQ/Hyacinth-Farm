'use strict';

const express  = require('express');
const initSqlJs = require('sql.js');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const crypto   = require('crypto');

const app = express();

// ── Configuration ─────────────────────────────────────────────────────
// 图表数据点上限配置（用于降采样）
const MAX_CHART_DATA_POINTS = 50;

// ── Session Key ───────────────────────────────────────────────────────
const SESSION_KEY_FILE = path.join(__dirname, '.session_key');
let SESSION_KEY = '';

function generateSessionKey() {
  return crypto.randomBytes(16).toString('hex'); // 32 characters
}

function loadOrCreateSessionKey() {
  if (fs.existsSync(SESSION_KEY_FILE)) {
    SESSION_KEY = fs.readFileSync(SESSION_KEY_FILE, 'utf8').trim();
    console.log('Session key loaded from file');
  } else {
    SESSION_KEY = generateSessionKey();
    fs.writeFileSync(SESSION_KEY_FILE, SESSION_KEY, 'utf8');
    console.log('New session key generated and saved');
  }
  console.log(`Session Key: ${SESSION_KEY}`);
}

// Authentication middleware
function requireAuth(req, res, next) {
  const key = req.headers['x-session-key'] || req.query.session_key;
  if (key !== SESSION_KEY) {
    return res.status(401).json({ status: 'error', message: 'Invalid or missing session key' });
  }
  next();
}

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
    soil_moisture_a REAL,
    soil_moisture_b REAL,
    light        REAL,
    temperature  REAL,
    humidity     REAL,
    pressure     REAL,
    solar_voltage REAL,
    battery_voltage REAL,
    supply_voltage REAL,
    solar_current REAL,
    battery_current REAL,
    supply_current REAL,
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
app.post('/api/image', requireAuth, (req, res) => {
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
app.post('/api/heartbeat', requireAuth, (req, res) => {
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
// Body (JSON): { timestamp, soil_moisture_a, soil_moisture_b, light, temperature, humidity, pressure, solar_voltage, battery_voltage, supply_voltage, solar_current, battery_current, supply_current }
// At least one numeric sensor field is required.
app.post('/api/data', requireAuth, (req, res) => {
  const { 
    timestamp, soil_moisture_a, soil_moisture_b, light, 
    temperature, humidity, pressure,
    solar_voltage, battery_voltage, supply_voltage,
    solar_current, battery_current, supply_current
  } = req.body || {};
  const ts  = normalizeTimestamp(timestamp);
  const num = v => (typeof v === 'number' && isFinite(v) ? v : null);

  const SMA = num(soil_moisture_a);
  const SMB = num(soil_moisture_b);
  const L   = num(light);
  const T   = num(temperature);
  const H   = num(humidity);
  const P   = num(pressure);
  const SV  = num(solar_voltage);
  const BV  = num(battery_voltage);
  const SPV = num(supply_voltage);
  const SC  = num(solar_current);
  const BC  = num(battery_current);
  const SPC = num(supply_current);

  if ([SMA, SMB, L, T, H, P, SV, BV, SPV, SC, BC, SPC].every(v => v === null)) {
    return sendError(res, 400, 'At least one numeric sensor field is required');
  }

  try {
    const id = dbRun(
      `INSERT INTO sensor_data (timestamp, soil_moisture_a, soil_moisture_b, light, temperature, humidity, pressure, solar_voltage, battery_voltage, supply_voltage, solar_current, battery_current, supply_current)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ts, SMA, SMB, L, T, H, P, SV, BV, SPV, SC, BC, SPC]
    );

    const record = { 
      id, timestamp: ts, 
      soil_moisture_a: SMA, soil_moisture_b: SMB, light: L,
      temperature: T, humidity: H, pressure: P,
      solar_voltage: SV, battery_voltage: BV, supply_voltage: SPV,
      solar_current: SC, battery_current: BC, supply_current: SPC
    };
    const logLine = `[${ts}] SMA=${SMA ?? 'N/A'} SMB=${SMB ?? 'N/A'} L=${L ?? 'N/A'} T=${T ?? 'N/A'} H=${H ?? 'N/A'} P=${P ?? 'N/A'} SV=${SV ?? 'N/A'} BV=${BV ?? 'N/A'} SPV=${SPV ?? 'N/A'} SC=${SC ?? 'N/A'} BC=${BC ?? 'N/A'} SPC=${SPC ?? 'N/A'}`;
    appendLog(SENSOR_LOG, logLine);
    broadcast('data', record);
    res.json({ status: 'ok', id, timestamp: ts });
  } catch (err) {
    return sendError(res, 500, err.message);
  }
});

// ── GET /api/data ──────────────────────────────────────────────────────
// Query params: limit (default 200, max 1000), start (ISO), end (ISO), downsample (optional)
app.get('/api/data', (req, res) => {
  const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 200, 1000));
  const downsample = parseInt(req.query.downsample) || 0; // 降采样间隔，0表示不降采样
  const conditions = [];
  const countParams = [];
  if (req.query.start) { conditions.push('timestamp >= ?'); countParams.push(req.query.start); }
  if (req.query.end)   { conditions.push('timestamp <= ?'); countParams.push(req.query.end);   }

  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '';

  console.log(`[API /api/data] limit=${limit}, downsample=${downsample}, start=${req.query.start || 'N/A'}, end=${req.query.end || 'N/A'}`);

  try {
    // 先查询总数
    const countResult = dbAll(`SELECT COUNT(*) as count FROM sensor_data${where}`, countParams);
    const totalCount = countResult[0].count;
    
    console.log(`[API /api/data] Total count: ${totalCount}`);
    
    let rows;
    if (downsample > 1 && totalCount > MAX_CHART_DATA_POINTS) {
      // 需要降采样：先获取所有数据，然后在内存中进行降采样
      console.log(`[API /api/data] Downsampling required: total=${totalCount}, rate=${downsample}, max=${MAX_CHART_DATA_POINTS}`);
      const allRows = dbAll(`SELECT * FROM sensor_data${where} ORDER BY timestamp ASC`, countParams);
      
      // 均匀采样
      rows = [];
      for (let i = 0; i < allRows.length; i += downsample) {
        rows.push(allRows[i]);
      }
      
      // 限制返回数量并倒序
      rows = rows.slice(0, MAX_CHART_DATA_POINTS).reverse();
      
      console.log(`[API /api/data] Downsampling complete: returned ${rows.length} rows`);
    } else {
      // 不降采样，直接返回
      console.log(`[API /api/data] No downsampling needed`);
      const params = [...countParams, limit];
      rows = dbAll(`SELECT * FROM sensor_data${where} ORDER BY timestamp DESC LIMIT ?`, params);
      console.log(`[API /api/data] Returned ${rows.length} rows`);
    }
    
    res.json({
      data: rows,
      total: totalCount,
      downsampled: downsample > 1 && totalCount > MAX_CHART_DATA_POINTS,
      downsampleRate: downsample,
      maxPoints: MAX_CHART_DATA_POINTS
    });
  } catch (err) {
    console.error('[API /api/data] Error:', err);
    return sendError(res, 500, err.message);
  }
});

// ── POST /api/event ────────────────────────────────────────────────────
// Body (JSON): { timestamp, event, detail }
// event examples: "watering_start", "watering_stop", "refill_water"
app.post('/api/event', requireAuth, (req, res) => {
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
app.post('/api/log', requireAuth, (req, res) => {
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
    
    // 清理超过500条的旧日志
    const countResult = dbAll('SELECT COUNT(*) as count FROM debug_logs');
    const count = countResult[0].count;
    if (count > 500) {
      dbRun(
        'DELETE FROM debug_logs WHERE id IN (SELECT id FROM debug_logs ORDER BY timestamp ASC LIMIT ?)',
        [count - 500]
      );
    }
    
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

loadOrCreateSessionKey();

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🌱 Hyacinth Farm Server running on http://localhost:${PORT}`);
    console.log(`   Dashboard  → http://localhost:${PORT}`);
    console.log(`   API Status → http://localhost:${PORT}/api/status`);
    console.log(`   Session Key: ${SESSION_KEY}\n`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

process.on('SIGINT',  () => { saveDatabase(); process.exit(0); });
process.on('SIGTERM', () => { saveDatabase(); process.exit(0); });
