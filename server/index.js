import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import * as vault from './vault.js';
import { DEFAULT_CATEGORIES, allRules, categorize, merchantKey } from './categorize.js';
import { parseStatement } from './parsers/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROD = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
const PORT = Number(process.env.VAULTBOOK_PORT || 4310);
const HOST = '127.0.0.1'; // never expose financial data to the network
const IDLE_MS = 30 * 60 * 1000;
const MAX_SESSION_MS = 12 * 60 * 60 * 1000;
const COOKIE = 'vb_session';

/** Today's date in the computer's own time zone, as YYYY-MM-DD. */
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ---------------------------------------------------------------- state ---
// The decrypted data key and vault contents exist only in memory while unlocked.
const state = { dek: null, data: null, username: null };
const sessions = new Map(); // token -> { created, lastSeen }

function lock() {
  sessions.clear();
  state.dek?.fill(0);
  state.dek = null;
  state.data = null;
  state.username = null;
}

setInterval(() => {
  const now = Date.now();
  for (const [t, s] of sessions) {
    if (now - s.lastSeen > IDLE_MS || now - s.created > MAX_SESSION_MS) sessions.delete(t);
  }
  if (!sessions.size && state.dek) lock();
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
  vault.saveVault(state.dek, state.data);
}

// ----------------------------------------------------------------- app ----
const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: null, // served over plain http on localhost
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Block DNS-rebinding: only answer requests addressed to this machine.
app.use((req, res, next) => {
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return res.status(403).send('Forbidden host');
  next();
});

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

function startSession(res) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { created: Date.now(), lastSeen: Date.now() });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: false, path: '/', maxAge: MAX_SESSION_MS });
}

function requireAuth(req, res, next) {
  const s = sessions.get(getToken(req));
  if (!s || !state.dek) return res.status(401).json({ error: 'Not logged in' });
  s.lastSeen = Date.now();
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
  const authed = sessions.has(getToken(req)) && !!state.dek;
  res.json({ setUp: vault.isSetUp(), authenticated: authed, username: authed ? state.username : null });
});

app.post('/api/auth/setup', asyncRoute(async (req, res) => {
  if (vault.isSetUp()) return res.status(400).json({ error: 'An account already exists' });
  const { username, password } = req.body || {};
  const err = validCredentials(username, password);
  if (err) return res.status(400).json({ error: err });
  const data = freshData();
  state.dek = await vault.setup(username, password, data);
  state.data = data;
  state.username = username;
  startSession(res);
  res.json({ ok: true, username });
}));

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const ip = req.ip;
  const wait = throttled(ip);
  if (wait) return res.status(429).json({ error: `Too many attempts. Try again in ${wait}s.` });
  const { username, password } = req.body || {};
  const dek = typeof username === 'string' && typeof password === 'string'
    ? await vault.unlock(username, password) : null;
  if (!dek) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  failures.delete(ip);
  if (!state.dek) {
    state.dek = dek;
    state.data = migrate(vault.loadVault(dek));
    state.username = username;
  } else {
    dek.fill(0);
  }
  startSession(res);
  res.json({ ok: true, username });
}));

app.post('/api/auth/logout', (req, res) => {
  sessions.delete(getToken(req));
  res.clearCookie(COOKIE, { path: '/' });
  if (!sessions.size) lock();
  res.json({ ok: true });
});

app.post('/api/auth/change-password', requireAuth, asyncRoute(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const check = await vault.unlock(state.username, String(currentPassword || ''));
  if (!check) return res.status(400).json({ error: 'Current password is incorrect' });
  check.fill(0);
  const err = validCredentials(state.username, newPassword);
  if (err) return res.status(400).json({ error: err });
  await vault.changePassword(state.dek, state.username, newPassword);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- data ----
app.use('/api', (req, res, next) => (req.path.startsWith('/auth/') ? next() : requireAuth(req, res, next)));

app.get('/api/data', (req, res) => res.json(state.data));

const ACCOUNT_TYPES = [
  'checking', 'savings', 'money-market', 'cd', 'cash', 'other', 'brokerage', 'retirement',
  'credit', 'auto-loan', 'mortgage', 'student-loan', 'personal-loan', 'medical-debt', 'other-debt',
];
const DEBT_TYPES = new Set(['credit', 'auto-loan', 'mortgage', 'student-loan', 'personal-loan', 'medical-debt', 'other-debt']);
const isDebt = (type) => DEBT_TYPES.has(type);
const ACCOUNT_FIELDS = [
  'name', 'type', 'institution', 'balance', 'apr', 'apy', 'minPayment', 'creditLimit', 'dueDay', 'last4', 'maturityDate',
  'expectedReturn', 'withdrawalCost', 'excludeFromPayoff',
];
function pickAccount(body) {
  const a = {};
  for (const k of ACCOUNT_FIELDS) if (body[k] !== undefined) a[k] = body[k];
  for (const k of ['balance', 'apr', 'apy', 'minPayment', 'creditLimit', 'dueDay', 'expectedReturn', 'withdrawalCost']) {
    if (a[k] !== undefined) a[k] = a[k] === '' || a[k] === null || !Number.isFinite(Number(a[k])) ? null : Number(a[k]);
  }
  if (a.apy != null) a.apy = Math.min(100, Math.max(0, a.apy));
  if (a.expectedReturn != null) a.expectedReturn = Math.min(50, Math.max(-50, a.expectedReturn));
  if (a.withdrawalCost != null) a.withdrawalCost = Math.min(100, Math.max(0, a.withdrawalCost));
  if (a.excludeFromPayoff !== undefined) a.excludeFromPayoff = a.excludeFromPayoff === true;
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
  state.data.transactions = state.data.transactions.filter((t) => t.accountId !== id);
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

app.post('/api/import/preview', upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const acct = state.data.accounts.find((a) => a.id === req.body.accountId);
  try {
    const parsed = await parseStatement(req.file.originalname, req.file.buffer, acct?.type);
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
    res.json({
      fileName: req.file.originalname,
      format: parsed.format,
      flipped: !!parsed.flip,
      accountTypeHint: parsed.accountTypeHint,
      statement: parsed.statement,
      warnings: parsed.warnings,
      rows,
    });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not read this file' });
  }
  // The uploaded file only ever existed in memory; drop our reference.
  req.file.buffer = null;
}));

app.post('/api/import/commit', (req, res) => {
  const { accountId, fileName, rows, statement } = req.body || {};
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
  state.data.imports.push({
    id: importId, accountId, fileName: String(fileName || 'statement').slice(0, 200),
    importedAt: new Date().toISOString(), count, from: minDate, to: maxDate,
  });
  persist();
  res.json({ ok: true, count });
});

app.delete('/api/imports/:id', (req, res) => {
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
      source: ['bonus', 'raise', 'lump', 'increase'].includes(a.source) ? a.source : null,
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

// --------------------------------------------------------------- export ---
app.get('/api/backup', (req, res) => {
  const stamp = localToday();
  res.set('Content-Disposition', `attachment; filename="vaultbook-backup-${stamp}.json"`);
  res.json({
    format: 'vaultbook-encrypted-backup',
    note: 'Encrypted. Restore by placing auth.json and vault.enc in the data folder. Requires your password.',
    auth: JSON.parse(fs.readFileSync(path.join(vault.DATA_DIR, 'auth.json'), 'utf8')),
    vault: vault.vaultBytes().toString('base64'),
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

app.listen(PORT, HOST, () => {
  console.log(`Vault Book listening on http://${HOST}:${PORT}${PROD ? ' (serving app)' : ''}`);
});
