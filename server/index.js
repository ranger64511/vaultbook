import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import * as vault from './vault.js';
import { DEFAULT_CATEGORIES, allRules, categorize, merchantKey } from './categorize.js';
import { parseStatement } from './parsers/index.js';
import { parseStatementLines } from './parsers/pdf.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROD = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
const PORT = Number(process.env.VAULTBOOK_PORT || 4310);
const IDLE_MS = 30 * 60 * 1000;
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'vb_session';

// Network: only this computer, unless the admin turned on home-network access
// (Settings > Household). Changing it takes effect after a restart.
const OPTIONS_AT_START = vault.serverOptions();
const HOST = process.env.VAULTBOOK_HOST || (OPTIONS_AT_START.lanAccess ? '0.0.0.0' : '127.0.0.1');
const LAN_ACTIVE = HOST !== '127.0.0.1' && HOST !== 'localhost';
// Optional HTTPS (recommended for home-network access): paths to a certificate and key.
const TLS = process.env.VAULTBOOK_TLS_CERT && process.env.VAULTBOOK_TLS_KEY
  ? { cert: fs.readFileSync(process.env.VAULTBOOK_TLS_CERT), key: fs.readFileSync(process.env.VAULTBOOK_TLS_KEY) }
  : null;

/** This machine's IPv4 addresses on the local network. */
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

// Host-header allow-list (blocks DNS rebinding). With LAN access, this machine's own
// addresses and names are allowed too, plus any in VAULTBOOK_ALLOWED_HOSTS.
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
if (LAN_ACTIVE) {
  for (const ip of lanAddresses()) ALLOWED_HOSTS.add(ip);
  const name = os.hostname().toLowerCase();
  ALLOWED_HOSTS.add(name);
  ALLOWED_HOSTS.add(`${name}.local`);
  ALLOWED_HOSTS.add(`${name}.lan`);
}
for (const h of (process.env.VAULTBOOK_ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)) ALLOWED_HOSTS.add(h);

/** Today's date in the computer's own time zone, as YYYY-MM-DD. */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- state ---
// Each signed-in user's decrypted data key and vault exist only in memory while unlocked.
const unlocked = new Map(); // userId -> { user, dek, data }
const sessions = new Map(); // token -> { userId, created, lastSeen }
// Every request runs "as" its signed-in user, so concurrent users never see each other's data.
const current = new AsyncLocalStorage();
const state = {
  get dek() { return current.getStore()?.dek; },
  get data() { return current.getStore()?.data; },
  get user() { return current.getStore()?.user; },
  get userId() { return current.getStore()?.user.id; },
  get username() { return current.getStore()?.user.username; },
};

function lockUser(userId) {
  const e = unlocked.get(userId);
  if (e) { e.dek.fill(0); unlocked.delete(userId); }
  for (const [t, s] of sessions) if (s.userId === userId) sessions.delete(t);
  for (const [id, p] of pendingUploads) if (p.userId === userId) pendingUploads.delete(id);
}

setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) {
    if (now - s.lastSeen > IDLE_MS || now - s.created > MAX_SESSION_MS) sessions.delete(t);
  }
  const active = new Set([...sessions.values()].map((s) => s.userId));
  for (const id of unlocked.keys()) if (!active.has(id)) lockUser(id);
}, 60 * 1000).unref();

function freshData() {
  return {
    version: 1,
    accounts: [],
    transactions: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    rules: [],
    // merchantKey -> { status: 'keep' | 'cancel' | 'ignore', note, stopMonth }. 'cancel' is a plan only;
    // Vault Book never contacts merchants or stops any charge.
    recurring: {},
    imports: [],
    settings: { payoffBudget: 0, payoffStrategy: 'avalanche' },
  };
}

function migrate(data) {
  const base = freshData();
  for (const k of Object.keys(base)) data[k] ??= base[k];
  for (const c of DEFAULT_CATEGORIES) {
    if (!data.categories.some((x) => x.id === c.id)) data.categories.push({ ...c });
  }
  return data;
}

function persist() {
  vault.saveVault(state.userId, state.dek, state.data);
}

