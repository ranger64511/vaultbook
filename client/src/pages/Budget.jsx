import { useEffect, useMemo, useState } from 'react';
import { Wand2, Plus, Save, AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { useData } from '../DataContext.jsx';
import { PageHead, Card, Stat, Modal } from '../components/ui.jsx';
import MonthChips from '../components/MonthChips.jsx';
import { useChartColors, STATUS } from '../lib/theme.js';
import { summarize } from '../lib/analytics.js';
import { money0, monthLabel, addMonths, currentMonth, pct } from '../lib/format.js';

export default function Budget() {
  const { data, mutate } = useData();
  const c = useChartColors();
  const months = useMemo(() => [...new Set(data.transactions.map((t) => t.date.slice(0, 7)))].sort().reverse(), [data.transactions]);
  // Spending per month, worked out from the transactions (needs + wants only).
  const spentByMonth = useMemo(() => {
    const kinds = new Map(data.categories.map((x) => [x.id, x.kind]));
    const m = new Map();
    for (const t of data.transactions) {
      const k = kinds.get(t.category) || 'want';
      if (k === 'need' || k === 'want') m.set(t.date.slice(0, 7), (m.get(t.date.slice(0, 7)) || 0) - t.amount);
    }
    return m;
  }, [data.transactions, data.categories]);
  // Open on this month if it has spending yet, otherwise the latest month that does.
  const [month, setMonth] = useState(() => (spentByMonth.get(currentMonth()) ? currentMonth() : (months[0] || currentMonth())));
  const chipMonths = [...new Set([currentMonth(), ...months])].sort().reverse()
    .map((m) => ({ month: m, detail: spentByMonth.get(m) ? money0(spentByMonth.get(m)) : (m === currentMonth() ? 'in progress' : '$0') }));
  // How far through the month we are, to judge spending pace in the current month.
  const progress = (() => {
    if (month !== currentMonth()) return null;
    const d = new Date();
    const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return { day: d.getDate(), days };
  })();
  const [cats, setCats] = useState(data.categories);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setCats(data.categories); }, [data.categories, dirty]);

  // Spending per category for the month and the 3 months before it.
  const { spent, avg3, income, avgIncome } = useMemo(() => {
    const prior = [1, 2, 3].map((n) => addMonths(month, -n));
    const spent = new Map(), sum3 = new Map();
    let income = 0, inc3 = 0;
    const kinds = new Map(data.categories.map((x) => [x.id, x.kind]));
    const priorSet = new Set(prior.filter((m) => months.includes(m)));
    for (const t of data.transactions) {
      const m = t.date.slice(0, 7);
      const k = kinds.get(t.category);
      if (k === 'income') { if (m === month) income += t.amount; if (priorSet.has(m)) inc3 += t.amount; continue; }
      if (k === 'transfer') continue;
      if (m === month) spent.set(t.category, (spent.get(t.category) || 0) - t.amount);
      if (priorSet.has(m)) sum3.set(t.category, (sum3.get(t.category) || 0) - t.amount);
    }
    const n = Math.max(1, priorSet.size);
    return { spent, avg3: new Map([...sum3].map(([k, v]) => [k, v / n])), income, avgIncome: priorSet.size ? inc3 / n : 0 };
  }, [data.transactions, data.categories, month, months]);

  const update = (id, patch) => { setCats((cs) => cs.map((x) => (x.id === id ? { ...x, ...patch } : x))); setDirty(true); };
  const save = async () => { await mutate('/categories', { method: 'PUT', body: { categories: cats } }, 'Budget saved'); setDirty(false); };
  const suggest = () => {
    setCats((cs) => cs.map((x) => (x.kind === 'need' || x.kind === 'want')
      ? { ...x, budget: Math.max(0, Math.ceil((avg3.get(x.id) || spent.get(x.id) || 0) / 10) * 10) } : x));
    setDirty(true);
  };
  const [adding, setAdding] = useState(false);
  // Saves right away, together with any unsaved budget edits on the page.
  const addCategory = async (cat) => {
    const next = [...cats, { id: `custom-${Date.now()}`, ...cat }];
    await mutate('/categories', { method: 'PUT', body: { categories: next } }, `Added “${cat.name}”`);
    setCats(next);
    setDirty(false);
  };

  const spendCats = cats.filter((x) => x.kind === 'need' || x.kind === 'want');
  const totalBudget = spendCats.reduce((s, x) => s + (Number(x.budget) || 0), 0);
  const needsBudget = spendCats.filter((x) => x.kind === 'need').reduce((s, x) => s + (Number(x.budget) || 0), 0);
  const sum = summarize(data.transactions.filter((t) => t.date.startsWith(month)), data.categories);
  const monthIncome = data.settings.incomeByMonth?.[month];
  const baseIncome = monthIncome ?? (data.settings.monthlyIncome || income || avgIncome);
  const leftover = baseIncome - sum.spending;
  // Current month: assume each category ends at least at its usual (3-month average)
  // amount, and anything already above that stays as spent. A rent payment on the 1st
  // counts once, and categories you haven't spent in yet are filled in from your usual.
  const projected = (() => {
    if (!progress || progress.day >= progress.days || sum.spending <= 0) return null;
    if (!avg3.size) return progress.day >= 10 ? (sum.spending / progress.day) * progress.days : null;
    const ids = new Set([...spent.keys(), ...avg3.keys()]);
    let total = 0;
    for (const id of ids) total += Math.max(spent.get(id) || 0, Math.max(0, avg3.get(id) || 0));
    return total;
  })();

  const split = baseIncome > 0 ? [
    { label: 'Needs', value: sum.needs, target: 50, color: c.series[0] },
    { label: 'Wants', value: sum.wants, target: 30, color: c.series[1] },
    { label: 'Left for debt & savings', value: Math.max(0, leftover), target: 20, color: c.series[2] },
  ] : [];

  const section = (kind, title, hint) => (
    <Card className="flush" title={title} subtitle={hint}>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Category</th><th>Type</th><th className="amount">Monthly budget</th><th className="amount">Spent</th><th style={{ width: '28%' }}>Progress</th><th className="amount">3-mo avg</th><th /></tr></thead>
          <tbody>
            {cats.filter((x) => x.kind === kind && x.id !== 'uncategorized' || (kind === 'want' && x.id === 'uncategorized')).map((x) => {
              const s = spent.get(x.id) || 0;
              const b = Number(x.budget) || 0;
              const ratio = b ? s / b : s > 0 ? 2 : 0;
              const state = !b && !s ? null : ratio > 1 ? 'over' : ratio > 0.85 ? 'near' : 'ok';
              return (
                <tr key={x.id}>
                  <td><input value={x.name} onChange={(e) => update(x.id, { name: e.target.value })} style={{ height: 30, border: 'none', background: 'transparent', fontWeight: 550, padding: 0, width: '100%' }} aria-label="Category name" /></td>
                  <td>
                    <select className="inline" value={x.kind} onChange={(e) => update(x.id, { kind: e.target.value })} aria-label="Need or want">
                      <option value="need">Need</option><option value="want">Want</option><option value="income">Income</option><option value="transfer">Transfer</option>
                    </select>
                  </td>
                  <td className="amount"><input type="number" min="0" step="10" value={x.budget || ''} placeholder="0" onChange={(e) => update(x.id, { budget: e.target.value })} style={{ width: 100, height: 30, textAlign: 'right' }} aria-label={`${x.name} budget`} /></td>
                  <td className="amount">{money0(s)}</td>
                  <td>
                    {state && (
                      <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
                        <div className={`bar grow ${state === 'over' ? 'bad' : state === 'near' ? 'warn' : ''}`}><span style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div>
                        {state === 'over'
                          ? <span className="badge bad"><AlertTriangle size={12} /> {b ? `${money0(s - b)} over` : 'No budget'}</span>
                          : <span className="faint num" style={{ minWidth: 70, textAlign: 'right' }}>{money0(b - s)} left</span>}
                      </div>
                    )}
                  </td>
                  <td className="amount faint">{money0(avg3.get(x.id) || 0)}</td>
                  <td style={{ width: 40 }}>{x.id.startsWith('custom-') && (
                    <button className="btn ghost icon sm" aria-label="Remove category" onClick={() => { setCats((cs) => cs.filter((y) => y.id !== x.id)); setDirty(true); }}><Trash2 size={14} /></button>
                  )}</td>
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
      <PageHead title="Budget" subtitle="Set a monthly amount per category. Needs are essentials; wants are places to cut.">
        <button className="btn" onClick={suggest} title="Set each budget to your 3-month average"><Wand2 size={16} /> Suggest from history</button>
        <button className="btn" onClick={() => setAdding(true)}><Plus size={16} /> Category</button>
        <button className="btn primary" onClick={save} disabled={!dirty}><Save size={16} /> Save</button>
      </PageHead>

      <div className="spread budget-month">
        <h2>{monthLabel(month, 'long')}{progress && <span className="badge warn" style={{ marginLeft: 8, verticalAlign: 2 }}>In progress · day {progress.day} of {progress.days}</span>}</h2>
      </div>
      <MonthChips items={chipMonths} isActive={(m) => m === month} onPick={setMonth} label="Budget months" className="bare" />

      <div className="grid g-4">
        <Stat label="Income" value={money0(baseIncome)} sub={monthIncome != null ? 'Expected for this month (Settings)' : data.settings.monthlyIncome ? 'Usual expected income (Settings)' : income ? 'Received this month' : avgIncome ? '3-month average' : 'Set expected income in Settings'} />
        <Stat label="Budgeted" value={money0(totalBudget)} sub={`Needs ${money0(needsBudget)} · Wants ${money0(totalBudget - needsBudget)}`} />
        <Stat label="Spent" value={money0(sum.spending)}
          sub={projected != null
            ? <>Heading for about <b>{money0(projected)}</b> if the rest of the month is typical{totalBudget ? ` (budget ${money0(totalBudget)})` : ''}</>
            : totalBudget ? `${pct((sum.spending / totalBudget) * 100)} of budget` : 'No budget set yet'} />
        <Stat label="Left over" value={<span className={leftover >= 0 ? 'pos' : 'bad'}>{money0(leftover)}</span>} sub={leftover > 0 ? 'Available for card payoff & savings' : 'Spending exceeds income'} />
      </div>

      {split.length > 0 && (
        <Card className="mt" title="Where your income goes" subtitle="Compared with the 50/30/20 guideline (50% needs, 30% wants, 20% debt & savings)">
          <div style={{ display: 'flex', height: 14, borderRadius: 999, overflow: 'hidden', gap: 2, background: 'var(--surface-hover)' }}>
            {split.map((s) => <span key={s.label} title={s.label} style={{ width: `${Math.max(0, Math.min(100, (s.value / baseIncome) * 100))}%`, background: s.color }} />)}
          </div>
          <div className="grid g-4 mt" style={{ gap: 12 }}>
            {split.map((s) => {
              const actual = (s.value / baseIncome) * 100;
              const ok = s.label.startsWith('Left') ? actual >= s.target : actual <= s.target;
              return (
                <div key={s.label}>
                  <div className="row" style={{ gap: 8, fontSize: 13 }}><span className="swatch" style={{ background: s.color }} />{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 650, marginTop: 2 }}>{pct(actual)} <span className="faint" style={{ fontWeight: 500 }}>· {money0(s.value)}</span></div>
                  <div className="row faint" style={{ gap: 5 }}>
                    {ok ? <CheckCircle2 size={13} color={STATUS.good} /> : <AlertTriangle size={13} color={STATUS.serious} />}
                    Target {s.label.startsWith('Left') ? 'at least' : 'at most'} {s.target}%
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="stack mt">
        {section('need', 'Needs', 'Essentials: housing, utilities, groceries, insurance, transportation')}
        {section('want', 'Wants', 'Nice-to-haves: the first place to look for money to put toward your cards')}
      </div>

      <AddCategoryModal open={adding} onClose={() => setAdding(false)} existing={cats} onAdd={addCategory} />
    </>
  );
}

const KINDS = [
  { value: 'need', label: 'Need', hint: 'Essential: you’d keep paying this even on a tight budget' },
  { value: 'want', label: 'Want', hint: 'Nice to have: a place to cut back' },
  { value: 'income', label: 'Income', hint: 'Money coming in (not part of spending)' },
  { value: 'transfer', label: 'Transfer', hint: 'Moving money between your own accounts' },
];

function AddCategoryModal({ open, onClose, existing, onAdd }) {
  const blank = { name: '', kind: 'want', budget: '' };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setForm(blank); setError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return setError('Give the category a name.');
    if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) return setError(`“${name}” already exists.`);
    setBusy(true);
    try {
      await onAdd({ name, kind: form.kind, budget: Math.max(0, Number(form.budget) || 0) });
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const showBudget = form.kind === 'need' || form.kind === 'want';
  return (
    <Modal open={open} onClose={onClose} title="New category"
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" form="add-category" className="btn primary" disabled={busy}><Plus size={16} /> {busy ? 'Adding…' : 'Add category'}</button>
      </>}>
      <form id="add-category" className="stack" style={{ gap: 16 }} onSubmit={submit}>
        <div className="field">
          <label htmlFor="cat-name">Name</label>
          <input id="cat-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Pet Care" maxLength={60} data-autofocus />
        </div>
        <div className="field">
          <label>Type</label>
          <div className="segmented" role="group" aria-label="Category type" style={{ alignSelf: 'flex-start' }}>
            {KINDS.map((k) => (
              <button type="button" key={k.value} aria-pressed={form.kind === k.value} onClick={() => setForm({ ...form, kind: k.value })}>{k.label}</button>
            ))}
          </div>
          <span className="hint">{KINDS.find((k) => k.value === form.kind).hint}</span>
        </div>
        {showBudget && (
          <div className="field">
            <label htmlFor="cat-budget">Monthly budget</label>
            <input id="cat-budget" type="number" min="0" step="10" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="0 (optional)" />
          </div>
        )}
        {error && <div className="error-box" role="alert">{error}</div>}
      </form>
    </Modal>
  );
}
