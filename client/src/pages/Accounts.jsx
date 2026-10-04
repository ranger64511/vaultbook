import { useMemo, useState } from 'react';
import {
  CreditCard, Landmark, PiggyBank, Coins, CalendarClock, Banknote, Wallet, Plus, Pencil, Trash2, TrendingUp,
  Car, Home, GraduationCap, HandCoins, Stethoscope, Receipt, LineChart, Briefcase, Scale, Building2, CarFront, Gem,
} from 'lucide-react';
import { useData } from '../DataContext.jsx';
import { PageHead, Card, Empty, Modal, Stat } from '../components/ui.jsx';
import { money, money0, pct, longDate, monthLabel, currentMonth } from '../lib/format.js';
import MonthChips from '../components/MonthChips.jsx';
import { monthsOf, startMonth } from '../lib/months.js';
import { ACCOUNT_TYPES, ACCOUNT_GROUPS, accountType, typeLabel, earnsInterest, interestInfo, isDebt, isInvestment, isAsset, assetInfo, hasTransactions, balanceAtMonthEnd, monthActivity } from '../lib/accounts.js';

const ICON = {
  credit: CreditCard, checking: Landmark, savings: PiggyBank, 'money-market': Coins, cd: CalendarClock, cash: Banknote, other: Wallet,
  brokerage: LineChart, retirement: Briefcase,
  home: Building2, vehicle: CarFront, property: Gem,
  'auto-loan': Car, mortgage: Home, 'student-loan': GraduationCap, 'personal-loan': HandCoins, 'medical-debt': Stethoscope, 'other-debt': Receipt,
};

const PLACEHOLDER = {
  bank: 'e.g. High-Yield Savings', investment: 'e.g. Retirement 401(k)', card: 'e.g. Rewards Visa', loan: 'e.g. Car loan', asset: 'e.g. Our house',
};

