// Captures README screenshots of every page from a running DEMO instance.
//
//   1. npm run dev:demo            (and `node samples/seed-demo.js` the first time)
//   2. npm run screenshots         (or: SCREENSHOT_URL=http://localhost:5173 node scripts/screenshots.mjs)
//
// Uses an installed Edge or Chrome via puppeteer-core (no browser download) and the
// demo login from samples/DEMO_LOGIN.md. Only ever point this at the demo: the images
// are committed to the public repo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');
const BASE = (process.env.SCREENSHOT_URL || 'http://localhost:5173').replace(/\/$/, '');
const creds = fs.readFileSync(path.join(ROOT, 'samples', 'DEMO_LOGIN.md'), 'utf8');
const username = creds.match(/Username: `([^`]+)`/)[1];
const password = creds.match(/Password: `([^`]+)`/)[1];

const BROWSERS = [
  process.env.BROWSER_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = BROWSERS.find((p) => fs.existsSync(p));
if (!executablePath) throw new Error('No Edge or Chrome found. Set BROWSER_PATH to a Chromium-based browser.');

// name, path, optional setup in the page, how tall to capture, and an optional month
// chip to click first (1 = the second chip, i.e. the last full month, which reads
// better in screenshots than a month that has only just started).
const PAGES = [
  { name: 'dashboard', path: '/', height: 1500, chip: 1 },
  { name: 'transactions', path: '/transactions', height: 1000, chip: 1, setup: () => localStorage.setItem('tx-view', 'month') },
  { name: 'import', path: '/import', height: 1250 },
  { name: 'accounts', path: '/accounts', height: 1550, chip: 1 },
  // "Add account" popup filled in with an example savings account (never saved: closed with Escape).
  {
    name: 'accounts-add', path: '/accounts', height: 900, openText: 'Add account',
    fill: [['select', 'savings'], ['input[placeholder^="e.g. High-Yield"]', 'High-Yield Savings'], ['input[placeholder="Optional"]', 'Acme Online Bank'],
      ['input[placeholder="0.00"]', '12000'], ['input[placeholder="e.g. 4.25"]', '4.2']],
  },
  { name: 'recurring', path: '/recurring', height: 1250 },
  // "Plan to cancel" popup for the first charge to review; closed with Escape, nothing is planned.
  { name: 'recurring-plan-cancel', path: '/recurring', height: 900, openText: 'Plan to cancel' },
  { name: 'budget', path: '/budget', height: 1250, chip: 1 },
  { name: 'payoff', path: '/payoff', height: 1350 },
  { name: 'payoff-theory', path: '/payoff/theory', height: 1450 },
  // The "+ Bonus" popup; it's closed again without saving, so the demo data is untouched.
  { name: 'payoff-theory-popup', path: '/payoff/theory', height: 900, open: 'button[title^="Work bonus"]' },
  // "Apply to main plan" confirmation; closed with Escape, so the main plan isn't changed.
  { name: 'payoff-theory-apply', path: '/payoff/theory', height: 900, openText: 'Apply to main plan' },
  { name: 'settings', path: '/settings', height: 1150 },
];
const WIDTH = 1440;
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(page, file, height) {
  await page.setViewport({ width: WIDTH, height, deviceScaleFactor: 1 });
  await settle(1600); // let charts finish animating
  await page.screenshot({ path: path.join(OUT, file), type: 'webp', quality: 82 });
  console.log(`  ${file}`);
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-first-run', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: 900 });

  for (const theme of ['light', 'dark']) {
    console.log(`${theme}:`);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await page.evaluate((t) => localStorage.setItem('color-scheme', t), theme);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);

    // Login screen (signed out).
    await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'vaultbook' } }));
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#u');
    if (theme === 'light') await shoot(page, 'login.webp', 760);
    await page.type('#u', username);
    await page.type('#p', password);
    await Promise.all([page.keyboard.press('Enter'), page.waitForSelector('.sidebar', { timeout: 15000 })]);

    for (const p of PAGES) {
      if (theme === 'dark' && p.name !== 'dashboard' && p.name !== 'payoff-theory') continue; // a couple of dark examples
      if (p.setup) await page.evaluate(p.setup);
      await page.goto(`${BASE}${p.path}`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('.page-head');
      if (p.chip != null) {
        await page.evaluate((i) => document.querySelectorAll('.month-chip')[i]?.click(), p.chip);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      if (p.open || p.openText) {
        if (p.open) await page.click(p.open);
        else {
          await page.evaluate((text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text && !b.disabled)?.click(), p.openText);
        }
        await page.waitForSelector('dialog[open]');
        if (p.fill) {
          // Fill fields the way React expects (native setter + input/change event).
          await page.evaluate((fields) => {
            const dlg = document.querySelector('dialog[open]');
            for (const [sel, value] of fields) {
              const el = dlg.querySelector(sel);
              if (!el) continue;
              const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
              Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
              el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
            }
          }, p.fill);
          await settle(300);
        }
        await page.evaluate(() => document.activeElement?.blur()); // no focus ring in the picture
      }
      await shoot(page, `${p.name}${theme === 'dark' ? '-dark' : ''}.webp`, p.height);
      if (p.open || p.openText) await page.keyboard.press('Escape');
    }
  }
  await page.evaluate(() => {
    localStorage.removeItem('color-scheme');
    return fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'vaultbook' } });
  });
} finally {
  await browser.close();
}
console.log(`Saved to ${path.relative(ROOT, OUT)}`);
