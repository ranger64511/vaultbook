import { useState } from 'react';
import { CreditCard, Landmark, PiggyBank, Coins, CalendarClock, Banknote, Wallet, Plus, Pencil, Trash2, TrendingUp } from 'lucide-react';
import { useData } from '../DataContext.jsx';
import { PageHead, Card, Empty, Modal, Stat } from '../components/ui.jsx';
import { money, money0, pct, longDate } from '../lib/format.js';
import { ACCOUNT_TYPES, accountType, typeLabel, earnsInterest, interestInfo } from '../lib/accounts.js';

const ICON = { credit: CreditCard, checking: Landmark, savings: PiggyBank, 'money-market': Coins, cd: CalendarClock, cash: Banknote, other: Wallet };

export function AccountForm({ account, onSaved, onCancel, submitLabel = 'Save' }) {
  const { mutate } = useData();
  const [f, setF] = useState(() => ({
    name: '', type: 'checking', institution: '', balance: '', apr: '', apy: '', minPayment: '', creditLimit: '', dueDay: '', last4: '', maturityDate: '',
    ...Object.fromEntries(Object.entries(account || {}).map(([k, v]) => [k, v ?? ''])),
  }));
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const type = accountType(f.type);
  const credit = f.type === 'credit';
  const interest = earnsInterest(f.type);
  const preview = interest ? interestInfo({ ...f, balanceAsOf: null }) : null;

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const body = { ...f };
      // Clear fields that don't apply to this account type.
      if (!credit) Object.assign(body, { apr: null, minPayment: null, creditLimit: null, dueDay: null });
      if (!interest) body.apy = null;
      if (f.type !== 'cd') body.maturityDate = null;
      const saved = await mutate(account ? `/accounts/${account.id}` : '/accounts', { method: account ? 'PUT' : 'POST', body }, account ? 'Account updated' : 'Account added');
      onSaved?.(saved);
    } catch (err) { setError(err.message); }
  };

  return (
    <form className="form-grid" onSubmit={save}>
      <div className="field full"><label>Account name</label><input value={f.name} onChange={set('name')} placeholder={credit ? 'e.g. Rewards Visa' : 'e.g. High-Yield Savings'} required /></div>
      <div className="field"><label>Type</label>
        <select value={f.type} onChange={set('type')}>
          <optgroup label="Bank & cash">
            {ACCOUNT_TYPES.filter((t) => t.value !== 'credit').map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </optgroup>
          <optgroup label="Debt">
            <option value="credit">Credit card</option>
          </optgroup>
        </select>
      </div>
      <div className="field"><label>{f.type === 'cash' ? 'Where it’s kept' : 'Bank / issuer'}</label><input value={f.institution} onChange={set('institution')} placeholder="Optional" /></div>
      <div className="field"><label>{credit ? 'Current balance owed' : 'Current balance'}</label>
        <input type="number" step="0.01" value={f.balance} onChange={set('balance')} placeholder="0.00" />
      </div>
      {f.type !== 'cash' && <div className="field"><label>Last 4 digits</label><input value={f.last4} onChange={set('last4')} maxLength={4} inputMode="numeric" placeholder="Optional" /></div>}
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
      {credit && (
        <>
          <div className="field"><label>APR %</label><input type="number" step="0.01" value={f.apr} onChange={set('apr')} placeholder="e.g. 24.99" /></div>
          <div className="field"><label>Minimum payment</label><input type="number" step="0.01" value={f.minPayment} onChange={set('minPayment')} placeholder="From statement" /></div>
          <div className="field"><label>Credit limit</label><input type="number" step="1" value={f.creditLimit} onChange={set('creditLimit')} placeholder="Optional" /></div>
          <div className="field"><label>Payment due day</label><input type="number" min="1" max="31" value={f.dueDay} onChange={set('dueDay')} placeholder="1–31" /></div>
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

function AccountCell({ a }) {
  const Icon = ICON[a.type] || Wallet;
  return (
    <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
      <span className="stat-icon"><Icon size={16} /></span>
      <div>
        <b>{a.name}</b>{a.last4 && <span className="faint"> ••{a.last4}</span>}
        <div className="faint">{[typeLabel(a.type, true), a.institution].filter(Boolean).join(' · ')}{a.balanceAsOf && ` · as of ${longDate(a.balanceAsOf)}`}</div>
      </div>
    </div>
  );
}

export default function Accounts() {
  const { data, mutate } = useData();
  const [editing, setEditing] = useState(null); // account | 'new' | null
  const counts = new Map();
  for (const t of data.transactions) counts.set(t.accountId, (counts.get(t.accountId) || 0) + 1);

  const cards = data.accounts.filter((a) => a.type === 'credit');
  const banks = data.accounts.filter((a) => a.type !== 'credit');
  const debt = cards.reduce((s, a) => s + (a.balance || 0), 0);
  const interest = new Map(banks.map((a) => [a.id, interestInfo(a)]));
  const cash = banks.reduce((s, a) => s + (interest.get(a.id)?.estimatedToday ?? (a.balance || 0)), 0);
  const yearly = [...interest.values()].reduce((s, i) => s + (i?.yearly || 0), 0);
  const monthly = [...interest.values()].reduce((s, i) => s + (i?.monthly || 0), 0);

  const actions = (a) => (
    <td style={{ width: 90, whiteSpace: 'nowrap' }}>
      <button className="btn ghost icon sm" aria-label="Edit" onClick={() => setEditing(a)}><Pencil size={15} /></button>
      <button className="btn ghost icon sm" aria-label="Delete" onClick={() =>
        confirm(`Delete ${a.name} and its ${counts.get(a.id) || 0} transactions? This can’t be undone.`) &&
        mutate(`/accounts/${a.id}`, { method: 'DELETE' }, 'Account deleted')}><Trash2 size={15} /></button>
    </td>
  );

  return (
    <>
      <PageHead title="Accounts & cards" subtitle="Bank accounts, savings, cash and credit cards.">
        <button className="btn primary" onClick={() => setEditing('new')}><Plus size={16} /> Add account</button>
      </PageHead>

      {!data.accounts.length ? (
        <Card><Empty icon={CreditCard} title="No accounts yet" action={<button className="btn primary" onClick={() => setEditing('new')}>Add your first account</button>}>
          Add your checking, savings, money market, CD, cash and credit card accounts.
        </Empty></Card>
      ) : (
        <div className="grid g-4">
          <Stat icon={PiggyBank} label="Bank & cash" value={money0(cash)} sub={`${banks.length} account${banks.length === 1 ? '' : 's'} · incl. interest to date`} />
          <Stat icon={TrendingUp} label="Interest earned" value={<span className={yearly > 0 ? 'pos' : ''}>{money(yearly)}/yr</span>}
            sub={yearly > 0 ? `About ${money(monthly)} a month` : 'Add an APY to savings accounts to see this'} />
          <Stat icon={CreditCard} label="Owed on cards" value={money0(debt)} sub={`${cards.length} card${cards.length === 1 ? '' : 's'}`} />
        </div>
      )}

      {banks.length > 0 && (
        <Card title="Bank & cash accounts" subtitle="Interest is estimated from each account’s APY, compounding daily." className="mt flush">
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
                  const canEarn = earnsInterest(a.type);
                  return (
                    <tr key={a.id}>
                      <td>
                        <AccountCell a={a} />
                        {i?.maturityValue != null && (
                          <div className="faint" style={{ marginLeft: 42 }}>
                            {i.daysToMaturity > 0 ? `Matures ${longDate(a.maturityDate)} · worth ~${money(i.maturityValue)}` : `Matured ${longDate(a.maturityDate)}`}
                          </div>
                        )}
                      </td>
                      <td className="amount"><b>{money(a.balance || 0)}</b></td>
                      <td className="amount">{i ? `${i.apy}%` : canEarn ? <button className="btn ghost sm" onClick={() => setEditing(a)}>Add</button> : '—'}</td>
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
                      <td><AccountCell a={a} /></td>
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

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add account' : 'Edit account'}>
        {editing && <AccountForm key={editing.id || 'new'} account={editing === 'new' ? null : editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />}
      </Modal>
    </>
  );
}
