import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search, Trash2, ReceiptText, Download } from 'lucide-react';
import { useData } from '../DataContext.jsx';
import { PageHead, Card, Empty, Amount, Modal, Segmented, CategorySelect } from '../components/ui.jsx';
import { money, monthLabel, weekKey, weekLabel, shortDate, isoDate, dayLabel } from '../lib/format.js';
import { kindOf } from '../lib/analytics.js';

const PAGE = 400;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');

export default function Transactions() {
  const { data, accountsById, mutate } = useData();
  const [q, setQ] = useState('');
  const [account, setAccount] = useState('');
  const [category, setCategory] = useState('');
  const [month, setMonth] = useState('');
  const [group, setGroup] = useState('month');
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const [ruleAsk, setRuleAsk] = useState(null);

  const months = useMemo(() => [...new Set(data.transactions.map((t) => t.date.slice(0, 7)))].sort().reverse(), [data.transactions]);
  const kind = kindOf(data.categories);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.transactions
      .filter((t) => (!account || t.accountId === account) && (!category || t.category === category) &&
        (!month || t.date.startsWith(month)) &&
        (!needle || t.description.toLowerCase().includes(needle) || t.notes?.toLowerCase().includes(needle) || String(Math.abs(t.amount)).includes(needle)))
      .sort((a, b) => b.date.localeCompare(a.date) || a.description.localeCompare(b.description));
  }, [data.transactions, q, account, category, month]);

  const groups = useMemo(() => {
    const out = [];
    const keyFn = { month: (t) => t.date.slice(0, 7), week: (t) => weekKey(t.date), day: (t) => t.date }[group] || (() => 'all');
    for (const t of filtered.slice(0, limit)) {
      const k = keyFn(t);
      let g = out[out.length - 1];
      if (!g || g.key !== k) out.push((g = { key: k, items: [] }));
      g.items.push(t);
    }
    // Totals use the full filtered set so partially-rendered groups are still right.
    const totals = new Map();
    for (const t of filtered) {
      const k = keyFn(t);
      const s = totals.get(k) || { in: 0, out: 0, n: 0 };
      if (kind(t.category) !== 'transfer') { if (t.amount > 0) s.in += t.amount; else s.out -= t.amount; }
      s.n++;
      totals.set(k, s);
    }
    return out.map((g) => ({ ...g, totals: totals.get(g.key) }));
  }, [filtered, group, limit, kind]);

  const changeCategory = async (t, cat) => {
    await mutate(`/transactions/${t.id}`, { method: 'PUT', body: { category: cat } });
    const similar = data.transactions.filter((x) => x.id !== t.id && x.merchant === t.merchant && x.category !== cat);
    if (t.merchant && similar.length) setRuleAsk({ merchant: t.merchant, category: cat, count: similar.length });
  };

  const groupLabel = (k) => ({ month: () => monthLabel(k, 'long'), week: () => `Week of ${weekLabel(k)}`, day: () => dayLabel(k) }[group]?.() ?? 'All transactions');

  return (
    <>
      <PageHead title="Transactions" subtitle={`${filtered.length.toLocaleString()} transactions`}>
        <a className="btn" href="/api/export.csv" download><Download size={16} /> Export CSV</a>
        <button className="btn primary" onClick={() => setAdding(true)} disabled={!data.accounts.length}><Plus size={16} /> Add</button>
      </PageHead>

      <Card className="flush">
        <div className="row" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <div style={{ position: 'relative', flex: '1 1 220px' }}>
            <Search size={16} style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text-3)' }} />
            <input type="search" placeholder="Search description, notes or amount" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%', paddingLeft: 34 }} aria-label="Search" />
          </div>
          <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
            <option value="">All months</option>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m, 'long')}</option>)}
          </select>
          <select value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account">
            <option value="">All accounts</option>
            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <CategorySelect categories={data.categories} value={category} onChange={setCategory} includeAll />
          <Segmented label="Group by" value={group} onChange={setGroup} options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'day', label: 'Day' }, { value: 'none', label: 'None' }]} />
        </div>

        {!filtered.length ? (
          <Empty icon={ReceiptText} title="No transactions" action={!data.transactions.length && <Link className="btn primary" to="/import">Import a statement</Link>}>
            {data.transactions.length ? 'Nothing matches these filters.' : 'Import a statement to see transactions here.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Date</th><th>Description</th><th>Category</th><th>Account</th><th className="amount">Amount</th><th /></tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    {group !== 'none' && (
                      <tr className="group-row">
                        <td colSpan={3}>{groupLabel(g.key)} <span className="faint" style={{ fontWeight: 500 }}>· {g.totals.n} transaction{g.totals.n === 1 ? '' : 's'}</span></td>
                        <td colSpan={3} className="amount">
                          <span className="pos">+{money(g.totals.in)}</span>
                          <span className="faint"> in · </span>
                          <span>−{money(g.totals.out)}</span>
                          <span className="faint"> out</span>
                        </td>
                      </tr>
                    )}
                    {g.items.map((t) => (
                      <tr key={t.id} className={kind(t.category) === 'transfer' ? 'dim-soft' : ''}>
                        <td className="faint" style={{ whiteSpace: 'nowrap' }}>{shortDate(t.date)}</td>
                        <td className="desc" title={t.description}>{t.description}{t.notes && <div className="faint ellipsis">{t.notes}</div>}</td>
                        <td><CategorySelect className="inline" categories={data.categories} value={t.category} onChange={(c) => changeCategory(t, c)} /></td>
                        <td className="faint ellipsis" style={{ maxWidth: 160 }}>{accountsById.get(t.accountId)?.name}</td>
                        <td className="amount"><Amount value={t.amount} /></td>
                        <td style={{ width: 40 }}>
                          <button className="btn ghost icon sm" aria-label="Delete transaction" title="Delete"
                            onClick={() => confirm('Delete this transaction?') && mutate(`/transactions/${t.id}`, { method: 'DELETE' }, 'Transaction deleted')}>
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {filtered.length > limit && (
              <div style={{ padding: 16, textAlign: 'center' }}>
                <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>Show more ({filtered.length - limit} left)</button>
              </div>
            )}
          </div>
        )}
      </Card>

      <AddTransaction open={adding} onClose={() => setAdding(false)} />

      <Modal open={!!ruleAsk} onClose={() => setRuleAsk(null)} title="Remember this category?"
        footer={<>
          <button className="btn" onClick={() => setRuleAsk(null)}>Just this one</button>
          <button className="btn primary" onClick={async () => {
            const r = ruleAsk;
            setRuleAsk(null);
            await mutate('/rules', { method: 'POST', body: { pattern: escapeRe(r.merchant), category: r.category, applyToExisting: true } }, 'Rule saved');
          }}>Always categorize</button>
        </>}>
        {ruleAsk && (
          <p>
            Always put transactions from <b>{ruleAsk.merchant}</b> in <b>{data.categories.find((c) => c.id === ruleAsk.category)?.name}</b>?
            {ruleAsk.count > 0 && <> This also updates {ruleAsk.count} existing transaction{ruleAsk.count === 1 ? '' : 's'}.</>}
          </p>
        )}
      </Modal>
    </>
  );
}

