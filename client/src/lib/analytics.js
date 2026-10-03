import { monthKey, weekKey, toDate, isoDate } from './format.js';

export const kindOf = (categories) => {
  const m = new Map(categories.map((c) => [c.id, c.kind]));
  return (id) => m.get(id) || 'want';
};

/** Spending is need/want outflows; refunds in those categories net against it. */
export function summarize(txs, categories) {
  const kind = kindOf(categories);
  let income = 0, needs = 0, wants = 0;
  for (const t of txs) {
    const k = kind(t.category);
    if (k === 'income') income += t.amount;
    else if (k === 'need') needs -= t.amount;
    else if (k === 'want') wants -= t.amount;
  }
  return { income, needs, wants, spending: needs + wants, net: income - needs - wants };
}

function groupBy(txs, keyFn) {
  const m = new Map();
  for (const t of txs) {
    const k = keyFn(t.date);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  return m;
}

export function byPeriod(txs, categories, period = 'month') {
  const groups = groupBy(txs, period === 'week' ? weekKey : monthKey);
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, list]) => ({ key, count: list.length, ...summarize(list, categories) }));
}

/** Fills gaps so charts show a continuous run of months. */
export function lastNMonths(rows, n, endKey) {
  const out = [];
  const map = new Map(rows.map((r) => [r.key, r]));
  const end = toDate(`${endKey}-01`);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    const k = isoDate(d).slice(0, 7);
    out.push(map.get(k) || { key: k, count: 0, income: 0, needs: 0, wants: 0, spending: 0, net: 0 });
  }
  return out;
}

export function byCategory(txs, categories) {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const m = new Map();
  for (const t of txs) {
    const c = cats.get(t.category);
    const kind = c?.kind || 'want';
    if (kind !== 'need' && kind !== 'want') continue;
    m.set(t.category, (m.get(t.category) || 0) - t.amount);
  }
  return [...m.entries()]
    .map(([id, total]) => ({ id, name: cats.get(id)?.name || id, kind: cats.get(id)?.kind || 'want', total }))
    .filter((r) => Math.abs(r.total) >= 0.005)
    .sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------- recurring ----
const FREQS = [
  { id: 'weekly', label: 'Weekly', days: 7, tol: 2 },
  { id: 'biweekly', label: 'Every 2 weeks', days: 14, tol: 3 },
  { id: 'monthly', label: 'Monthly', days: 30.44, tol: 5 },
  { id: 'quarterly', label: 'Quarterly', days: 91, tol: 12 },
  { id: 'semiannual', label: 'Every 6 months', days: 182, tol: 18 },
  { id: 'annual', label: 'Yearly', days: 365, tol: 20 },
];

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);

/**
 * Finds charges that repeat on a regular schedule with a stable amount.
 * Returns one entry per merchant with frequency, typical amount and yearly cost.
 */
export function detectRecurring(txs, categories) {
  const kind = kindOf(categories);
  const latest = txs.reduce((m, t) => (t.date > m ? t.date : m), '0000-00-00');
  const groups = new Map();
  for (const t of txs) {
    if (t.amount >= 0) continue;
    const k = kind(t.category);
    if (k === 'transfer' || k === 'income') continue;
    const key = t.merchant || t.description;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }

  const results = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    // Collapse same-day duplicates (split charges).
    const days = [];
    for (const t of list) {
      const last = days[days.length - 1];
      if (last && last.date === t.date) last.amount += -t.amount;
      else days.push({ date: t.date, amount: -t.amount, tx: t });
    }
    if (days.length < 2) continue;
    const gaps = days.slice(1).map((d, i) => daysBetween(days[i].date, d.date));
    const med = median(gaps);
    const freq = FREQS.find((f) => Math.abs(med - f.days) <= f.tol);
    if (!freq) continue;
    const onSchedule = gaps.filter((g) => Math.abs(g - freq.days) <= freq.tol * 1.6).length / gaps.length;
    const amounts = days.map((d) => d.amount);
    const typical = median(amounts);
    const stable = amounts.filter((a) => Math.abs(a - typical) <= Math.max(1, typical * 0.2)).length / amounts.length;
    const needed = days.length === 2 ? { sched: 1, stable: 1 } : { sched: 0.6, stable: 0.6 };
    if (onSchedule < needed.sched || stable < needed.stable) continue;
    if (days.length === 2 && freq.id !== 'monthly' && freq.id !== 'annual' && freq.id !== 'quarterly') continue;

    const last = days[days.length - 1];
    const next = toDate(last.date);
    next.setDate(next.getDate() + Math.round(freq.days));
    const sinceLast = daysBetween(last.date, latest);
    const active = sinceLast <= freq.days + freq.tol * 2;
    const monthly = typical * (30.44 / freq.days);
    const confidence = Math.min(1, (days.length / 4) * 0.4 + onSchedule * 0.3 + stable * 0.3);
    const cat = last.tx.category;
    results.push({
      key,
      name: prettyMerchant(key, last.tx.description),
      description: last.tx.description,
      category: cat,
      kind: kind(cat),
      frequency: freq.id,
      frequencyLabel: freq.label,
      amount: typical,
      lastAmount: last.amount,
      // Only meaningful for normally-fixed charges (e.g. a subscription price increase).
      priceChanged: steadyBefore(days) && Math.abs(last.amount - days[days.length - 2].amount) > 0.5,
      count: days.length,
      first: days[0].date,
      last: last.date,
      next: isoDate(next),
      active,
      monthly,
      yearly: monthly * 12,
      confidence,
      accountId: last.tx.accountId,
      history: days.map((d) => ({ date: d.date, amount: d.amount })),
    });
  }
  // Wants first: those are the ones worth cancelling.
  const rank = (r) => (r.kind === "want" ? 0 : 1);
  return results.sort((a, b) => rank(a) - rank(b) || b.yearly - a.yearly);
}