// ----------------------------------------------------------------- app ----
const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // OCR runs in a Web Worker using WebAssembly.
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      workerSrc: ["'self'", 'blob:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null, // may be served over plain http on a home network
    },
  },
  hsts: !!TLS,
  crossOriginEmbedderPolicy: false,
}));

// Block DNS-rebinding: only answer requests addressed to this machine.
app.use((req, res, next) => {
  const host = (req.headers.host || '').replace(/:\d+$/, '').toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return res.status(403).send('Forbidden host');
  next();
});

// OCR engine files, served from this machine so nothing is downloaded from the internet.
const OCR_ASSETS = {
  worker: path.join(ROOT, 'node_modules', 'tesseract.js', 'dist'),
  core: path.join(ROOT, 'node_modules', 'tesseract.js-core'),
  lang: path.join(ROOT, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int'),
};
for (const [name, dir] of Object.entries(OCR_ASSETS)) {
  app.use(`/ocr/${name}`, express.static(dir, { index: false, fallthrough: false, maxAge: '7d' }));
}

app.use('/api', express.json({ limit: '10mb' }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  // CSRF: browsers cannot send this custom header cross-site without a CORS preflight we never allow.
  if (req.method !== 'GET' && req.get('x-requested-with') !== 'vaultbook') {
    return res.status(403).json({ error: 'Missing CSRF header' });
  }
  next();
});

function getToken(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId, created: Date.now(), lastSeen: Date.now() });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: !!TLS, path: '/', maxAge: MAX_SESSION_MS });
}

/** The signed-in user's unlocked vault for this request, if any. */
function entryFor(req) {
  const s = sessions.get(getToken(req));
  const e = s && unlocked.get(s.userId);
  if (e) s.lastSeen = Date.now();
  return e || null;
}

function requireAuth(req, res, next) {
  const e = entryFor(req);
  if (!e) return res.status(401).json({ error: 'Not logged in' });
  req.vb = e;
  current.run(e, next);
}

/** Re-enters the user's context after middleware (like uploads) that loses it. */
const withUser = (fn) => (req, res, next) => current.run(req.vb, () => fn(req, res, next));

function requireAdmin(req, res, next) {
  if (state.user?.role !== 'admin') return res.status(403).json({ error: 'Only the household admin can do this' });
  next();
}

// Login throttling: exponential lockout per client after repeated failures.
const failures = new Map();
function throttled(ip) {
  const f = failures.get(ip);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
}
function recordFailure(ip) {
  const f = failures.get(ip) || { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) f.until = Date.now() + Math.min(15 * 60, 30 * 2 ** (f.count - 5)) * 1000;
  failures.set(ip, f);
}

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function validCredentials(username, password) {
  if (typeof username !== 'string' || !/^[\w.@-]{3,40}$/.test(username)) return 'Username must be 3-40 letters, numbers, or . _ - @';
  if (typeof password !== 'string' || password.length < 10) return 'Password must be at least 10 characters';
  return null;
}

// ---------------------------------------------------------------- auth ----
app.get('/api/auth/status', (req, res) => {
  const e = entryFor(req);
  res.json({
    setUp: vault.isSetUp(),
    authenticated: !!e,
    username: e?.user.username ?? null,
    role: e?.user.role ?? null,
    multiUser: vault.serverOptions().multiUser,
  });
});

app.post('/api/auth/setup', asyncRoute(async (req, res) => {
  if (vault.isSetUp()) return res.status(400).json({ error: 'An account already exists' });
  const { username, password } = req.body || {};
  const err = validCredentials(username, password);
  if (err) return res.status(400).json({ error: err });
  const data = freshData();
  // The first account is the household admin.
  const { user, dek } = await vault.createUser(username, password, 'admin', data);
  unlocked.set(user.id, { user, dek, data });
  startSession(res, user.id);
  res.json({ ok: true, username });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const ip = req.ip;
  const wait = throttled(ip);
  if (wait) return res.status(429).json({ error: `Too many attempts. Try again in ${wait}s.` });
  const { username, password } = req.body || {};
  const result = typeof username === 'string' && typeof password === 'string'
    ? await vault.unlock(username, password) : null;
  if (!result) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  failures.delete(ip);
  if (result.user.role !== 'admin' && !vault.serverOptions().multiUser) {
    result.dek.fill(0);
    return res.status(403).json({ error: 'Household mode is turned off. Ask your household admin to turn it on.' });
  }
  if (!unlocked.has(result.user.id)) {
    unlocked.set(result.user.id, { user: result.user, dek: result.dek, data: migrate(vault.loadVault(result.user.id, result.dek)) });
  } else {
    result.dek.fill(0);
  }
  startSession(res, result.user.id);
  res.json({ ok: true, username: result.user.username });
}));

