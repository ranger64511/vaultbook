// Fills the DEMO vault (npm run dev:demo) with the fake sample statements via the API.
// Usage: node samples/seed-demo.js   (server must be running in demo mode)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:4310/api';
const creds = fs.readFileSync(path.join(dir, 'DEMO_LOGIN.md'), 'utf8');
const username = creds.match(/Username: `([^`]+)`/)[1];
const password = creds.match(/Password: `([^`]+)`/)[1];
let cookie = '';

async function call(p, { method = 'GET', body, form } = {}) {
  const headers = { 'X-Requested-With': 'vaultbook', Cookie: cookie };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers, body: form || (body && JSON.stringify(body)) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = await res.json();
  if (!res.ok) throw new Error(`${p}: ${data.error}`);
  return data;
}

const status = await call('/auth/status');
await call(status.setUp ? '/auth/login' : '/auth/setup', { method: 'POST', body: { username, password } });
const existing = await call('/data');
if (existing.transactions.length) {
  console.log('Demo vault already has data - nothing to do.');
  process.exit(0);
}

const accounts = [
  { name: 'Everyday Checking', type: 'checking', institution: 'Acme Bank', balance: 2840.12, file: 'sample-checking.csv' },
  { name: 'Chase Freedom', type: 'credit', institution: 'Chase', balance: 4380.55, apr: 27.49, minPayment: 132, creditLimit: 7500, dueDay: 20, file: 'sample-chase-card.csv' },
  { name: 'Discover It', type: 'credit', institution: 'Discover', balance: 1925.3, apr: 22.99, minPayment: 45, creditLimit: 4000, dueDay: 22, file: 'sample-discover-card.csv' },
  { name: 'Store Card', type: 'credit', institution: 'Synchrony', balance: 640, apr: 29.99, minPayment: 30, creditLimit: 1500, dueDay: 5 },
];
for (const { file, ...a } of accounts) {
  const acct = await call('/accounts', { method: 'POST', body: a });
  if (!file) continue;
  const form = new FormData();
  form.append('accountId', acct.id);
  form.append('file', new Blob([fs.readFileSync(path.join(dir, file))]), file);
  const preview = await call('/import/preview', { method: 'POST', form });
  const res = await call('/import/commit', { method: 'POST', body: { accountId: acct.id, fileName: file, rows: preview.rows, statement: null } });
  console.log(`${a.name}: imported ${res.count} (flipped signs: ${preview.flipped})`);
}
await call('/settings', { method: 'PUT', body: { monthlyIncome: 4900 } });
console.log('Demo data ready.');