function steadyBefore(days) {
  const prior = days.slice(0, -1).map((d) => d.amount);
  return prior.length >= 2 && Math.max(...prior) - Math.min(...prior) < 0.5;
}

function prettyMerchant(key, fallback) {
  const s = key || fallback || '';
  return s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\.Com\b/, '.com');
}

// ------------------------------------------------------------- payoff ----
export const defaultMinPayment = (balance, apr) =>
  Math.min(balance, Math.max(25, balance * 0.01 + (balance * (apr || 0)) / 1200));

/**
 * Month-by-month payoff simulation.
 * strategy: 'avalanche' (highest APR first), 'snowball' (smallest balance first),
 * or 'minimum' (only minimum payments, no extra and no roll-over).
 */
export function simulatePayoff(debts, monthlyBudget, strategy = 'avalanche', maxMonths = 600) {
  const ds = debts
    .filter((d) => d.balance > 0.005)
    .map((d) => ({ ...d, bal: d.balance, min: d.minPayment > 0 ? d.minPayment : defaultMinPayment(d.balance, d.apr), interest: 0, paidOffMonth: null }));
  const minTotal = ds.reduce((s, d) => s + Math.min(d.min, d.bal), 0);
  const schedule = [{ month: 0, total: ds.reduce((s, d) => s + d.bal, 0), ...Object.fromEntries(ds.map((d) => [d.id, d.bal])) }];
  if (!ds.length) return { months: 0, totalInterest: 0, totalPaid: 0, schedule, debts: [], feasible: true, minTotal: 0 };

  const budget = strategy === 'minimum' ? minTotal : monthlyBudget;
  let totalInterest = 0, totalPaid = 0, month = 0;
  const order = () => ds.filter((d) => d.bal > 0.005).sort((a, b) =>
    strategy === 'snowball' ? a.bal - b.bal || b.apr - a.apr : b.apr - a.apr || a.bal - b.bal);

  while (ds.some((d) => d.bal > 0.005) && month < maxMonths) {
    month++;
    for (const d of ds) {
      if (d.bal <= 0.005) continue;
      const i = (d.bal * (d.apr || 0)) / 1200;
      d.bal += i;
      d.interest += i;
      totalInterest += i;
    }
    let left = budget;
    for (const d of ds) d.paid = 0;
    for (const d of ds) {
      if (d.bal <= 0.005) continue;
      const p = Math.min(d.min, d.bal, Math.max(0, left));
      d.bal -= p;
      d.paid += p;
      left -= p;
      totalPaid += p;
    }
    if (strategy !== 'minimum') {
      for (const d of order()) {
        if (left <= 0.005) break;
        const p = Math.min(left, d.bal);
        d.bal -= p;
        d.paid += p;
        left -= p;
        totalPaid += p;
      }
    }
    for (const d of ds) if (d.bal <= 0.005 && d.paidOffMonth == null) { d.bal = 0; d.paidOffMonth = month; }
    schedule.push({
      month,
      total: ds.reduce((s, d) => s + d.bal, 0),
      ...Object.fromEntries(ds.map((d) => [d.id, Math.max(0, d.bal)])),
      payments: Object.fromEntries(ds.map((d) => [d.id, d.paid])),
    });
  }
  const done = ds.every((d) => d.bal <= 0.005);
  return {
    months: done ? month : Infinity,
    totalInterest,
    totalPaid,
    schedule,
    feasible: budget + 0.005 >= minTotal && done,
    minTotal,
    debts: ds.map((d) => ({ id: d.id, name: d.name, apr: d.apr, startBalance: d.balance, min: d.min, interest: d.interest, paidOffMonth: d.paidOffMonth })),
    order: strategy === 'minimum' ? [] : [...ds].sort((a, b) => (a.paidOffMonth ?? 1e9) - (b.paidOffMonth ?? 1e9)).map((d) => d.id),
  };
}
