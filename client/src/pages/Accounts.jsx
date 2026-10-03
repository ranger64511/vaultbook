import { useState } from 'react';
import { CreditCard, Landmark, PiggyBank, Plus, Pencil, Trash2 } from 'lucide-react';
import { useData } from '../DataContext.jsx';
import { PageHead, Card, Empty, Modal } from '../components/ui.jsx';
import { money, money0, pct, longDate } from '../lib/format.js';

const ICON = { credit: CreditCard, checking: Landmark, savings: PiggyBank };
const TYPE_LABEL = { credit: 'Credit card', checking: 'Checking', savings: 'Savings' };

export function AccountForm({ account, onSaved, onCancel, submitLabel = 'Save' }) {
  const { mutate } = useData();
  const [f, setF] = useState(() => ({
    name: '', type: 'checking', institution: '', balance: '', apr: '', minPayment: '', creditLimit: '', dueDay: '', last4: '',
    ...Object.fromEntries(Object.entries(account || {}).map(([k, v]) => [k, v ?? ''])),
  }));
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const credit = f.type === 'credit';

  const save = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const body = { ...f };
      if (!credit) { body.apr = null; body.minPayment = null; body.creditLimit = null; body.dueDay = null; }
      const saved = await mutate(account ? `/accounts/${account.id}` : '/accounts', { method: account ? 'PUT' : 'POST', body }, account ? 'Account updated' : 'Account added');
      onSaved?.(saved);
    } catch (err) { setError(err.message); }
  };

  return (
    <form className="form-grid" onSubmit={save}>
      <div className="field full"><label>Account name</label><input value={f.name} onChange={set('name')} placeholder="e.g. Chase Sapphire" required /></div>
      <div className="field"><label>Type</label>
        <select value={f.type} onChange={set('type')}>
          <option value="checking">Checking</option><option value="savings">Savings</option><option value="credit">Credit card</option>
        </select>
      </div>
      <div className="field"><label>Bank / issuer</label><input value={f.institution} onChange={set('institution')} placeholder="Optional" /></div>
      <div className="field"><label>{credit ? 'Current balance owed' : 'Current balance'}</label>
        <input type="number" step="0.01" value={f.balance} onChange={set('balance')} placeholder="0.00" />
      </div>
      <div className="field"><label>Last 4 digits</label><input value={f.last4} onChange={set('last4')} maxLength={4} inputMode="numeric" placeholder="Optional" /></div>
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

export default function Accounts() {
  const { data, mutate } = useData();
  const [editing, setEditing] = useState(null); // account | 'new' | null
  const counts = new Map();
  for (const t of data.transactions) counts.set(t.accountId, (counts.get(t.accountId) || 0) + 1);

  const cards = data.accounts.filter((a) => a.type === 'credit');
  const banks = data.accounts.filter((a) => a.type !== 'credit');
  const debt = cards.reduce((s, a) => s + (a.balance || 0), 0);
  const cash = banks.reduce((s, a) => s + (a.balance || 0), 0);

  const section = (title, list) => list.length > 0 && (
    <Card title={title} className="mt flush">
      <div className="table-wrap">
        <table>
          <thead><tr><th>Account</th><th className="amount">Balance</th>{title.includes('Credit') && <><th className="amount">APR</th><th className="amount">Min. payment</th><th className="amount">Utilization</th><th>Due</th></>}<th className="amount">Transactions</th><th /></tr></thead>
          <tbody>
            {list.map((a) => {
              const Icon = ICON[a.type];
              const util = a.creditLimit ? (a.balance / a.creditLimit) * 100 : null;
              return (
                <tr key={a.id}>
                  <td>
                    <div className="row" style={{ gap: 12, flexWrap: 'nowrap' }}>
                      <span className="stat-icon"><Icon size={16} /></span>
                      <div>
                        <b>{a.name}</b>{a.last4 && <span className="faint"> ••{a.last4}</span>}
                        <div className="faint">{[TYPE_LABEL[a.type], a.institution].filter(Boolean).join(' · ')}{a.balanceAsOf && ` · as of ${longDate(a.balanceAsOf)}`}</div>
                      </div>
                    </div>
                  </td>
                  <td className="amount"><b>{money(a.balance || 0)}</b></td>
                  {a.type === 'credit' && <>
                    <td className="amount">{a.apr != null ? `${a.apr}%` : <span className="badge warn">Add APR</span>}</td>
                    <td className="amount">{a.minPayment != null ? money(a.minPayment) : '—'}</td>
                    <td className="amount">{util != null ? <span className={`badge ${util > 50 ? 'bad' : util > 30 ? 'warn' : 'good'}`}>{pct(util)}</span> : '—'}</td>
                    <td className="faint">{a.dueDay ? `Day ${a.dueDay}` : '—'}</td>
                  </>}
                  <td className="amount faint">{counts.get(a.id) || 0}</td>
                  <td style={{ width: 90, whiteSpace: 'nowrap' }}>
                    <button className="btn ghost icon sm" aria-label="Edit" onClick={() => setEditing(a)}><Pencil size={15} /></button>
                    <button className="btn ghost icon sm" aria-label="Delete" onClick={() =>
                      confirm(`Delete ${a.name} and its ${counts.get(a.id) || 0} transactions? This can’t be undone.`) &&
                      mutate(`/accounts/${a.id}`, { method: 'DELETE' }, 'Account deleted')}><Trash2 size={15} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );

  return (
    <>
      <PageHead title="Accounts & cards" subtitle={`${money0(cash)} in bank accounts · ${money0(debt)} owed on cards`}>
        <button className="btn primary" onClick={() => setEditing('new')}><Plus size={16} /> Add account</button>
      </PageHead>
      {!data.accounts.length && (
        <Card><Empty icon={CreditCard} title="No accounts yet" action={<button className="btn primary" onClick={() => setEditing('new')}>Add your first account</button>}>
          Add each checking, savings and credit card account you want to track.
        </Empty></Card>
      )}
      {section('Credit cards', cards)}
      {section('Bank accounts', banks)}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add account' : 'Edit account'}>
        {editing && <AccountForm key={editing.id || 'new'} account={editing === 'new' ? null : editing} onSaved={() => setEditing(null)} onCancel={() => setEditing(null)} />}
      </Modal>
    </>
  );
}
