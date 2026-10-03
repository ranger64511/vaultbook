// Shared helpers for the Main plan and Payoff theory pages.
import { currentMonth, addMonths, monthLabel } from './format.js';
import { simulatePayoff, defaultMinPayment } from './analytics.js';

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

export const payoffCards = (accounts) => accounts.filter((a) => a.type === 'credit' && a.balance > 0);
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

/**
 * Turns saved extras ({ type, amount, month: 'YYYY-MM', endMonth?, target? }) into
 * simulation extras keyed by payment month (1 = next month). Lump sums dated in the
 * past are dropped; increases that already started begin with the next payment.
 */
export function toSimExtras(adjustments = [], today = currentMonth()) {
  const out = [];
  for (const a of adjustments) {
    const amount = Number(a.amount) || 0;
    if (amount <= 0 || !a.month) continue;
    const start = monthsBetween(today, a.month);
    if (a.type === 'lump') {
      if (start >= 1) out.push({ type: 'lump', start, amount, target: a.target || null });
    } else {
      const end = a.endMonth ? monthsBetween(today, a.endMonth) : null;
      if (end != null && end < 1) continue;
      out.push({ type: 'increase', start: Math.max(1, start), end, amount });
    }
  }
  return out;
}

export function runPlan(debts, { budget, strategy, adjustments }) {
  return simulatePayoff(debts, budget, strategy, 600, toSimExtras(adjustments));
}

export const firstPaymentMonth = () => addMonths(currentMonth(), 1);

export function describeAdjustment(a, cardName) {
  const amt = `$${Number(a.amount || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (a.type === 'lump') {
    return `${amt} lump sum in ${monthLabel(a.month, 'long')}${a.target ? ` to ${cardName(a.target) || 'a card'}` : ''}`;
  }
  return `+${amt}/month from ${monthLabel(a.month, 'long')}${a.endMonth ? ` to ${monthLabel(a.endMonth, 'long')}` : ''}`;
}

/** Total of all extra money a set of adjustments adds over the life of a plan. */
export const totalExtra = (plan) => plan.schedule.reduce((s, r) => s + (r.extra || 0), 0);