app.post('/api/auth/logout', (req, res) => {
  const token = getToken(req);
  const s = sessions.get(token);
  sessions.delete(token);
  res.clearCookie(COOKIE, { path: '/' });
  if (s && ![...sessions.values()].some((x) => x.userId === s.userId)) lockUser(s.userId);
  res.json({ ok: true });
});

app.post('/api/auth/change-password', requireAuth, asyncRoute(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const check = await vault.unlock(state.username, String(currentPassword || ''));
  if (!check || check.user.id !== state.userId) return res.status(400).json({ error: 'Current password is incorrect' });
  check.dek.fill(0);
  const err = validCredentials(state.username, newPassword);
  if (err) return res.status(400).json({ error: err });
  await vault.changePassword(state.userId, state.dek, newPassword);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- data ----
app.use('/api', (req, res, next) => (req.path.startsWith('/auth/') ? next() : requireAuth(req, res, next)));

app.get('/api/data', (req, res) => res.json(state.data));

const ACCOUNT_TYPES = [
  'checking', 'savings', 'money-market', 'cd', 'cash', 'other', 'brokerage', 'retirement',
  'credit', 'auto-loan', 'mortgage', 'student-loan', 'personal-loan', 'medical-debt', 'other-debt',
  'home', 'vehicle', 'property',
];
const DEBT_TYPES = new Set(['credit', 'auto-loan', 'mortgage', 'student-loan', 'personal-loan', 'medical-debt', 'other-debt']);
const isDebt = (type) => DEBT_TYPES.has(type);
const INVESTMENT_TYPES = new Set(['brokerage', 'retirement']);
const ACCOUNT_FIELDS = [
  'name', 'type', 'institution', 'balance', 'apr', 'apy', 'minPayment', 'creditLimit', 'dueDay', 'last4', 'maturityDate',
  'expectedReturn', 'withdrawalCost', 'excludeFromPayoff', 'appreciation', 'linkedLoan',
];
function pickAccount(body) {
  const a = {};
  for (const k of ACCOUNT_FIELDS) if (body[k] !== undefined) a[k] = body[k];
  for (const k of ['balance', 'apr', 'apy', 'minPayment', 'creditLimit', 'dueDay', 'expectedReturn', 'withdrawalCost', 'appreciation']) {
    if (a[k] !== undefined) a[k] = a[k] === '' || a[k] === null || !Number.isFinite(Number(a[k])) ? null : Number(a[k]);
  }
  if (a.apy != null) a.apy = Math.min(100, Math.max(0, a.apy));
  if (a.expectedReturn != null) a.expectedReturn = Math.min(50, Math.max(-50, a.expectedReturn));
  if (a.withdrawalCost != null) a.withdrawalCost = Math.min(100, Math.max(0, a.withdrawalCost));
  if (a.excludeFromPayoff !== undefined) a.excludeFromPayoff = a.excludeFromPayoff === true;
  if (a.appreciation != null) a.appreciation = Math.min(100, Math.max(-100, a.appreciation));
  // A home or vehicle can point at the loan against it, to show equity.
  if (a.linkedLoan !== undefined) a.linkedLoan = state.data.accounts.some((x) => x.id === a.linkedLoan && isDebt(x.type)) ? a.linkedLoan : null;
  if (a.maturityDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(a.maturityDate || '')) a.maturityDate = null;
  if (a.type && !ACCOUNT_TYPES.includes(a.type)) a.type = 'checking';
  return a;
}

app.post('/api/accounts', (req, res) => {
  const acct = { id: crypto.randomUUID(), type: 'checking', balance: 0, ...pickAccount(req.body || {}) };
  if (!acct.name) return res.status(400).json({ error: 'Name is required' });
  acct.balanceAsOf = localToday();
  state.data.accounts.push(acct);
  persist();
  res.json(acct);
});

app.put('/api/accounts/:id', (req, res) => {
  const acct = state.data.accounts.find((a) => a.id === req.params.id);
  if (!acct) return res.status(404).json({ error: 'Not found' });
  const patch = pickAccount(req.body || {});
  if (patch.balance !== undefined && patch.balance !== acct.balance) acct.balanceAsOf = localToday();
  Object.assign(acct, patch);
  persist();
  res.json(acct);
});

app.delete('/api/accounts/:id', (req, res) => {
  const id = req.params.id;
  state.data.accounts = state.data.accounts.filter((a) => a.id !== id);
  for (const a of state.data.accounts) if (a.linkedLoan === id) a.linkedLoan = null;
  state.data.transactions = state.data.transactions.filter((t) => t.accountId !== id);
  for (const imp of state.data.imports) if (imp.accountId === id) vault.deleteFile(state.userId, imp.id);
  state.data.imports = state.data.imports.filter((i) => i.accountId !== id);
  persist();
  res.json({ ok: true });
});

const txHash = (accountId, date, amount, description) =>
  `${accountId}|${date}|${amount.toFixed(2)}|${merchantKey(description)}`;

function buildTx(accountId, { date, description, amount, category, notes }, extra = {}) {
  const acct = state.data.accounts.find((a) => a.id === accountId);
  amount = Math.round(Number(amount) * 100) / 100;
  return {
    id: crypto.randomUUID(),
    accountId,
    date,
    description: String(description || '').slice(0, 300),
    merchant: merchantKey(description),
    amount,
    category: category || categorize(description, amount, allRules(state.data), acct?.type),
    notes: notes || '',
    hash: txHash(accountId, date, amount, description),
    ...extra,
  };
}

app.post('/api/transactions', (req, res) => {
  const { accountId, date, description, amount } = req.body || {};
  if (!state.data.accounts.some((a) => a.id === accountId)) return res.status(400).json({ error: 'Pick an account' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !description || !Number.isFinite(Number(amount))) {
    return res.status(400).json({ error: 'Date, description and amount are required' });
  }
  const tx = buildTx(accountId, req.body, { manual: true });
  state.data.transactions.push(tx);
  persist();
  res.json(tx);
});

app.put('/api/transactions/:id', (req, res) => {
  const tx = state.data.transactions.find((t) => t.id === req.params.id);
  if (!tx) return res.status(404).json({ error: 'Not found' });
  const { category, notes, description, amount, date } = req.body || {};
  if (category !== undefined) { tx.category = category; tx.categoryLocked = true; }
  if (notes !== undefined) tx.notes = String(notes).slice(0, 500);
  if (description !== undefined) { tx.description = String(description).slice(0, 300); tx.merchant = merchantKey(tx.description); }
  if (amount !== undefined && Number.isFinite(Number(amount))) tx.amount = Math.round(Number(amount) * 100) / 100;
  if (date !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(date)) tx.date = date;
  persist();
  res.json(tx);
});

app.post('/api/transactions/bulk-category', (req, res) => {
  const { ids, category } = req.body || {};
  const set = new Set(ids || []);
  for (const t of state.data.transactions) if (set.has(t.id)) { t.category = category; t.categoryLocked = true; }
  persist();
  res.json({ ok: true });
});

app.delete('/api/transactions/:id', (req, res) => {
  state.data.transactions = state.data.transactions.filter((t) => t.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

// ------------------------------------------------------------- imports ----
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });

// Uploaded statements wait here (in memory only) between preview and import, so an
// encrypted copy can be kept if the user asks. Cleared on import, after 30 minutes, or on lock.
const pendingUploads = new Map(); // uploadId -> { buffer, name, type, at }
const PENDING_MS = 30 * 60 * 1000;
function holdUpload(file) {
  for (const [id, p] of pendingUploads) if (Date.now() - p.at > PENDING_MS) pendingUploads.delete(id);
  const id = crypto.randomUUID();
  pendingUploads.set(id, { userId: state.userId, buffer: file.buffer, name: file.originalname, type: file.mimetype || 'application/octet-stream', at: Date.now() });
  return id;
}

function previewPayload(parsed, acct, fileName, uploadId) {
  const sign = parsed.flip ? -1 : 1;
    const rules = allRules(state.data);
    // Flag rows already imported (same account, date, amount and merchant).
    const existing = new Map();
    if (acct) {
      for (const t of state.data.transactions) {
        if (t.accountId === acct.id) existing.set(t.hash, (existing.get(t.hash) || 0) + 1);
      }
    }
    const seen = new Map();
    const rows = parsed.rows.map((r, i) => {
      const amount = Math.round(r.amount * sign * 100) / 100;
      const h = acct ? txHash(acct.id, r.date, amount, r.description) : null;
      const n = (seen.get(h) || 0) + 1;
      seen.set(h, n);
      return {
        key: i,
        date: r.date,
        description: r.description,
        amount,
        category: categorize(r.description, amount, rules, acct?.type),
        duplicate: !!h && n <= (existing.get(h) || 0),
      };
    });
    return {
      fileName,
      uploadId,
      format: parsed.format,
      flipped: !!parsed.flip,
      accountTypeHint: parsed.accountTypeHint,
      statement: parsed.statement,
      warnings: parsed.warnings,
      rows,
    };
}

app.post('/api/import/preview', upload.single('file'), withUser(asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const acct = state.data.accounts.find((a) => a.id === req.body.accountId);
  try {
    const parsed = await parseStatement(req.file.originalname, req.file.buffer, acct?.type);
    res.json(previewPayload(parsed, acct, req.file.originalname, holdUpload(req.file)));
  } catch (e) {
    res.status(e.code === 'NEEDS_OCR' ? 422 : 400).json({ error: e.message || 'Could not read this file', code: e.code });
  }
})));

// Text read by OCR in the browser (photos, scanned PDFs). The original file comes along
// only so an encrypted copy can be kept; it is never written to disk unencrypted.
app.post('/api/import/preview-text', upload.single('file'), withUser(asyncRoute(async (req, res) => {
  const acct = state.data.accounts.find((a) => a.id === req.body.accountId);
  let lines;
  try { lines = JSON.parse(req.body.lines || '[]'); } catch { lines = null; }
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'No text was found to read' });
  lines = lines.slice(0, 20000).map((l) => String(l).slice(0, 500));
  const parsed = parseStatementLines(lines, acct?.type, 'ocr');
  parsed.flip = false;
  const fileName = String(req.body.fileName || req.file?.originalname || 'scanned statement').slice(0, 200);
  res.json(previewPayload(parsed, acct, fileName, req.file ? holdUpload(req.file) : null));
})));

