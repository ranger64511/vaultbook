import { toDate, isoDate } from './format.js';

// interest: 'apy' = earns interest (savings-style), 'apr' = charges interest (credit card).
export const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Checking', interest: 'apy', apyHint: 'Usually 0–0.5%. Leave blank if it earns nothing.' },
  { value: 'savings', label: 'Savings', interest: 'apy', apyHint: 'High-yield savings often pay 3–5%.' },
  { value: 'money-market', label: 'Money market', interest: 'apy', apyHint: 'Shown on your statement as APY.' },
  { value: 'cd', label: 'CD (certificate of deposit)', short: 'CD', interest: 'apy', apyHint: 'The fixed rate for the CD’s term.' },
  { value: 'cash', label: 'Cash', interest: null },
  { value: 'other', label: 'Other', interest: 'apy', apyHint: 'Optional.' },
  { value: 'credit', label: 'Credit card', interest: 'apr' },
];

const BY_VALUE = new Map(ACCOUNT_TYPES.map((t) => [t.value, t]));
export const accountType = (value) => BY_VALUE.get(value) || BY_VALUE.get('other');
export const typeLabel = (value, short) => (short && accountType(value).short) || accountType(value).label;
export const earnsInterest = (value) => accountType(value).interest === 'apy';

const DAY = 86400000;

/**
 * Interest projections for a deposit account, compounding daily at its APY.
 * APY already reflects compounding, so growth over t years is (1 + APY)^t.
 */
export function interestInfo(acct, today = new Date()) {
  const apy = Number(acct.apy) || 0;
  const balance = Number(acct.balance) || 0;
  if (!earnsInterest(acct.type) || apy <= 0 || balance <= 0) return null;
  const r = apy / 100;
  const growth = (years) => balance * ((1 + r) ** years - 1);
  // Whole days only, so a balance entered today shows no accrued interest yet.
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const asOf = acct.balanceAsOf ? toDate(acct.balanceAsOf) : today;
  const yearsSince = Math.max(0, Math.round((today - asOf) / DAY) / 365);
  const info = {
    apy,
    monthly: growth(1 / 12),
    yearly: growth(1),
    // Interest accrued since the balance was last updated, so the estimate stays current.
    accruedSinceAsOf: growth(yearsSince),
    estimatedToday: balance + growth(yearsSince),
    asOf: acct.balanceAsOf || isoDate(today),
  };
  if (acct.type === 'cd' && acct.maturityDate) {
    const maturity = toDate(acct.maturityDate);
    const years = Math.max(0, (maturity - asOf) / DAY / 365);
    info.maturityValue = balance + growth(years);
    info.daysToMaturity = Math.ceil((maturity - today) / DAY);
  }
  return info;
}