export function AccountForm({ account, onSaved, onCancel, submitLabel = 'Save' }) {
  const { data, mutate } = useData();
  const [f, setF] = useState(() => ({
    name: '', type: 'checking', institution: '', balance: '', apr: '', apy: '', minPayment: '', creditLimit: '', dueDay: '', last4: '',
    maturityDate: '', expectedReturn: '', withdrawalCost: '', excludeFromPayoff: false, appreciation: '', linkedLoan: '',
    ...Object.fromEntries(Object.entries(account || {}).map(([k, v]) => [k, v ?? ''])),
  }));
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const type = accountType(f.type);
  const group = type.group;
  const debt = isDebt(f.type);
  const card = f.type === 'credit';
  const invest = isInvestment(f.type);
  const asset = isAsset(f.type);
  const loans = data.accounts.filter((a) => isDebt(a.type) && a.type !== 'credit' && a.id !== account?.id);
  const assetPreview = asset ? assetInfo({ ...f, balance: f.balance, appreciation: f.appreciation }, data.accounts) : null;
  const interest = earnsInterest(f.type);
  const preview = interest ? interestInfo({ ...f, balanceAsOf: null }) : null;
  const ret = Number(f.expectedReturn) || 0;
  const bal = Number(f.balance) || 0;

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const body = { ...f };
      // Clear fields that don't apply to this account type.
      if (!debt) Object.assign(body, { apr: null, minPayment: null, dueDay: null, excludeFromPayoff: false });
      if (!card) body.creditLimit = null;
      if (!interest) body.apy = null;
      if (!invest) Object.assign(body, { expectedReturn: null, withdrawalCost: null });
      if (!asset) Object.assign(body, { appreciation: null, linkedLoan: null });
      else body.linkedLoan = body.linkedLoan || null;
      if (f.type !== 'cd') body.maturityDate = null;
      body.excludeFromPayoff = !!body.excludeFromPayoff;
      const saved = await mutate(account ? `/accounts/${account.id}` : '/accounts', { method: account ? 'PUT' : 'POST', body }, account ? 'Account updated' : 'Account added');
      onSaved?.(saved);
    } catch (err) { setError(err.message); }
  };

  return (
    <form className="form-grid" onSubmit={save}>
      <div className="field full"><label>Account name</label><input value={f.name} onChange={set('name')} placeholder={PLACEHOLDER[group]} required /></div>
      <div className="field"><label>Type</label>
        <select value={f.type} onChange={set('type')}>
          {ACCOUNT_GROUPS.map((g) => (
            <optgroup key={g.value} label={g.label}>
              {ACCOUNT_TYPES.filter((t) => t.group === g.value).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      {!asset && (
        <div className="field"><label>{f.type === 'cash' ? 'Where it’s kept' : group === 'loan' ? 'Lender' : invest ? 'Provider' : 'Bank / issuer'}</label>
          <input value={f.institution} onChange={set('institution')} placeholder="Optional" />
        </div>
      )}
      <div className="field"><label>{debt ? 'Current balance owed' : asset ? 'Estimated value' : invest ? 'Current value' : 'Current balance'}</label>
        <input type="number" step="0.01" value={f.balance} onChange={set('balance')} placeholder="0.00" />
        {asset && <span className="hint">What it would sell for today, e.g. from a home-value or car-value website.</span>}
      </div>
      {asset && (
        <>
          <div className="field"><label>Expected yearly change %</label>
            <input type="number" step="0.5" min="-100" max="100" value={f.appreciation} onChange={set('appreciation')} placeholder={`e.g. ${type.defaultChange}`} />
            <span className="hint">{type.changeHint}</span>
          </div>
          <div className="field"><label>Loan against it</label>
            <select value={f.linkedLoan || ''} onChange={set('linkedLoan')}>
              <option value="">None (owned outright)</option>
              {loans.map((l) => <option key={l.id} value={l.id}>{l.name} ({typeLabel(l.type, true)})</option>)}
            </select>
            <span className="hint">Link the mortgage or car loan to see your equity.</span>
          </div>
          {assetPreview && assetPreview.value > 0 && (
            <div className="info-box full">
              {assetPreview.loan ? <>Equity: <b>{money(assetPreview.equity)}</b> (worth {money(assetPreview.value)}, {money(assetPreview.owed)} still owed on {assetPreview.loan.name}). </> : null}
              {assetPreview.change !== 0 && <>Expected to {assetPreview.change > 0 ? 'gain' : 'lose'} about <b>{money(Math.abs(assetPreview.yearlyChange))}</b> in value this year.</>}
            </div>
          )}
        </>
      )}
      {f.type !== 'cash' && !asset && <div className="field"><label>Last 4 digits</label><input value={f.last4} onChange={set('last4')} maxLength={4} inputMode="numeric" placeholder="Optional" /></div>}

      {interest && (
        <div className="field"><label>Interest rate (APY %)</label>
          <input type="number" step="0.01" min="0" max="100" value={f.apy} onChange={set('apy')} placeholder="e.g. 4.25" />
          <span className="hint">{type.apyHint}</span>
        </div>
      )}
      {f.type === 'cd' && (
        <div className="field"><label>Maturity date</label><input type="date" value={f.maturityDate} onChange={set('maturityDate')} /></div>
      )}
      {preview && (
        <div className="info-box full">
          At {preview.apy}% APY this earns about <b>{money(preview.monthly)}</b> a month, <b>{money(preview.yearly)}</b> a year
          {preview.maturityValue != null && <>, and is worth about <b>{money(preview.maturityValue)}</b> at maturity</>}.
        </div>
      )}

      {invest && (
        <>
          <div className="field"><label>Expected yearly return %</label>
            <input type="number" step="0.1" min="-50" max="50" value={f.expectedReturn} onChange={set('expectedReturn')} placeholder="e.g. 7" />
            <span className="hint">Your own estimate. Returns aren’t guaranteed and can be negative.</span>
          </div>
          <div className="field"><label>Tax & penalties if withdrawn %</label>
            <input type="number" step="1" min="0" max="100" value={f.withdrawalCost} onChange={set('withdrawalCost')} placeholder={f.type === 'retirement' ? 'e.g. 32' : 'e.g. 15'} />
            <span className="hint">{type.costHint}</span>
          </div>
          {bal > 0 && (ret !== 0 || Number(f.withdrawalCost) > 0) && (
            <div className="info-box full">
              {ret !== 0 && <>At {ret}% a year this would {ret > 0 ? 'grow' : 'shrink'} by about <b>{money(Math.abs(bal * ret / 100))}</b> in a year. </>}
              {Number(f.withdrawalCost) > 0 && <>Cashing it all out today would leave about <b>{money(bal * (1 - Number(f.withdrawalCost) / 100))}</b> after tax and penalties.</>}
            </div>
          )}
        </>
      )}

      {debt && (
        <>
          <div className="field"><label>Interest rate (APR %)</label><input type="number" step="0.01" value={f.apr} onChange={set('apr')} placeholder={card ? 'e.g. 24.99' : 'e.g. 6.5'} /></div>
          <div className="field"><label>{card ? 'Minimum payment' : 'Monthly payment'}</label>
            <input type="number" step="0.01" value={f.minPayment} onChange={set('minPayment')} placeholder={card ? 'From statement' : 'Your required payment'} />
          </div>
          {card && <div className="field"><label>Credit limit</label><input type="number" step="1" value={f.creditLimit} onChange={set('creditLimit')} placeholder="Optional" /></div>}
          <div className="field"><label>Payment due day</label><input type="number" min="1" max="31" value={f.dueDay} onChange={set('dueDay')} placeholder="1–31" /></div>
          <label className="row full" style={{ gap: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={!f.excludeFromPayoff} onChange={(e) => setF((x) => ({ ...x, excludeFromPayoff: !e.target.checked }))} />
            Include in the debt payoff plan
            <span className="faint">Untick to leave it out, for example a mortgage you just want to pay normally.</span>
          </label>
        </>
      )}
      {error && <div className="error-box full">{error}</div>}
      <div className="row full" style={{ justifyContent: 'flex-end' }}>
        {onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}
        <button className="btn primary">{submitLabel}</button>
      </div>
    </form>
  );
}

function AccountCell({ a, extra }) {
  const Icon = ICON[a.type] || Wallet;
  return (
    <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
      <span className="stat-icon"><Icon size={16} /></span>
      <div>
        <b>{a.name}</b>{a.last4 && <span className="faint"> ••{a.last4}</span>}
        <div className="faint">{[typeLabel(a.type, true), a.institution].filter(Boolean).join(' · ')}{a.balanceAsOf && ` · as of ${longDate(a.balanceAsOf)}`}</div>
        {extra}
      </div>
    </div>
  );
}

export default function Accounts() {
  const { data, mutate } = useData();
  const [editing, setEditing] = useState(null); // account | 'new' | null
  const counts = new Map();
  for (const t of data.transactions) counts.set(t.accountId, (counts.get(t.accountId) || 0) + 1);

  const byGroup = (g) => data.accounts.filter((a) => accountType(a.type).group === g);
  const banks = byGroup('bank');
  const investments = byGroup('investment');
  const cards = byGroup('card');
  const loans = byGroup('loan');
  const assets = byGroup('asset');
  const interest = new Map(banks.map((a) => [a.id, interestInfo(a)]));
  const cash = banks.reduce((s, a) => s + (interest.get(a.id)?.estimatedToday ?? (a.balance || 0)), 0);
  const invested = investments.reduce((s, a) => s + (a.balance || 0), 0);
  const debt = [...cards, ...loans].reduce((s, a) => s + (a.balance || 0), 0);
  const property = assets.reduce((s, a) => s + (a.balance || 0), 0);
  const equity = assets.reduce((s, a) => s + assetInfo(a, data.accounts).equity, 0);
  const yearly = [...interest.values()].reduce((s, i) => s + (i?.yearly || 0), 0);

  // Month view: activity per account and (for past months) estimated month-end balances.
  const months = useMemo(() => monthsOf(data.transactions), [data.transactions]);
  const [month, setMonth] = useState(() => startMonth(months));
  const txCountByMonth = useMemo(() => {
    const m = new Map();
    for (const t of data.transactions) m.set(t.date.slice(0, 7), (m.get(t.date.slice(0, 7)) || 0) + 1);
    return m;
  }, [data.transactions]);
  const past = month < currentMonth();
  const endLabel = `end of ${monthLabel(month, 'long')}`;
  const monthRows = useMemo(() => data.accounts.filter((a) => hasTransactions(a.type)).map((a) => ({
    a, ...monthActivity(a, data.transactions, month), end: balanceAtMonthEnd(a, data.transactions, month),
  })), [data.accounts, data.transactions, month]);
  const endOf = (list) => list.reduce((s, a) => s + (monthRows.find((r) => r.a.id === a.id)?.end.balance ?? (a.balance || 0)), 0);
  const shownCash = past ? endOf(banks) : cash;
  const shownDebt = past ? endOf([...cards, ...loans]) : debt;
  const shownNet = shownCash + invested + property - shownDebt;
  const activityTotals = monthRows.reduce((t, r) => ({ in: t.in + r.in, out: t.out + r.out, count: t.count + r.count }), { in: 0, out: 0, count: 0 });

  const actions = (a) => (
    <td style={{ width: 90, whiteSpace: 'nowrap' }}>
      <button className="btn ghost icon sm" aria-label="Edit" onClick={() => setEditing(a)}><Pencil size={15} /></button>
      <button className="btn ghost icon sm" aria-label="Delete" onClick={() =>
        confirm(`Delete ${a.name} and its ${counts.get(a.id) || 0} transactions? This can’t be undone.`) &&
        mutate(`/accounts/${a.id}`, { method: 'DELETE' }, 'Account deleted')}><Trash2 size={15} /></button>
    </td>
  );
  const planBadge = (a) => (a.excludeFromPayoff ? <span className="badge">Not in plan</span> : null);

  return (
    <>
      <PageHead title="Accounts" subtitle="Bank accounts, savings, investments, property, credit cards and loans.">
        <button className="btn primary" onClick={() => setEditing('new')}><Plus size={16} /> Add account</button>
      </PageHead>

      {!data.accounts.length ? (
        <Card><Empty icon={CreditCard} title="No accounts yet" action={<button className="btn primary" onClick={() => setEditing('new')}>Add your first account</button>}>
          Add your checking, savings, investment, credit card and loan accounts, plus your home, vehicles and other property.
        </Empty></Card>
      ) : (
        <div className="grid g-4">
          <Stat icon={PiggyBank} label={past ? `Bank & cash, ${endLabel}` : 'Bank & cash'} value={money0(shownCash)} sub={yearly > 0 ? <span className="pos">+{money(yearly)}/yr interest</span> : `${banks.length} account${banks.length === 1 ? '' : 's'}`} />
          <Stat icon={TrendingUp} label="Investments" value={money0(invested)} sub={`${investments.length} account${investments.length === 1 ? '' : 's'}`} />
          {assets.length > 0 && <Stat icon={Building2} label="Property & assets" value={money0(property)} sub={`${money0(equity)} equity after linked loans`} />}
          <Stat icon={CreditCard} label={past ? `Total debt, ${endLabel}` : 'Total debt'} value={money0(shownDebt)} sub={`${cards.length} card${cards.length === 1 ? '' : 's'} · ${loans.length} loan${loans.length === 1 ? '' : 's'}`} />
          <Stat icon={Scale} label={past ? `Net worth, ${endLabel}` : 'Net worth'} value={<span className={shownNet >= 0 ? 'pos' : 'bad'}>{money0(shownNet)}</span>}
            sub={past ? 'Estimated from transactions; investments & property at current value' : 'What you have minus what you owe'} />
        </div>
      )}

      {monthRows.length > 0 && (
        <Card className="mt flush" title={`Account activity · ${monthLabel(month, 'long')}`}
          subtitle={past
            ? 'Money in and out during the month, and each balance at month end (worked back from today’s balance and the transactions since).'
            : 'Money in and out so far this month, and current balances.'}>
          <MonthChips items={months.map((m) => ({ month: m, detail: txCountByMonth.get(m) }))} isActive={(m) => m === month} onPick={setMonth} label="Months with activity" />
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Account</th><th className="amount">Money in</th><th className="amount">Money out</th><th className="amount">Net</th>
                <th className="amount">Transactions</th><th className="amount">{past ? `Balance, ${endLabel}` : 'Balance now'}</th>
              </tr></thead>
              <tbody>
                {monthRows.filter((r) => r.count).map(({ a, in: inn, out, count, end }) => (
                  <tr key={a.id}>
                    <td><AccountCell a={a} /></td>
                    <td className="amount">{inn ? <span className="pos">+{money(inn)}</span> : <span className="faint">—</span>}</td>
                    <td className="amount">{out ? <span>−{money(out)}</span> : <span className="faint">—</span>}</td>
                    <td className="amount">{count ? <b className={inn - out >= 0 ? 'pos' : ''}>{inn - out >= 0 ? '+' : '−'}{money(Math.abs(inn - out))}</b> : <span className="faint">—</span>}</td>
                    <td className="amount faint">{count}</td>
                    <td className="amount"><b>{money(end.balance)}</b>{isDebt(a.type) && <div className="faint">owed</div>}{end.estimated && <div className="faint">estimated</div>}</td>
                  </tr>
                ))}
                <tr className="group-row">
                  <td>Total</td>
                  <td className="amount pos">+{money(activityTotals.in)}</td>
                  <td className="amount">−{money(activityTotals.out)}</td>
                  <td className="amount">{activityTotals.in - activityTotals.out >= 0 ? '+' : '−'}{money(Math.abs(activityTotals.in - activityTotals.out))}</td>
                  <td className="amount">{activityTotals.count}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="faint" style={{ padding: '10px 20px' }}>
            {(() => {
              const quiet = monthRows.filter((r) => !r.count).map((r) => r.a.name);
              return quiet.length ? <>No activity this month: {quiet.join(', ')}. </> : null;
            })()}
            Totals include transfers between your own accounts (like card payments), so money can appear on both sides.
          </p>
        </Card>
      )}

      {banks.length > 0 && (
        <Card title="Bank & cash" subtitle="Current balances. Interest is estimated from each account’s APY, compounding daily." className="mt flush">
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Account</th><th className="amount">Balance</th><th className="amount">APY</th>
                <th className="amount">Interest / mo</th><th className="amount">Interest / yr</th><th className="amount">Est. today</th>
                <th className="amount">Transactions</th><th />
              </tr></thead>
              <tbody>
                {banks.map((a) => {
                  const i = interest.get(a.id);
                  return (
                    <tr key={a.id}>
                      <td><AccountCell a={a} extra={i?.maturityValue != null && (
                        <div className="faint">{i.daysToMaturity > 0 ? `Matures ${longDate(a.maturityDate)} · worth ~${money(i.maturityValue)}` : `Matured ${longDate(a.maturityDate)}`}</div>
                      )} /></td>
                      <td className="amount"><b>{money(a.balance || 0)}</b></td>
                      <td className="amount">{i ? `${i.apy}%` : earnsInterest(a.type) ? <button className="btn ghost sm" onClick={() => setEditing(a)}>Add</button> : '—'}</td>
                      <td className="amount">{i ? <span className="pos">+{money(i.monthly)}</span> : '—'}</td>
                      <td className="amount">{i ? <span className="pos">+{money(i.yearly)}</span> : '—'}</td>
                      <td className="amount" title={i ? `${money(i.accruedSinceAsOf)} interest since ${longDate(i.asOf)}` : undefined}>
                        {i && i.accruedSinceAsOf >= 0.01 ? money(i.estimatedToday) : <span className="faint">{money(a.balance || 0)}</span>}
                      </td>
                      <td className="amount faint">{counts.get(a.id) || 0}</td>
                      {actions(a)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {investments.length > 0 && (
        <Card title="Investments" subtitle="Growth uses your expected return, which is an estimate, not a guarantee." className="mt flush">
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Account</th><th className="amount">Value</th><th className="amount">Expected return</th>
                <th className="amount">Growth / yr</th><th className="amount">If cashed out today</th><th className="amount">Transactions</th><th />
              </tr></thead>
              <tbody>
                {investments.map((a) => {
                  const r = Number(a.expectedReturn) || 0;
                  const cost = Number(a.withdrawalCost) || 0;
                  return (
                    <tr key={a.id}>
                      <td><AccountCell a={a} /></td>
                      <td className="amount"><b>{money(a.balance || 0)}</b></td>
                      <td className="amount">{a.expectedReturn != null ? `${r}%` : <button className="btn ghost sm" onClick={() => setEditing(a)}>Add</button>}</td>
                      <td className="amount">{r ? <span className={r > 0 ? 'pos' : 'bad'}>{r > 0 ? '+' : '−'}{money(Math.abs((a.balance || 0) * r / 100))}</span> : '—'}</td>
                      <td className="amount" title={cost ? `After ~${cost}% tax & penalties` : 'Add tax & penalties to estimate this'}>{money((a.balance || 0) * (1 - cost / 100))}{cost ? <div className="faint">−{cost}%</div> : null}</td>
                      <td className="amount faint">{counts.get(a.id) || 0}</td>
                      {actions(a)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {assets.length > 0 && (
        <Card title="Property & assets" subtitle="Estimated values. Link a mortgage or car loan to see your equity." className="mt flush">
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Asset</th><th className="amount">Value</th><th className="amount">Change / yr</th>
                <th>Loan against it</th><th className="amount">Owed</th><th className="amount">Equity</th><th />
              </tr></thead>
              <tbody>
                {assets.map((a) => {
                  const i = assetInfo(a, data.accounts);
                  return (
                    <tr key={a.id}>
                      <td><AccountCell a={a} /></td>
                      <td className="amount"><b>{money(i.value)}</b></td>
                      <td className="amount">{i.change ? <span className={i.change > 0 ? 'pos' : 'bad'}>{i.change > 0 ? '+' : '−'}{money(Math.abs(i.yearlyChange))}<div className="faint">{i.change}%</div></span> : '—'}</td>
                      <td>{i.loan ? i.loan.name : <span className="faint">Owned outright</span>}</td>
                      <td className="amount">{i.loan ? money(i.owed) : '—'}</td>
                      <td className="amount"><b className={i.equity >= 0 ? 'pos' : 'bad'}>{money(i.equity)}</b>
                        {i.loan && i.value > 0 && <div className="faint">{Math.round((Math.max(0, i.equity) / i.value) * 100)}% owned</div>}
                      </td>
                      {actions(a)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {cards.length > 0 && (
        <Card title="Credit cards" className="mt flush">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Account</th><th className="amount">Balance</th><th className="amount">APR</th><th className="amount">Min. payment</th><th className="amount">Utilization</th><th>Due</th><th className="amount">Transactions</th><th /></tr></thead>
              <tbody>
                {cards.map((a) => {
                  const util = a.creditLimit ? (a.balance / a.creditLimit) * 100 : null;
                  return (
                    <tr key={a.id}>
                      <td><AccountCell a={a} extra={planBadge(a)} /></td>
                      <td className="amount"><b>{money(a.balance || 0)}</b></td>
                      <td className="amount">{a.apr != null ? `${a.apr}%` : <span className="badge warn">Add APR</span>}</td>
                      <td className="amount">{a.minPayment != null ? money(a.minPayment) : '—'}</td>
                      <td className="amount">{util != null ? <span className={`badge ${util > 50 ? 'bad' : util > 30 ? 'warn' : 'good'}`}>{pct(util)}</span> : '—'}</td>
                      <td className="faint">{a.dueDay ? `Day ${a.dueDay}` : '—'}</td>
                      <td className="amount faint">{counts.get(a.id) || 0}</td>
                      {actions(a)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {loans.length > 0 && (
        <Card title="Loans & other debts" subtitle="Car loans, mortgages, student, personal and medical loans." className="mt flush">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Account</th><th className="amount">Balance</th><th className="amount">APR</th><th className="amount">Monthly payment</th><th className="amount">Interest / mo</th><th>Due</th><th className="amount">Transactions</th><th /></tr></thead>
              <tbody>
                {loans.map((a) => (
                  <tr key={a.id}>
                    <td><AccountCell a={a} extra={planBadge(a)} /></td>
                    <td className="amount"><b>{money(a.balance || 0)}</b></td>
                    <td className="amount">{a.apr != null ? `${a.apr}%` : <span className="badge warn">Add APR</span>}</td>
                    <td className="amount">{a.minPayment != null ? money(a.minPayment) : <span className="badge warn">Add payment</span>}</td>
                    <td className="amount">{a.apr ? money(((a.balance || 0) * a.apr) / 1200) : '—'}</td>
                    <td className="faint">{a.dueDay ? `Day ${a.dueDay}` : '—'}</td>
                    <td className="amount faint">{counts.get(a.id) || 0}</td>
                    {actions(a)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add account' : 'Edit account'} width={620}>
        {editing && <AccountForm key={editing.id || 'new'} account={editing === 'new' ? null : editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />}
      </Modal>
    </>
  );
}
