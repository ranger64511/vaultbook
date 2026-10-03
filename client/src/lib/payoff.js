// Shared helpers for the Main plan and Payoff theory pages.
import { currentMonth, addMonths, monthLabel } from './format.js';
import { simulatePayoff, defaultMinPayment } from './analytics.js';
import { isDebt, isInvestment } from './accounts.js';

export const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

export const duration = (m) => {
  if (!Number.isFinite(m)) return 'Never at this rate';
  const y = Math.floor(m / 12), r = m % 12;
  return [y && `${y} yr${y > 1 ? 's' : ''}`, r && `${r} mo`].filter(Boolean).join(' ') || '0 mo';
};

export const monthTicks = (len) => {
  const step = len <= 12 ? 2 : len <= 36 ? 6 : len <= 120 ? 12 : 24;
  return Array.from({ length: Math.floor(len / step) + 1 }, (_, i) => i * step);
};
export const tickLabel = (m) => (m === 0 ? 'Now' : m % 12 === 0 ? `${m / 12}y` : `${m}mo`);

/** Credit cards and loans with a balance, unless excluded from the payoff plan. */
export const payoffDebts = (accounts) => accounts.filter((a) => isDebt(a.type) && a.balance > 0 && !a.excludeFromPayoff);
export const debtsFrom = (cards) => cards.map((a) => ({ id: a.id, name: a.name, balance: a.balance, apr: a.apr || 0, minPayment: a.minPayment || 0 }));
export const minimumTotal = (debts) => debts.reduce((s, d) => s + (d.minPayment || defaultMinPayment(d.balance, d.apr)), 0);
export const defaultBudget = (debts) => Math.ceil((minimumTotal(debts) * 1.5) / 10) * 10;

/** The saved Main plan: monthly budget, strategy and any applied extra payments. */
export function mainPlanSettings(settings, debts) {
  return {
    budget: settings.payoffBudget || defaultBudget(debts),
    strategy: settings.payoffStrategy || 'avalanche',
    adjustments: settings.payoffAdjustments || [],
  };
}

export const REPEATS = [
  { value: 'none', label: 'One time', every: 0 },
  { value: 'monthly', label: 'Every month', every: 1 },
  { value: 'quarterly', label: 'Every 3 months', every: 3 },
  { value: 'semiannual', label: 'Twice a year', every: 6 },
  { value: 'yearly', label: 'Every year', every: 12 },
];
const EVERY = Object.fromEntries(REPEATS.map((r) => [r.value, r.every]));

/** The part of an adjustment that actually goes to debt (amount × "% toward debt"). */
export const towardDebt = (a) => (Number(a.amount) || 0) * (a.percent == null || a.percent === '' ? 1 : Math.min(100, Math.max(0, Number(a.percent))) / 100);

/**
 * Turns saved extras into simulation extras keyed by payment month (1 = next month).
 *   { type: 'lump', amount, percent?, month: 'YYYY-MM', repeat?, endMonth?, target? }
 *   { type: 'increase', amount, percent?, month, endMonth? }
 * A repeating lump (e.g. a quarterly sales bonus) becomes one lump per occurrence.
 * Past occurrences are dropped; increases that already started begin with the next payment.
 */
export function toSimExtras(adjustments = [], today = currentMonth(), horizon = 600, accounts = []) {
  const out = [];
  for (const a of adjustments) {
    if (a.source === 'withdraw') {
      // Cashing out investments: only what's left after tax & penalties reaches the debt.
      const w = withdrawalInfo(a, accounts);
      const start = a.month ? monthsBetween(today, a.month) : 0;
      if (w && w.net > 0 && start >= 1) {
        out.push({ type: 'lump', start, amount: w.net, target: a.target || null, withdraw: { accountId: w.account.id, gross: w.gross } });
      }
      continue;
    }
    const amount = towardDebt(a);
    if (amount <= 0 || !a.month) continue;
    const start = monthsBetween(today, a.month);
    if (a.type === 'lump') {
      const every = EVERY[a.repeat] || 0;
      const end = every && a.endMonth ? Math.min(horizon, monthsBetween(today, a.endMonth)) : horizon;
      for (let m = start; m <= end; m += every || horizon + 1) {
        if (m >= 1) out.push({ type: 'lump', start: m, amount, target: a.target || null });
      }
    } else {
      const end = a.endMonth ? monthsBetween(today, a.endMonth) : null;
      if (end != null && end < 1) continue;
      out.push({ type: 'increase', start: Math.max(1, start), end, amount });
    }
  }
  return out;
}

/** Gross withdrawal, tax & penalty cost and the net amount left for debt. */
export function withdrawalInfo(a, accounts = []) {
  const account = accounts.find((x) => x.id === a.fromAccount && isInvestment(x.type));
  if (!account) return null;
  const gross = Math.min(Number(a.amount) || 0, Math.max(0, account.balance || 0));
  const costPct = Number(account.withdrawalCost) || 0;
  return { account, gross, costPct, cost: gross * costPct / 100, net: gross * (1 - costPct / 100) };
}

