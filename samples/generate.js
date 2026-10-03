// Generates FAKE sample statements for trying the app. Run: node samples/generate.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rand() * a.length)];
const amt = (lo, hi) => Math.round((lo + rand() * (hi - lo)) * 100) / 100;
const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
const months = [4, 5, 6, 7, 8, 9]; // May..Oct 2026 (0-based month index)
const Y = 2026;

// ---- Checking (generic bank CSV: Date, Description, Amount, Balance) ----
const checking = [];
for (const m of months) {
  for (const day of [1, 15]) checking.push([new Date(Y, m, day), 'ACME CORP PAYROLL DIRECT DEP', 2450.0]);
  checking.push([new Date(Y, m, 1), 'ZELLE PAYMENT TO OAKWOOD APTS RENT', -1350]);
  checking.push([new Date(Y, m, 6), 'DUKE ENERGY ELECTRIC PAYMENT', -amt(95, 160)]);
  checking.push([new Date(Y, m, 9), 'XFINITY INTERNET 800-934-6489', -79.99]);
  checking.push([new Date(Y, m, 12), 'GEICO AUTO INSURANCE', -142.5]);
  checking.push([new Date(Y, m, 18), 'VERIZON WIRELESS PAYMENT', -85.0]);
  checking.push([new Date(Y, m, 20), 'CHASE CREDIT CRD AUTOPAY', -amt(300, 450)]);
  checking.push([new Date(Y, m, 22), 'DISCOVER E-PAYMENT', -amt(150, 250)]);
  checking.push([new Date(Y, m, 3), 'PLANET FITNESS #1123', -24.99]);
  for (let i = 0; i < 3; i++) checking.push([new Date(Y, m, 2 + Math.floor(rand() * 26)), pick(['SHELL OIL 57442', 'WAWA 8812', 'EXXONMOBIL 4471']), -amt(35, 60)]);
  if (m === 9) break;
}
checking.sort((a, b) => a[0] - b[0]);
let bal = 3200;
const checkingCsv = ['Date,Description,Amount,Balance'];
for (const [d, desc, a] of checking.filter(([d]) => d <= new Date(Y, 9, 2))) {
  bal += a;
  checkingCsv.push(`${fmt(d)},"${desc}",${a.toFixed(2)},${bal.toFixed(2)}`);
}
fs.writeFileSync(path.join(dir, 'sample-checking.csv'), checkingCsv.join('\n'));

// ---- Chase-style card CSV (charges negative) ----
const chase = ['Transaction Date,Post Date,Description,Category,Type,Amount,Memo'];
const chaseRows = [];
for (const m of months.slice(0, 5)) {
  chaseRows.push([new Date(Y, m, 4), 'NETFLIX.COM', 'Entertainment', 'Sale', -15.49]);
  chaseRows.push([new Date(Y, m, 11), 'SPOTIFY USA', 'Entertainment', 'Sale', -11.99]);
  chaseRows.push([new Date(Y, m, 14), 'HULU 877-8244858', 'Entertainment', 'Sale', -17.99]);
  chaseRows.push([new Date(Y, m, 23), 'APPLE.COM/BILL', 'Shopping', 'Sale', -2.99]);
  chaseRows.push([new Date(Y, m, 27), 'PELOTON MEMBERSHIP', 'Health & Wellness', 'Sale', -44.0]);
  for (let i = 0; i < 9; i++) chaseRows.push([new Date(Y, m, 1 + Math.floor(rand() * 28)), pick(['STARBUCKS STORE 1234', 'CHIPOTLE 2231', 'DOORDASH*TACOBELL', 'UBER EATS', 'MCDONALD\'S F1234', 'PANERA BREAD #601']), 'Food & Drink', 'Sale', -amt(6, 42)]);
  for (let i = 0; i < 4; i++) chaseRows.push([new Date(Y, m, 1 + Math.floor(rand() * 28)), pick(['AMAZON MKTPL*2K4LQ', 'TARGET 00012345', 'BEST BUY 00011']), 'Shopping', 'Sale', -amt(18, 140)]);
  for (let i = 0; i < 4; i++) chaseRows.push([new Date(Y, m, 1 + Math.floor(rand() * 28)), pick(['KROGER #442', 'WHOLEFDS MKT 10234', 'TRADER JOE S #552']), 'Groceries', 'Sale', -amt(45, 160)]);
  chaseRows.push([new Date(Y, m, 20), 'Payment Thank You-Mobile', '', 'Payment', 400]);
}
chaseRows.sort((a, b) => a[0] - b[0]);
for (const [d, desc, cat, type, a] of chaseRows) {
  const post = new Date(d); post.setDate(post.getDate() + 1);
  chase.push(`${fmt(d)},${fmt(post)},"${desc}",${cat},${type},${a.toFixed(2)},`);
}
fs.writeFileSync(path.join(dir, 'sample-chase-card.csv'), chase.join('\n'));

// ---- Discover-style card CSV (charges positive, payments negative) ----
const disc = ['Trans. Date,Post Date,Description,Amount,Category'];
const discRows = [];
for (const m of months.slice(0, 5)) {
  discRows.push([new Date(Y, m, 8), 'DISNEY PLUS 888-905-7888 CA', 13.99, 'Services']);
  discRows.push([new Date(Y, m, 16), 'AUDIBLE*2X88AB', 14.95, 'Merchandise']);
  discRows.push([new Date(Y, m, 19), 'SIRIUSXM RADIO', 10.99, 'Services']);
  for (let i = 0; i < 5; i++) discRows.push([new Date(Y, m, 1 + Math.floor(rand() * 28)), pick(['OLIVE GARDEN 0012', 'AMC THEATRES 4421', 'ULTA BEAUTY #33', 'HOME DEPOT 6631', 'ETSY.COM']), amt(20, 95), 'Merchandise']);
  discRows.push([new Date(Y, m, 22), 'INTERNET PAYMENT - THANK YOU', -200, 'Payments and Credits']);
}
discRows.push([new Date(Y, 6, 2), 'ADOBE CREATIVE CLOUD', 59.99, 'Services']);
discRows.sort((a, b) => a[0] - b[0]);
for (const [d, desc, a, cat] of discRows) disc.push(`${fmt(d)},${fmt(d)},${desc},${a.toFixed(2)},${cat}`);
fs.writeFileSync(path.join(dir, 'sample-discover-card.csv'), disc.join('\n'));

console.log('Wrote sample-checking.csv, sample-chase-card.csv, sample-discover-card.csv (fake data)');
