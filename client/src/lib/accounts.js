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

/**
 * An account's balance at the end of a month, worked back from its current balance:
 * transactions after the month end (up to the balance date) are undone. Money out is
 * negative, so for debts (balance = amount owed) the sign flips. Accounts without
 * transactions (investments, property) just keep their current value.
 */
export function balanceAtMonthEnd(acct, transactions, month, today = isoDate(new Date())) {
  const current = Number(acct.balance) || 0;
  const end = isoDate(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)); // last day of month
  if (!hasTransactions(acct.type) || end >= today) return { balance: current, estimated: false };
  const asOf = acct.balanceAsOf || today;
  let after = 0;
  for (const t of transactions) {
    if (t.accountId === acct.id && t.date > end && t.date <= asOf) after += t.amount;
  }
  after = Math.round(after * 100) / 100;
  return { balance: isDebt(acct.type) ? current + after : current - after, estimated: true };
}

/** Money in / out and count of an account's transactions in a month. */
export function monthActivity(acct, transactions, month) {
  const out = { in: 0, out: 0, count: 0 };
  for (const t of transactions) {
    if (t.accountId !== acct.id || !t.date.startsWith(month)) continue;
    if (t.amount > 0) out.in += t.amount; else out.out -= t.amount;
    out.count++;
  }
  return out;
}

// ------------------------------------------------------------ coverage ---
const monthOf = (iso) => iso.slice(0, 7);
function monthsBetweenKeys(a, b) {
  const out = [];
  let y = Number(a.slice(0, 4)), m = Number(a.slice(5, 7));
  while (`${y}-${String(m).padStart(2, '0')}` <= b && out.length < 600) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * Works out, per account, which months have transactions, which are missing, and
 * how up to date it is. Returns { months: ['YYYY-MM', ...], accounts: [...] }.
 */
export function statementCoverage(accounts, transactions, today = isoDate(new Date())) {
  const byAccount = new Map();
  for (const t of transactions) {
    let s = byAccount.get(t.accountId);
    if (!s) byAccount.set(t.accountId, (s = { counts: new Map(), first: t.date, last: t.date }));
    s.counts.set(monthOf(t.date), (s.counts.get(monthOf(t.date)) || 0) + 1);
    if (t.date < s.first) s.first = t.date;
    if (t.date > s.last) s.last = t.date;
  }
  const thisMonth = monthOf(today);
  const firsts = [...byAccount.values()].map((s) => monthOf(s.first));
  const start = firsts.length ? firsts.sort()[0] : thisMonth;
  const months = monthsBetweenKeys(start, thisMonth);
  const DAY = 86400000;
  const rows = accounts.filter((a) => hasTransactions(a.type)).map((a) => {
    const s = byAccount.get(a.id);
    if (!s) return { account: a, empty: true, cells: months.map((m) => ({ month: m, count: 0, state: 'none' })), gaps: [] };
    const own = monthsBetweenKeys(monthOf(s.first), thisMonth);
    // A month is a gap if it has no transactions but sits between months that do.
    const gaps = own.filter((m) => !s.counts.get(m) && m < monthOf(s.last));
    const daysSince = Math.round((new Date(today) - new Date(s.last)) / DAY);
    return {
      account: a,
      first: s.first,
      last: s.last,
      daysSince,
      gaps,
      stale: daysSince > 35,
      cells: months.map((m) => {
        const count = s.counts.get(m) || 0;
        let state = 'none';
        if (count) state = 'covered';
        else if (gaps.includes(m)) state = 'gap';
        else if (m > monthOf(s.last)) state = 'pending';
        return { month: m, count, state };
      }),
    };
  });
  return { months, accounts: rows };
}

/**
 * How a statement's rows relate to what's already imported for its account:
 * the period it covers, months it adds, gaps it fills, and months it overlaps.
 */
export function describeStatementPeriod(rows, accountId, transactions) {
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  if (!dates.length) return null;
  const from = dates[0], to = dates[dates.length - 1];
  const fileMonths = monthsBetweenKeys(monthOf(from), monthOf(to));
  const existing = new Set(transactions.filter((t) => t.accountId === accountId).map((t) => monthOf(t.date)));
  const existingSorted = [...existing].sort();
  const firstHave = existingSorted[0], lastHave = existingSorted[existingSorted.length - 1];
  const overlaps = fileMonths.filter((m) => existing.has(m));
  const newMonths = fileMonths.filter((m) => !existing.has(m));
  const fillsGaps = newMonths.filter((m) => firstHave && m > firstHave && m < lastHave);
  return { from, to, months: fileMonths, overlaps, newMonths, fillsGaps, firstImport: !existing.size };
}