export function runPlan(debts, { budget, strategy, adjustments }, accounts = []) {
  return simulatePayoff(debts, budget, strategy, 600, toSimExtras(adjustments, undefined, undefined, accounts));
}

export const firstPaymentMonth = () => addMonths(currentMonth(), 1);

/** Friendly kinds shown in the editor; each maps to a type plus a source label. */
export const EXTRA_KINDS = [
  { value: 'bonus', label: 'Bonus', type: 'lump', hint: 'Work bonus or commission. Can repeat monthly, quarterly, twice a year or yearly.' },
  { value: 'raise', label: 'Raise', type: 'increase', hint: 'A pay raise or promotion, starting any month. Enter the extra you’ll have each month.' },
  { value: 'lump', label: 'Lump sum', type: 'lump', hint: 'One-time money like a tax refund, gift or sale.' },
  { value: 'increase', label: 'Monthly increase', type: 'increase', hint: 'Extra each month, e.g. from cancelled subscriptions or a side job.' },
  { value: 'withdraw', label: 'Investment withdrawal', type: 'lump', hint: 'Cash out part of an investment and put it toward debt. Tax & penalties from the account are taken off first.' },
];
export const kindOfAdjustment = (a) => a.source || (a.type === 'lump' ? 'lump' : 'increase');

const usd = (n) => `$${Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export function describeAdjustment(a, cardName, accounts = []) {
  const kind = kindOfAdjustment(a);
  if (kind === 'withdraw') {
    const w = withdrawalInfo(a, accounts);
    if (!w) return `Investment withdrawal in ${monthLabel(a.month, 'long')} (account no longer available)`;
    return `Withdraw ${usd(w.gross)} from ${w.account.name} in ${monthLabel(a.month, 'long')}`
      + (w.costPct ? ` (−${w.costPct}% tax & penalties → ${usd(w.net)} toward debt)` : '')
      + (a.target ? `, to ${cardName(a.target) || 'a debt'}` : '');
  }
  const label = EXTRA_KINDS.find((k) => k.value === kind)?.label || 'Extra';
  const pctPart = a.percent != null && a.percent !== '' && Number(a.percent) < 100 ? ` (${Number(a.percent)}% → ${usd(towardDebt(a))} toward debt)` : '';
  if (a.type === 'lump') {
    const rep = REPEATS.find((r) => r.value === (a.repeat || 'none'));
    const when = rep.every
      ? `${rep.label.toLowerCase()} from ${monthLabel(a.month, 'long')}${a.endMonth ? ` to ${monthLabel(a.endMonth, 'long')}` : ''}`
      : `in ${monthLabel(a.month, 'long')}`;
    return `${label}: ${usd(a.amount)} ${when}${pctPart}${a.target ? `, to ${cardName(a.target) || 'a debt'}` : ''}`;
  }
  return `${label}: +${usd(a.amount)}/month from ${monthLabel(a.month, 'long')}${a.endMonth ? ` to ${monthLabel(a.endMonth, 'long')}` : ''}${pctPart}`;
}

/** Total of all extra money a set of adjustments adds over the life of a plan. */
export const totalExtra = (plan) => plan.schedule.reduce((s, r) => s + (r.extra || 0), 0);

/**
 * Projects investment balances month by month for a payoff plan, to compare paying
 * debt with investments against leaving them invested.
 *
 * - Each investment grows at its expected yearly return.
 * - Withdrawals in the plan come out of the account they're taken from.
 * - With `reinvest`, once the plan is debt-free the money that was going to debt
 *   (monthly payment plus any raises/bonuses) is invested instead, into `intoId`.
 */
export function projectInvestments({ accounts, plan, budget, extras, horizon, reinvest = true, intoId }) {
  const invest = accounts.filter((a) => isInvestment(a.type));
  const bal = new Map(invest.map((a) => [a.id, Math.max(0, a.balance || 0)]));
  const monthly = new Map(invest.map((a) => [a.id, (1 + (Number(a.expectedReturn) || 0) / 100) ** (1 / 12) - 1]));
  const into = bal.has(intoId) ? intoId : invest[0]?.id;
  const debtFree = Number.isFinite(plan.months) ? plan.months : Infinity;
  const series = [{ month: 0, total: [...bal.values()].reduce((s, v) => s + v, 0) }];
  let contributed = 0;
  for (let m = 1; m <= horizon; m++) {
    for (const [id, v] of bal) bal.set(id, v * (1 + monthly.get(id)));
    for (const x of extras) {
      if (x.withdraw && x.start === m) bal.set(x.withdraw.accountId, Math.max(0, bal.get(x.withdraw.accountId) - x.withdraw.gross));
    }
    if (reinvest && into && m > debtFree) {
      let freed = budget;
      for (const x of extras) {
        if (x.withdraw) continue;
        if (x.type === 'increase' && m >= x.start && (!x.end || m <= x.end)) freed += x.amount;
        if (x.type === 'lump' && x.start === m) freed += x.amount;
      }
      bal.set(into, bal.get(into) + freed);
      contributed += freed;
    }
    series.push({ month: m, total: [...bal.values()].reduce((s, v) => s + v, 0) });
  }
  return { total: series[series.length - 1].total, series, contributed };
}