function AddTransaction({ open, onClose }) {
  const { data, mutate } = useData();
  const [form, setForm] = useState({ accountId: '', date: isoDate(new Date()), description: '', amount: '', type: 'out', category: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target ? e.target.value : e }));

  const save = async () => {
    setError('');
    try {
      const amt = Math.abs(Number(form.amount)) * (form.type === 'out' ? -1 : 1);
      await mutate('/transactions', { method: 'POST', body: { ...form, accountId: form.accountId || data.accounts[0]?.id, amount: amt, category: form.category || undefined } }, 'Transaction added');
      setForm((f) => ({ ...f, description: '', amount: '' }));
      onClose();
    } catch (e) { setError(e.message); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add transaction"
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Add</button></>}>
      <div className="form-grid">
        <div className="field full"><label>Description</label><input value={form.description} onChange={set('description')} /></div>
        <div className="field"><label>Amount</label><input type="number" step="0.01" min="0" value={form.amount} onChange={set('amount')} /></div>
        <div className="field"><label>Type</label>
          <select value={form.type} onChange={set('type')}><option value="out">Money out</option><option value="in">Money in</option></select>
        </div>
        <div className="field"><label>Date</label><input type="date" value={form.date} onChange={set('date')} /></div>
        <div className="field"><label>Account</label>
          <select value={form.accountId} onChange={set('accountId')}>{data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </div>
        <div className="field full"><label>Category</label>
          <select value={form.category} onChange={set('category')}>
            <option value="">Auto-detect</option>
            {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {error && <div className="error-box full">{error}</div>}
      </div>
    </Modal>
  );
}
