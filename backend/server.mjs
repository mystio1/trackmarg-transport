import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { MongoClient } from 'mongodb';

// ── Load .env file (no dotenv package needed) ──────────────────────────────
(function loadEnv() {
  try {
    const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let val = trimmed.slice(eqIndex + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* .env not found — rely on system env */ }
})();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir  = path.resolve(__dirname, '..');
const dataDir  = path.join(__dirname, 'data');
const dbPath   = path.join(dataDir, 'db.json');
const distDir  = path.join(rootDir, 'dist');
const port     = Number(process.env.PORT || 4000);
const host     = process.env.HOST || '0.0.0.0';

// ── Session secret (persisted so sessions survive restarts) ────────────────
// On a real deployment (Render, etc.) the disk is ephemeral, so set SESSION_SECRET as an
// env var there — otherwise every restart invalidates all logged-in sessions. Locally, we
// fall back to a file so `npm run dev`/`npm run server` don't need any setup.
const sessionSecret = process.env.SESSION_SECRET || (() => {
  const secretPath = path.join(dataDir, '.session_secret');
  fs.mkdirSync(dataDir, { recursive: true });
  try { return fs.readFileSync(secretPath, 'utf8').trim(); } catch {}
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretPath, secret);
  return secret;
})();

const clientsByGroup = new Map();

// ── DB helpers ─────────────────────────────────────────────────────────────
// Persistence is a single JSON-shaped document, stored either in MongoDB (Atlas or
// self-hosted — set MONGODB_URI) or, if that's not configured, in a local file — same shape
// either way, so every route above just does `await readDb()` / `await writeDb(db)` without
// caring which backend is active. Fine at this app's scale (one document well under MongoDB's
// 16MB limit); a larger deployment would want separate collections per entity instead.
const mongoUri    = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB || 'shivam_transport';
const usingMongo  = Boolean(mongoUri);

// Master password for the cross-tenant support console (see "Support/master access" below).
// Unset by default — the feature is entirely disabled until this is explicitly configured, so a
// fresh deploy never ships with a support backdoor nobody set on purpose.
const supportPassword = process.env.SUPPORT_ACCESS_PASSWORD || '';
const STATE_ID    = 'main';
let mongoClient;
let stateCollection;

async function connectMongo() {
  // Explicit, capped pool size (same reasoning as backend/src's Postgres pool: bound how many
  // connections this single process can ever hold open) plus a short server-selection timeout so
  // a database that's unreachable fails fast instead of hanging requests indefinitely.
  mongoClient = new MongoClient(mongoUri, { maxPoolSize: 10, serverSelectionTimeoutMS: 10_000 });
  await mongoClient.connect();
  stateCollection = mongoClient.db(mongoDbName).collection('appState');
  await stateCollection.createIndex({ _id: 1 });
  const existing = await stateCollection.findOne({ _id: STATE_ID });
  if (!existing) {
    await writeDb({ users: [], groups: [], customers: [], trips: [], auditLogs: [], bills: [], vehicles: [], tripEditRequests: [] });
  }
}

function ensureDbFile() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) {
    writeDbFile({ users: [], groups: [], customers: [], trips: [], auditLogs: [], bills: [], vehicles: [], tripEditRequests: [] });
  }
}

function readDbFile() {
  ensureDbFile();
  return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
}

function writeDbFile(db) {
  fs.mkdirSync(dataDir, { recursive: true });
  const tempPath = `${dbPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(db, null, 2));
  fs.renameSync(tempPath, dbPath);
}

async function readDb() {
  let db;
  if (usingMongo) {
    const doc = await stateCollection.findOne({ _id: STATE_ID });
    const { _id, ...rest } = doc;
    db = rest;
  } else {
    db = readDbFile();
  }
  // Backward compatible with db files/documents written before these existed.
  if (!Array.isArray(db.bills)) db.bills = [];
  if (!Array.isArray(db.vehicles)) db.vehicles = [];
  if (!Array.isArray(db.tripEditRequests)) db.tripEditRequests = [];
  return db;
}

async function writeDb(db) {
  if (!usingMongo) return writeDbFile(db);
  await stateCollection.replaceOne({ _id: STATE_ID }, { _id: STATE_ID, ...db }, { upsert: true });
}

function now()      { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`; }

function normalizeGroupCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generateGroupCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Short, human-readable ID shown next to a person's name wherever it might otherwise be
// ambiguous (two drivers both named "Ramesh", say) — e.g. "D-8F3A". Not used for login;
// phone number already uniquely identifies who's signing in.
function generateUserCode(role) {
  return `${role === 'admin' ? 'A' : 'D'}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

// ── Password hashing (PBKDF2, 100k iterations — no extra packages) ─────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored || '').split(':');
    if (!salt || !hash) return false;
    const computed = crypto.pbkdf2Sync(String(password), salt, 100000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
  } catch { return false; }
}

// ── Session tokens (30-day, HMAC-signed) ──────────────────────────────────
function createSessionToken(userId, groupCode, role) {
  const payload = { userId, groupCode, role, exp: Date.now() + 1000 * 60 * 60 * 24 * 30 };
  const encoded = base64url(payload);
  const sig = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySessionToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expected = crypto.createHmac('sha256', sessionSecret).update(encoded).digest('base64url');
    if (expected.length !== sig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

// ── Support tokens (4-hour, HMAC-signed, NOT tied to any group or user) ────
// Deliberately signed with a distinct HMAC input (`support:${encoded}`, vs. a bare session
// token's `${encoded}`) so a support token and a normal session token can never be confused for
// each other even though they share the same secret and encoding — verifySessionToken will
// reject a support token's signature and vice versa.
function createSupportToken() {
  const payload = { support: true, exp: Date.now() + 1000 * 60 * 60 * 4 };
  const encoded = base64url(payload);
  const sig = crypto.createHmac('sha256', sessionSecret).update(`support:${encoded}`).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySupportToken(req, url) {
  const token = getBearerToken(req, url);
  if (!token) return false;
  const parts = String(token).split('.');
  if (parts.length !== 2) return false;
  const [encoded, sig] = parts;
  const expected = crypto.createHmac('sha256', sessionSecret).update(`support:${encoded}`).digest('base64url');
  if (expected.length !== sig.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    return Boolean(payload.support) && payload.exp > Date.now();
  } catch { return false; }
}

function safeUser(user) {
  if (!user) return null;
  const { passwordHash, resetOtpHash, resetOtpExpiresAt, resetOtpAttempts, ...safe } = user;
  return safe;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────
function send(res, status, body) {
  const content = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(content),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  });
  res.end(content);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 4 * 1024 * 1024) { req.destroy(); reject(new Error('Request body too large')); }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('Invalid JSON body')); }
    });
  });
}

function getBearerToken(req, url) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return url.searchParams.get('token');
}

// ── Rate limiting (per-IP, in-memory) ───────────────────────────────────────
// Single-process self-hosted server (no Redis/reverse-proxy assumed), so an in-memory map is
// enough. Protects login (password guessing) and signup (guessing another business's 6-char
// group code to self-register as a "driver" in their account) from brute forcing.
const rateLimitHits = new Map(); // `${ip}:${bucket}` -> timestamps (ms) within the current window

function getClientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

function isRateLimited(req, bucket, max, windowMs) {
  const key = `${getClientIp(req)}:${bucket}`;
  const now = Date.now();
  const hits = (rateLimitHits.get(key) || []).filter(t => now - t < windowMs);
  hits.push(now);
  rateLimitHits.set(key, hits);
  return hits.length > max;
}

// Periodically drop stale entries so the map doesn't grow unbounded over a long-running process.
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of rateLimitHits) {
    const fresh = hits.filter(t => now - t < 60 * 60 * 1000);
    if (fresh.length) rateLimitHits.set(key, fresh);
    else rateLimitHits.delete(key);
  }
}, 10 * 60 * 1000).unref();

// ── DB circuit breaker (Mongo mode only — see readDb/writeDb) ──────────────
// If MongoDB starts failing, stop hammering it and fail every request fast instead of letting
// each one pile up its own timeout against an already-struggling database.
const DB_FAILURE_THRESHOLD = 5;
const DB_FAILURE_WINDOW_MS = 10 * 1000;
const DB_COOLDOWN_MS = 15 * 1000;
let dbFailureTimestamps = [];
let dbBreakerOpenUntil = 0;

function isDbBreakerOpen() {
  return Date.now() < dbBreakerOpenUntil;
}

function dbBreakerRetryAfterMs() {
  return Math.max(0, dbBreakerOpenUntil - Date.now());
}

function recordDbFailure() {
  const now = Date.now();
  dbFailureTimestamps.push(now);
  dbFailureTimestamps = dbFailureTimestamps.filter(t => now - t < DB_FAILURE_WINDOW_MS);
  if (dbFailureTimestamps.length >= DB_FAILURE_THRESHOLD) {
    dbBreakerOpenUntil = now + DB_COOLDOWN_MS;
    dbFailureTimestamps = [];
  }
}

async function requireAuth(req, url) {
  const token = getBearerToken(req, url);
  if (!token) return null;
  const payload = verifySessionToken(token);
  if (!payload) return null;
  const db = await readDb();
  const user = db.users.find(u => u.id === payload.userId && u.groupCode === payload.groupCode && u.active);
  return user ? { db, user } : null;
}

function requireRole(auth, role) {
  return auth?.user?.role === role;
}

function broadcast(groupCode, event, payload) {
  const clients = clientsByGroup.get(groupCode);
  if (!clients) return;
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(data);
}

function addAudit(db, user, action, entityId, details = {}) {
  db.auditLogs.push({
    id: id('audit'), groupCode: user.groupCode, userId: user.id, userName: user.name,
    action, entityId, details, createdAt: now(),
  });
}

// Every action that produces a real invoice document for a customer — saving it to My Bills,
// downloading it as a PDF, or sharing it to WhatsApp — counts toward the support-set "max bills
// per day" cap, not just the ones that end up persisted as a bill record.
const BILL_GENERATION_ACTIONS = ['bill.save', 'bill.generate'];

function countBillGenerationsToday(db, groupCode, since) {
  return db.auditLogs.filter(a => a.groupCode === groupCode && BILL_GENERATION_ACTIONS.includes(a.action) && new Date(a.createdAt) >= since).length;
}

// Shared by both POST /api/bills (save to My Bills) and POST /api/bills/generation
// (download/WhatsApp, which don't otherwise touch the server at all).
function checkDailyBillLimit(db, group) {
  if (group?.maxBillsPerDay == null) return null;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const billsToday = countBillGenerationsToday(db, group.code, startOfToday);
  if (billsToday >= group.maxBillsPerDay) {
    return {
      message: `Daily bill limit reached (${group.maxBillsPerDay}/day). Contact support to increase it.`,
      code: 'BILL_LIMIT_REACHED',
    };
  }
  return null;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

// ── Bill branding (per-group, admin-editable) ───────────────────────────────
const DEFAULT_BRANDING = {
  companyName: 'Transport Manager',
  tagline: 'Transport & Logistics Solutions',
  proprietorName: '',
  phone1: '',
  phone2: '',
  address: '',
  gstNumber: '',
  footerNote: 'Thank you for your business!',
  primaryColor: '#0B2B5E',
  accentColor: '#F0B90B',
  logoDataUrl: '',
  signatureDataUrl: '',
  headerLeftImageDataUrl: '',
  headerRightImageDataUrl: '',
  upiQrImageDataUrl: '',
  upiQrShowOn: 'both',
  bankName: '',
  bankBranch: '',
  bankAccountNumber: '',
  bankIfsc: '',
  bankAccounts: [],
  publicServerUrl: '',
  nextInvoiceNumber: 1,
};

function sanitizeBankAccounts(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map(account => ({
    id: String(account?.id || '').trim() || id('bank'),
    label: String(account?.label || '').trim(),
    bankName: String(account?.bankName || '').trim(),
    bankBranch: String(account?.bankBranch || '').trim(),
    accountNumber: String(account?.accountNumber || '').trim(),
    ifscCode: String(account?.ifscCode || '').trim(),
  })).filter(account => account.label || account.bankName || account.accountNumber);
}

function getBranding(group) {
  return { ...DEFAULT_BRANDING, ...(group?.branding || {}) };
}

let mailTransporter = null;
function getMailTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
  }
  return mailTransporter;
}

function validateTripInput(body) {
  const errors = [];
  if (!String(body.customerName || '').trim() && !String(body.customerId || '').trim())
    errors.push('Customer is required');
  if (!String(body.pickupLocation || '').trim()) errors.push('Pickup location is required');
  if (!String(body.dropLocation || '').trim()) errors.push('Drop location is required');
  if (toNumber(body.amount) <= 0) errors.push('Amount must be greater than zero');
  if (toNumber(body.advanceAmount) < 0) errors.push('Advance amount cannot be negative');
  return errors;
}

function findOrCreateCustomer(db, groupCode, trip) {
  if (trip.customerId) {
    const existing = db.customers.find(c => c.groupCode === groupCode && c.id === trip.customerId);
    if (existing) return existing;
  }
  const name = String(trip.customerName || '').trim();
  const phone = String(trip.customerPhone || '').trim();
  const existingByName = db.customers.find(
    c => c.groupCode === groupCode && c.name.toLowerCase() === name.toLowerCase()
  );
  if (existingByName) return existingByName;
  const customer = {
    id: id('customer'), groupCode, name, phone,
    address: String(trip.customerAddress || '').trim(),
    email: '', gstNumber: '', advanceBalance: 0,
    createdAt: now(), updatedAt: now(),
  };
  db.customers.push(customer);
  return customer;
}

// ── Static file serving ────────────────────────────────────────────────────
function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const filePath = urlPath === '/' ? path.join(distDir, 'index.html') : path.join(distDir, urlPath);
  const resolved = path.resolve(filePath);
  const safeTarget = resolved.startsWith(path.resolve(distDir)) ? resolved : path.join(distDir, 'index.html');
  const fallback = path.join(distDir, 'index.html');
  const target = fs.existsSync(safeTarget) && fs.statSync(safeTarget).isFile() ? safeTarget : fallback;

  if (!fs.existsSync(target)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Build the frontend first with: npm run build');
    return;
  }

  const ext = path.extname(target).toLowerCase();
  const mime = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.mp4': 'video/mp4', '.webm': 'video/webm',
  }[ext] || 'application/octet-stream';
  const isMedia = ext === '.mp4' || ext === '.webm';
  const { size } = fs.statSync(target);

  // Video needs real byte-range support — iOS Safari's WebView (and some Android WebViews)
  // refuse to play a <video> at all unless the server answers its Range probe with a 206
  // instead of just handing back a plain 200 with the whole file.
  const range = isMedia ? req.headers.range : null;
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    const start = match && match[1] ? parseInt(match[1], 10) : 0;
    const end = match && match[2] ? parseInt(match[2], 10) : size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Type': mime,
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Cache-Control': 'public, max-age=86400',
    });
    fs.createReadStream(target, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Content-Length': size,
    ...(isMedia ? { 'Cache-Control': 'public, max-age=86400' } : {}),
  });
  fs.createReadStream(target).pipe(res);
}

// ── API routes ─────────────────────────────────────────────────────────────
async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (req.method === 'OPTIONS') return send(res, 204, {});

  if (pathname === '/api/health') {
    return send(res, 200, { ok: true, time: now() });
  }

  // If MongoDB is configured and currently failing, stop hammering it and fail fast instead of
  // letting every request pile up its own timeout against an already-struggling database — the
  // same reasoning as backend/src's dbCircuitBreaker. Not applicable to the local-file mode
  // (nothing to "overload" reading a file off disk), so this is a no-op unless MONGODB_URI is set.
  if (usingMongo && isDbBreakerOpen()) {
    const retryAfterSec = Math.max(1, Math.ceil(dbBreakerRetryAfterMs() / 1000));
    res.setHeader('Retry-After', String(retryAfterSec));
    return send(res, 503, {
      message: 'The database is temporarily unavailable — please try again in a few seconds.',
      code: 'DB_UNAVAILABLE',
    });
  }

  // ── SIGNUP (Admin creates group; Driver joins with group code) ────────────
  if (pathname === '/api/auth/signup' && req.method === 'POST') {
    // Signup doubles as a group-code guesser (drivers join with just a 6-char code) — keep the
    // attempt budget low per IP per hour so brute-forcing another business's code isn't practical.
    if (isRateLimited(req, 'signup', 8, 60 * 60 * 1000)) {
      return send(res, 429, { message: 'Too many signup attempts. Please try again later.' });
    }
    const body = await readBody(req);
    const role     = body.role === 'admin' ? 'admin' : 'driver';
    const name     = String(body.name || '').trim();
    const phone    = String(body.phone || '').trim();
    const password = String(body.password || '');
    const email    = String(body.email || '').trim().toLowerCase();
    const requestedGroupCode = normalizeGroupCode(body.groupCode);
    const groupName = String(body.groupName || '').trim();

    if (!name || !phone)
      return send(res, 400, { message: 'Name and phone are required' });
    if (!password || password.length < 6)
      return send(res, 400, { message: 'Password must be at least 6 characters' });
    if (email && !isValidEmail(email))
      return send(res, 400, { message: 'Enter a valid email address' });

    const db = await readDb();
    let groupCode = requestedGroupCode;
    let group = groupCode ? db.groups.find(g => g.code === groupCode) : null;

    if (role === 'driver' && !group) {
      return send(res, 400, { message: 'A valid group code from your admin is required to register as a driver' });
    }

    if (role === 'admin' && !group) {
      if (!groupName) return send(res, 400, { message: 'A business name is required' });
      groupCode = groupCode || generateGroupCode();
      while (db.groups.some(g => g.code === groupCode)) groupCode = generateGroupCode();
      group = {
        code: groupCode,
        name: groupName,
        frozen: false,
        createdAt: now(),
      };
      db.groups.push(group);
    }

    // Support-console-managed seat caps — `null`/undefined means unlimited (the default until
    // support sets one). A brand-new group can never have one of these set, since support only
    // manages groups it can already see in its console, so this can't accidentally block someone
    // creating a fresh business.
    if (role === 'driver' && group.maxDrivers != null) {
      const count = db.users.filter(u => u.groupCode === group.code && u.role === 'driver' && u.active).length;
      if (count >= group.maxDrivers) {
        return send(res, 403, {
          message: `This group has reached its limit of ${group.maxDrivers} driver${group.maxDrivers === 1 ? '' : 's'}. Contact your admin or support.`,
          code: 'DRIVER_LIMIT_REACHED',
        });
      }
    }
    if (role === 'admin' && group.maxAdmins != null) {
      const count = db.users.filter(u => u.groupCode === group.code && u.role === 'admin' && u.active).length;
      if (count >= group.maxAdmins) {
        return send(res, 403, {
          message: `This group has reached its limit of ${group.maxAdmins} admin${group.maxAdmins === 1 ? '' : 's'}. Contact support to increase it.`,
          code: 'ADMIN_LIMIT_REACHED',
        });
      }
    }

    const duplicate = db.users.find(u => u.groupCode === groupCode && u.phone === phone);
    if (duplicate)
      return send(res, 409, { message: 'A user with this phone already exists in this group' });

    let userCode = generateUserCode(role);
    while (db.users.some(u => u.userCode === userCode)) userCode = generateUserCode(role);

    const user = {
      id: id('user'), groupCode, role, name, phone, userCode, email,
      passwordHash: hashPassword(password),
      active: true, createdAt: now(), updatedAt: now(),
    };
    db.users.push(user);
    addAudit(db, user, 'user.signup', user.id, { role: user.role });
    await writeDb(db);

    const token = createSessionToken(user.id, user.groupCode, user.role);
    return send(res, 201, { token, user: safeUser(user), group });
  }

  // ── LOGIN ─────────────────────────────────────────────────────────────────
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    if (isRateLimited(req, 'login', 5, 60 * 1000)) {
      return send(res, 429, { message: 'Too many login attempts. Please wait a minute and try again.' });
    }
    const body      = await readBody(req);
    const phone     = String(body.phone || '').trim();
    const password  = String(body.password || '');
    // Optional now — a phone number is only unique within a group here (db.users is keyed by
    // groupCode+phone, never globally), so login resolves the account by phone + password alone
    // across every group that phone appears in. Still accepted so the picker below can complete
    // a login it already narrowed down to one specific account.
    const groupCode = normalizeGroupCode(body.groupCode);

    if (!phone || !password)
      return send(res, 400, { message: 'Phone and password are required' });

    const db = await readDb();

    const candidates = groupCode
      ? db.users.filter(u => u.groupCode === groupCode && u.phone === phone && u.active)
      : db.users.filter(u => u.phone === phone && u.active);
    const matches = candidates.filter(u => verifyPassword(password, u.passwordHash));

    if (matches.length === 0)
      return send(res, 401, { message: 'Invalid phone number or password' });

    if (matches.length > 1) {
      // Same phone AND the same password valid in more than one business — rare, but real (see
      // the identical comment in backend/src/routes/auth.routes.ts). Hand back the short list
      // instead of guessing; the client's follow-up call includes groupCode.
      const accounts = matches.map(u => {
        const g = db.groups.find(g => g.code === u.groupCode);
        return { groupCode: u.groupCode, groupName: g ? g.name : u.groupCode };
      });
      return send(res, 200, { requiresGroupSelection: true, accounts });
    }

    const user  = matches[0];
    const group = db.groups.find(g => g.code === user.groupCode);
    if (group && group.frozen) {
      return send(res, 423, {
        message: 'This account has been frozen by our support console. Your data is safe — contact support for recovery.',
        code: 'ACCOUNT_FROZEN',
      });
    }

    const token = createSessionToken(user.id, user.groupCode, user.role);
    return send(res, 200, { token, user: safeUser(user), group });
  }

  // ── FORGOT PASSWORD (admin only — drivers get their password reset by their admin instead) ──
  // Always responds with the same generic message regardless of whether the account/email
  // actually matched, so this can't be used to probe which phone numbers have accounts.
  if (pathname === '/api/auth/forgot-password' && req.method === 'POST') {
    if (isRateLimited(req, 'forgot-password', 5, 60 * 60 * 1000)) {
      return send(res, 429, { message: 'Too many requests. Please try again later.' });
    }
    const body = await readBody(req);
    const phone = String(body.phone || '').trim();
    const groupCode = normalizeGroupCode(body.groupCode);
    const genericResponse = { message: 'If that account has a recovery email on file, a reset code has been sent to it.' };
    if (!phone || !groupCode) return send(res, 400, { message: 'Phone and group code are required' });

    const db = await readDb();
    const user = db.users.find(u => u.groupCode === groupCode && u.phone === phone && u.role === 'admin' && u.active);
    const transporter = getMailTransporter();
    if (user && user.email && transporter) {
      const otp = String(crypto.randomInt(100000, 1000000));
      user.resetOtpHash = hashPassword(otp);
      user.resetOtpExpiresAt = Date.now() + 15 * 60 * 1000;
      user.resetOtpAttempts = 0;
      await writeDb(db);
      try {
        const group = db.groups.find(g => g.code === groupCode);
        const fromName = getBranding(group).companyName || 'Transport Manager';
        await transporter.sendMail({
          from: `"${fromName}" <${process.env.GMAIL_USER}>`,
          to: user.email,
          subject: 'Your password reset code',
          text: `Your password reset code is ${otp}. It expires in 15 minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
        });
      } catch (error) {
        console.error('Failed to send password reset email:', error);
      }
    }
    return send(res, 200, genericResponse);
  }

  // Shared by /verify-reset-otp and /reset-password so a wrong guess in either place counts
  // the same way against the 5-attempt cap. Returns 'ok', 'expired', 'too-many', or 'wrong' —
  // callers decide what to do (verify just reports it; reset also needs 'ok' to proceed).
  function checkResetOtp(user, otp) {
    if (!user || !user.resetOtpHash || !user.resetOtpExpiresAt || user.resetOtpExpiresAt < Date.now()) {
      return 'expired';
    }
    if ((user.resetOtpAttempts || 0) >= 5) return 'too-many';
    if (!verifyPassword(otp, user.resetOtpHash)) return 'wrong';
    return 'ok';
  }

  // ── VERIFY RESET CODE (checked on its own, before the new-password step is shown) ────────
  if (pathname === '/api/auth/verify-reset-otp' && req.method === 'POST') {
    if (isRateLimited(req, 'reset-password', 10, 60 * 60 * 1000)) {
      return send(res, 429, { message: 'Too many attempts. Please try again later.' });
    }
    const body = await readBody(req);
    const phone = String(body.phone || '').trim();
    const groupCode = normalizeGroupCode(body.groupCode);
    const otp = String(body.otp || '').trim();
    const invalidOrExpired = { message: 'That code is invalid or has expired. Request a new one.' };
    if (!phone || !groupCode || !otp) return send(res, 400, { message: 'Phone, group code and reset code are required' });

    const db = await readDb();
    const user = db.users.find(u => u.groupCode === groupCode && u.phone === phone && u.role === 'admin' && u.active);
    const result = checkResetOtp(user, otp);
    if (result === 'too-many') {
      delete user.resetOtpHash; delete user.resetOtpExpiresAt; delete user.resetOtpAttempts;
      await writeDb(db);
      return send(res, 400, { message: 'Too many incorrect attempts. Please request a new code.' });
    }
    if (result === 'wrong') {
      user.resetOtpAttempts = (user.resetOtpAttempts || 0) + 1;
      await writeDb(db);
      return send(res, 400, invalidOrExpired);
    }
    if (result === 'expired') return send(res, 400, invalidOrExpired);
    return send(res, 200, { ok: true });
  }

  // ── RESET PASSWORD (consume the code emailed by /forgot-password) ────────
  if (pathname === '/api/auth/reset-password' && req.method === 'POST') {
    if (isRateLimited(req, 'reset-password', 10, 60 * 60 * 1000)) {
      return send(res, 429, { message: 'Too many attempts. Please try again later.' });
    }
    const body = await readBody(req);
    const phone = String(body.phone || '').trim();
    const groupCode = normalizeGroupCode(body.groupCode);
    const otp = String(body.otp || '').trim();
    const newPassword = String(body.newPassword || '');
    const invalidOrExpired = { message: 'That code is invalid or has expired. Request a new one.' };

    if (!phone || !groupCode || !otp) return send(res, 400, { message: 'Phone, group code and reset code are required' });
    if (newPassword.length < 6) return send(res, 400, { message: 'Password must be at least 6 characters' });

    const db = await readDb();
    const user = db.users.find(u => u.groupCode === groupCode && u.phone === phone && u.role === 'admin' && u.active);
    const result = checkResetOtp(user, otp);
    if (result === 'too-many') {
      delete user.resetOtpHash; delete user.resetOtpExpiresAt; delete user.resetOtpAttempts;
      await writeDb(db);
      return send(res, 400, { message: 'Too many incorrect attempts. Please request a new code.' });
    }
    if (result === 'wrong') {
      user.resetOtpAttempts = (user.resetOtpAttempts || 0) + 1;
      await writeDb(db);
      return send(res, 400, invalidOrExpired);
    }
    if (result === 'expired') return send(res, 400, invalidOrExpired);

    user.passwordHash = hashPassword(newPassword);
    user.updatedAt = now();
    delete user.resetOtpHash; delete user.resetOtpExpiresAt; delete user.resetOtpAttempts;
    addAudit(db, user, 'user.password.reset', user.id);
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  // ── Support/master access (cross-tenant, for remote troubleshooting) ───────
  // A single shared password grants a short-lived support token; that token can only be used
  // against the two endpoints below. Not reachable from the normal app UI — only from the
  // dedicated /support console page, and disabled entirely unless SUPPORT_ACCESS_PASSWORD is set.
  if (pathname === '/api/support/login' && req.method === 'POST') {
    if (!supportPassword) return send(res, 404, { message: 'Not found' });
    if (isRateLimited(req, 'support-login', 5, 15 * 60 * 1000)) {
      return send(res, 429, { message: 'Too many attempts. Please wait 15 minutes and try again.' });
    }
    const body = await readBody(req);
    const password = String(body.password || '');
    // Constant-time compare so response timing can't leak how many characters matched.
    const provided = Buffer.from(password.padEnd(supportPassword.length, '\0'));
    const expected = Buffer.from(supportPassword.padEnd(password.length, '\0'));
    const matches = password.length === supportPassword.length && crypto.timingSafeEqual(provided, expected);
    if (!matches) return send(res, 401, { message: 'Incorrect password' });
    return send(res, 200, { token: createSupportToken() });
  }

  if (pathname === '/api/support/groups' && req.method === 'GET') {
    if (!verifySupportToken(req, url)) return send(res, 401, { message: 'Support session expired — log in again' });
    const db = await readDb();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const groups = db.groups.map(group => ({
      code: group.code,
      name: group.name,
      createdAt: group.createdAt,
      adminCount: db.users.filter(u => u.groupCode === group.code && u.role === 'admin' && u.active).length,
      driverCount: db.users.filter(u => u.groupCode === group.code && u.role === 'driver' && u.active).length,
      customerCount: db.customers.filter(c => c.groupCode === group.code).length,
      tripCount: db.trips.filter(t => t.groupCode === group.code).length,
      frozen: Boolean(group.frozen),
      maxDrivers: group.maxDrivers ?? null,
      maxAdmins: group.maxAdmins ?? null,
      maxBillsPerDay: group.maxBillsPerDay ?? null,
      billsToday: countBillGenerationsToday(db, group.code, startOfToday),
    })).sort((a, b) => a.name.localeCompare(b.name));
    return send(res, 200, { groups });
  }

  // Support-set usage caps for a business — max active drivers, max active admins, and max bills
  // generated per calendar day. `null`/blank means unlimited. Enforced server-side at driver/admin
  // signup and bill creation above.
  if (pathname === '/api/support/set-limits' && req.method === 'POST') {
    if (!verifySupportToken(req, url)) return send(res, 401, { message: 'Support session expired — log in again' });
    const body      = await readBody(req);
    const groupCode = normalizeGroupCode(body.groupCode);
    const db        = await readDb();
    const group     = db.groups.find(g => g.code === groupCode);
    if (!group) return send(res, 404, { message: 'No business found with that code' });

    // A number of 0 or less is nonsensical for a "how many can there be" cap, so it's rejected
    // rather than silently treated as unlimited or as zero.
    const parseLimit = (value, label) => {
      if (value === null || value === undefined || value === '') return null;
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} must be a positive whole number, or left blank for unlimited`);
      return n;
    };
    let maxDrivers, maxAdmins, maxBillsPerDay;
    try {
      maxDrivers = parseLimit(body.maxDrivers, 'Max drivers');
      maxAdmins = parseLimit(body.maxAdmins, 'Max admins');
      maxBillsPerDay = parseLimit(body.maxBillsPerDay, 'Max bills per day');
    } catch (err) {
      return send(res, 400, { message: err.message });
    }

    group.maxDrivers = maxDrivers;
    group.maxAdmins = maxAdmins;
    group.maxBillsPerDay = maxBillsPerDay;
    const adminUser = db.users.find(u => u.groupCode === groupCode && u.role === 'admin' && u.active);
    if (adminUser) addAudit(db, adminUser, 'support.setLimits', group.code, { maxDrivers, maxAdmins, maxBillsPerDay });
    await writeDb(db);

    return send(res, 200, { group });
  }

  // Locks/unlocks a business from support — pushed instantly (same SSE channel normal
  // data-changes use) to every admin/driver device open on that group code, and enforced
  // server-side too (see the frozen check right after requireAuth below) so it can't be
  // bypassed by a stale frontend. A fresh login is also refused while frozen (see /api/auth/login).
  if (pathname === '/api/support/set-frozen' && req.method === 'POST') {
    if (!verifySupportToken(req, url)) return send(res, 401, { message: 'Support session expired — log in again' });
    const body      = await readBody(req);
    const groupCode = normalizeGroupCode(body.groupCode);
    const frozen    = Boolean(body.frozen);
    const db        = await readDb();
    const group     = db.groups.find(g => g.code === groupCode);
    if (!group) return send(res, 404, { message: 'No business found with that code' });

    group.frozen = frozen;
    const adminUser = db.users.find(u => u.groupCode === groupCode && u.role === 'admin' && u.active);
    if (adminUser) addAudit(db, adminUser, frozen ? 'support.freeze' : 'support.unfreeze', group.code, {});
    await writeDb(db);

    broadcast(group.code, frozen ? 'account-frozen' : 'account-unfrozen', {});
    return send(res, 200, { group });
  }

  if (pathname === '/api/support/impersonate' && req.method === 'POST') {
    if (!verifySupportToken(req, url)) return send(res, 401, { message: 'Support session expired — log in again' });
    const body      = await readBody(req);
    const groupCode = normalizeGroupCode(body.groupCode);
    const db        = await readDb();
    const group     = db.groups.find(g => g.code === groupCode);
    if (!group) return send(res, 404, { message: 'No business found with that code' });
    const adminUser = db.users.find(u => u.groupCode === groupCode && u.role === 'admin' && u.active);
    if (!adminUser) return send(res, 404, { message: 'This business has no active admin account to access' });

    // Real session token, same as a normal login — the rest of the app needs no special-casing
    // to work once support is "in" as this admin. Logged so there's always a trace of when and
    // which business support accessed.
    const token = createSessionToken(adminUser.id, adminUser.groupCode, adminUser.role);
    addAudit(db, adminUser, 'support.impersonate', adminUser.id, {});
    await writeDb(db);
    return send(res, 200, { token, user: safeUser(adminUser), group });
  }

  // ── All routes below require a valid session token ────────────────────────
  const auth = await requireAuth(req, url);
  if (!auth) return send(res, 401, { message: 'Authentication required' });

  // A frozen account can still reach /api/me (how the frontend learns it's frozen at all) and
  // /api/events (the SSE channel the unfreeze push arrives on) — everything else 423s.
  if (pathname !== '/api/me' && pathname !== '/api/events') {
    const authGroup = auth.db.groups.find(g => g.code === auth.user.groupCode);
    if (authGroup?.frozen) {
      return send(res, 423, {
        message: 'This account has been frozen by our support console. Your data is safe — contact support for recovery.',
        code: 'ACCOUNT_FROZEN',
      });
    }
  }

  // ── GET /api/me ───────────────────────────────────────────────────────────
  if (pathname === '/api/me' && req.method === 'GET') {
    const group = auth.db.groups.find(g => g.code === auth.user.groupCode);
    return send(res, 200, { user: safeUser(auth.user), group });
  }

  // Lets an admin set/update the recovery email used by "Forgot password?" on the login screen.
  if (pathname === '/api/me' && req.method === 'PATCH') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    if (email && !isValidEmail(email)) return send(res, 400, { message: 'Enter a valid email address' });
    const db = auth.db;
    const user = db.users.find(u => u.id === auth.user.id);
    user.email = email;
    user.updatedAt = now();
    await writeDb(db);
    return send(res, 200, { user: safeUser(user) });
  }

  // ── Bill branding (theme/company details, editable by admin) ──────────────
  // Drivers only need the cosmetic bits (name/logo/colors) for their own UI — bank account
  // number, IFSC, phone numbers, address and GST are admin-only (billing pages are admin-only
  // routes in the UI, and there's no reason a driver account should be able to pull them via
  // a direct API call either).
  const DRIVER_VISIBLE_BRANDING_FIELDS = ['companyName', 'tagline', 'primaryColor', 'accentColor', 'logoDataUrl', 'footerNote'];
  if (pathname === '/api/branding' && req.method === 'GET') {
    const group = auth.db.groups.find(g => g.code === auth.user.groupCode);
    const branding = getBranding(group);
    if (auth.user.role !== 'admin') {
      const publicBranding = {};
      for (const key of DRIVER_VISIBLE_BRANDING_FIELDS) publicBranding[key] = branding[key];
      return send(res, 200, { branding: publicBranding });
    }
    return send(res, 200, { branding });
  }

  if (pathname === '/api/branding' && req.method === 'PUT') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const body = await readBody(req);
    const db = auth.db;
    const group = db.groups.find(g => g.code === auth.user.groupCode);
    if (!group) return send(res, 404, { message: 'Group not found' });
    const current = getBranding(group);
    const editable = [
      'companyName', 'tagline', 'proprietorName', 'phone1', 'phone2', 'address',
      'gstNumber', 'footerNote', 'primaryColor', 'accentColor', 'logoDataUrl', 'signatureDataUrl',
      'headerLeftImageDataUrl', 'headerRightImageDataUrl',
      'upiQrImageDataUrl', 'upiQrShowOn',
      'bankName', 'bankBranch', 'bankAccountNumber', 'bankIfsc', 'publicServerUrl',
    ];
    const updated = { ...current };
    for (const key of editable) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        updated[key] = String(body[key] ?? '').trim();
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'bankAccounts')) {
      updated.bankAccounts = sanitizeBankAccounts(body.bankAccounts);
    }
    group.branding = updated;
    addAudit(db, auth.user, 'branding.update', group.code);
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'branding.update', branding: updated });
    return send(res, 200, { branding: updated });
  }

  if (pathname === '/api/branding/next-invoice-number' && req.method === 'POST') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const db = auth.db;
    const group = db.groups.find(g => g.code === auth.user.groupCode);
    if (!group) return send(res, 404, { message: 'Group not found' });
    const branding = getBranding(group);
    const invoiceNumber = branding.nextInvoiceNumber || 1;
    branding.nextInvoiceNumber = invoiceNumber + 1;
    group.branding = branding;
    await writeDb(db);
    return send(res, 200, { invoiceNumber });
  }

  // ── Saved bills ("My Bills") ─────────────────────────────────────────────
  // A record of every bill the admin has explicitly saved from the View & Print Bill preview —
  // a snapshot (trip lines + totals as they were at save time), not a live view, so it stays
  // accurate for reference even if the underlying trips get edited or deleted later.
  if (pathname === '/api/bills' && req.method === 'GET') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const bills = auth.db.bills
      .filter(b => b.groupCode === auth.user.groupCode)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return send(res, 200, { bills });
  }

  // Called before a bill is downloaded as a PDF or shared to WhatsApp — those never otherwise
  // reach the server (html2canvas/print happen entirely client-side), so without this call
  // they'd silently bypass the daily limit that POST /api/bills (save to My Bills) enforces.
  if (pathname === '/api/bills/generation' && req.method === 'POST') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const db = auth.db;
    const group = db.groups.find(g => g.code === auth.user.groupCode);
    const limitError = checkDailyBillLimit(db, group);
    if (limitError) return send(res, 403, limitError);

    const body = await readBody(req);
    const customerId = String(body.customerId || '').trim();
    const method = String(body.method || '').trim() || 'unknown';
    addAudit(db, auth.user, 'bill.generate', customerId || auth.user.groupCode, { method });
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  if (pathname === '/api/bills' && req.method === 'POST') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const body = await readBody(req);
    const customerId = String(body.customerId || '').trim();
    if (!customerId) return send(res, 400, { message: 'customerId is required' });
    const db = auth.db;
    const customer = db.customers.find(c => c.groupCode === auth.user.groupCode && c.id === customerId);
    if (!customer) return send(res, 404, { message: 'Customer not found' });

    const groupForLimit = db.groups.find(g => g.code === auth.user.groupCode);
    const limitError = checkDailyBillLimit(db, groupForLimit);
    if (limitError) return send(res, 403, limitError);

    const trips = Array.isArray(body.trips) ? body.trips : [];
    const bill = {
      id: id('bill'),
      groupCode: auth.user.groupCode,
      customerId: customer.id,
      customerName: customer.name,
      billNo: String(body.billNo || '').trim(),
      billDate: String(body.billDate || now()),
      isGstBill: Boolean(body.isGstBill),
      gstPercent: toNumber(body.gstPercent),
      discount: toNumber(body.discount),
      subTotal: toNumber(body.subTotal),
      received: toNumber(body.received),
      gstAmount: toNumber(body.gstAmount),
      grandTotal: toNumber(body.grandTotal),
      advanceApplied: toNumber(body.advanceApplied),
      netPayable: toNumber(body.netPayable),
      amountInWords: String(body.amountInWords || '').trim(),
      trips: trips.map(t => ({
        tripId: String(t.tripId || ''),
        date: String(t.date || ''),
        pickupLocation: String(t.pickupLocation || ''),
        dropLocation: String(t.dropLocation || ''),
        amount: toNumber(t.amount),
        paidAmount: toNumber(t.paidAmount),
      })),
      customerPhone: String(body.customerPhone || '').trim(),
      customerAddress: String(body.customerAddress || '').trim(),
      customerGst: String(body.customerGst || '').trim(),
      bankName: String(body.bankName || '').trim(),
      bankBranch: String(body.bankBranch || '').trim(),
      accountNumber: String(body.accountNumber || '').trim(),
      ifscCode: String(body.ifscCode || '').trim(),
      createdAt: now(),
      createdBy: auth.user.name,
    };

    // Finalizing this bill "spends" whatever advance balance the preview applied — deduct it for
    // real, and actually MOVE that amount out of the active entries (oldest deposit first) into
    // the deleted/record section tagged with the bill number, splitting an entry if the consumed
    // amount doesn't line up exactly with one deposit. This keeps "Advance Balance" showing only
    // what's genuinely left, with the used portion still traceable to which bill it went to.
    if (bill.advanceApplied > 0) {
      const available = toNumber(customer.advanceBalance);
      let remaining = Math.min(bill.advanceApplied, available);
      if (remaining > 0) {
        if (!Array.isArray(customer.advanceHistory)) customer.advanceHistory = [];
        const activeEntries = customer.advanceHistory
          .filter(e => !e.deleted)
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        for (const entry of activeEntries) {
          if (remaining <= 0) break;
          const entryAmount = toNumber(entry.amount);
          if (entryAmount <= remaining) {
            entry.deleted = true;
            entry.deletedAt = now();
            entry.usedInBillNo = bill.billNo;
            remaining -= entryAmount;
          } else {
            entry.amount = entryAmount - remaining;
            customer.advanceHistory.push({
              id: id('adv'), amount: remaining, note: entry.note, date: entry.date, createdAt: now(),
              deleted: true, deletedAt: now(), usedInBillNo: bill.billNo,
            });
            remaining = 0;
          }
        }
        customer.advanceBalance = available - Math.min(bill.advanceApplied, available);
        addAudit(db, auth.user, 'customer.advance.usedInBill', customer.id, { amount: Math.min(bill.advanceApplied, available), billNo: bill.billNo });
      }
    }

    db.bills.push(bill);
    customer.updatedAt = now();
    addAudit(db, auth.user, 'bill.save', bill.id, { customerId: customer.id, billNo: bill.billNo, netPayable: bill.netPayable });
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'customer.edit', customer });
    return send(res, 201, { bill });
  }

  // Delete a saved bill — soft delete (mirrors the advance-payment delete flow): kept as a record,
  // just excluded from the active list, until the admin permanently removes it below.
  const billSoftDelete = pathname.match(/^\/api\/bills\/([^/]+)$/);
  if (billSoftDelete && req.method === 'DELETE') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const billId = billSoftDelete[1];
    const db = auth.db;
    const bill = db.bills.find(b => b.groupCode === auth.user.groupCode && b.id === billId);
    if (!bill) return send(res, 404, { message: 'Bill not found' });
    if (bill.deleted) return send(res, 400, { message: 'This bill was already deleted' });
    bill.deleted = true;
    bill.deletedAt = now();
    addAudit(db, auth.user, 'bill.delete', bill.id, { customerId: bill.customerId, billNo: bill.billNo });
    await writeDb(db);
    return send(res, 200, { bill });
  }

  // Permanently erase an already-deleted bill — no way back, unlike the soft delete above.
  const billPermanentDelete = pathname.match(/^\/api\/bills\/([^/]+)\/permanent$/);
  if (billPermanentDelete && req.method === 'DELETE') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const billId = billPermanentDelete[1];
    const db = auth.db;
    const bill = db.bills.find(b => b.groupCode === auth.user.groupCode && b.id === billId);
    if (!bill) return send(res, 404, { message: 'Bill not found' });
    if (!bill.deleted) return send(res, 400, { message: 'Only already-deleted bills can be permanently removed' });
    db.bills = db.bills.filter(b => b.id !== billId);
    addAudit(db, auth.user, 'bill.permanentDelete', billId, { customerId: bill.customerId, billNo: bill.billNo });
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  // ── Email notifications (bills / payment reminders via Gmail SMTP) ───────
  if (pathname === '/api/notify/email' && req.method === 'POST') {
    // Admin-only: this relays through the business's own Gmail account, so an unrestricted
    // endpoint would let any authenticated driver send arbitrary email as the company.
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    if (isRateLimited(req, 'email', 10, 60 * 60 * 1000)) {
      return send(res, 429, { message: 'Too many emails sent. Please try again later.' });
    }
    const body = await readBody(req);
    const to = String(body.to || '').trim();
    const subject = String(body.subject || '').trim() || 'Transport Manager';
    const text = String(body.text || '');
    if (!isValidEmail(to)) return send(res, 400, { message: 'A valid recipient email is required' });
    const transporter = getMailTransporter();
    if (!transporter) {
      return send(res, 400, {
        message: 'Email is not configured on this server. Set GMAIL_USER and GMAIL_APP_PASSWORD in the .env file, then restart the server.',
      });
    }
    try {
      const group = auth.db.groups.find(g => g.code === auth.user.groupCode);
      const fromName = getBranding(group).companyName || 'Transport Manager';
      await transporter.sendMail({
        from: `"${fromName}" <${process.env.GMAIL_USER}>`,
        to, subject, text,
      });
      addAudit(auth.db, auth.user, 'email.sent', to, { subject });
      await writeDb(auth.db);
      return send(res, 200, { ok: true });
    } catch (error) {
      return send(res, 502, { message: `Could not send email: ${error instanceof Error ? error.message : 'unknown error'}` });
    }
  }

  // ── Server-Sent Events ────────────────────────────────────────────────────
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*',
    });
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    const groupCode = auth.user.groupCode;
    if (!clientsByGroup.has(groupCode)) clientsByGroup.set(groupCode, new Set());
    clientsByGroup.get(groupCode).add(res);
    req.on('close', () => clientsByGroup.get(groupCode)?.delete(res));
    return;
  }

  // ── Drivers (read-only roster of who has joined the group) ─────────────────
  if (pathname === '/api/drivers' && req.method === 'GET') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const drivers = auth.db.users
      .filter(u => u.groupCode === auth.user.groupCode && u.role === 'driver')
      .map(safeUser)
      .sort((a, b) => a.name.localeCompare(b.name));
    return send(res, 200, { drivers });
  }

  // Drivers have no recovery email on file, so if one forgets their password the admin sets a
  // new one directly here and passes it along to them (call/WhatsApp) — no email/SMS needed.
  const driverResetPassword = pathname.match(/^\/api\/drivers\/([^/]+)\/reset-password$/);
  if (driverResetPassword && req.method === 'POST') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const driverId = driverResetPassword[1];
    const body = await readBody(req);
    const newPassword = String(body.newPassword || '');
    if (newPassword.length < 6) return send(res, 400, { message: 'Password must be at least 6 characters' });
    const db = auth.db;
    const driver = db.users.find(u => u.groupCode === auth.user.groupCode && u.id === driverId && u.role === 'driver');
    if (!driver) return send(res, 404, { message: 'Driver not found' });
    driver.passwordHash = hashPassword(newPassword);
    driver.updatedAt = now();
    addAudit(db, auth.user, 'driver.password.reset', driver.id);
    await writeDb(db);
    return send(res, 200, { ok: true });
  }

  // ── Vehicles & document-expiry reminders (insurance, PUC, and any other segment the admin
  // adds — fitness certificate, permit, road tax, etc.) ──────────────────────
  if (pathname === '/api/vehicles' && req.method === 'GET') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const vehicles = auth.db.vehicles
      .filter(v => v.groupCode === auth.user.groupCode)
      .sort((a, b) => a.vehicleNumber.localeCompare(b.vehicleNumber));
    return send(res, 200, { vehicles });
  }

  if (pathname === '/api/vehicles' && req.method === 'POST') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const body = await readBody(req);
    const vehicleNumber = String(body.vehicleNumber || '').trim().toUpperCase();
    if (!vehicleNumber) return send(res, 400, { message: 'Vehicle number is required' });
    const db = auth.db;
    const duplicate = db.vehicles.find(v => v.groupCode === auth.user.groupCode && v.vehicleNumber === vehicleNumber);
    if (duplicate) return send(res, 409, { message: 'A vehicle with this number already exists' });
    const vehicle = {
      id: id('vehicle'), groupCode: auth.user.groupCode, vehicleNumber,
      documents: [], createdAt: now(), updatedAt: now(),
    };
    db.vehicles.push(vehicle);
    addAudit(db, auth.user, 'vehicle.create', vehicle.id, { vehicleNumber });
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'vehicle.create', vehicle });
    return send(res, 201, { vehicle });
  }

  const vehiclePatch = pathname.match(/^\/api\/vehicles\/([^/]+)$/);
  if (vehiclePatch && req.method === 'PATCH') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const vehicleId = vehiclePatch[1];
    const body = await readBody(req);
    const db = auth.db;
    const vehicle = db.vehicles.find(v => v.groupCode === auth.user.groupCode && v.id === vehicleId);
    if (!vehicle) return send(res, 404, { message: 'Vehicle not found' });
    if (Object.prototype.hasOwnProperty.call(body, 'vehicleNumber')) {
      const vehicleNumber = String(body.vehicleNumber || '').trim().toUpperCase();
      if (!vehicleNumber) return send(res, 400, { message: 'Vehicle number is required' });
      vehicle.vehicleNumber = vehicleNumber;
    }
    vehicle.updatedAt = now();
    addAudit(db, auth.user, 'vehicle.edit', vehicle.id);
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'vehicle.edit', vehicle });
    return send(res, 200, { vehicle });
  }

  if (vehiclePatch && req.method === 'DELETE') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const vehicleId = vehiclePatch[1];
    const db = auth.db;
    const existed = db.vehicles.some(v => v.groupCode === auth.user.groupCode && v.id === vehicleId);
    if (!existed) return send(res, 404, { message: 'Vehicle not found' });
    db.vehicles = db.vehicles.filter(v => !(v.groupCode === auth.user.groupCode && v.id === vehicleId));
    addAudit(db, auth.user, 'vehicle.delete', vehicleId);
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'vehicle.delete', vehicleId });
    return send(res, 200, { ok: true });
  }

  // A "document" here is one expiry-tracked segment on a vehicle — Insurance and PUC are just
  // the two an admin is nudged to add first; `label` is free text so any number of additional
  // segments (Fitness Certificate, Permit, Road Tax, ...) work the same way with no schema change.
  const vehicleAddDoc = pathname.match(/^\/api\/vehicles\/([^/]+)\/documents$/);
  if (vehicleAddDoc && req.method === 'POST') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const vehicleId = vehicleAddDoc[1];
    const body = await readBody(req);
    const label = String(body.label || '').trim();
    const expiryDate = String(body.expiryDate || '').trim();
    if (!label) return send(res, 400, { message: 'Document name is required' });
    if (!expiryDate || Number.isNaN(new Date(expiryDate).getTime())) {
      return send(res, 400, { message: 'A valid expiry date is required' });
    }
    const reminderDaysBefore = Number.isFinite(toNumber(body.reminderDaysBefore)) && body.reminderDaysBefore !== undefined
      ? Math.max(0, Math.round(toNumber(body.reminderDaysBefore)))
      : 7;
    const db = auth.db;
    const vehicle = db.vehicles.find(v => v.groupCode === auth.user.groupCode && v.id === vehicleId);
    if (!vehicle) return send(res, 404, { message: 'Vehicle not found' });
    const document = { id: id('doc'), label, expiryDate, reminderDaysBefore, createdAt: now(), updatedAt: now() };
    vehicle.documents.push(document);
    vehicle.updatedAt = now();
    addAudit(db, auth.user, 'vehicle.document.add', vehicle.id, { label, expiryDate });
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'vehicle.edit', vehicle });
    return send(res, 201, { vehicle });
  }

  const vehicleDocPatch = pathname.match(/^\/api\/vehicles\/([^/]+)\/documents\/([^/]+)$/);
  if (vehicleDocPatch && req.method === 'PATCH') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const [, vehicleId, docId] = vehicleDocPatch;
    const body = await readBody(req);
    const db = auth.db;
    const vehicle = db.vehicles.find(v => v.groupCode === auth.user.groupCode && v.id === vehicleId);
    if (!vehicle) return send(res, 404, { message: 'Vehicle not found' });
    const document = vehicle.documents.find(d => d.id === docId);
    if (!document) return send(res, 404, { message: 'Document not found' });
    if (Object.prototype.hasOwnProperty.call(body, 'label')) {
      const label = String(body.label || '').trim();
      if (!label) return send(res, 400, { message: 'Document name is required' });
      document.label = label;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'expiryDate')) {
      const expiryDate = String(body.expiryDate || '').trim();
      if (!expiryDate || Number.isNaN(new Date(expiryDate).getTime())) {
        return send(res, 400, { message: 'A valid expiry date is required' });
      }
      document.expiryDate = expiryDate;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'reminderDaysBefore')) {
      document.reminderDaysBefore = Math.max(0, Math.round(toNumber(body.reminderDaysBefore)));
    }
    document.updatedAt = now();
    vehicle.updatedAt = now();
    addAudit(db, auth.user, 'vehicle.document.edit', vehicle.id, { documentId: document.id });
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'vehicle.edit', vehicle });
    return send(res, 200, { vehicle });
  }

  if (vehicleDocPatch && req.method === 'DELETE') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const [, vehicleId, docId] = vehicleDocPatch;
    const db = auth.db;
    const vehicle = db.vehicles.find(v => v.groupCode === auth.user.groupCode && v.id === vehicleId);
    if (!vehicle) return send(res, 404, { message: 'Vehicle not found' });
    const existed = vehicle.documents.some(d => d.id === docId);
    if (!existed) return send(res, 404, { message: 'Document not found' });
    vehicle.documents = vehicle.documents.filter(d => d.id !== docId);
    vehicle.updatedAt = now();
    addAudit(db, auth.user, 'vehicle.document.delete', vehicle.id, { documentId: docId });
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'vehicle.edit', vehicle });
    return send(res, 200, { vehicle });
  }

  // Restore from a downloaded backup file — imports the customers/trips it contains into the
  // CURRENT admin's group (rewriting groupCode and re-linking customerId to freshly-minted ids,
  // since a backup taken from a different account carries that account's own ids/groupCode).
  // Additive: existing customers/trips in this group are left alone, the import is appended.
  if (pathname === '/api/restore' && req.method === 'POST') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const body = await readBody(req);
    const incomingCustomers = Array.isArray(body.customers) ? body.customers : [];
    const incomingTrips = Array.isArray(body.trips) ? body.trips : [];
    if (!incomingCustomers.length && !incomingTrips.length) {
      return send(res, 400, { message: 'Backup file has no customers or trips to restore' });
    }
    const db = auth.db;
    const groupCode = auth.user.groupCode;
    const idMap = new Map(); // old customer id (from the backup) -> new id in this group

    for (const c of incomingCustomers) {
      const newId = id('customer');
      if (c && c.id) idMap.set(c.id, newId);
      db.customers.push({
        id: newId, groupCode,
        name: String(c?.name || '').trim() || 'Unnamed Customer',
        phone: String(c?.phone || '').trim(),
        address: String(c?.address || '').trim(),
        email: String(c?.email || '').trim(),
        gstNumber: String(c?.gstNumber || '').trim(),
        advanceBalance: toNumber(c?.advanceBalance),
        advanceHistory: Array.isArray(c?.advanceHistory) ? c.advanceHistory : [],
        createdAt: c?.createdAt || now(), updatedAt: now(),
      });
    }

    for (const t of incomingTrips) {
      db.trips.push({
        id: id('trip'), groupCode,
        customerId: (t?.customerId && idMap.get(t.customerId)) || '',
        customerName: String(t?.customerName || '').trim(),
        customerPhone: String(t?.customerPhone || '').trim(),
        customerAddress: String(t?.customerAddress || '').trim(),
        driverId: '', driverName: String(t?.driverName || '').trim(), driverCode: String(t?.driverCode || '').trim(),
        date: t?.date || now(),
        pickupLocation: String(t?.pickupLocation || '').trim(),
        dropLocation: String(t?.dropLocation || '').trim(),
        amount: toNumber(t?.amount),
        advanceAmount: toNumber(t?.advanceAmount),
        isPaid: Boolean(t?.isPaid),
        paidAmount: toNumber(t?.paidAmount),
        paymentMode: String(t?.paymentMode || '').trim(),
        paymentNote: String(t?.paymentNote || '').trim(),
        paidAt: t?.paidAt || '',
        vehicleType: String(t?.vehicleType || '').trim(),
        vehicleNumber: String(t?.vehicleNumber || '').trim(),
        materialType: String(t?.materialType || '').trim(),
        status: t?.status || 'approved',
        rejectionReason: String(t?.rejectionReason || '').trim(),
        submittedAt: t?.submittedAt || now(), updatedAt: now(),
        approvedAt: t?.approvedAt || '', approvedBy: '',
      });
    }

    addAudit(db, auth.user, 'data.restore', groupCode, {
      customersImported: incomingCustomers.length, tripsImported: incomingTrips.length,
    });
    await writeDb(db);
    broadcast(groupCode, 'data-changed', { type: 'data.restore' });
    return send(res, 200, { customersImported: incomingCustomers.length, tripsImported: incomingTrips.length });
  }

  // ── Customers ─────────────────────────────────────────────────────────────
  if (pathname === '/api/customers' && req.method === 'GET') {
    const customers = auth.db.customers
      .filter(c => c.groupCode === auth.user.groupCode)
      .sort((a, b) => a.name.localeCompare(b.name));
    return send(res, 200, { customers });
  }

  if (pathname === '/api/customers' && req.method === 'POST') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    if (!name) return send(res, 400, { message: 'Customer name is required' });
    const customer = {
      id: id('customer'), groupCode: auth.user.groupCode, name,
      phone: String(body.phone || '').trim(),
      address: String(body.address || '').trim(),
      email: String(body.email || '').trim(),
      gstNumber: String(body.gstNumber || '').trim(),
      advanceBalance: 0,
      createdAt: now(), updatedAt: now(),
    };
    const db = auth.db;
    db.customers.push(customer);
    addAudit(db, auth.user, 'customer.create', customer.id);
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'customer.create', customer });
    return send(res, 201, { customer });
  }

  const customerPatch = pathname.match(/^\/api\/customers\/([^/]+)$/);
  if (customerPatch && req.method === 'PATCH') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const customerId = customerPatch[1];
    const body = await readBody(req);
    const db = auth.db;
    const customer = db.customers.find(c => c.groupCode === auth.user.groupCode && c.id === customerId);
    if (!customer) return send(res, 404, { message: 'Customer not found' });
    const editable = ['name', 'phone', 'address', 'email', 'gstNumber'];
    for (const key of editable) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        customer[key] = String(body[key] ?? '').trim();
      }
    }
    customer.updatedAt = now();
    addAudit(db, auth.user, 'customer.edit', customer.id);
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'customer.edit', customer });
    return send(res, 200, { customer });
  }

  // Record an advance payment against a customer's account (money paid before any specific
  // trip exists yet — gets drawn down later when settling a trip's payment). Each entry is kept
  // in advanceHistory (date + note) so the admin can review exactly what was paid and when,
  // separate from the running advanceBalance total used everywhere else.
  const customerAdvance = pathname.match(/^\/api\/customers\/([^/]+)\/advance$/);
  if (customerAdvance && req.method === 'POST') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const customerId = customerAdvance[1];
    const body = await readBody(req);
    const amount = toNumber(body.amount);
    if (amount <= 0) return send(res, 400, { message: 'Amount must be greater than zero' });
    const db = auth.db;
    const customer = db.customers.find(c => c.groupCode === auth.user.groupCode && c.id === customerId);
    if (!customer) return send(res, 404, { message: 'Customer not found' });
    const note = String(body.note || '').trim();
    const date = String(body.date || '').trim() || now();
    customer.advanceBalance = toNumber(customer.advanceBalance) + amount;
    if (!Array.isArray(customer.advanceHistory)) customer.advanceHistory = [];
    customer.advanceHistory.push({ id: id('adv'), amount, note, date, createdAt: now() });
    customer.updatedAt = now();
    addAudit(db, auth.user, 'customer.advance.add', customer.id, { amount, note, date });
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'customer.edit', customer });
    return send(res, 200, { customer });
  }

  // Delete a single advance-history entry (e.g. one entered by mistake) and reverse its effect
  // on the running advance balance. This is a SOFT delete — the entry stays in advanceHistory
  // flagged deleted/deletedAt so the admin keeps a record of what was removed and when, it's
  // just excluded from the available balance and the active list.
  const customerAdvanceDelete = pathname.match(/^\/api\/customers\/([^/]+)\/advance\/([^/]+)$/);
  if (customerAdvanceDelete && req.method === 'DELETE') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const [, customerId, advanceId] = customerAdvanceDelete;
    const db = auth.db;
    const customer = db.customers.find(c => c.groupCode === auth.user.groupCode && c.id === customerId);
    if (!customer) return send(res, 404, { message: 'Customer not found' });
    const history = Array.isArray(customer.advanceHistory) ? customer.advanceHistory : [];
    const entry = history.find(h => h.id === advanceId);
    if (!entry) return send(res, 404, { message: 'Advance entry not found' });
    if (entry.deleted) return send(res, 400, { message: 'This advance entry was already deleted' });
    entry.deleted = true;
    entry.deletedAt = now();
    customer.advanceBalance = toNumber(customer.advanceBalance) - toNumber(entry.amount);
    customer.updatedAt = now();
    addAudit(db, auth.user, 'customer.advance.delete', customer.id, { amount: entry.amount, note: entry.note, date: entry.date });
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'customer.edit', customer });
    return send(res, 200, { customer });
  }

  // Permanently erase an already-(soft)-deleted advance entry — no way back from here, unlike
  // the soft delete above which just excludes it from the active balance/list.
  const customerAdvancePermanentDelete = pathname.match(/^\/api\/customers\/([^/]+)\/advance\/([^/]+)\/permanent$/);
  if (customerAdvancePermanentDelete && req.method === 'DELETE') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const [, customerId, advanceId] = customerAdvancePermanentDelete;
    const db = auth.db;
    const customer = db.customers.find(c => c.groupCode === auth.user.groupCode && c.id === customerId);
    if (!customer) return send(res, 404, { message: 'Customer not found' });
    const history = Array.isArray(customer.advanceHistory) ? customer.advanceHistory : [];
    const entry = history.find(h => h.id === advanceId);
    if (!entry) return send(res, 404, { message: 'Advance entry not found' });
    if (!entry.deleted) return send(res, 400, { message: 'Only already-deleted entries can be permanently removed' });
    customer.advanceHistory = history.filter(h => h.id !== advanceId);
    customer.updatedAt = now();
    addAudit(db, auth.user, 'customer.advance.permanentDelete', customer.id, { amount: entry.amount, note: entry.note, date: entry.date });
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'customer.edit', customer });
    return send(res, 200, { customer });
  }

  // Merge a duplicate customer record into another — moves every trip over, then removes the
  // source record. Used when the admin confirms two near-identical names are the same customer.
  const customerMerge = pathname.match(/^\/api\/customers\/([^/]+)\/merge$/);
  if (customerMerge && req.method === 'POST') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const sourceId = customerMerge[1];
    const body = await readBody(req);
    const targetId = String(body.intoCustomerId || '').trim();
    const db = auth.db;
    const source = db.customers.find(c => c.groupCode === auth.user.groupCode && c.id === sourceId);
    const target = db.customers.find(c => c.groupCode === auth.user.groupCode && c.id === targetId);
    if (!source || !target) return send(res, 404, { message: 'Customer not found' });
    if (source.id === target.id) return send(res, 400, { message: 'Cannot merge a customer into itself' });
    for (const trip of db.trips) {
      if (trip.groupCode === auth.user.groupCode && trip.customerId === source.id) {
        trip.customerId = target.id;
        trip.customerName = target.name;
        trip.customerPhone = target.phone;
        trip.customerAddress = target.address;
        trip.updatedAt = now();
      }
    }
    target.advanceBalance = toNumber(target.advanceBalance) + toNumber(source.advanceBalance);
    if (Array.isArray(source.advanceHistory) && source.advanceHistory.length) {
      target.advanceHistory = [...(Array.isArray(target.advanceHistory) ? target.advanceHistory : []), ...source.advanceHistory];
    }
    target.updatedAt = now();
    db.customers = db.customers.filter(c => c.id !== source.id);
    addAudit(db, auth.user, 'customer.merge', target.id, { mergedFrom: source.id, mergedName: source.name });
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'customer.merge', customerId: target.id });
    return send(res, 200, { customer: target });
  }

  const customerDelete = pathname.match(/^\/api\/customers\/([^/]+)$/);
  if (customerDelete && req.method === 'DELETE') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const customerId = customerDelete[1];
    const db = auth.db;
    db.customers = db.customers.filter(
      c => !(c.groupCode === auth.user.groupCode && c.id === customerId)
    );
    db.trips = db.trips.filter(
      t => !(t.groupCode === auth.user.groupCode && t.customerId === customerId)
    );
    addAudit(db, auth.user, 'customer.delete', customerId);
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'customer.delete', customerId });
    return send(res, 200, { ok: true });
  }

  // ── Trips ─────────────────────────────────────────────────────────────────
  if (pathname === '/api/trips' && req.method === 'GET') {
    const status = url.searchParams.get('status');
    let trips = auth.db.trips.filter(t => t.groupCode === auth.user.groupCode);
    if (auth.user.role !== 'admin') trips = trips.filter(t => t.driverId === auth.user.id);
    if (status) trips = trips.filter(t => t.status === status);
    trips.sort((a, b) =>
      new Date(b.submittedAt || b.date).getTime() - new Date(a.submittedAt || a.date).getTime()
    );
    return send(res, 200, { trips });
  }

  if (pathname === '/api/trips' && req.method === 'POST') {
    const body   = await readBody(req);
    const errors = validateTripInput(body);
    if (errors.length) return send(res, 400, { message: errors.join(', ') });

    const db      = auth.db;
    const isAdmin = auth.user.role === 'admin';
    // Admin-created trips must be explicitly attributed to a driver or to the admin themself
    // ("Self") — the UI makes this a required field so a trip is never silently misattributed.
    // Driver-submitted trips skip this: they're always attributed to the submitting driver.
    if (isAdmin && !String(body.driverId || '').trim()) {
      return send(res, 400, { message: 'Select a driver (or Self) for this trip' });
    }
    const customer = body.customerId
      ? db.customers.find(c => c.groupCode === auth.user.groupCode && c.id === body.customerId)
      : null;

    let driverId = auth.user.id, driverName = auth.user.name, driverCode = auth.user.userCode || '';
    if (isAdmin && body.driverId !== 'self') {
      const selectedDriver = db.users.find(u => u.groupCode === auth.user.groupCode && u.id === body.driverId && u.role === 'driver');
      if (!selectedDriver) return send(res, 400, { message: 'Selected driver not found' });
      driverId = selectedDriver.id;
      driverName = selectedDriver.name;
      driverCode = selectedDriver.userCode || '';
    }

    const trip = {
      id: id('trip'), groupCode: auth.user.groupCode,
      customerId: customer?.id || '',
      customerName: customer?.name || String(body.customerName || '').trim(),
      customerPhone: customer?.phone || String(body.customerPhone || '').trim(),
      customerAddress: customer?.address || String(body.customerAddress || '').trim(),
      driverId, driverName, driverCode,
      date: body.date || now(),
      pickupLocation: String(body.pickupLocation || '').trim(),
      dropLocation: String(body.dropLocation || '').trim(),
      amount: toNumber(body.amount),
      advanceAmount: toNumber(body.advanceAmount),
      isPaid: Boolean(body.isPaid),
      // Collecting an advance upfront already counts as money paid — the running "paid so
      // far" total (shown on the bill and used to compute what's left owing) starts there.
      paidAmount: body.isPaid ? toNumber(body.amount) : toNumber(body.advanceAmount),
      paymentMode: String(body.paymentMode || '').trim(),
      paidAt: body.isPaid ? now() : '',
      vehicleType: String(body.vehicleType || '').trim(),
      vehicleNumber: String(body.vehicleNumber || '').trim(),
      materialType: String(body.materialType || '').trim(),
      status: isAdmin ? 'approved' : 'pending',
      rejectionReason: '',
      submittedAt: now(), updatedAt: now(),
      approvedAt: isAdmin ? now() : '',
      approvedBy: isAdmin ? auth.user.id : '',
    };

    if (isAdmin) {
      const approvedCustomer = findOrCreateCustomer(db, auth.user.groupCode, trip);
      trip.customerId   = approvedCustomer.id;
      trip.customerName = approvedCustomer.name;
    }

    db.trips.push(trip);
    addAudit(db, auth.user, isAdmin ? 'trip.create.approved' : 'trip.submit', trip.id);
    await writeDb(db);
    broadcast(auth.user.groupCode, 'trip-submitted', { trip });
    broadcast(auth.user.groupCode, 'data-changed', { type: 'trip.create', trip });
    return send(res, 201, { trip });
  }

  const tripPatch = pathname.match(/^\/api\/trips\/([^/]+)$/);
  if (tripPatch && req.method === 'PATCH') {
    const tripId = tripPatch[1];
    const body   = await readBody(req);
    const db     = auth.db;
    const trip   = db.trips.find(t => t.groupCode === auth.user.groupCode && t.id === tripId);
    if (!trip) return send(res, 404, { message: 'Trip not found' });

    // A driver can edit their own trip directly ONLY while it's still pending admin review —
    // once approved, the numbers may already be reflected in billing, so a driver-side change
    // instead goes through the edit-request flow below for an admin to apply deliberately.
    const isAdmin = auth.user.role === 'admin';
    const isOwnPendingTrip = auth.user.role === 'driver' && trip.driverId === auth.user.id && trip.status === 'pending';
    if (!isAdmin && !isOwnPendingTrip) {
      return send(res, 403, { message: 'You can only edit your own trip while it is still pending approval' });
    }

    // Drivers can fix trip/customer details and the amount, but not payment status — that's an
    // admin-only concern regardless of who submitted the trip.
    const editable = isAdmin
      ? [
          'customerId', 'customerName', 'customerPhone', 'customerAddress',
          'date', 'pickupLocation', 'dropLocation', 'vehicleType', 'vehicleNumber',
          'materialType', 'isPaid', 'paymentMode', 'paymentNote',
        ]
      : [
          'customerName', 'customerPhone', 'customerAddress',
          'date', 'pickupLocation', 'dropLocation', 'vehicleType', 'vehicleNumber', 'materialType',
        ];
    const wasPaid = trip.isPaid;
    for (const key of editable) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        trip[key] = typeof body[key] === 'string' ? body[key].trim() : body[key];
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'amount')) {
      const amount = toNumber(body.amount);
      if (amount <= 0) return send(res, 400, { message: 'Amount must be greater than zero' });
      trip.amount = amount;
    }
    if (isAdmin && Object.prototype.hasOwnProperty.call(body, 'advanceAmount')) {
      const advanceAmount = toNumber(body.advanceAmount);
      if (advanceAmount < 0) return send(res, 400, { message: 'Advance amount cannot be negative' });
      trip.advanceAmount = advanceAmount;
      // Raising the advance on an edit means more was actually collected upfront — reflect
      // that in the running paid total (never lowers it; a later real payment isn't erased).
      trip.paidAmount = Math.max(toNumber(trip.paidAmount), trip.advanceAmount);
    }
    if (isAdmin && Object.prototype.hasOwnProperty.call(body, 'paidAmount')) trip.paidAmount = toNumber(body.paidAmount);
    if (isAdmin && Object.prototype.hasOwnProperty.call(body, 'isPaid')) {
      if (trip.isPaid && !wasPaid) { trip.paidAt = now(); trip.paidAmount = trip.amount; }
      if (!trip.isPaid) { trip.paidAt = ''; trip.paymentMode = ''; trip.paidAmount = 0; trip.paymentNote = ''; }
    }
    trip.updatedAt = now();
    addAudit(db, auth.user, isAdmin ? 'trip.edit' : 'trip.edit.driver', trip.id);
    await writeDb(db);
    broadcast(auth.user.groupCode, 'trip-updated', { trip });
    broadcast(auth.user.groupCode, 'data-changed', { type: 'trip.edit', trip });
    return send(res, 200, { trip });
  }

  // ── Trip edit requests ───────────────────────────────────────────────────
  // Once a trip is approved, a driver can no longer edit it directly (see the PATCH route
  // above) — instead they describe what needs to change here, and an admin applies it (or
  // dismisses the request) via PATCH /api/trip-edit-requests/:id.
  const tripEditRequestCreate = pathname.match(/^\/api\/trips\/([^/]+)\/edit-requests$/);
  if (tripEditRequestCreate && req.method === 'POST') {
    if (!requireRole(auth, 'driver')) return send(res, 403, { message: 'Driver access required' });
    const tripId = tripEditRequestCreate[1];
    const body   = await readBody(req);
    const db     = auth.db;
    const trip   = db.trips.find(t => t.groupCode === auth.user.groupCode && t.id === tripId);
    if (!trip) return send(res, 404, { message: 'Trip not found' });
    if (trip.driverId !== auth.user.id) return send(res, 403, { message: 'You can only request changes to your own trips' });
    if (trip.status !== 'approved') {
      return send(res, 400, { message: 'Only approved trips need an update request — pending trips can be edited directly' });
    }
    const message = String(body.message || '').trim();
    if (!message) return send(res, 400, { message: 'Describe what needs to change' });

    const request = {
      id: id('editreq'), groupCode: auth.user.groupCode, tripId: trip.id,
      driverId: auth.user.id, driverName: auth.user.name,
      message, status: 'pending', createdAt: now(), resolvedAt: '',
    };
    db.tripEditRequests.push(request);
    addAudit(db, auth.user, 'trip.editRequest.create', trip.id, { message });
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'tripEditRequest.create', request });
    return send(res, 201, { request });
  }

  if (pathname === '/api/trip-edit-requests' && req.method === 'GET') {
    const all = auth.db.tripEditRequests.filter(r => r.groupCode === auth.user.groupCode);
    const requests = (auth.user.role === 'admin' ? all : all.filter(r => r.driverId === auth.user.id))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return send(res, 200, { requests });
  }

  const tripEditRequestResolve = pathname.match(/^\/api\/trip-edit-requests\/([^/]+)$/);
  if (tripEditRequestResolve && req.method === 'PATCH') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const requestId = tripEditRequestResolve[1];
    const body      = await readBody(req);
    const db        = auth.db;
    const request   = db.tripEditRequests.find(r => r.groupCode === auth.user.groupCode && r.id === requestId);
    if (!request) return send(res, 404, { message: 'Request not found' });
    const status = String(body.status || '').trim();
    if (!['resolved', 'dismissed'].includes(status)) return send(res, 400, { message: 'Invalid status' });
    request.status = status;
    request.resolvedAt = now();
    addAudit(db, auth.user, `trip.editRequest.${status}`, request.tripId);
    await writeDb(db);
    broadcast(auth.user.groupCode, 'data-changed', { type: 'tripEditRequest.update', request });
    return send(res, 200, { request });
  }

  // Record a payment against a trip — supports partial payments (admin types an amount) or
  // "mark fully paid" (fills in whatever balance remains). Optionally draws the amount down
  // from the customer's pre-paid advance balance instead of treating it as a fresh payment.
  const tripPayment = pathname.match(/^\/api\/trips\/([^/]+)\/payment$/);
  if (tripPayment && req.method === 'POST') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const tripId = tripPayment[1];
    const body   = await readBody(req);
    const db     = auth.db;
    const trip   = db.trips.find(t => t.groupCode === auth.user.groupCode && t.id === tripId);
    if (!trip) return send(res, 404, { message: 'Trip not found' });

    const alreadyPaid = toNumber(trip.paidAmount);
    const remaining   = Math.max(0, toNumber(trip.amount) - alreadyPaid);
    const amount      = body.fullyPaid ? remaining : toNumber(body.amount);
    if (amount <= 0) return send(res, 400, { message: 'Enter an amount greater than zero' });

    if (body.fromAdvance) {
      const customer = db.customers.find(c => c.groupCode === auth.user.groupCode && c.id === trip.customerId);
      if (!customer) return send(res, 404, { message: 'Customer not found' });
      const available = toNumber(customer.advanceBalance);
      if (amount > available) return send(res, 400, { message: `Only ₹${available.toFixed(2)} available in advance balance` });
      customer.advanceBalance = available - amount;
      customer.updatedAt = now();
    }

    trip.paidAmount   = alreadyPaid + amount;
    trip.isPaid       = trip.paidAmount >= toNumber(trip.amount);
    trip.paymentMode  = String(body.paymentMode || trip.paymentMode || '').trim();
    trip.paidAt       = now();
    if (typeof body.note === 'string') trip.paymentNote = body.note.trim();
    trip.updatedAt    = now();
    addAudit(db, auth.user, 'trip.payment', trip.id, { amount, fromAdvance: Boolean(body.fromAdvance) });
    await writeDb(db);
    broadcast(auth.user.groupCode, 'trip-updated', { trip });
    broadcast(auth.user.groupCode, 'data-changed', { type: 'trip.edit', trip });
    return send(res, 200, { trip });
  }

  const tripApprove = pathname.match(/^\/api\/trips\/([^/]+)\/approve$/);
  if (tripApprove && req.method === 'POST') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const tripId = tripApprove[1];
    const db     = auth.db;
    const trip   = db.trips.find(t => t.groupCode === auth.user.groupCode && t.id === tripId);
    if (!trip) return send(res, 404, { message: 'Trip not found' });
    const customer = findOrCreateCustomer(db, auth.user.groupCode, trip);
    trip.customerId      = customer.id;
    trip.customerName    = customer.name;
    trip.status          = 'approved';
    trip.rejectionReason = '';
    trip.approvedAt      = now();
    trip.approvedBy      = auth.user.id;
    trip.updatedAt       = now();
    addAudit(db, auth.user, 'trip.approve', trip.id);
    await writeDb(db);
    broadcast(auth.user.groupCode, 'trip-updated', { trip });
    broadcast(auth.user.groupCode, 'data-changed', { type: 'trip.approve', trip });
    return send(res, 200, { trip });
  }

  const tripReject = pathname.match(/^\/api\/trips\/([^/]+)\/reject$/);
  if (tripReject && req.method === 'POST') {
    if (!requireRole(auth, 'admin')) return send(res, 403, { message: 'Admin access required' });
    const tripId = tripReject[1];
    const body   = await readBody(req);
    const db     = auth.db;
    const trip   = db.trips.find(t => t.groupCode === auth.user.groupCode && t.id === tripId);
    if (!trip) return send(res, 404, { message: 'Trip not found' });
    trip.status          = 'rejected';
    trip.rejectionReason = String(body.reason || 'Rejected by admin').trim();
    trip.updatedAt       = now();
    addAudit(db, auth.user, 'trip.reject', trip.id, { reason: trip.rejectionReason });
    await writeDb(db);
    broadcast(auth.user.groupCode, 'trip-updated', { trip });
    broadcast(auth.user.groupCode, 'data-changed', { type: 'trip.reject', trip });
    return send(res, 200, { trip });
  }

  return send(res, 404, { message: 'Route not found' });
}

// ── HTTP server ────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // Security headers on every response. HSTS is ignored by browsers on plain-HTTP connections
  // (LAN/localhost access), so it only takes effect when actually served over HTTPS (e.g. via
  // the Cloudflare Tunnel) — safe to send unconditionally.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // connect-src is intentionally unrestricted: the app lets a device point at any backend URL
  // (LAN IP, Cloudflare Tunnel domain, or a custom server address entered on the login screen),
  // so the origin it talks to isn't knowable in advance.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com data:; " +
    "img-src 'self' data: blob:; connect-src *; frame-ancestors 'none'; " +
    "base-uri 'self'; object-src 'none'"
  );

  try {
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res);
    } else {
      serveStatic(req, res);
    }
  } catch (error) {
    // MongoServerSelectionError, MongoNetworkError, MongoTimeoutError, etc. all carry a `name`
    // ending in one of these — narrow on purpose, so a normal application error (a bug in a
    // route handler) never gets mistaken for the database itself being down.
    if (usingMongo && /Mongo(ServerSelection|Network|Timeout|NotConnected)Error/.test(error?.name || '')) {
      recordDbFailure();
      const correlationId = crypto.randomBytes(6).toString('hex');
      console.error(`[${correlationId}] database connection error`, error);
      if (!res.headersSent) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(dbBreakerRetryAfterMs() / 1000)) || 15));
        send(res, 503, {
          message: 'The database is temporarily unavailable — please try again in a few seconds.',
          code: 'DB_UNAVAILABLE',
          correlationId,
        });
      } else {
        res.end();
      }
      return;
    }
    // Detailed error stays server-side only — the client gets a generic message plus a
    // correlation ID so an incident can still be traced back to this log line if reported.
    const correlationId = crypto.randomBytes(6).toString('hex');
    console.error(`[${correlationId}]`, error);
    if (!res.headersSent) {
      send(res, 500, { message: 'Something went wrong on our end.', correlationId });
    } else {
      res.end();
    }
  }
});

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

// ── Automated backups ────────────────────────────────────────────────────
// Goes through readDb() so it works the same whether the live data is the local file or
// MongoDB — either way, every business's data on this server ends up snapshotted to a plain
// JSON file, independent of whatever's serving live traffic. Hourly, keeping the last 3 days'
// worth; this is a stopgap against data loss, not a substitute for a real backup destination
// (off this machine) once this is handling real customers.
const backupsDir = path.join(dataDir, 'backups');
const BACKUP_INTERVAL_MS = 60 * 60 * 1000;
const BACKUP_RETENTION_COUNT = 72;

async function runBackup() {
  try {
    fs.mkdirSync(backupsDir, { recursive: true });
    const db = await readDb();
    const stamp = now().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(backupsDir, `db-${stamp}.json`), JSON.stringify(db, null, 2));
    const files = fs.readdirSync(backupsDir)
      .filter(f => f.startsWith('db-') && f.endsWith('.json'))
      .sort();
    for (const file of files.slice(0, Math.max(0, files.length - BACKUP_RETENTION_COUNT))) {
      fs.unlinkSync(path.join(backupsDir, file));
    }
  } catch (error) {
    console.error('Backup failed:', error);
  }
}

(usingMongo ? connectMongo() : Promise.resolve(ensureDbFile()))
  .then(() => {
    server.listen(port, host, () => {
      const lanIp = getLanIp();
      console.log('\n========================================');
      console.log('  TRANSPORT MANAGER SERVER STARTED');
      console.log('========================================');
      console.log(`  Admin (this laptop): http://localhost:${port}`);
      if (lanIp) {
        console.log(`  Drivers (phone/tablet): http://${lanIp}:${port}`);
        console.log(`  Share this URL with drivers: http://${lanIp}:${port}`);
      }
      console.log(usingMongo ? `  Database: MongoDB (${mongoDbName})` : `  Data file: ${dbPath}`);
      console.log(`  Backups: ${backupsDir} (hourly, last ${BACKUP_RETENTION_COUNT} kept)`);
      console.log('========================================\n');
    });
    runBackup();
    setInterval(runBackup, BACKUP_INTERVAL_MS).unref();
  })
  .catch(error => {
    console.error(`\nFailed to start${usingMongo ? ': could not connect to MongoDB' : ''}.`);
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