app.post('/api/import/commit', (req, res) => {
  const { accountId, fileName, rows, statement, uploadId, keepFile } = req.body || {};
  const acct = state.data.accounts.find((a) => a.id === accountId);
  if (!acct) return res.status(400).json({ error: 'Pick an account' });
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'Nothing to import' });
  const importId = crypto.randomUUID();
  let count = 0;
  let minDate = null;
  let maxDate = null;
  for (const r of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '') || !Number.isFinite(Number(r.amount))) continue;
    state.data.transactions.push(buildTx(accountId, r, { importId }));
    count++;
    if (!minDate || r.date < minDate) minDate = r.date;
    if (!maxDate || r.date > maxDate) maxDate = r.date;
  }
  if (statement) {
    if (Number.isFinite(statement.balance)) {
      acct.balance = isDebt(acct.type) ? Math.abs(statement.balance) : statement.balance;
      acct.balanceAsOf = maxDate || localToday();
    }
    if (Number.isFinite(statement.minPayment)) acct.minPayment = statement.minPayment;
    if (Number.isFinite(statement.apr)) acct.apr = statement.apr;
    if (Number.isFinite(statement.creditLimit)) acct.creditLimit = statement.creditLimit;
    if (statement.dueDate) acct.dueDay = Number(statement.dueDate.slice(8, 10));
  }
  // Optionally keep the original statement, encrypted with the vault key.
  let file = null;
  const pending = uploadId && pendingUploads.get(uploadId)?.userId === state.userId ? pendingUploads.get(uploadId) : null;
  if (pending) {
    if (keepFile) {
      vault.saveFile(state.userId, state.dek, importId, pending.buffer);
      file = { name: pending.name, type: pending.type, size: pending.buffer.length };
    }
    pendingUploads.delete(uploadId);
  }
  state.data.imports.push({
    id: importId, accountId, fileName: String(fileName || 'statement').slice(0, 200),
    importedAt: new Date().toISOString(), count, from: minDate, to: maxDate, file,
  });
  persist();
  res.json({ ok: true, count, keptFile: !!file });
});

