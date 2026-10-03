// Shared helpers for statement parsing.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const pad = (n) => String(n).padStart(2, '0');

function fullYear(y) {
  y = Number(y);
  return y < 100 ? 2000 + y : y;
}

/**
 * Parses common bank date formats to ISO "YYYY-MM-DD".
 * `fallbackYear` is used for dates without a year (typical in PDF statements).
 */
export function parseDate(raw, fallbackYear) {
  if (raw == null) return null;
  const s = String(raw).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`; // OFX 20250131120000
  if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/))) return `${fullYear(m[3])}-${pad(m[1])}-${pad(m[2])}`;
  if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})$/)) && fallbackYear) return `${fallbackYear}-${pad(m[1])}-${pad(m[2])}`;
  if ((m = s.match(/^([A-Za-z]{3,4})\.?\s+(\d{1,2}),?\s*(\d{4})?/))) {
    const mo = MONTHS[m[1].toLowerCase()];
    const y = m[3] || fallbackYear;
    if (mo && y) return `${y}-${pad(mo)}-${pad(m[2])}`;
  }
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/))) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) return `${m[3]}-${pad(mo)}-${pad(m[1])}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && /\d{4}/.test(s)) return d.toISOString().slice(0, 10);
  return null;
}

/** "$1,234.56" -> 1234.56, "(12.00)" -> -12, "12.00 CR" -> 12 with credit flag. */
export function parseAmount(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }
  if (/\bCR$/i.test(s)) { s = s.replace(/\s*CR$/i, ''); sign *= -1; }
  if (/\bDR$/i.test(s)) s = s.replace(/\s*DR$/i, '');
  if (/-$/.test(s)) { sign *= -1; s = s.slice(0, -1); }
  s = s.replace(/[$€£,\s]/g, '');
  if (!/^[-+]?\d*\.?\d+$/.test(s)) return null;
  const n = Number(s) * sign;
  return Math.round(n * 100) / 100;
}

export function cleanDescription(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/**
 * Decides whether charges are positive in this file (common for credit card
 * exports) and should be flipped so that money out is negative everywhere.
 */
export function suggestFlip(rows, accountType) {
  // Bank exports already use negative = money out.
  if (!rows.length || accountType !== 'credit') return false;
  const payments = rows.filter((r) => /payment|thank you|autopay/i.test(r.description));
  if (payments.length) {
    const negPayments = payments.filter((r) => r.amount < 0).length;
    if (negPayments > payments.length / 2) return true; // payments shown as negative => charges positive
    return false;
  }
  const positive = rows.filter((r) => r.amount > 0).length;
  return positive > rows.length * 0.6;
}
