// Best-effort PDF statement parser. PDF layouts vary a lot between banks, so the
// import screen always shows a preview where rows and signs can be corrected.
import { parseAmount, parseDate, cleanDescription } from './common.js';

let pdfjs;
async function loadPdfjs() {
  pdfjs ??= await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

/** Rebuilds visual text lines from positioned PDF text items. */
async function extractLines(buffer) {
  const { getDocument } = await loadPdfjs();
  const task = getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const { items } = await page.getTextContent();
    const rows = [];
    for (const it of items) {
      if (!it.str?.trim()) continue;
      const x = it.transform[4];
      const y = it.transform[5];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) rows.push((row = { y, parts: [] }));
      row.parts.push({ x, str: it.str, w: it.width || 0 });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      let s = '';
      let lastEnd = null;
      for (const part of r.parts) {
        if (lastEnd != null) s += part.x - lastEnd > 1 ? ' ' : '';
        s += part.str;
        lastEnd = part.x + part.w;
      }
      lines.push(s.replace(/\s+/g, ' ').trim());
    }
  }
  await task.destroy();
  return lines;
}

const DATE = String.raw`(?:\d{1,2}/\d{1,2}(?:/\d{2,4})?|[A-Z][a-z]{2}\.? \d{1,2})`;
const AMT = String.raw`(?:-\s?)?\(?\$?-?[\d,]*\d\.\d{2}\)?(?:\s?CR|-)?`;
const TXN = new RegExp(`^(${DATE})\\s+(?:(${DATE})\\s+)?(.+?)\\s+(${AMT})(?:\\s+(${AMT}))?$`);

function money(text, re) {
  const m = text.match(re);
  return m ? parseAmount(m[1]) : undefined;
}

function statementInfo(text) {
  const info = {};
  const nb = money(text, /new balance(?: total)?[:\s]*(-?\$?[\d,]+\.\d{2})/i);
  if (nb != null) info.balance = nb;
  const mp = money(text, /minimum (?:payment|amount) due[:\s]*\$?([\d,]+\.\d{2})/i);
  if (mp != null) info.minPayment = mp;
  const cl = money(text, /credit (?:limit|line)[:\s]*\$?([\d,]+(?:\.\d{2})?)/i);
  if (cl != null) info.creditLimit = cl;
  const apr = text.match(/purchases?\s+(?:\S+\s+){0,3}?(\d{1,2}\.\d{1,2})\s?%/i) ||
    text.match(/annual percentage rate[^%]{0,80}?(\d{1,2}\.\d{1,2})\s?%/i);
  if (apr) info.apr = Number(apr[1]);
  const due = text.match(/payment due date[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  if (due) info.dueDate = parseDate(due[1]);
  return info;
}

/** Finds the statement closing date so that "MM/DD" rows get the right year. */
function closingDate(text) {
  const patterns = [
    /closing date[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /statement (?:period|date)[^\d]{0,20}(?:\d{1,2}\/\d{1,2}\/\d{2,4}\s*(?:-|to|through)\s*)?(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /\d{1,2}\/\d{1,2}\/\d{2,4}\s*(?:-|to|through)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /([A-Z][a-z]+ \d{1,2}, \d{4})/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    const d = m && parseDate(m[1]);
    if (d) return d;
  }
  return null;
}

export async function parsePdf(buffer, accountType) {
  const lines = await extractLines(buffer);
  const text = lines.join('\n');
  if (text.replace(/\s/g, '').length < 50) {
    throw new Error('This PDF has no readable text (it may be a scanned image). Download a CSV or OFX export from your bank instead.');
  }
  const isCredit = accountType === 'credit' || /minimum payment due|credit limit|new balance/i.test(text);
  const close = closingDate(text);
  const closeYear = close ? Number(close.slice(0, 4)) : new Date().getFullYear();
  const closeMonth = close ? Number(close.slice(5, 7)) : 12;

  const rows = [];
  let section = 0; // +1 deposits, -1 withdrawals, 0 unknown
  for (const line of lines) {
    if (/^(deposits|credits|additions|other credits|payments and( other)? credits|electronic deposits)/i.test(line)) section = 1;
    else if (/^(withdrawals|debits|checks|card purchases|subtractions|electronic withdrawals|atm|purchases|fees|other debits|purchases and adjustments|interest charged)/i.test(line)) section = -1;

    const m = line.match(TXN);
    if (!m) continue;
    const description = cleanDescription(m[3]);
    if (/^(total|balance|beginning|ending|previous|new balance|daily balance)/i.test(description)) continue;
    let date = parseDate(m[1], closeYear);
    if (!date) continue;
    // A December row on a January statement belongs to the previous year.
    if (!/\/\d{2,4}$/.test(m[1]) && Number(date.slice(5, 7)) > closeMonth) {
      date = `${closeYear - 1}${date.slice(4)}`;
    }
    let amount = parseAmount(m[4]);
    if (amount == null) continue;
    const explicitSign = /^-|\(|CR$|-$/i.test(m[4].trim());
    if (isCredit) {
      // Card statements list purchases as positive and payments/credits as negative.
      amount = -amount;
    } else if (!explicitSign) {
      if (section === 1) amount = Math.abs(amount);
      else amount = -Math.abs(amount);
    }
    rows.push({ date, description, amount });
  }

  const warnings = [];
  if (!rows.length) warnings.push('No transaction lines were recognised in this PDF. Try the CSV or OFX download from your bank.');
  else warnings.push('PDF import is best-effort. Check the dates, amounts and signs below before importing.');
  return {
    format: 'pdf',
    rows,
    warnings,
    statement: statementInfo(text),
    accountTypeHint: isCredit ? 'credit' : undefined,
    signConvention: 'standard',
  };
}
