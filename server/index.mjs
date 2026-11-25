import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
try { process.loadEnvFile(path.join(appRoot, '.env')); } catch { /* .env é opcional no primeiro acesso */ }
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'logisticmaster.sqlite'));
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS distributors (
  id TEXT PRIMARY KEY,
  trade_name TEXT NOT NULL,
  cnpj TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  distributor_id TEXT NOT NULL REFERENCES distributors(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK(role IN ('MANAGER','DISPATCHER','DRIVER','SALES_REP')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  record_type TEXT NOT NULL,
  id TEXT NOT NULL,
  distributor_id TEXT NOT NULL REFERENCES distributors(id) ON DELETE CASCADE,
  status TEXT,
  name TEXT,
  invoice_number TEXT,
  weight_kg REAL,
  volume_m3 REAL,
  latitude REAL,
  longitude REAL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(distributor_id, record_type, id)
);
CREATE INDEX IF NOT EXISTS idx_records_tenant_type ON records(distributor_id, record_type);
CREATE INDEX IF NOT EXISTS idx_records_status ON records(distributor_id, record_type, status);
CREATE TABLE IF NOT EXISTS system_config (
  distributor_id TEXT PRIMARY KEY REFERENCES distributors(id) ON DELETE CASCADE,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  distributor_id TEXT NOT NULL REFERENCES distributors(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT
);
CREATE TABLE IF NOT EXISTS delivery_events (
  id TEXT PRIMARY KEY,
  distributor_id TEXT NOT NULL REFERENCES distributors(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  client_event_id TEXT,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS operational_messages (
  id TEXT PRIMARY KEY,
  distributor_id TEXT NOT NULL REFERENCES distributors(id) ON DELETE CASCADE,
  client_event_id TEXT,
  route_id TEXT,
  order_id TEXT,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_role TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_messages_idempotency
  ON operational_messages(distributor_id, client_event_id) WHERE client_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_operational_messages_tenant_created
  ON operational_messages(distributor_id, created_at);
`;
db.exec(SCHEMA);
const deliveryEventColumns = db.prepare('PRAGMA table_info(delivery_events)').all().map((column) => column.name);
if (!deliveryEventColumns.includes('client_event_id')) db.exec('ALTER TABLE delivery_events ADD COLUMN client_event_id TEXT');
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_event_idempotency ON delivery_events(distributor_id, client_event_id) WHERE client_event_id IS NOT NULL`);
// Upgrade databases created by the first prototype without losing records.
const recordPk = db.prepare('PRAGMA table_info(records)').all().filter((column) => Number(column.pk) > 0).sort((a,b) => a.pk-b.pk).map((column) => column.name);
if (recordPk.join(',') !== 'distributor_id,record_type,id') {
  db.exec(`BEGIN;
    CREATE TABLE records_migrated (
      record_type TEXT NOT NULL, id TEXT NOT NULL,
      distributor_id TEXT NOT NULL REFERENCES distributors(id) ON DELETE CASCADE,
      status TEXT, name TEXT, invoice_number TEXT, weight_kg REAL, volume_m3 REAL,
      latitude REAL, longitude REAL, data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(distributor_id, record_type, id)
    );
    INSERT OR REPLACE INTO records_migrated
      (record_type,id,distributor_id,status,name,invoice_number,weight_kg,volume_m3,latitude,longitude,data_json,created_at,updated_at)
      SELECT record_type,id,distributor_id,status,name,invoice_number,weight_kg,volume_m3,latitude,longitude,data_json,created_at,updated_at FROM records;
    DROP TABLE records;
    ALTER TABLE records_migrated RENAME TO records;
    CREATE INDEX idx_records_tenant_type ON records(distributor_id, record_type);
    CREATE INDEX idx_records_status ON records(distributor_id, record_type, status);
  COMMIT;`);
}

const DEFAULT_CONFIG = {
  dieselPricePerLiter: 7.77,
  crewHourlyRate: 40,
  redeliveryDistanceKm: 30,
  avgFuelEfficiencyKmL: 8,
  redeliveryFixedTimeHours: 1.5,
  reverseProcessingCost: 10,
  minProfitMarginPct: 12,
  defaultUnloadMinutes: 15,
  geofenceRadiusMeters: 30,
  trafficDelayThresholdMinutes: 15,
  offlineWindowHours: 4,
  maxVehicleUtilizationPct: 90
};

const newId = () => crypto.randomUUID();
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};

const tenant = db.prepare('SELECT * FROM distributors ORDER BY created_at LIMIT 1').get();
let distributorId = tenant?.id;
if (!distributorId) {
  distributorId = newId();
  db.prepare('INSERT INTO distributors (id, trade_name, cnpj) VALUES (?, ?, ?)')
    .run(distributorId, 'Distribuidora Demonstração', '00000000000000');
  db.prepare('INSERT INTO system_config (distributor_id, data_json) VALUES (?, ?)')
    .run(distributorId, JSON.stringify(DEFAULT_CONFIG));
}

const demoUsers = [
  { name: 'Marcos Almeida', email: 'gestor@logisticmaster.local', role: 'MANAGER' },
  { name: 'Juliana Costa', email: 'despacho@logisticmaster.local', role: 'DISPATCHER' },
  { name: 'Carlos Santos', email: 'motorista@logisticmaster.local', role: 'DRIVER' },
  { name: 'Rodrigo Lima', email: 'vendas@logisticmaster.local', role: 'SALES_REP' }
];
const existingUsers = db.prepare('SELECT COUNT(*) AS total FROM users').get().total;
if (!existingUsers && (process.env.ENABLE_DEMO_USERS === 'true' || (process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEMO_USERS !== 'false'))) {
  const insertUser = db.prepare(`INSERT INTO users
    (id, distributor_id, name, email, role, password_salt, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const user of demoUsers) {
    const salt = crypto.randomBytes(16).toString('hex');
    insertUser.run(newId(), distributorId, user.name, user.email, user.role, salt, hashPassword('Demo@123', salt));
  }
}

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1' || process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(express.json({ limit: '20mb', verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

function cookieValue(req, name) {
  const source = req.headers.cookie || '';
  const part = source.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}
function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role, distributorId: row.distributor_id };
}
function auth(req, res, next) {
  const token = cookieValue(req, 'lm_session') || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Autenticação necessária.' });
  const session = db.prepare(`SELECT s.*, u.id, u.name, u.email, u.role, u.distributor_id, u.active
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`).get(hashToken(token), Date.now());
  if (!session) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  req.user = publicUser(session);
  next();
}
function requireRole(...roles) {
  return (req, res, next) => roles.includes(req.user.role)
    ? next()
    : res.status(403).json({ error: 'Seu perfil não tem permissão para esta ação.' });
}
function tenantRecords(type, distributor = distributorId) {
  return db.prepare('SELECT data_json FROM records WHERE record_type = ? AND distributor_id = ? ORDER BY created_at DESC')
    .all(type, distributor).map((row) => JSON.parse(row.data_json));
}
function saveRecord(type, data, distributor = distributorId) {
  const normalized = { ...data, id: String(data.id || newId()) };
  const get = (key) => normalized[key] == null ? null : normalized[key];
  db.prepare(`INSERT INTO records
    (record_type,id,distributor_id,status,name,invoice_number,weight_kg,volume_m3,latitude,longitude,data_json,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(distributor_id,record_type,id) DO UPDATE SET
      status=excluded.status,name=excluded.name,invoice_number=excluded.invoice_number,
      weight_kg=excluded.weight_kg,volume_m3=excluded.volume_m3,latitude=excluded.latitude,
      longitude=excluded.longitude,data_json=excluded.data_json,updated_at=CURRENT_TIMESTAMP`)
    .run(type, normalized.id, distributor, get('status'), get('tradeName') || get('name') || get('customerName'),
      get('nfe') || get('invoiceNumber'), get('weightKg'), get('volumeM3'), get('lat'), get('lng'), JSON.stringify(normalized));
  return normalized;
}
function tenantMessages(distributor, limit = 80) {
  return db.prepare(`SELECT id,client_event_id,route_id,order_id,sender_id,sender_name,sender_role,kind,message,created_at
    FROM operational_messages WHERE distributor_id = ? ORDER BY created_at DESC LIMIT ?`).all(distributor, limit)
    .reverse().map((row) => ({ id: row.id, clientEventId: row.client_event_id, routeId: row.route_id, orderId: row.order_id,
      senderId: row.sender_id, senderName: row.sender_name, senderRole: row.sender_role, kind: row.kind, message: row.message, createdAt: row.created_at }));
}
function removeRecord(type, id, distributor = distributorId) {
  return db.prepare('DELETE FROM records WHERE record_type = ? AND id = ? AND distributor_id = ?').run(type, id, distributor).changes > 0;
}
function logEvent(user, eventType, orderId, data = {}, clientEventId = null) {
  db.prepare('INSERT OR IGNORE INTO delivery_events (id,distributor_id,order_id,event_type,client_event_id,data_json) VALUES (?,?,?,?,?,?)')
    .run(newId(), user.distributorId, String(orderId || ''), eventType, clientEventId, JSON.stringify({ actor: user.id, ...data }));
}
function priorDeliveryEvent(distributorId, clientEventId) {
  if (!clientEventId) return null;
  const row = db.prepare('SELECT data_json FROM delivery_events WHERE distributor_id = ? AND client_event_id = ?').get(distributorId, clientEventId);
  if (!row) return null;
  try { return JSON.parse(row.data_json).response || null; } catch { return null; }
}
function haversineMeters(aLat, aLng, bLat, bLng) {
  const rad = (v) => (v * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function hasCoordinates(point) {
  return Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng)) && point?.lat != null && point?.lng != null;
}
function normalizeRegion(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function orderSpatialClusters(orders) {
  const clusters = [];
  for (const order of orders) {
    const neighborhood = normalizeRegion(order.neighborhood || '');
    const coords = hasCoordinates(order);
    let best = null;
    let bestDistance = Infinity;
    for (const cluster of clusters) {
      const sameNeighborhood = neighborhood && cluster.neighborhoods.has(neighborhood);
      let distance = Infinity;
      if (coords && cluster.lat != null && cluster.lng != null) distance = haversineMeters(Number(order.lat), Number(order.lng), cluster.lat, cluster.lng);
      if ((sameNeighborhood && (!coords || distance <= 4000)) || distance <= 2500) {
        if (distance < bestDistance || (sameNeighborhood && !best)) { best = cluster; bestDistance = distance; }
      }
    }
    if (!best) {
      best = { id: `zone-${clusters.length + 1}`, orders: [], neighborhoods: new Set(), lat: null, lng: null, coordinateCount: 0 };
      clusters.push(best);
    }
    best.orders.push(order);
    if (neighborhood) best.neighborhoods.add(neighborhood);
    if (coords) {
      const n = best.coordinateCount;
      best.lat = ((best.lat || 0) * n + Number(order.lat)) / (n + 1);
      best.lng = ((best.lng || 0) * n + Number(order.lng)) / (n + 1);
      best.coordinateCount += 1;
    }
  }
  return clusters;
}
function routeOrderByTimeAndDistance(stops, vehicle) {
  const byWindow = new Map();
  for (const stop of stops) {
    const key = parseTime(stop.timeWindow);
    if (!byWindow.has(key)) byWindow.set(key, []);
    byWindow.get(key).push(stop);
  }
  const ordered = [];
  let cursor = hasCoordinates(vehicle) ? { lat: Number(vehicle.lat), lng: Number(vehicle.lng) } : null;
  for (const key of [...byWindow.keys()].sort((a,b) => a-b)) {
    const pending = [...byWindow.get(key)];
    while (pending.length) {
      let selectedIndex = 0;
      if (cursor && pending.some(hasCoordinates)) {
        let nearest = Infinity;
        pending.forEach((stop, index) => {
          if (!hasCoordinates(stop)) return;
          const distance = haversineMeters(cursor.lat, cursor.lng, Number(stop.lat), Number(stop.lng));
          if (distance < nearest) { nearest = distance; selectedIndex = index; }
        });
      }
      const [next] = pending.splice(selectedIndex, 1);
      ordered.push(next);
      if (hasCoordinates(next)) cursor = { lat: Number(next.lat), lng: Number(next.lng) };
    }
  }
  return ordered;
}
function estimateRouteKm(stops, vehicle) {
  const points = [];
  if (hasCoordinates(vehicle)) points.push({ lat: Number(vehicle.lat), lng: Number(vehicle.lng) });
  for (const stop of stops) if (hasCoordinates(stop)) points.push({ lat: Number(stop.lat), lng: Number(stop.lng) });
  if (points.length < 2) return { estimatedKm: null, geographyCoveragePct: stops.length ? Math.round(stops.filter(hasCoordinates).length / stops.length * 100) : 0 };
  let meters = 0;
  for (let i = 1; i < points.length; i++) meters += haversineMeters(points[i-1].lat, points[i-1].lng, points[i].lat, points[i].lng);
  return { estimatedKm: Number((meters / 1000).toFixed(1)), geographyCoveragePct: stops.length ? Math.round(stops.filter(hasCoordinates).length / stops.length * 100) : 0 };
}
function parseTime(value = '') {
  const match = String(value).match(/(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 17 * 60;
}
function daysUntil(dateValue) {
  if (!dateValue) return 9999;
  const parts = String(dateValue).includes('/') ? String(dateValue).split('/').reverse().join('-') : String(dateValue);
  const end = new Date(`${parts}T00:00:00`);
  if (Number.isNaN(end.getTime())) return 9999;
  return Math.ceil((end.getTime() - Date.now()) / 86400000);
}
function findDriverVehicle(tenantId, user) {
  const vehicles = tenantRecords('vehicles', tenantId);
  return vehicles.find((v) => v.driverUserId && v.driverUserId === user.id)
    || vehicles.find((v) => (v.driverName || '').trim().toLowerCase() === (user.name || '').trim().toLowerCase());
}

function upsertRetailerFromOrder(order, tenantId) {
  if (!order.cnpj && !order.tradeName) return;
  const retailerId = String(order.cnpj || order.tradeName).replace(/\D/g, '') || order.tradeName.toLowerCase().replace(/\W/g, '-');
  const existing = tenantRecords('retailers', tenantId).find((r) => r.id === retailerId);
  saveRecord('retailers', {
    id: retailerId,
    tradeName: order.tradeName || existing?.tradeName || '',
    cnpj: order.cnpj || existing?.cnpj || '',
    address: order.address || existing?.address || '',
    neighborhood: order.neighborhood || existing?.neighborhood || '',
    city: order.city || existing?.city || 'Salvador',
    lat: order.lat != null ? order.lat : (existing?.lat ?? null),
    lng: order.lng != null ? order.lng : (existing?.lng ?? null),
    avgUnloadMinutes: existing?.avgUnloadMinutes ?? 15,
    completedDeliveriesCount: existing?.completedDeliveriesCount ?? 0
  }, tenantId);
}

const evidenceStorageRoot = path.join(dataDir, 'evidence');
function evidenceStoragePath(tenantId, orderId, kind, ext = 'bin') {
  const tenantKey = crypto.createHash('sha256').update(String(tenantId)).digest('hex');
  const orderKey = crypto.createHash('sha256').update(`${tenantId}:${orderId}:${kind}`).digest('hex');
  return path.join(evidenceStorageRoot, tenantKey, `${orderKey}.${ext}`);
}

function saveEvidenceDataUrl(tenantId, orderId, kind, dataUrl) {
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (bytes.length > 8 * 1024 * 1024) return null;
  const target = evidenceStoragePath(tenantId, orderId, kind, ext);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  return { mime, ext, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function stripHeavyEvidence(order) {
  if (!order || typeof order !== 'object') return order;
  const { signature, occurrencePhoto, rejectionPhoto, ...rest } = order;
  return {
    ...rest,
    signatureAvailable: Boolean(rest.signatureAvailable || signature),
    occurrencePhotoAvailable: Boolean(rest.occurrencePhotoAvailable || occurrencePhoto),
    rejectionPhotoAvailable: Boolean(rest.rejectionPhotoAvailable || rejectionPhoto)
  };
}

function sanitizeOrder(data) {
  return { ...(data || {}) };
}
function auditItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => {
    const days = item.expiryDate ? daysUntil(item.expiryDate) : Number(item.shelfLifeDays ?? 9999);
    return { ...item, shelfLifeDays: days, fefoPriority: days <= 0 ? 'vencido' : days <= 65 ? 'urgente' : 'normal' };
  });
}
function closeRouteIfSettled(routeId, tenantId) {
  if (!routeId) return;
  const route = tenantRecords('routes', tenantId).find((r) => r.id === routeId);
  if (!route || !Array.isArray(route.orderIds) || !route.orderIds.length) return;
  const records = tenantRecords('orders', tenantId);
  const settled = new Set(['entregue', 'reagendado_d1', 'baixado_avaria']);
  if (!route.orderIds.every((id) => settled.has(records.find((o) => o.id === id)?.status))) return;
  saveRecord('routes', { ...route, status: 'encerrada', closedAt: new Date().toISOString() }, tenantId);
  const vehicle = tenantRecords('vehicles', tenantId).find((v) => v.id === route.vehicleId);
  if (vehicle) saveRecord('vehicles', { ...vehicle, status: 'disponivel', allocatedOrders: [], currentWeightKg: 0, currentVolumeM3: 0, activeRouteId: undefined, routeDescription: 'Sem rota ativa' }, tenantId);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'LogisticMaster', database: 'sqlite', version: '1.0.0-prototype' }));

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
app.post('/api/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const attemptKey = `${req.ip || req.socket.remoteAddress || 'unknown'}:${email}`;
  const now = Date.now();
  const previous = loginAttempts.get(attemptKey);
  const attempt = previous && now - previous.startedAt < LOGIN_WINDOW_MS ? previous : { count: 0, startedAt: now };
  if (attempt.count >= LOGIN_MAX_ATTEMPTS) {
    const retryAfter = Math.max(1, Math.ceil((LOGIN_WINDOW_MS - (now - attempt.startedAt)) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde antes de tentar novamente.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
  if (!user || !safeEqual(hashPassword(password, user.password_salt), user.password_hash)) {
    attempt.count += 1; loginAttempts.set(attemptKey, attempt);
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }
  loginAttempts.delete(attemptKey);
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
    .run(hashToken(token), user.id, Date.now() + 1000 * 60 * 60 * 12);
  res.setHeader('Set-Cookie', `lm_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  const distributor = db.prepare('SELECT id,trade_name,cnpj FROM distributors WHERE id = ?').get(user.distributor_id);
  res.json({ user: publicUser(user), distributor });
});
app.get('/api/auth/me', auth, (req, res) => {
  const distributor = db.prepare('SELECT id,trade_name,cnpj FROM distributors WHERE id = ?').get(req.user.distributorId);
  res.json({ user: req.user, distributor });
});
app.post('/api/auth/change-password', auth, (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (newPassword.length < 8) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 8 caracteres.' });
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND distributor_id = ?').get(req.user.id, req.user.distributorId);
  if (!user || !safeEqual(hashPassword(currentPassword, user.password_salt), user.password_hash)) return res.status(401).json({ error: 'A senha atual não confere.' });
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?').run(salt, hashPassword(newPassword, salt), user.id);
  const currentToken = cookieValue(req, 'lm_session') || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, hashToken(currentToken));
  res.json({ ok: true, message: 'Senha alterada. As outras sessões foram encerradas.' });
});
app.post('/api/auth/logout', (req, res) => {
  const token = cookieValue(req, 'lm_session');
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  res.setHeader('Set-Cookie', 'lm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/bootstrap', auth, (req, res) => {
  const tenantId = req.user.distributorId;
  const cfg = db.prepare('SELECT data_json FROM system_config WHERE distributor_id = ?').get(tenantId);
  const count = db.prepare('SELECT COUNT(*) AS total FROM records WHERE distributor_id = ? AND record_type = ?').get(tenantId, 'orders').total;
  res.json({
    orders: tenantRecords('orders', tenantId).map(stripHeavyEvidence),
    vehicles: tenantRecords('vehicles', tenantId),
    retailers: tenantRecords('retailers', tenantId),
    routes: tenantRecords('routes', tenantId),
    communications: tenantMessages(tenantId),
    auditLogs: tenantRecords('audit_logs', tenantId),
    config: cfg ? JSON.parse(cfg.data_json) : DEFAULT_CONFIG,
    needsDemoSeed: count === 0
  });
});
app.post('/api/bootstrap/seed', auth, requireRole('MANAGER'), (req, res) => {
  const tenantId = req.user.distributorId;
  const count = db.prepare('SELECT COUNT(*) AS total FROM records WHERE distributor_id = ? AND record_type = ?').get(tenantId, 'orders').total;
  if (count > 0) return res.status(409).json({ error: 'A base de dados já contém pedidos.' });
  const driverUsers = db.prepare("SELECT id, name FROM users WHERE distributor_id = ? AND role = 'DRIVER' AND active = 1").all(tenantId);
  const vehicles = (req.body.vehicles || []).map((v, idx) => {
    const matchedDriver = driverUsers.find((d) => d.name.trim().toLowerCase() === String(v.driverName || '').trim().toLowerCase()) || (idx === 0 ? driverUsers[0] : null);
    return {
    ...v,
    driverUserId: v.driverUserId || matchedDriver?.id || null,
    driverName: matchedDriver?.name || v.driverName || '',
    status: 'disponivel',
    allocatedOrders: [],
    currentWeightKg: 0,
    currentVolumeM3: 0,
    lat: v.lat ?? null,
    lng: v.lng ?? null
  }; });
  const orders = (req.body.orders || []).map((o) => ({
    ...sanitizeOrder(o),
    items: auditItems(o.items),
    status: auditItems(o.items).some((item) => item.shelfLifeDays <= 0) ? 'bloqueio_fiscal' : 'pendente',
    truckId: undefined,
    lifoPosition: undefined,
    retainedWeightKg: 0,
    lat: o.lat ?? null,
    lng: o.lng ?? null
  }));
  db.exec('BEGIN');
  try {
    vehicles.forEach((v) => saveRecord('vehicles', v, tenantId));
    orders.forEach((o) => {
      saveRecord('orders', o, tenantId);
      upsertRetailerFromOrder(o, tenantId);
    });
    db.exec('COMMIT');
    res.json({ ok: true, orders: orders.length, vehicles: vehicles.length });
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
});

app.get('/api/orders', auth, (req, res) => res.json(tenantRecords('orders', req.user.distributorId).map(stripHeavyEvidence)));

const invoiceStorageRoot = path.join(dataDir, 'invoices');
function invoiceStoragePath(distributorId, orderId) {
  const tenantKey = crypto.createHash('sha256').update(String(distributorId)).digest('hex');
  const orderKey = crypto.createHash('sha256').update(`${distributorId}:${orderId}`).digest('hex');
  return path.join(invoiceStorageRoot, tenantKey, `${orderKey}.pdf`);
}
function safePdfFilename(value, fallback) {
  const cleaned = String(value || fallback).replace(/[\\/\\\r\\n"']/g, '_').replace(/[^\w .()\-À-ÿ]/g, '_').slice(0, 120);
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned || fallback}.pdf`;
}
app.post('/api/orders/:id/invoice-pdf', auth, requireRole('MANAGER','DISPATCHER','SALES_REP'), (req, res) => {
  const tenantId = req.user.distributorId;
  const order = tenantRecords('orders', tenantId).find((item) => item.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado nesta distribuidora.' });
  const dataUrl = String(req.body?.dataUrl || '');
  const match = dataUrl.match(/^data:application\/pdf;base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (!match) return res.status(400).json({ error: 'Envie um PDF válido da DANFE/NF-e.' });
  const bytes = Buffer.from(match[1].replace(/\s/g, ''), 'base64');
  if (bytes.length < 8 || bytes.length > 8 * 1024 * 1024 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    return res.status(400).json({ error: 'O PDF deve ter até 8 MB e começar com a assinatura válida %PDF-.' });
  }
  const target = invoiceStoragePath(tenantId, order.id);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  const filename = safePdfFilename(req.body?.filename, `NFe-${order.nfe || order.id}.pdf`);
  const updated = { ...order, nfePdfAvailable: true, nfePdfFilename: filename, nfePdfUploadedAt: new Date().toISOString(), nfePdfSize: bytes.length };
  saveRecord('orders', updated, tenantId);
  logEvent(req.user, 'INVOICE_PDF_ATTACHED', order.id, { filename, bytes: bytes.length });
  res.status(201).json({ order: updated, filename, size: bytes.length });
});
app.get('/api/orders/:id/invoice-pdf', auth, (req, res) => {
  const tenantId = req.user.distributorId;
  const order = tenantRecords('orders', tenantId).find((item) => item.id === req.params.id);
  if (!order || !order.nfePdfAvailable) return res.status(404).json({ error: 'PDF oficial da NF-e ainda não foi anexado a este pedido.' });
  if (req.user.role === 'DRIVER') {
    const vehicle = findDriverVehicle(tenantId, req.user);
    if (!vehicle?.activeRouteId || order.routeId !== vehicle.activeRouteId) return res.status(403).json({ error: 'Esta NF-e não pertence à rota atualmente atribuída ao motorista.' });
  }
  const target = invoiceStoragePath(tenantId, order.id);
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'Arquivo PDF não encontrado no armazenamento.' });
  const filename = safePdfFilename(order.nfePdfFilename, `NFe-${order.nfe || order.id}.pdf`);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(target);
});
app.post('/api/orders', auth, requireRole('MANAGER','DISPATCHER','SALES_REP'), (req, res) => {
  const body = sanitizeOrder(req.body || {});
  const missing = [];
  if (!body.customerName && !body.tradeName) missing.push('cliente');
  if (!body.address) missing.push('endereço');
  if (!(Number(body.weightKg) > 0)) missing.push('peso');
  if (!(Number(body.volumeM3) > 0)) missing.push('cubagem');
  const order = {
    ...body,
    id: body.id || newId(),
    tradeName: body.tradeName || body.customerName || 'Cliente não informado',
    customerName: body.customerName || body.tradeName || 'Cliente não informado',
    city: body.city || 'Salvador', state: body.state || 'BA', neighborhood: body.neighborhood || '',
    weightKg: Number(body.weightKg) || 0,
    volumeM3: Number(body.volumeM3) || 0,
    totalValue: Number(body.totalValue) || 0,
    timeWindow: body.timeWindow || '08:00–17:00',
    status: auditItems(body.items).some((item) => item.shelfLifeDays <= 0) ? 'bloqueio_fiscal' : missing.length ? 'pendente_complemento' : (body.status || 'pendente'),
    missingFields: missing,
    items: auditItems(body.items),
    fefoCompliance: Number(body.fefoCompliance) || 100,
    createdAt: new Date().toISOString()
  };
  saveRecord('orders', order, req.user.distributorId);
  upsertRetailerFromOrder(order, req.user.distributorId);
  logEvent(req.user, 'ORDER_CREATED', order.id, { origin: order.source || 'manual' });
  res.status(201).json(order);
});
app.post('/api/orders/bulk-import', auth, requireRole('MANAGER','DISPATCHER','SALES_REP'), (req, res) => {
  const rows = Array.isArray(req.body?.orders) ? req.body.orders : [];
  if (!rows.length) return res.status(400).json({ error: 'Nenhum pedido foi enviado.' });
  const saved = [];
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      const body = sanitizeOrder(row);
      const missing = [];
      if (!body.customerName && !body.tradeName) missing.push('cliente');
      if (!body.address) missing.push('endereço');
      if (!(Number(body.weightKg) > 0)) missing.push('peso');
      if (!(Number(body.volumeM3) > 0)) missing.push('cubagem');
      const order = {
        ...body, id: body.id || newId(), tradeName: body.tradeName || body.customerName || 'Cliente não informado',
        customerName: body.customerName || body.tradeName || 'Cliente não informado',
        weightKg: Number(body.weightKg) || 0, volumeM3: Number(body.volumeM3) || 0,
        totalValue: Number(body.totalValue) || 0, city: body.city || 'Salvador', state: body.state || 'BA',
        timeWindow: body.timeWindow || '08:00–17:00', status: auditItems(body.items).some((item) => item.shelfLifeDays <= 0) ? 'bloqueio_fiscal' : missing.length ? 'pendente_complemento' : 'pendente',
        missingFields: missing, items: auditItems(body.items), createdAt: new Date().toISOString()
      };
      saveRecord('orders', order, req.user.distributorId);
      upsertRetailerFromOrder(order, req.user.distributorId);
      saved.push(order);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  res.status(201).json({ imported: saved.length, orders: saved });
});
app.patch('/api/orders/:id', auth, requireRole('MANAGER','DISPATCHER','SALES_REP'), (req, res) => {
  const current = tenantRecords('orders', req.user.distributorId).find((o) => o.id === req.params.id);
  if (!current) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (req.user.role === 'SALES_REP') {
    if (!['pendente','pendente_complemento'].includes(current.status)) return res.status(409).json({ error: 'O vendedor só pode alterar pedidos antes da alocação no carregamento.' });
    const allowed = ['nfe','invoiceNumber','customerName','tradeName','cnpj','address','neighborhood','city','state','cep','weightKg','volumeM3','timeWindow','totalValue','items','missingFields','lat','lng','notes'];
    const safeChanges = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)));
    req.body = safeChanges;
  }
  const updated = { ...current, ...sanitizeOrder(req.body), id: current.id, updatedAt: new Date().toISOString() };
  if (Array.isArray(req.body?.items)) {
    updated.items = auditItems(req.body.items);
    if (updated.items.some((item) => item.shelfLifeDays <= 0)) updated.status = 'bloqueio_fiscal';
    else if (current.status === 'bloqueio_fiscal') updated.status = 'pendente';
  }
  if (updated.weightKg > 0 && updated.volumeM3 > 0 && updated.address) {
    updated.status = updated.status === 'pendente_complemento' ? 'pendente' : updated.status;
    updated.missingFields = [];
  }
  saveRecord('orders', updated, req.user.distributorId);
  res.json(updated);
});
app.delete('/api/orders/:id', auth, requireRole('MANAGER','DISPATCHER'), (req, res) => {
  const ok = removeRecord('orders', req.params.id, req.user.distributorId);
  res.status(ok ? 200 : 404).json({ ok });
});

app.get('/api/drivers', auth, requireRole('MANAGER', 'DISPATCHER'), (req, res) => {
  const rows = db.prepare("SELECT id, name, email, role, active FROM users WHERE distributor_id = ? AND role = 'DRIVER' AND active = 1 ORDER BY name ASC").all(req.user.distributorId);
  res.json(rows.map((u) => ({ ...u, active: Boolean(u.active) })));
});

app.get('/api/orders/:id/evidence/:kind', auth, (req, res) => {
  const tenantId = req.user.distributorId;
  const kind = String(req.params.kind || '');
  if (!['signature', 'occurrence', 'rejection'].includes(kind)) return res.status(400).json({ error: 'Tipo de evidência inválido.' });
  const order = tenantRecords('orders', tenantId).find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  for (const ext of ['png', 'jpg', 'webp']) {
    const target = evidenceStoragePath(tenantId, order.id, kind, ext);
    if (fs.existsSync(target)) {
      res.setHeader('Content-Type', ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return res.sendFile(target);
    }
  }
  res.status(404).json({ error: 'Evidência não encontrada.' });
});

app.post('/api/orders/:id/cancel-in-route', auth, requireRole('MANAGER', 'DISPATCHER'), (req, res) => {
  const tenantId = req.user.distributorId;
  const order = tenantRecords('orders', tenantId).find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (order.status !== 'em_rota') return res.status(409).json({ error: 'Somente pedidos em rota podem ser cancelados em trânsito.' });
  const vehicle = order.truckId ? tenantRecords('vehicles', tenantId).find((v) => v.id === order.truckId) : null;
  let distanceMeters = null;
  if (hasCoordinates(vehicle) && hasCoordinates(order)) {
    distanceMeters = haversineMeters(Number(vehicle.lat), Number(vehicle.lng), Number(order.lat), Number(order.lng));
  }
  const withinCutoff = distanceMeters != null && distanceMeters <= 500;
  const updated = {
    ...order,
    status: withinCutoff ? 'ocorrencia' : 'cancelado_em_rota',
    occurrenceReason: withinCutoff ? 'Cancelamento tardio na porta (< 500m · RN-15)' : (req.body?.reason || 'Cancelado em rota pela central (> 500m)'),
    retainedWeightKg: Number(order.weightKg || 0),
    retainedVolumeM3: Number(order.volumeM3 || 0),
    cancelledAt: new Date().toISOString()
  };
  saveRecord('orders', updated, tenantId);
  logEvent(req.user, 'ORDER_CANCELLED_IN_ROUTE', order.id, { distanceMeters, withinCutoff, status: updated.status });
  res.json({ order: stripHeavyEvidence(updated), distanceMeters, penaltyApplied: withinCutoff });
});

app.get('/api/vehicles', auth, (req, res) => res.json(tenantRecords('vehicles', req.user.distributorId)));
app.post('/api/vehicles', auth, requireRole('MANAGER','DISPATCHER'), (req, res) => {
  const b = req.body || {};
  if (!b.plate || !(Number(b.maxWeightKg) > 0) || !(Number(b.maxVolumeM3) > 0)) return res.status(400).json({ error: 'Informe placa, capacidade em kg e cubagem.' });
  const exists = tenantRecords('vehicles', req.user.distributorId).some((v) => String(v.plate).toUpperCase() === String(b.plate).toUpperCase());
  if (exists) return res.status(409).json({ error: 'Já existe um veículo com essa placa.' });
  let driverUserId = b.driverUserId || null;
  let driverName = b.driverName || '';
  if (driverUserId) {
    const drv = db.prepare("SELECT id, name FROM users WHERE id = ? AND distributor_id = ? AND role = 'DRIVER'").get(driverUserId, req.user.distributorId);
    if (drv) { driverUserId = drv.id; driverName = drv.name; }
  }
  const vehicle = { ...b, id: newId(), driverUserId, driverName, plate: String(b.plate).toUpperCase(), currentWeightKg: 0, currentVolumeM3: 0, allocatedOrders: [], status: 'disponivel', routeDescription: 'Sem rota ativa', currentLocation: 'Base operacional' };
  saveRecord('vehicles', vehicle, req.user.distributorId);
  res.status(201).json(vehicle);
});
app.patch('/api/vehicles/:id', auth, requireRole('MANAGER','DISPATCHER'), (req, res) => {
  const current = tenantRecords('vehicles', req.user.distributorId).find((v) => v.id === req.params.id);
  if (!current) return res.status(404).json({ error: 'Veículo não encontrado.' });
  const updated = { ...current, ...req.body, id: current.id };
  if (updated.currentWeightKg > updated.maxWeightKg || updated.currentVolumeM3 > updated.maxVolumeM3) return res.status(422).json({ error: 'A alteração ultrapassa a capacidade física do veículo.' });
  saveRecord('vehicles', updated, req.user.distributorId);
  res.json(updated);
});
app.post('/api/vehicles/:id/location', auth, requireRole('MANAGER','DISPATCHER','DRIVER'), (req, res) => {
  const vehicles = tenantRecords('vehicles', req.user.distributorId);
  const current = vehicles.find((v) => v.id === req.params.id);
  if (!current) return res.status(404).json({ error: 'Veículo não encontrado.' });
  const updated = { ...current, lat: Number(req.body.lat), lng: Number(req.body.lng), locationUpdatedAt: new Date().toISOString(), currentLocation: req.body.label || `${req.body.lat}, ${req.body.lng}` };
  saveRecord('vehicles', updated, req.user.distributorId);
  res.json(updated);
});


app.post('/api/geocode', auth, async (req, res) => {
  const address = String(req.body?.address || '').trim();
  if (!address) return res.status(400).json({ error: 'Informe um endereço para localizar.' });
  const query = [address, req.body?.city || 'Salvador', req.body?.state || 'BA', 'Brasil'].filter(Boolean).join(', ');
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': 'LogisticMasterPrototype/1.0 (geocoding)' }
    });
    if (!response.ok) return res.status(502).json({ error: 'O serviço de geolocalização está indisponível.' });
    const results = await response.json();
    if (!results.length) return res.status(404).json({ error: 'Endereço não localizado. Confira o logradouro e o bairro.' });
    res.json({ lat: Number(results[0].lat), lng: Number(results[0].lon), displayName: results[0].display_name });
  } catch { res.status(502).json({ error: 'Não foi possível consultar o geocodificador.' }); }
});

app.get('/api/customers', auth, (req, res) => res.json(tenantRecords('retailers', req.user.distributorId)));
app.post('/api/customers', auth, requireRole('MANAGER','DISPATCHER','SALES_REP'), (req, res) => {
  const b = req.body || {};
  if (!b.tradeName || !b.address) return res.status(400).json({ error: 'Informe nome e endereço do cliente.' });
  const customer = { ...b, id: b.id || newId(), avgUnloadMinutes: Number(b.avgUnloadMinutes) || 15, completedDeliveriesCount: Number(b.completedDeliveriesCount) || 0 };
  saveRecord('retailers', customer, req.user.distributorId);
  res.status(201).json(customer);
});

app.post('/api/dispatch/optimize', auth, requireRole('MANAGER','DISPATCHER'), (req, res) => {
  const tenantId = req.user.distributorId;
  const orders = tenantRecords('orders', tenantId);
  const vehicles = tenantRecords('vehicles', tenantId);
  const eligibleOrders = orders.filter((o) => ['pendente','reagendado_d1'].includes(o.status) && !o.truckId);
  const availableVehicles = vehicles.filter((v) => v.status === 'disponivel');
  if (!eligibleOrders.length) return res.status(400).json({ error: 'Não há pedidos pendentes para alocar.' });
  if (!availableVehicles.length) return res.status(400).json({ error: 'Não há veículos disponíveis para carregamento.' });

  const priority = (o) => {
    const minExpiry = Array.isArray(o.items) && o.items.length ? Math.min(...o.items.map((i) => Number(i.shelfLifeDays ?? daysUntil(i.expiryDate)))) : 9999;
    return [o.status === 'reagendado_d1' ? 0 : 1, minExpiry <= 65 ? 0 : 1, minExpiry, parseTime(o.timeWindow), -Number(o.weightKg || 0)];
  };
  const comparePriority = (a, b) => {
    const aa = priority(a), bb = priority(b);
    for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
    return 0;
  };
  eligibleOrders.sort(comparePriority);
  const clusters = orderSpatialClusters(eligibleOrders);
  const loads = new Map(availableVehicles.map((v) => [v.id, {
    weight: Number(v.currentWeightKg) || 0, volume: Number(v.currentVolumeM3) || 0,
    orderIds: [...(v.allocatedOrders || [])], assignedOrders: [], clusterIds: new Set()
  }]));
  const assignments = [];
  const unassigned = [];
  const configRow = db.prepare('SELECT data_json FROM system_config WHERE distributor_id = ?').get(tenantId);
  const dispatchConfig = { ...DEFAULT_CONFIG, ...(configRow ? JSON.parse(configRow.data_json) : {}) };
  const utilizationPct = Number(req.body?.maxUtilizationPct || dispatchConfig.maxVehicleUtilizationPct || 90);
  const utilization = Math.min(1, Math.max(0.1, utilizationPct / 100));
  const clustersByPriority = [...clusters].sort((a,b) => comparePriority(a.orders[0], b.orders[0]));

  for (const cluster of clustersByPriority) {
    for (const order of cluster.orders.sort(comparePriority)) {
      const weight = Number(order.weightKg) || 0;
      const volume = Number(order.volumeM3) || 0;
      const candidates = availableVehicles.filter((vehicle) => {
        const load = loads.get(vehicle.id);
        return load.weight + weight <= Number(vehicle.maxWeightKg) * utilization
          && load.volume + volume <= Number(vehicle.maxVolumeM3) * utilization;
      }).sort((a,b) => {
        const score = (vehicle) => {
          const load = loads.get(vehicle.id);
          if (load.clusterIds.has(cluster.id)) return -1000 + (load.weight / Math.max(1, Number(vehicle.maxWeightKg))) * 0.25;
          const points = load.assignedOrders.filter(hasCoordinates);
          let spatialCost = points.length && cluster.lat != null
            ? haversineMeters(cluster.lat, cluster.lng,
                points.reduce((sum,p) => sum + Number(p.lat), 0) / points.length,
                points.reduce((sum,p) => sum + Number(p.lng), 0) / points.length) / 1000
            : (load.assignedOrders.length ? 6 : 4.5);
          // Opening a fresh vehicle is preferred over sending a truck across town.
          if (!load.assignedOrders.length) spatialCost = 4.5;
          const loadRatio = load.weight / Math.max(1, Number(vehicle.maxWeightKg));
          return spatialCost + loadRatio * 0.3;
        };
        return score(a) - score(b);
      });
      if (!candidates.length) {
        unassigned.push({ id: order.id, reason: 'Capacidade de peso/cubagem insuficiente ou limite operacional atingido.' });
        continue;
      }
      const vehicle = candidates[0];
      const load = loads.get(vehicle.id);
      load.weight += weight; load.volume += volume; load.orderIds.push(order.id);
      load.assignedOrders.push(order); load.clusterIds.add(cluster.id);
      assignments.push({ orderId: order.id, vehicleId: vehicle.id, clusterId: cluster.id });
    }
  }

  const routeByVehicle = new Map();
  const writes = db.prepare(`INSERT INTO records
    (record_type,id,distributor_id,status,name,invoice_number,weight_kg,volume_m3,latitude,longitude,data_json,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(distributor_id,record_type,id) DO UPDATE SET
      status=excluded.status,name=excluded.name,invoice_number=excluded.invoice_number,
      weight_kg=excluded.weight_kg,volume_m3=excluded.volume_m3,latitude=excluded.latitude,
      longitude=excluded.longitude,data_json=excluded.data_json,updated_at=CURRENT_TIMESTAMP`);
  db.exec('BEGIN');
  try {
    for (const vehicle of availableVehicles) {
      const load = loads.get(vehicle.id);
      const newIds = load.orderIds.filter((id) => assignments.some((a) => a.orderId === id && a.vehicleId === vehicle.id));
      if (!newIds.length) continue;
      const rawStops = newIds.map((id) => orders.find((o) => o.id === id)).filter(Boolean);
      const stops = routeOrderByTimeAndDistance(rawStops, vehicle);
      const orderedIds = stops.map((o) => o.id);
      const routeId = newId();
      const distance = estimateRouteKm(stops, vehicle);
      const route = {
        id: routeId, vehicleId: vehicle.id, driverName: vehicle.driverName, status: 'em_carregamento',
        orderIds: orderedIds, stopCount: orderedIds.length,
        totalWeightKg: stops.reduce((sum,o) => sum + Number(o.weightKg || 0), 0),
        totalVolumeM3: stops.reduce((sum,o) => sum + Number(o.volumeM3 || 0), 0),
        ...distance,
        createdAt: new Date().toISOString(), description: stops.map((o) => o.neighborhood || o.tradeName).join(' → ')
      };
      routeByVehicle.set(vehicle.id, route);
      const updatedVehicle = { ...vehicle, status: 'em_carregamento', allocatedOrders: orderedIds,
        currentWeightKg: load.weight, currentVolumeM3: Number(load.volume.toFixed(3)), activeRouteId: routeId,
        routeDescription: route.description };
      const recordRows = [
        ['routes', route],
        ['vehicles', updatedVehicle],
        ...orderedIds.map((id,index) => ['orders', { ...orders.find((o) => o.id === id), status: 'alocado_no_bau', truckId: vehicle.id, routeId, lifoPosition: index + 1, deliverySequence: index + 1 }])
      ];
      for (const [type, data] of recordRows) {
        writes.run(type, data.id, tenantId, data.status ?? null, data.tradeName || data.name || data.customerName || null,
          data.nfe || data.invoiceNumber || null, data.weightKg ?? null, data.volumeM3 ?? null, data.lat ?? null, data.lng ?? null, JSON.stringify(data));
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  res.json({ assigned: assignments.length, unassigned, clusters: clusters.length, routes: [...routeByVehicle.values()], orders: tenantRecords('orders', tenantId), vehicles: tenantRecords('vehicles', tenantId) });
});
app.post('/api/dispatch/decision', auth, requireRole('MANAGER','DISPATCHER'), (req, res) => {
  const tenantId = req.user.distributorId;
  const order = tenantRecords('orders', tenantId).find((o) => o.id === req.body?.orderId);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (!['pendente','reagendado_d1'].includes(order.status)) return res.status(409).json({ error: 'A decisão Hoje vs. Amanhã só pode ser aplicada a pedidos ainda não carregados.' });
  const configRow = db.prepare('SELECT data_json FROM system_config WHERE distributor_id = ?').get(tenantId);
  const config = { ...DEFAULT_CONFIG, ...(configRow ? JSON.parse(configRow.data_json) : {}) };
  const orderValue = Number(order.totalValue || 0);
  const grossMarginPct = Number(req.body.grossMarginPct);
  const extraKmToday = Math.max(0, Number(req.body.extraKmToday) || 0);
  const extraHoursToday = Math.max(0, Number(req.body.extraHoursToday) || 0);
  const spotFreightToday = Math.max(0, Number(req.body.spotFreightToday) || 0);
  const tomorrowIncrementalCost = Math.max(0, Number(req.body.tomorrowIncrementalCost) || 0);
  if (!(orderValue > 0) || !Number.isFinite(grossMarginPct) || grossMarginPct < 0 || grossMarginPct > 100) return res.status(400).json({ error: 'O pedido precisa ter valor positivo e margem bruta entre 0% e 100%.' });
  const todayIncrementalCost = (extraKmToday / Math.max(0.1, Number(config.avgFuelEfficiencyKmL))) * Number(config.dieselPricePerLiter)
    + extraHoursToday * Number(config.crewHourlyRate) + spotFreightToday;
  const grossProfit = orderValue * grossMarginPct / 100;
  const marginTodayPct = (grossProfit - todayIncrementalCost) / orderValue * 100;
  const marginTomorrowPct = (grossProfit - tomorrowIncrementalCost) / orderValue * 100;
  const floor = Number(config.minProfitMarginPct);
  const todayViable = marginTodayPct >= floor && marginTodayPct >= 0;
  const tomorrowViable = marginTomorrowPct >= floor && marginTomorrowPct >= 0;
  let recommendation;
  if (todayViable && !tomorrowViable) recommendation = 'today';
  else if (!todayViable && tomorrowViable) recommendation = 'tomorrow';
  else recommendation = marginTomorrowPct > marginTodayPct ? 'tomorrow' : 'today';
  const recommendationReason = todayViable && tomorrowViable
    ? 'Os dois cenários respeitam o piso; foi escolhida a maior margem líquida.'
    : todayViable ? 'Somente o cenário de hoje respeita o piso de margem.'
    : tomorrowViable ? 'Somente o cenário D+1 respeita o piso de margem.'
    : 'Os dois cenários ficam abaixo do piso; foi escolhida a alternativa de menor perda de margem.';
  const result = { orderId: order.id, orderValue, grossMarginPct, grossProfit, todayIncrementalCost: Number(todayIncrementalCost.toFixed(2)), tomorrowIncrementalCost: Number(tomorrowIncrementalCost.toFixed(2)), marginTodayPct: Number(marginTodayPct.toFixed(2)), marginTomorrowPct: Number(marginTomorrowPct.toFixed(2)), minimumMarginPct: floor, recommendation, recommendationReason };
  const action = req.body.action;
  if ((action === 'apply_today' || action === 'apply_tomorrow') && req.user.role !== 'MANAGER') return res.status(403).json({ error: 'Somente o gestor pode registrar a decisão final Hoje vs. Amanhã.' });
  if (action === 'apply_today' || action === 'apply_tomorrow') {
    const decision = action === 'apply_tomorrow' ? 'tomorrow' : 'today';
    const updated = { ...order, status: decision === 'tomorrow' ? 'reagendado_d1' : 'pendente', dispatchDecision: { ...result, decision, approvedBy: req.user.id, approvedAt: new Date().toISOString() } };
    saveRecord('orders', updated, tenantId);
    logEvent(req.user, 'DISPATCH_DECISION', order.id, { ...result, decision });
    return res.json({ ...result, decision, order: updated });
  }
  res.json(result);
});

app.post('/api/dispatch/routes/:id/start', auth, requireRole('MANAGER','DISPATCHER'), (req, res) => {
  const routes = tenantRecords('routes', req.user.distributorId);
  const route = routes.find((r) => r.id === req.params.id);
  if (!route) return res.status(404).json({ error: 'Rota não encontrada.' });
  const updatedRoute = { ...route, status: 'em_rota', startedAt: new Date().toISOString() };
  saveRecord('routes', updatedRoute, req.user.distributorId);
  const orders = tenantRecords('orders', req.user.distributorId);
  for (const order of orders.filter((o) => o.routeId === route.id)) saveRecord('orders', { ...order, status: 'em_rota' }, req.user.distributorId);
  const vehicle = tenantRecords('vehicles', req.user.distributorId).find((v) => v.id === route.vehicleId);
  if (vehicle) saveRecord('vehicles', { ...vehicle, status: 'em_rota' }, req.user.distributorId);
  res.json({ route: updatedRoute, orders: tenantRecords('orders', req.user.distributorId), vehicles: tenantRecords('vehicles', req.user.distributorId) });
});

app.post('/api/deliveries/:orderId/confirm', auth, requireRole('MANAGER','DISPATCHER','DRIVER'), (req, res) => {
  const tenantId = req.user.distributorId;
  const clientEventId = String(req.body?.clientEventId || '').slice(0, 100) || null;
  const previous = priorDeliveryEvent(tenantId, clientEventId);
  if (previous) return res.json(previous);
  const orders = tenantRecords('orders', tenantId);
  const order = orders.find((o) => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (order.status !== 'em_rota') return res.status(409).json({ error: 'Somente pedidos em rota podem receber baixa de entrega.' });
  const { receiverName, receiverDoc, signature, lat, lng, deliveryMode = 'integral', rejectedWeightKg = 0 } = req.body || {};
  if (!receiverName || !receiverDoc || !signature) return res.status(400).json({ error: 'Recebedor, documento e assinatura são obrigatórios.' });
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return res.status(400).json({ error: 'Não foi possível validar a localização do dispositivo.' });
  let distanceMeters = null;
  if (order.lat !== null && order.lat !== undefined && order.lng !== null && order.lng !== undefined && Number.isFinite(Number(order.lat)) && Number.isFinite(Number(order.lng))) {
    distanceMeters = haversineMeters(Number(order.lat), Number(order.lng), Number(lat), Number(lng));
    const radius = Number((db.prepare('SELECT data_json FROM system_config WHERE distributor_id = ?').get(tenantId)?.data_json && JSON.parse(db.prepare('SELECT data_json FROM system_config WHERE distributor_id = ?').get(tenantId).data_json).geofenceRadiusMeters) || 30);
    if (distanceMeters > radius) return res.status(422).json({ error: `Fora do raio de confirmação (${Math.round(distanceMeters)}m; limite ${radius}m).` });
  }
  const rejected = deliveryMode === 'parcial' ? Math.max(0, Math.min(Number(order.weightKg), Number(rejectedWeightKg) || 0)) : 0;
  if (deliveryMode === 'parcial' && (rejected <= 0 || rejected >= Number(order.weightKg || 0) || !req.body.rejectionPhoto)) return res.status(400).json({ error: 'Entrega parcial exige peso recusado menor que o total e foto comprobatória.' });
  const originalWeight = Number(order.originalWeightKg ?? order.weightKg ?? 0);
  const originalVolume = Number(order.originalVolumeM3 ?? order.volumeM3 ?? 0);
  const deliveredWeight = originalWeight - rejected;
  const deliveredRatio = originalWeight > 0 ? deliveredWeight / originalWeight : 1;
  const deliveredVolume = Number((originalVolume * deliveredRatio).toFixed(3));
  const retainedVolume = Number(Math.max(0, originalVolume - deliveredVolume).toFixed(3));
  const sigMeta = saveEvidenceDataUrl(tenantId, order.id, 'signature', signature);
  const rejMeta = req.body.rejectionPhoto ? saveEvidenceDataUrl(tenantId, order.id, 'rejection', req.body.rejectionPhoto) : null;
  const signatureSha256 = crypto.createHash('sha256').update(`${signature}|${order.id}|${receiverDoc}`).digest('hex');
  const updated = { ...order, originalWeightKg: originalWeight, originalVolumeM3: originalVolume,
    status: deliveryMode === 'parcial' ? 'entregue_parcial' : 'entregue',
    deliveredAt: new Date().toISOString(), retainedWeightKg: rejected, retainedVolumeM3: deliveryMode === 'parcial' ? retainedVolume : 0,
    deliveredWeightKg: deliveredWeight, deliveredVolumeM3: deliveredVolume,
    receiverName, receiverDoc, deliveryGps: { lat: Number(lat), lng: Number(lng), distanceMeters },
    signatureAvailable: true, signatureSha256, signatureBytes: sigMeta?.bytes || null,
    rejectionPhotoAvailable: Boolean(rejMeta || req.body.rejectionPhoto) };
  delete updated.signature;
  delete updated.rejectionPhoto;
  saveRecord('orders', updated, tenantId);
  const retailerId = String(order.cnpj || order.tradeName || '').replace(/\D/g, '') || String(order.tradeName || '').toLowerCase().replace(/\W/g, '-');
  const retailer = tenantRecords('retailers', tenantId).find((r) => r.id === retailerId);
  if (retailer) {
    const nextCount = Number(retailer.completedDeliveriesCount || 0) + 1;
    let nextAvg = Number(retailer.avgUnloadMinutes || 15);
    const unloadMin = Number(req.body?.unloadMinutes);
    if (Number.isFinite(unloadMin) && unloadMin >= 3 && unloadMin <= nextAvg * 2.5 && nextCount >= 3) {
      nextAvg = Number(((nextAvg * Math.min(nextCount - 1, 4) + unloadMin) / Math.min(nextCount, 5)).toFixed(1));
    }
    saveRecord('retailers', { ...retailer, completedDeliveriesCount: nextCount, avgUnloadMinutes: nextAvg }, tenantId);
  }
  if (order.truckId) {
    const vehicle = tenantRecords('vehicles', tenantId).find((v) => v.id === order.truckId);
    if (vehicle) {
      const allocatedOrders = deliveryMode === 'parcial' ? (vehicle.allocatedOrders || []) : (vehicle.allocatedOrders || []).filter((id) => id !== order.id);
      saveRecord('vehicles', { ...vehicle, allocatedOrders,
        currentWeightKg: Math.max(0, Number(vehicle.currentWeightKg || 0) - deliveredWeight),
        currentVolumeM3: Math.max(0, Number((Number(vehicle.currentVolumeM3 || 0) - deliveredVolume).toFixed(3)))
      }, tenantId);
    }
  }
  closeRouteIfSettled(order.routeId, tenantId);
  const response = { order: stripHeavyEvidence(updated), orders: tenantRecords('orders', tenantId).map(stripHeavyEvidence), vehicles: tenantRecords('vehicles', tenantId) };
  logEvent(req.user, 'DELIVERY_CONFIRMED', order.id, { deliveryMode, deliveredWeight, rejectedWeight: rejected, distanceMeters, response }, clientEventId);
  res.json(response);
});
app.post('/api/deliveries/:orderId/occurrence', auth, requireRole('MANAGER','DISPATCHER','DRIVER'), (req, res) => {
  const tenantId = req.user.distributorId;
  const clientEventId = String(req.body?.clientEventId || '').slice(0, 100) || null;
  const previous = priorDeliveryEvent(tenantId, clientEventId);
  if (previous) return res.json(previous);
  const order = tenantRecords('orders', tenantId).find((o) => o.id === req.params.orderId);
  if (!order) return res.status(404).json({ error: 'Pedido não encontrado.' });
  if (order.status !== 'em_rota') return res.status(409).json({ error: 'Somente pedidos em rota podem receber ocorrência.' });
  const { reason, photo, lat, lng } = req.body || {};
  if (!reason || !photo || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return res.status(400).json({ error: 'Motivo, foto e geolocalização são obrigatórios.' });
  let distanceMeters = null;
  let geofenceWarning = false;
  if (order.lat != null && order.lng != null) {
    distanceMeters = haversineMeters(Number(order.lat), Number(order.lng), Number(lat), Number(lng));
    const configRow = db.prepare('SELECT data_json FROM system_config WHERE distributor_id = ?').get(tenantId);
    const occurrenceRadius = Number((configRow ? JSON.parse(configRow.data_json).geofenceRadiusMeters : DEFAULT_CONFIG.geofenceRadiusMeters) || DEFAULT_CONFIG.geofenceRadiusMeters);
    geofenceWarning = distanceMeters > occurrenceRadius;
  }
  saveEvidenceDataUrl(tenantId, order.id, 'occurrence', photo);
  const updated = { ...order, status: 'ocorrencia', occurrenceReason: reason, occurrencePhotoAvailable: true,
    occurrenceGps: { lat: Number(lat), lng: Number(lng), distanceMeters }, geofenceWarning,
    retainedWeightKg: Number(order.weightKg || 0), retainedVolumeM3: Number(order.volumeM3 || 0), occurrenceAt: new Date().toISOString() };
  delete updated.occurrencePhoto;
  saveRecord('orders', updated, tenantId);
  const response = { order: updated };
  logEvent(req.user, 'DELIVERY_OCCURRENCE', order.id, { reason, distanceMeters, geofenceWarning, response }, clientEventId);
  res.json(response);
});
app.post('/api/dispatch/reverse-checkin/:orderId', auth, requireRole('MANAGER','DISPATCHER'), (req, res) => {
  const tenantId = req.user.distributorId;
  const order = tenantRecords('orders', tenantId).find((o) => o.id === req.params.orderId);
  if (!order || !['ocorrencia','entregue_parcial','cancelado_em_rota'].includes(order.status)) return res.status(409).json({ error: 'Pedido não está aguardando conferência reversa.' });
  const action = req.body?.action;
  if (!['reagendado_d1','baixa_avaria'].includes(action)) return res.status(400).json({ error: 'Ação de retorno inválida.' });
  const retainedWeight = Number(order.retainedWeightKg ?? order.weightKg ?? 0);
  const retainedVolume = Number(order.retainedVolumeM3 ?? (Number(order.weightKg) > 0 ? Number(order.volumeM3 || 0) * retainedWeight / Number(order.weightKg) : Number(order.volumeM3 || 0)));
  const updated = { ...order, status: action === 'reagendado_d1' ? 'reagendado_d1' : 'baixado_avaria',
    ...(action === 'reagendado_d1' ? { weightKg: retainedWeight, volumeM3: retainedVolume } : {}),
    retainedWeightKg: 0, retainedVolumeM3: 0, truckId: undefined, routeId: undefined, lifoPosition: undefined,
    reverseCheckedAt: new Date().toISOString() };
  saveRecord('orders', updated, tenantId);
  if (order.truckId) {
    const vehicle = tenantRecords('vehicles', tenantId).find((v) => v.id === order.truckId);
    if (vehicle) {
      const remainingIds = (vehicle.allocatedOrders || []).filter((id) => id !== order.id);
      saveRecord('vehicles', { ...vehicle, allocatedOrders: remainingIds, currentWeightKg: Math.max(0, Number(vehicle.currentWeightKg || 0) - retainedWeight), currentVolumeM3: Math.max(0, Number((Number(vehicle.currentVolumeM3 || 0) - retainedVolume).toFixed(3))), status: remainingIds.length ? vehicle.status : 'disponivel' }, tenantId);
    }
  }
  closeRouteIfSettled(order.routeId, tenantId);
  logEvent(req.user, 'REVERSE_CHECKIN', order.id, { action });
  res.json({ order: updated, orders: tenantRecords('orders', tenantId), vehicles: tenantRecords('vehicles', tenantId) });
});

app.get('/api/communications', auth, (req, res) => {
  const tenantId = req.user.distributorId;
  let messages = tenantMessages(tenantId);
  if (req.user.role === 'DRIVER') {
    const vehicle = findDriverVehicle(tenantId, req.user);
    const activeRouteId = vehicle?.activeRouteId;
    messages = activeRouteId ? messages.filter((m) => m.routeId === activeRouteId) : messages.filter((m) => m.senderId === req.user.id);
  }
  res.json(messages);
});
app.post('/api/communications', auth, requireRole('MANAGER','DISPATCHER','DRIVER'), (req, res) => {
  const tenantId = req.user.distributorId;
  const message = String(req.body?.message || '').trim();
  const kind = String(req.body?.kind || 'text');
  const allowedKinds = new Set(['arrived','waiting','help','delay','next_stop','text','central_reply']);
  if (!message || message.length > 500 || !allowedKinds.has(kind)) return res.status(400).json({ error: 'Envie uma mensagem de até 500 caracteres e um tipo válido.' });
  const clientEventId = String(req.body?.clientEventId || '').slice(0, 100) || null;
  const routeId = req.body?.routeId ? String(req.body.routeId) : null;
  const orderId = req.body?.orderId ? String(req.body.orderId) : null;
  if (routeId && !tenantRecords('routes', tenantId).some((r) => r.id === routeId)) return res.status(404).json({ error: 'Rota não encontrada nesta distribuidora.' });
  if (orderId && !tenantRecords('orders', tenantId).some((o) => o.id === orderId && (!routeId || o.routeId === routeId))) return res.status(404).json({ error: 'Pedido não pertence à rota informada.' });
  if (req.user.role === 'DRIVER') {
    const vehicle = findDriverVehicle(tenantId, req.user);
    if (!vehicle?.activeRouteId || routeId !== vehicle.activeRouteId) return res.status(403).json({ error: 'O motorista só pode comunicar a rota atualmente atribuída.' });
  }
  const id = newId();
  if (clientEventId) {
    db.prepare(`INSERT OR IGNORE INTO operational_messages
      (id,distributor_id,client_event_id,route_id,order_id,sender_id,sender_name,sender_role,kind,message)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, tenantId, clientEventId, routeId, orderId, req.user.id, req.user.name, req.user.role, kind, message);
  } else {
    db.prepare(`INSERT INTO operational_messages
      (id,distributor_id,route_id,order_id,sender_id,sender_name,sender_role,kind,message)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, tenantId, routeId, orderId, req.user.id, req.user.name, req.user.role, kind, message);
  }
  const saved = clientEventId
    ? db.prepare('SELECT id,client_event_id,route_id,order_id,sender_id,sender_name,sender_role,kind,message,created_at FROM operational_messages WHERE distributor_id = ? AND client_event_id = ?').get(tenantId, clientEventId)
    : db.prepare('SELECT id,client_event_id,route_id,order_id,sender_id,sender_name,sender_role,kind,message,created_at FROM operational_messages WHERE id = ?').get(id);
  const item = { id: saved.id, clientEventId: saved.client_event_id, routeId: saved.route_id, orderId: saved.order_id,
    senderId: saved.sender_id, senderName: saved.sender_name, senderRole: saved.sender_role, kind: saved.kind,
    message: saved.message, createdAt: saved.created_at };
  logEvent(req.user, 'OPERATIONAL_MESSAGE', orderId, { routeId, kind, message });
  res.status(201).json(item);
});

app.get('/api/config', auth, requireRole('MANAGER'), (req, res) => {
  const row = db.prepare('SELECT data_json FROM system_config WHERE distributor_id = ?').get(req.user.distributorId);
  res.json(row ? JSON.parse(row.data_json) : DEFAULT_CONFIG);
});
app.put('/api/config', auth, requireRole('MANAGER'), (req, res) => {
  const current = db.prepare('SELECT data_json FROM system_config WHERE distributor_id = ?').get(req.user.distributorId);
  const updated = { ...(current ? JSON.parse(current.data_json) : DEFAULT_CONFIG), ...req.body };
  for (const key of Object.keys(updated)) if (!Number.isFinite(Number(updated[key]))) delete updated[key];
  db.prepare(`INSERT INTO system_config (distributor_id,data_json,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(distributor_id) DO UPDATE SET data_json=excluded.data_json,updated_at=CURRENT_TIMESTAMP`)
    .run(req.user.distributorId, JSON.stringify(updated));
  res.json(updated);
});

app.get('/api/users', auth, requireRole('MANAGER'), (req, res) => {
  const rows = db.prepare('SELECT id,name,email,role,active,created_at FROM users WHERE distributor_id = ? ORDER BY created_at DESC').all(req.user.distributorId);
  res.json(rows.map((u) => ({ ...u, active: Boolean(u.active) })));
});
app.post('/api/users', auth, requireRole('MANAGER'), (req, res) => {
  const { name, email, role, password } = req.body || {};
  if (!name || !email || !password || String(password).length < 8 || !['MANAGER','DISPATCHER','DRIVER','SALES_REP'].includes(role)) return res.status(400).json({ error: 'Informe nome, e-mail, perfil válido e senha com pelo menos 8 caracteres.' });
  const salt = crypto.randomBytes(16).toString('hex');
  try {
    const id = newId();
    db.prepare(`INSERT INTO users (id,distributor_id,name,email,role,password_salt,password_hash) VALUES (?,?,?,?,?,?,?)`)
      .run(id, req.user.distributorId, String(name).trim(), String(email).trim().toLowerCase(), role, salt, hashPassword(password, salt));
    res.status(201).json({ id, name, email: String(email).trim().toLowerCase(), role, active: true });
  } catch { res.status(409).json({ error: 'Este e-mail já está cadastrado.' }); }
});
app.patch('/api/users/:id', auth, requireRole('MANAGER'), (req, res) => {
  if (req.params.id === req.user.id && req.body.active === false) return res.status(400).json({ error: 'Você não pode desativar o próprio usuário.' });
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND distributor_id = ?').get(req.params.id, req.user.distributorId);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(req.body.active === false ? 0 : 1, user.id);
  res.json({ ok: true });
});

function apiKeyAuth(req, res, next) {
  const token = req.headers['x-api-key'];
  if (!token) return res.status(401).json({ error: 'Envie o cabeçalho X-API-Key.' });
  const key = db.prepare('SELECT * FROM api_keys WHERE token_hash = ?').get(hashToken(token));
  if (!key) return res.status(401).json({ error: 'API key inválida.' });
  db.prepare('UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(key.id);
  req.distributorId = key.distributor_id;
  next();
}
app.get('/api/integrations/api-keys', auth, requireRole('MANAGER'), (req, res) => {
  res.json(db.prepare('SELECT id,label,token_prefix,created_at,last_used_at FROM api_keys WHERE distributor_id = ? ORDER BY created_at DESC').all(req.user.distributorId));
});
app.post('/api/integrations/api-keys', auth, requireRole('MANAGER'), (req, res) => {
  const token = `lm_${crypto.randomBytes(28).toString('base64url')}`;
  const id = newId();
  db.prepare('INSERT INTO api_keys (id,distributor_id,label,token_hash,token_prefix) VALUES (?,?,?,?,?)')
    .run(id, req.user.distributorId, String(req.body?.label || 'Integração externa'), hashToken(token), token.slice(0, 11));
  res.status(201).json({ id, label: req.body?.label || 'Integração externa', token, warning: 'Copie agora. Por segurança, o segredo completo não será exibido novamente.' });
});
app.delete('/api/integrations/api-keys/:id', auth, requireRole('MANAGER'), (req, res) => {
  const result = db.prepare('DELETE FROM api_keys WHERE id = ? AND distributor_id = ?').run(req.params.id, req.user.distributorId);
  res.json({ deleted: result.changes > 0 });
});
app.post('/api/integrations/orders', apiKeyAuth, (req, res) => {
  const list = Array.isArray(req.body?.orders) ? req.body.orders : [req.body];
  const saved = list.map((entry) => {
    const b = sanitizeOrder(entry);
    const missing = [];
    if (!b.customerName && !b.tradeName) missing.push('cliente');
    if (!(Number(b.weightKg) > 0)) missing.push('peso');
    if (!(Number(b.volumeM3) > 0)) missing.push('cubagem');
    if (!b.address) missing.push('endereço');
    const items = auditItems(b.items || []);
    const expired = items.some((item) => item.shelfLifeDays <= 0);
    return saveRecord('orders', { ...b, tradeName: b.tradeName || b.customerName || 'Cliente não informado', customerName: b.customerName || b.tradeName || 'Cliente não informado', id: b.externalId || b.id || newId(), status: expired ? 'bloqueio_fiscal' : missing.length ? 'pendente_complemento' : 'pendente', missingFields: missing, source: 'api_externa', items }, req.distributorId);
  });
  res.status(201).json({ received: saved.length, orders: saved.map((o) => ({ id: o.id, status: o.status })) });
});

app.get('/api/integrations/whatsapp/status', auth, requireRole('MANAGER'), (_req, res) => {
  const configured = Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_API_VERSION);
  const webhookConfigured = Boolean(process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_APP_SECRET);
  res.json({ configured, provider: 'WhatsApp Cloud API (Meta)', webhookConfigured, note: configured ? 'Credenciais encontradas no servidor.' : 'Configure as variáveis no arquivo .env do servidor.' });
});
app.post('/api/integrations/whatsapp/send', auth, requireRole('MANAGER','DISPATCHER'), async (req, res) => {
  const { to, message } = req.body || {};
  if (!to || !message) return res.status(400).json({ error: 'Informe destinatário e mensagem.' });
  if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID || !process.env.WHATSAPP_API_VERSION) {
    return res.status(503).json({ error: 'WhatsApp não configurado. Defina WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_API_VERSION no servidor.' });
  }
  try {
    const response = await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: String(to).replace(/\D/g, ''), type: 'text', text: { preview_url: false, body: String(message) } })
    });
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: 'Meta recusou o envio.', details: data });
    res.json({ sent: true, messageId: data.messages?.[0]?.id || null });
  } catch (error) { res.status(502).json({ error: 'Falha de comunicação com a API do WhatsApp.', details: String(error) }); }
});
app.get('/api/integrations/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && process.env.WHATSAPP_VERIFY_TOKEN && token === process.env.WHATSAPP_VERIFY_TOKEN) return res.status(200).send(String(challenge || ''));
  res.sendStatus(403);
});
app.post('/api/integrations/whatsapp/webhook', (req, res) => {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const signature = String(req.headers['x-hub-signature-256'] || '');
  if (!secret || !signature.startsWith('sha256=')) return res.sendStatus(403);
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.alloc(0)).digest('hex')}`;
  if (!safeEqual(signature, expected)) return res.sendStatus(403);
  const changes = req.body?.entry?.flatMap((entry) => entry.changes || []) || [];
  const allConfigs = db.prepare('SELECT distributor_id, data_json FROM system_config').all();
  for (const change of changes) {
    const phoneNumberId = change.value?.metadata?.phone_number_id || null;
    const matchedCfg = phoneNumberId ? allConfigs.find((c) => { try { return JSON.parse(c.data_json).whatsappPhoneNumberId === phoneNumberId; } catch { return false; } }) : null;
    const targetTenantId = matchedCfg?.distributor_id || process.env.WHATSAPP_DEFAULT_DISTRIBUTOR_ID || distributorId;
    for (const message of (change.value?.messages || [])) {
      const rawMessage = message.text?.body || '';
      const sourcePhone = String(message.from || 'contato');
      const inboundOrder = {
        id: newId(), tradeName: `Pedido WhatsApp · ${sourcePhone}`, customerName: `Contato ${sourcePhone}`,
        cnpj: '', address: '', neighborhood: '', city: 'Salvador', state: 'BA', weightKg: 0, volumeM3: 0,
        totalValue: 0, timeWindow: '08:00–17:00', status: 'pendente_complemento',
        missingFields: ['cliente', 'endereço', 'peso', 'cubagem'], items: [], source: 'whatsapp', rawMessage,
        whatsappFrom: sourcePhone, createdAt: new Date().toISOString()
      };
      saveRecord('orders', inboundOrder, targetTenantId);
      db.prepare('INSERT INTO delivery_events (id,distributor_id,order_id,event_type,data_json) VALUES (?,?,?,?,?)')
        .run(newId(), targetTenantId, inboundOrder.id, 'WHATSAPP_INBOUND', JSON.stringify({ from: sourcePhone, phoneNumberId, text: rawMessage, receivedAt: new Date().toISOString() }));
    }
  }
  res.sendStatus(200);
});

app.get('/api/audit', auth, (req, res) => {
  const rows = db.prepare('SELECT id,order_id,event_type,data_json,created_at FROM delivery_events WHERE distributor_id = ? ORDER BY created_at DESC LIMIT 200').all(req.user.distributorId);
  res.json(rows.map((r) => ({ ...r, data: JSON.parse(r.data_json) })));
});

app.use((err, _req, res, _next) => {
  console.error('[LogisticMaster API]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Erro interno na operação. Consulte o log do servidor.' });
});

// Production: Vite's compiled frontend is served by the same process.
const distPath = path.join(appRoot, 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}
const port = Number(process.env.PORT || 4000);
app.listen(port, '0.0.0.0', () => console.log(`LogisticMaster API pronta em http://localhost:${port}`));
