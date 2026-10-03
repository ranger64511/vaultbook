import { toDate, isoDate } from './format.js';

// group: bank | investment | card | loan  (card + loan = debts)
// interest: 'apy' = earns interest, 'return' = expected investment return, 'apr' = charges interest.
export const ACCOUNT_TYPES = [
  { value: 'checking', group: 'bank', label: 'Checking', interest: 'apy', apyHint: 'Usually 0–0.5%. Leave blank if it earns nothing.' },
  { value: 'savings', group: 'bank', label: 'Savings', interest: 'apy', apyHint: 'High-yield savings often pay 3–5%.' },
  { value: 'money-market', group: 'bank', label: 'Money market', interest: 'apy', apyHint: 'Shown on your statement as APY.' },
  { value: 'cd', group: 'bank', label: 'CD (certificate of deposit)', short: 'CD', interest: 'apy', apyHint: 'The fixed rate for the CD’s term.' },
  { value: 'cash', group: 'bank', label: 'Cash', interest: null },
  { value: 'other', group: 'bank', label: 'Other', interest: 'apy', apyHint: 'Optional.' },
  { value: 'brokerage', group: 'investment', label: 'Brokerage / investment', short: 'Investment', interest: 'return', costHint: 'Estimated capital-gains tax on what you’d sell. Often 0–20%.' },
  { value: 'retirement', group: 'investment', label: 'Retirement (401(k), IRA)', short: 'Retirement', interest: 'return', costHint: 'Income tax plus any early-withdrawal penalty (often 10%). 25–40% total is common before age 59½.' },
  { value: 'credit', group: 'card', label: 'Credit card', interest: 'apr' },
  { value: 'auto-loan', group: 'loan', label: 'Auto loan', interest: 'apr' },
  { value: 'mortgage', group: 'loan', label: 'Mortgage / home loan', short: 'Mortgage', interest: 'apr' },
  { value: 'student-loan', group: 'loan', label: 'Student loan', interest: 'apr' },
  { value: 'personal-loan', group: 'loan', label: 'Personal loan', interest: 'apr' },
  { value: 'medical-debt', group: 'loan', label: 'Medical debt', interest: 'apr' },
  { value: 'other-debt', group: 'loan', label: 'Other debt', interest: 'apr' },
  { value: 'home', group: 'asset', label: 'Home / real estate', short: 'Home', interest: 'change', changeHint: 'Homes often gain about 3–4% a year on average, but it varies a lot by area.', defaultChange: 3 },
  { value: 'vehicle', group: 'asset', label: 'Vehicle', interest: 'change', changeHint: 'Cars usually lose value: often 10–20% a year (use a negative number).', defaultChange: -15 },
  { value: 'property', group: 'asset', label: 'Other property / valuables', short: 'Property', interest: 'change', changeHint: 'Land, a boat, jewelry, collectibles… Use your own estimate, or leave blank.', defaultChange: 0 },
];

export const ACCOUNT_GROUPS = [
  { value: 'bank', label: 'Bank & cash' },
  { value: 'investment', label: 'Investments' },
  { value: 'asset', label: 'Property & assets' },
  { value: 'card', label: 'Credit cards' },
  { value: 'loan', label: 'Loans & other debts' },
];

const BY_VALUE = new Map(ACCOUNT_TYPES.map((t) => [t.value, t]));
export const accountType = (value) => BY_VALUE.get(value) || BY_VALUE.get('other');
export const typeLabel = (value, short) => (short && accountType(value).short) || accountType(value).label;
export const earnsInterest = (value) => accountType(value).interest === 'apy';
export const isDebt = (value) => ['card', 'loan'].includes(accountType(value).group);
export const isLoan = (value) => accountType(value).group === 'loan';
export const isInvestment = (value) => accountType(value).group === 'investment';
export const isAsset = (value) => accountType(value).group === 'asset';
/** Accounts that can have transactions (everything except property & assets). */
export const hasTransactions = (value) => !isAsset(value);

/** Value, what's owed on the linked loan, equity, and expected change over a year. */
export function assetInfo(asset, accounts = []) {
  const value = Math.max(0, Number(asset.balance) || 0);
  const loan = asset.linkedLoan ? accounts.find((a) => a.id === asset.linkedLoan && isDebt(a.type)) : null;
  const owed = loan ? Math.max(0, Number(loan.balance) || 0) : 0;
  const change = Number(asset.appreciation) || 0;
  return { value, loan, owed, equity: value - owed, yearlyChange: value * change / 100, change };
}

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
