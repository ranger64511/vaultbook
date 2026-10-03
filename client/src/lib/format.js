const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

export const money = (n) => usd.format(n || 0);
export const money0 = (n) => usd0.format(Math.round(n || 0));
export const moneyCompact = (n) => (Math.abs(n) < 1000 ? usd0.format(n || 0) : compact.format(n || 0));
export const pct = (n, d = 0) => `${(n || 0).toFixed(d)}%`;

/** Parses "YYYY-MM-DD" as a local date (avoids UTC off-by-one). */
export const toDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const monthKey = (iso) => iso.slice(0, 7);
export const monthLabel = (key, style = 'short') =>
  toDate(`${key}-01`).toLocaleDateString('en-US', { month: style, year: 'numeric' });
export const monthShort = (key) => toDate(`${key}-01`).toLocaleDateString('en-US', { month: 'short' });

/** Weeks start on Sunday; key is the Sunday's ISO date. */
export const weekKey = (iso) => {
  const d = toDate(iso);
  d.setDate(d.getDate() - d.getDay());
  return isoDate(d);
};
export const weekLabel = (key) => {
  const start = toDate(key);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const f = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${f(start)} – ${f(end)}`;
};
export const shortDate = (iso) => toDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export const longDate = (iso) => toDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export const addMonths = (key, n) => {
  const d = toDate(`${key}-01`);
  d.setMonth(d.getMonth() + n);
  return isoDate(d).slice(0, 7);
};
export const currentMonth = () => isoDate(new Date()).slice(0, 7);

export const monthsFromNow = (n) => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
};
export const dayLabel = (iso) => toDate(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