app.get('/api/imports/:id/file', (req, res) => {
  const imp = state.data.imports.find((i) => i.id === req.params.id);
  if (!imp?.file) return res.status(404).json({ error: 'No saved copy of this statement' });
  const buf = vault.readFile(state.userId, state.dek, imp.id);
  const safeName = imp.file.name.replace(/[^\w.\- ()]/g, '_');
  res.set('Content-Type', imp.file.type || 'application/octet-stream');
  res.set('Content-Disposition', `attachment; filename="${safeName}"`);
  res.send(buf);
});

app.delete('/api/imports/:id', (req, res) => {
  vault.deleteFile(state.userId, req.params.id);
  state.data.transactions = state.data.transactions.filter((t) => t.importId !== req.params.id);
  state.data.imports = state.data.imports.filter((i) => i.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

// ---------------------------------------------------- categories & rules --
app.put('/api/categories', (req, res) => {
  const cats = req.body?.categories;
  if (!Array.isArray(cats)) return res.status(400).json({ error: 'categories must be an array' });
  state.data.categories = cats.map((c) => ({
    id: String(c.id || crypto.randomUUID()),
    name: String(c.name || 'Unnamed').slice(0, 60),
    kind: ['need', 'want', 'income', 'transfer'].includes(c.kind) ? c.kind : 'want',
    budget: Math.max(0, Number(c.budget) || 0),
  }));
  if (!state.data.categories.some((c) => c.id === 'uncategorized')) {
    state.data.categories.push({ id: 'uncategorized', name: 'Uncategorized', kind: 'want', budget: 0 });
  }
  persist();
  res.json(state.data.categories);
});

function recategorize() {
  const rules = allRules(state.data);
  const types = new Map(state.data.accounts.map((a) => [a.id, a.type]));
  let changed = 0;
  for (const t of state.data.transactions) {
    if (t.categoryLocked) continue;
    const c = categorize(t.description, t.amount, rules, types.get(t.accountId));
    if (c !== t.category) { t.category = c; changed++; }
  }
  return changed;
}

app.post('/api/rules', (req, res) => {
  const { pattern, category, applyToExisting } = req.body || {};
  if (!pattern || !category) return res.status(400).json({ error: 'Pattern and category are required' });
  let re;
  try { re = new RegExp(pattern, 'i'); } catch { return res.status(400).json({ error: 'Invalid pattern' }); }
  state.data.rules.unshift({ id: crypto.randomUUID(), pattern: String(pattern).slice(0, 200), category });
  let changed = 0;
  if (applyToExisting) {
    for (const t of state.data.transactions) {
      if (re.test(t.description) && t.category !== category) { t.category = category; t.categoryLocked = true; changed++; }
    }
  }
  persist();
  res.json({ ok: true, changed });
});

app.delete('/api/rules/:id', (req, res) => {
  state.data.rules = state.data.rules.filter((r) => r.id !== req.params.id);
  persist();
  res.json({ ok: true });
});

app.post('/api/recategorize', (req, res) => {
  const changed = recategorize();
  persist();
  res.json({ ok: true, changed });
});

// ----------------------------------------------------- recurring/settings -
app.put('/api/recurring/:key', (req, res) => {
  const key = decodeURIComponent(req.params.key);
  const { status, note, stopMonth } = req.body || {};
  if (!status) delete state.data.recurring[key];
  else if (!['keep', 'cancel', 'ignore'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  else {
    state.data.recurring[key] = {
      status,
      note: String(note || '').slice(0, 300),
      // 'cancel' only records a plan; YYYY-MM is when the user expects to have stopped the charge.
      stopMonth: status === 'cancel' && /^\d{4}-(0[1-9]|1[0-2])$/.test(stopMonth || '') ? stopMonth : null,
    };
  }
  persist();
  res.json({ ok: true });
});

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
function cleanAdjustments(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 100).flatMap((a) => {
    const amount = Math.round(Number(a?.amount) * 100) / 100;
    if (!['lump', 'increase'].includes(a?.type) || !(amount > 0) || amount > 1e8 || !MONTH_RE.test(a?.month || '')) return [];
    const repeat = a.type === 'lump' && ['monthly', 'quarterly', 'semiannual', 'yearly'].includes(a.repeat) ? a.repeat : 'none';
    const percent = a.percent === '' || a.percent == null || !Number.isFinite(Number(a.percent)) ? null : Math.min(100, Math.max(0, Number(a.percent)));
    return [{
      id: /^[\w-]{1,40}$/.test(a.id || '') ? a.id : crypto.randomUUID(),
      type: a.type,
      source: ['bonus', 'raise', 'lump', 'increase', 'withdraw'].includes(a.source) ? a.source : null,
      // Investment withdrawals name the account the money comes from.
      fromAccount: a.source === 'withdraw' && state.data.accounts.some((x) => x.id === a.fromAccount && INVESTMENT_TYPES.has(x.type)) ? a.fromAccount : null,
      amount,
      percent,
      month: a.month,
      repeat,
      endMonth: (a.type === 'increase' || repeat !== 'none') && MONTH_RE.test(a.endMonth || '') && a.endMonth >= a.month ? a.endMonth : null,
      target: a.type === 'lump' && state.data.accounts.some((x) => x.id === a.target && isDebt(x.type)) ? a.target : null,
      note: String(a.note || '').slice(0, 120),
    }];
  });
}

app.put('/api/settings', (req, res) => {
  const s = req.body || {};
  const next = { ...state.data.settings };
  if (s.payoffBudget !== undefined) next.payoffBudget = Math.max(0, Number(s.payoffBudget) || 0);
  if (s.payoffStrategy !== undefined) next.payoffStrategy = ['avalanche', 'snowball'].includes(s.payoffStrategy) ? s.payoffStrategy : 'avalanche';
  if (s.monthlyIncome !== undefined) next.monthlyIncome = Math.max(0, Number(s.monthlyIncome) || 0);
  // Extra payments applied to the Main plan, and saved Payoff theory scenarios.
  // These are plans only: Vault Book never makes a payment.
  if (s.payoffAdjustments !== undefined) next.payoffAdjustments = cleanAdjustments(s.payoffAdjustments);
  if (s.payoffScenarios !== undefined) {
    const prev = new Map((next.payoffScenarios || []).map((sc) => [sc.id, sc]));
    next.payoffScenarios = (Array.isArray(s.payoffScenarios) ? s.payoffScenarios : []).slice(0, 50).map((sc) => {
      const clean = {
        id: /^[\w-]{1,40}$/.test(sc?.id || '') ? sc.id : crypto.randomUUID(),
        name: String(sc?.name || 'Untitled theory').slice(0, 80),
        budget: Math.max(0, Number(sc?.budget) || 0),
        strategy: ['avalanche', 'snowball'].includes(sc?.strategy) ? sc.strategy : 'avalanche',
        adjustments: cleanAdjustments(sc?.adjustments),
      };
      // Keep the old timestamp unless something actually changed.
      const old = prev.get(clean.id);
      const same = old && JSON.stringify({ ...old, updatedAt: undefined, savedAt: undefined }) === JSON.stringify({ ...clean, updatedAt: undefined, savedAt: undefined });
      return { ...clean, updatedAt: same ? (old.updatedAt || old.savedAt || localToday()) : localToday() };
    });
  }
  if (s.payoffActiveTheory !== undefined) {
    next.payoffActiveTheory = /^[\w-]{1,40}$/.test(s.payoffActiveTheory || '') ? s.payoffActiveTheory : null;
  }
  state.data.settings = next;
  persist();
  res.json(next);
});

// ------------------------------------------------------------ household ---
// Multi-user ("household") mode is off by default. Each member has their own vault,
// encrypted with their own password; the admin cannot read anyone else's data.
function householdInfo() {
  const opts = vault.serverOptions();
  const scheme = TLS ? 'https' : 'http';
  return {
    ...opts,
    lanActive: LAN_ACTIVE,
    https: !!TLS,
    restartNeeded: opts.lanAccess !== LAN_ACTIVE && !process.env.VAULTBOOK_HOST,
    addresses: LAN_ACTIVE ? lanAddresses().map((ip) => `${scheme}://${ip}:${PORT}`) : [],
    users: vault.listUsers(),
    you: state.userId,
  };
}

app.get('/api/admin/household', requireAdmin, (req, res) => res.json(householdInfo()));

app.put('/api/admin/household', requireAdmin, (req, res) => {
  const { multiUser, lanAccess } = req.body || {};
  vault.setServerOptions({ multiUser, lanAccess });
  // Turning household mode off signs everyone but admins out.
  if (multiUser === false) {
    const admins = new Set(vault.listUsers().filter((u) => u.role === 'admin').map((u) => u.id));
    for (const id of [...unlocked.keys()]) if (!admins.has(id)) lockUser(id);
  }
  res.json(householdInfo());
});

app.post('/api/admin/users', requireAdmin, asyncRoute(async (req, res) => {
  if (!vault.serverOptions().multiUser) return res.status(400).json({ error: 'Turn on household mode first' });
  const { username, password, role } = req.body || {};
  const err = validCredentials(username, password);
  if (err) return res.status(400).json({ error: err });
  try {
    const { dek } = await vault.createUser(username, password, role === 'admin' ? 'admin' : 'member', freshData());
    dek.fill(0); // the new member unlocks their own vault when they sign in
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.json(householdInfo());
}));

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  if (id === state.userId) return res.status(400).json({ error: 'You can’t remove yourself' });
  if (!vault.listUsers().some((u) => u.id === id)) return res.status(404).json({ error: 'No such user' });
  lockUser(id);
  vault.deleteUser(id);
  res.json(householdInfo());
});

// --------------------------------------------------------------- export ---
app.get('/api/backup', (req, res) => {
  const stamp = localToday();
  res.set('Content-Disposition', `attachment; filename="vaultbook-backup-${stamp}.json"`);
  res.json({
    format: 'vaultbook-encrypted-backup',
    note: 'Encrypted with your password. Contains your login record (wrapped key), your vault and your statement copies.',
    username: state.username,
    auth: vault.authRecord(state.userId),
    vault: vault.vaultBytes(state.userId).toString('base64'),
    // Saved statement copies, still encrypted (restore into data/files/<id>.enc).
    files: Object.fromEntries(state.data.imports.filter((i) => i.file).map((i) => [i.id, vault.fileBytes(state.userId, i.id)?.toString('base64')]).filter(([, b]) => b)),
  });
});

app.get('/api/export.csv', (req, res) => {
  const accts = new Map(state.data.accounts.map((a) => [a.id, a.name]));
  const cats = new Map(state.data.categories.map((c) => [c.id, c.name]));
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['Date,Account,Description,Amount,Category,Notes'];
  for (const t of [...state.data.transactions].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push([t.date, accts.get(t.accountId), t.description, t.amount.toFixed(2), cats.get(t.category) || t.category, t.notes].map(esc).join(','));
  }
  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="transactions.csv"');
  res.send(lines.join('\r\n'));
});

// ------------------------------------------------------------- frontend ---
if (PROD) {
  const dist = path.join(ROOT, 'client', 'dist');
  app.use(express.static(dist, { index: false }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

const server = TLS ? https.createServer(TLS, app) : http.createServer(app);
server.listen(PORT, HOST, () => {
  const scheme = TLS ? 'https' : 'http';
  console.log(`Vault Book listening on ${scheme}://${HOST}:${PORT}${PROD ? ' (serving app)' : ''}`);
  if (LAN_ACTIVE) {
    console.log(`Home-network access is ON: ${lanAddresses().map((ip) => `${scheme}://${ip}:${PORT}`).join(', ')}`);
    if (!TLS) console.log('Warning: traffic on your network is not encrypted. Set VAULTBOOK_TLS_CERT and VAULTBOOK_TLS_KEY to use HTTPS.');
  }
});
