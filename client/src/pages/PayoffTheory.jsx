import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { FlaskConical, Plus, Trash2, CalendarCheck, Flame, Coins, Sparkles, RotateCcw, CheckCircle2, AlertTriangle, Target, Copy, Check, Loader2 } from 'lucide-react';
import { useData } from '../DataContext.jsx';
import { PageHead, Card, Stat, Empty, Segmented, Modal } from '../components/ui.jsx';
import { ChartTooltip, Legend, axisProps } from '../components/charts.jsx';
import PayoffSchedule from '../components/PayoffSchedule.jsx';
import { useChartColors } from '../lib/theme.js';
import { money, money0, moneyCompact, monthsFromNow, currentMonth, addMonths } from '../lib/format.js';
import {
  duration, monthTicks, tickLabel, payoffDebts, debtsFrom, minimumTotal, mainPlanSettings, runPlan, monthsBetween,
  firstPaymentMonth, describeAdjustment, totalExtra, EXTRA_KINDS, REPEATS, kindOfAdjustment, towardDebt, toSimExtras,
  withdrawalInfo, projectInvestments,
} from '../lib/payoff.js';
import { isInvestment } from '../lib/accounts.js';

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cloneAdjustments = (list) => list.map((a) => ({ ...a, id: newId() }));
const usable = (adjustments) => adjustments.filter((a) => Number(a.amount) > 0 && a.month);

/** A new theory starts as a copy of the main plan. */
const theoryFromMain = (main, name) => ({ id: newId(), name, budget: main.budget, strategy: main.strategy, adjustments: cloneAdjustments(main.adjustments) });
const nextName = (list) => {
  let n = list.length + 1;
  while (list.some((t) => t.name === `Theory ${n}`)) n++;
  return `Theory ${n}`;
};
const SAVE_DELAY = 700;

export function PlanningOnlyNotice() {
  return (
    <div className="warn-box row" role="note" style={{ gap: 10, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
      <AlertTriangle size={18} style={{ flex: 'none', marginTop: 1 }} />
      <div>
        <b>Planning only: Vault Book never makes payments.</b> Theories and your main plan are estimates to help you decide.
        Any lump sum or higher payment has to be made by you, through your lender, card issuer or bank.
      </div>
    </div>
  );
}

export default function PayoffTheory() {
  const { data, mutate, notify } = useData();
  const navigate = useNavigate();
  const c = useChartColors();
  const cards = payoffDebts(data.accounts);
  const debts = debtsFrom(cards);
  const debtsKey = JSON.stringify(debts);
  const minTotal = minimumTotal(debts);
  const main = mainPlanSettings(data.settings, debts);

  // Every theory is kept in the encrypted vault and autosaved while you edit.
  const [book, setBook] = useState(() => {
    const saved = (data.settings.payoffScenarios || []).map((t) => ({ ...t, adjustments: t.adjustments.map((a) => ({ ...a })) }));
    const list = saved.length ? saved : [theoryFromMain(main, 'Theory 1')];
    const activeId = list.some((t) => t.id === data.settings.payoffActiveTheory) ? data.settings.payoffActiveTheory : list[0].id;
    return { list, activeId, dirty: !saved.length };
  });
  const [status, setStatus] = useState(book.dirty ? 'saving' : 'saved');
  const [applying, setApplying] = useState(false);
  const draft = book.list.find((t) => t.id === book.activeId) || book.list[0];

  const change = (fn) => setBook((b) => ({ ...fn(b), dirty: true }));
  const setDraft = (fn) => change((b) => ({ ...b, list: b.list.map((t) => (t.id === b.activeId ? (typeof fn === 'function' ? fn(t) : fn) : t)) }));

  // Debounced autosave; anything still pending is flushed when you leave the page.
  const pending = useRef(null);
  const save = async (payload) => {
    pending.current = null;
    setStatus('saving');
    try {
      await mutate('/settings', { method: 'PUT', body: payload });
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };
  useEffect(() => {
    if (!book.dirty) return undefined;
    const payload = {
      payoffScenarios: book.list.map((t) => ({ ...t, adjustments: usable(t.adjustments) })),
      payoffActiveTheory: book.activeId,
    };
    pending.current = payload;
    setStatus('unsaved');
    const timer = setTimeout(() => save(payload), SAVE_DELAY);
    return () => clearTimeout(timer);
  }, [book]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Closing or reloading the tab: send anything pending with a keepalive request.
    const onHide = () => {
      if (!pending.current) return;
      fetch('/api/settings', {
        method: 'PUT', keepalive: true, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'vaultbook' },
        body: JSON.stringify(pending.current),
      }).catch(() => {});
      pending.current = null;
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      if (pending.current) save(pending.current); // leaving the page within the app
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const accounts = data.accounts;
  const investments = accounts.filter((a) => isInvestment(a.type) && a.balance > 0);
  const mainPlan = useMemo(() => runPlan(debts, main, accounts), [debtsKey, JSON.stringify(main), accounts]); // eslint-disable-line react-hooks/exhaustive-deps
  const theory = useMemo(() => runPlan(debts, draft, accounts), [debtsKey, draft, accounts]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasWithdrawals = draft.adjustments.some((a) => a.source === 'withdraw');
  // The same theory without its investment withdrawals, to isolate their effect.
  const withoutWithdrawals = useMemo(
    () => (hasWithdrawals ? runPlan(debts, { ...draft, adjustments: draft.adjustments.filter((a) => a.source !== 'withdraw') }, accounts) : null),
    [debtsKey, draft, accounts, hasWithdrawals], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!cards.length) {
    return (
      <>
        <PageHead title="Payoff theory" />
        <Card><Empty icon={Target} title="No debts to pay off" action={<Link className="btn primary" to="/accounts">Manage accounts</Link>}>
          Add credit cards or loans with balances on the Accounts page to try payoff theories.
        </Empty></Card>
      </>
    );
  }

  const firstPay = firstPaymentMonth();
  const cardName = (id) => cards.find((a) => a.id === id)?.name;
  const update = (id, patch) => setDraft((d) => ({ ...d, adjustments: d.adjustments.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  const remove = (id) => setDraft((d) => ({ ...d, adjustments: d.adjustments.filter((a) => a.id !== id) }));
  const add = (kind) => setDraft((d) => ({
    ...d,
    adjustments: [...d.adjustments, {
      bonus: { id: newId(), type: 'lump', source: 'bonus', amount: 2000, percent: 50, month: addMonths(firstPay, 2), repeat: 'yearly', endMonth: null, target: null },
      raise: { id: newId(), type: 'increase', source: 'raise', amount: 200, percent: 100, month: addMonths(firstPay, 3), endMonth: null },
      lump: { id: newId(), type: 'lump', source: 'lump', amount: 1000, percent: 100, month: addMonths(firstPay, 2), repeat: 'none', target: null },
      increase: { id: newId(), type: 'increase', source: 'increase', amount: 100, percent: 100, month: firstPay, endMonth: null },
      withdraw: { id: newId(), type: 'lump', source: 'withdraw', fromAccount: investments[0]?.id, amount: Math.min(5000, Math.round(investments[0]?.balance || 0)), month: addMonths(firstPay, 1), repeat: 'none', target: null },
    }[kind]],
  }));
  const resetToMain = () => {
    if (!confirm(`Reset “${draft.name}” to match your main plan? Its extra payments will be replaced.`)) return;
    setDraft((t) => ({ ...t, budget: main.budget, strategy: main.strategy, adjustments: cloneAdjustments(main.adjustments) }));
  };
  const newTheory = () => change((b) => {
    const t = theoryFromMain(main, nextName(b.list));
    return { ...b, list: [...b.list, t], activeId: t.id };
  });
  const duplicateTheory = () => change((b) => {
    const t = { ...draft, id: newId(), name: `${draft.name} (copy)`.slice(0, 80), adjustments: cloneAdjustments(draft.adjustments) };
    return { ...b, list: [...b.list, t], activeId: t.id };
  });
  const deleteTheory = () => {
    if (!confirm(`Delete “${draft.name}”? This can’t be undone.`)) return;
    change((b) => {
      const list = b.list.filter((t) => t.id !== b.activeId);
      const kept = list.length ? list : [theoryFromMain(main, 'Theory 1')];
      return { ...b, list: kept, activeId: kept[0].id };
    });
    notify('Theory deleted');
  };
  const selectTheory = (id) => change((b) => ({ ...b, activeId: id }));

  const cleanDraft = { budget: draft.budget, strategy: draft.strategy, adjustments: usable(draft.adjustments) };
  const changed = !sameJSON(
    { ...cleanDraft, adjustments: cleanDraft.adjustments.map(({ id, ...a }) => a) },
    { budget: main.budget, strategy: main.strategy, adjustments: main.adjustments.map(({ id, ...a }) => a) },
  );
  const apply = async () => {
    await mutate('/settings', { method: 'PUT', body: { payoffBudget: cleanDraft.budget, payoffStrategy: cleanDraft.strategy, payoffAdjustments: cleanDraft.adjustments } });
    setApplying(false);
    notify('Theory applied to your main plan');
    navigate('/payoff');
  };

  // Comparison numbers.
  const fin = (p) => Number.isFinite(p.months);
  const monthsSooner = fin(mainPlan) && fin(theory) ? mainPlan.months - theory.months : null;
  const interestSaved = mainPlan.totalInterest - theory.totalInterest;
  const extraTheory = totalExtra(theory);
  const extraMain = totalExtra(mainPlan);
  const addedMoney = extraTheory - extraMain + (draft.budget - main.budget) * Math.min(fin(theory) ? theory.months : 0, 600);
  const perDollar = addedMoney > 1 ? interestSaved / addedMoney : null;

  const len = Math.min(Math.max(fin(mainPlan) ? mainPlan.months : 120, fin(theory) ? theory.months : 0, 6), 360);
  const chart = Array.from({ length: len + 1 }, (_, i) => ({ month: i, main: mainPlan.schedule[i]?.total ?? 0, theory: theory.schedule[i]?.total ?? 0 }));
  // Mark lump-sum and bonus months on the chart (skipped when there are too many, e.g. monthly bonuses).
  const lumpAll = [...new Set(toSimExtras(draft.adjustments, undefined, undefined, accounts).filter((x) => x.type === 'lump' && x.start <= len).map((x) => x.start))];
  const lumpMonths = lumpAll.length <= 24 ? lumpAll : [];
  const sameAsMain = !changed;

  return (
    <>
      <PageHead title="Payoff theory" subtitle="Try “what if” ideas, like lump sums or paying more, and see how they change your main plan. Nothing changes until you apply it.">
        <button className="btn primary" disabled={!changed} onClick={() => setApplying(true)}><CheckCircle2 size={16} /> Apply to main plan</button>
      </PageHead>

      <div className="theory-tabs" role="tablist" aria-label="Your theories">
        {book.list.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === draft.id} className={`theory-tab${t.id === draft.id ? ' active' : ''}`} onClick={() => selectTheory(t.id)}>
            <FlaskConical size={14} /> <span className="ellipsis">{t.name || 'Untitled theory'}</span>
          </button>
        ))}
        <button className="btn ghost sm" onClick={newTheory}><Plus size={14} /> New theory</button>
        <span className={`save-status ${status}`} role="status">
          {status === 'saving' ? <><Loader2 size={13} className="spin" /> Saving…</>
            : status === 'unsaved' ? 'Editing…'
            : status === 'error' ? 'Couldn’t save. Will retry on your next change.'
            : <><Check size={13} /> All theories saved</>}
        </span>
      </div>

      <PlanningOnlyNotice />

      <div className="grid g-3-1 mt">
        <Card>
          <div className="spread" style={{ marginBottom: 14, alignItems: 'flex-start' }}>
            <div className="field" style={{ flex: '1 1 240px' }}>
              <label htmlFor="theory-name">Theory name</label>
              <input id="theory-name" value={draft.name} maxLength={80} placeholder="e.g. Tax refund + $100 raise"
                onChange={(e) => setDraft((t) => ({ ...t, name: e.target.value }))} style={{ fontWeight: 600 }} />
              <span className="hint">Saved automatically{draft.updatedAt ? ` · last changed ${draft.updatedAt}` : ''}.</span>
            </div>
            <div className="row" style={{ gap: 4, marginTop: 22 }}>
              <button className="btn ghost sm" onClick={duplicateTheory} title="Make a copy to try a variation"><Copy size={14} /> Duplicate</button>
              <button className="btn ghost sm" onClick={resetToMain} title="Make this theory match your main plan again"><RotateCcw size={14} /> Reset</button>
              <button className="btn ghost sm danger" onClick={deleteTheory}><Trash2 size={14} /> Delete</button>
            </div>
          </div>
          <div className="row" style={{ gap: 24, alignItems: 'flex-end' }}>
            <div className="field">
              <label htmlFor="t-budget">Monthly payment toward debts</label>
              <input id="t-budget" type="number" min="0" step="10" value={draft.budget} onChange={(e) => setDraft((d) => ({ ...d, budget: Number(e.target.value) || 0 }))} style={{ width: 140 }} />
              <span className="hint">Main plan: {money0(main.budget)}/mo · minimums {money0(minTotal)}/mo</span>
            </div>
            <div className="field">
              <label>Strategy</label>
              <Segmented label="Strategy" value={draft.strategy} onChange={(v) => setDraft((d) => ({ ...d, strategy: v }))}
                options={[{ value: 'avalanche', label: 'Avalanche' }, { value: 'snowball', label: 'Snowball' }]} />
            </div>
          </div>
          {draft.budget < minTotal - 0.005 && <div className="error-box mt">Below your combined minimum payments ({money(minTotal)}).</div>}

          <div className="spread mt" style={{ marginTop: 20 }}>
            <h3>Extra payments, bonuses & raises</h3>
            <div className="row" style={{ gap: 6 }}>
              {EXTRA_KINDS.filter((k) => k.value !== 'withdraw' || investments.length).map((k) => <button key={k.value} className="btn sm" onClick={() => add(k.value)} title={k.hint}><Plus size={14} /> {k.label}</button>)}
            </div>
          </div>
          {!draft.adjustments.length ? (
            <p className="faint" style={{ marginTop: 8 }}>
              Add a <b>bonus</b> (one-time or repeating: monthly, quarterly, twice a year or yearly), a <b>raise</b> starting any month,
              a one-time <b>lump sum</b> like a tax refund, or a <b>monthly increase</b> like money freed from cancelled subscriptions.
            </p>
          ) : (
            <div className="stack" style={{ gap: 10, marginTop: 10 }}>
              {draft.adjustments.map((a) => (
                <ExtraEditor key={a.id} a={a} debts={cards} investments={investments} accounts={accounts} strategy={draft.strategy} firstPay={firstPay}
                  onChange={(patch) => update(a.id, patch)} onRemove={() => remove(a.id)} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Theory vs. main plan">
          {sameAsMain ? (
            <p className="muted">This matches your main plan. Change the monthly payment or add an extra payment to see the difference.</p>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              <CompareRow label="Debt-free" main={fin(mainPlan) ? monthsFromNow(mainPlan.months) : 'Never'} theory={fin(theory) ? monthsFromNow(theory.months) : 'Never'}
                delta={monthsSooner == null ? null : monthsSooner > 0 ? `${duration(monthsSooner)} sooner` : monthsSooner < 0 ? `${duration(-monthsSooner)} later` : 'same month'} good={monthsSooner > 0} />
              <CompareRow label="Total interest" main={money0(mainPlan.totalInterest)} theory={money0(theory.totalInterest)}
                delta={Math.abs(interestSaved) < 1 ? 'no change' : interestSaved > 0 ? `${money0(interestSaved)} less` : `${money0(-interestSaved)} more`} good={interestSaved > 0} />
              <CompareRow label="Total paid" main={money0(mainPlan.totalPaid)} theory={money0(theory.totalPaid)} />
              {perDollar != null && interestSaved > 1 && (
                <p className="info-box">Each extra dollar you put in saves about <b>{money(perDollar)}</b> in interest.</p>
              )}
            </div>
          )}
        </Card>
      </div>

      <div className="grid g-4 mt">
        <Stat icon={CalendarCheck} label="Theory: debt-free" value={fin(theory) ? monthsFromNow(theory.months) : '—'} sub={duration(theory.months)} />
        <Stat icon={Flame} label="Theory: interest" value={money0(theory.totalInterest)} sub={<>Main plan {money0(mainPlan.totalInterest)}</>} />
        <Stat icon={Coins} label="Extra payments in theory" value={money0(extraTheory)} sub={`${draft.adjustments.length} extra payment${draft.adjustments.length === 1 ? '' : 's'}`} />
        <Stat icon={Sparkles} label="Interest saved vs. main" value={<span className={interestSaved > 0 ? 'pos' : ''}>{money0(Math.max(0, interestSaved))}</span>}
          sub={monthsSooner > 0 ? `Debt-free ${duration(monthsSooner)} sooner` : 'Add extra payments to see savings'} />
      </div>

      {hasWithdrawals && withoutWithdrawals && (
        <InvestmentImpact accounts={accounts} draft={draft} theory={theory} without={withoutWithdrawals} colors={c} />
      )}

      <Card className="mt" title="Total balance: theory vs. main plan" action={<Legend items={[{ label: 'Theory', color: c.series[0] }, { label: 'Main plan', color: c.muted }]} />}
        subtitle={lumpMonths.length ? 'Dotted lines mark lump-sum and bonus months.' : undefined}>
        <div className="chart-box">
          <ResponsiveContainer>
            <LineChart data={chart}>
              <CartesianGrid vertical={false} stroke={c.grid} />
              <XAxis dataKey="month" {...axisProps(c)} ticks={monthTicks(len)} tickFormatter={tickLabel} />
              <YAxis tickFormatter={moneyCompact} width={56} {...axisProps(c)} axisLine={false} />
              <Tooltip content={<ChartTooltip labelFormatter={(m) => `${monthsFromNow(m)} (month ${m})`} />} />
              {lumpMonths.map((m) => <ReferenceLine key={m} x={m} stroke={c.series[2]} strokeDasharray="3 3" />)}
              <Line type="monotone" dataKey="main" name="Main plan" stroke={c.muted} strokeWidth={2} strokeDasharray="5 4" dot={false} />
              <Line type="monotone" dataKey="theory" name="Theory" stroke={c.series[0]} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="mt flush" title="When each debt is paid off">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Debt</th><th className="amount">Balance</th><th className="amount">APR</th><th>Main plan</th><th>Theory</th><th>Change</th></tr></thead>
            <tbody>
              {cards.map((a) => {
                const m = mainPlan.debts.find((d) => d.id === a.id)?.paidOffMonth;
                const t = theory.debts.find((d) => d.id === a.id)?.paidOffMonth;
                const diff = m && t ? m - t : null;
                return (
                  <tr key={a.id}>
                    <td><b>{a.name}</b></td>
                    <td className="amount">{money(a.balance)}</td>
                    <td className="amount">{a.apr || 0}%</td>
                    <td>{m ? monthsFromNow(m) : '—'}</td>
                    <td>{t ? monthsFromNow(t) : '—'}</td>
                    <td>{diff == null ? '—' : diff > 0 ? <span className="pos">{duration(diff)} sooner</span> : diff < 0 ? <span className="bad">{duration(-diff)} later</span> : <span className="faint">same</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <PayoffSchedule plan={theory} cards={cards} title="Theory month by month" />

      <Modal open={applying} onClose={() => setApplying(false)} title="Apply theory to your main plan?"
        footer={<>
          <button className="btn" onClick={() => setApplying(false)}>Cancel</button>
          <button className="btn primary" onClick={apply}><CheckCircle2 size={16} /> Apply to main plan</button>
        </>}>
        <div className="stack" style={{ gap: 12 }}>
          <p>Your main plan will become <b>{draft.name || 'this theory'}</b>:</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>{money0(draft.budget)}/month toward debts, {draft.strategy} strategy{draft.budget !== main.budget ? ` (was ${money0(main.budget)})` : ''}</li>
            {cleanDraft.adjustments.map((a) => <li key={a.id}>{describeAdjustment(a, cardName, accounts)}</li>)}
            {!cleanDraft.adjustments.length && <li>No extra payments</li>}
          </ul>
          <p className="muted">
            Debt-free {fin(theory) ? monthsFromNow(theory.months) : '—'}
            {monthsSooner > 0 && <> ({duration(monthsSooner)} sooner)</>}, {money0(theory.totalInterest)} interest.
          </p>
          <PlanningOnlyNotice />
        </div>
      </Modal>
    </>
  );
}

function CompareRow({ label, main, theory, delta, good }) {
  return (
    <div>
      <div className="faint">{label}</div>
      <div className="spread" style={{ alignItems: 'baseline' }}>
        <span><span className="muted">{main}</span> → <b>{theory}</b></span>
        {delta && <span className={good ? 'pos' : 'faint'} style={{ fontWeight: 600, fontSize: 13 }}>{delta}</span>}
      </div>
    </div>
  );
}


/** One extra payment: bonus, raise, lump sum or monthly increase. */
function ExtraEditor({ a, debts, investments, accounts, strategy, firstPay, onChange, onRemove }) {
  const kind = kindOfAdjustment(a);
  if (kind === 'withdraw') return <WithdrawEditor a={a} debts={debts} investments={investments} accounts={accounts} strategy={strategy} firstPay={firstPay} onChange={onChange} onRemove={onRemove} />;
  const meta = EXTRA_KINDS.find((k) => k.value === kind) || EXTRA_KINDS[2];
  const lump = a.type === 'lump';
  const repeating = lump && a.repeat && a.repeat !== 'none';
  const pct = a.percent == null || a.percent === '' ? 100 : a.percent;
  const setKind = (value) => {
    const k = EXTRA_KINDS.find((x) => x.value === value);
    onChange({ source: value, type: k.type, fromAccount: null, ...(k.type === 'lump' ? { repeat: value === 'bonus' ? 'yearly' : 'none', endMonth: null } : { target: null, repeat: 'none' }) });
  };
  return (
    <div className="extra-row">
      <div className="field">
        <label>Type</label>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {EXTRA_KINDS.filter((k) => k.value !== 'withdraw').map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label>{lump ? 'Amount' : 'Extra per month'}</label>
        <input type="number" min="0" step="10" value={a.amount} onChange={(e) => onChange({ amount: e.target.value === '' ? '' : Number(e.target.value) })} style={{ width: 110 }} />
      </div>
      <div className="field">
        <label>% toward debt</label>
        <input type="number" min="0" max="100" step="5" value={pct} onChange={(e) => onChange({ percent: e.target.value === '' ? '' : Number(e.target.value) })} style={{ width: 80 }} />
      </div>
      <div className="field">
        <label>{lump && !repeating ? 'Month' : 'Starting'}</label>
        <input type="month" value={a.month} min={firstPay} onChange={(e) => e.target.value && onChange({ month: e.target.value })} />
      </div>
      {lump && (
        <div className="field">
          <label>Repeats</label>
          <select value={a.repeat || 'none'} onChange={(e) => onChange({ repeat: e.target.value, endMonth: e.target.value === 'none' ? null : a.endMonth })}>
            {REPEATS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
      )}
      {(!lump || repeating) && (
        <div className="field">
          <label>Until <span className="faint">(optional)</span></label>
          <input type="month" value={a.endMonth || ''} min={a.month} onChange={(e) => onChange({ endMonth: e.target.value || null })} />
        </div>
      )}
      {lump && (
        <div className="field">
          <label>Goes to</label>
          <select value={a.target || ''} onChange={(e) => onChange({ target: e.target.value || null })} style={{ maxWidth: 200 }}>
            <option value="">Focus debt ({strategy})</option>
            {debts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      )}
      <button className="btn ghost icon sm" aria-label="Remove" title="Remove" onClick={onRemove} style={{ alignSelf: 'flex-end', marginBottom: 3 }}><Trash2 size={14} /></button>
      <div className="extra-note faint">
        {meta.hint}{' '}
        {Number(a.amount) > 0 && pct < 100 && <b>{`$${towardDebt(a).toLocaleString('en-US', { maximumFractionDigits: 2 })}${lump ? '' : '/mo'} goes to debt.`}</b>}
        {a.month < firstPay && <span className="bad"> {lump && !repeating ? 'This month is in the past, so it’s ignored.' : 'Already started; counted from next month.'}</span>}
      </div>
    </div>
  );
}

function WithdrawEditor({ a, debts, investments, accounts, strategy, firstPay, onChange, onRemove }) {
  const w = withdrawalInfo(a, accounts);
  const fmt = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
  return (
    <div className="extra-row">
      <div className="field">
        <label>Type</label>
        <select value="withdraw" disabled><option value="withdraw">Investment withdrawal</option></select>
      </div>
      <div className="field">
        <label>From</label>
        <select value={a.fromAccount || ''} onChange={(e) => onChange({ fromAccount: e.target.value })} style={{ maxWidth: 200 }}>
          {!w && <option value="">Choose an account</option>}
          {investments.map((acct) => <option key={acct.id} value={acct.id}>{acct.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Amount withdrawn</label>
        <input type="number" min="0" step="100" value={a.amount} onChange={(e) => onChange({ amount: e.target.value === '' ? '' : Number(e.target.value) })} style={{ width: 120 }} />
      </div>
      <div className="field">
        <label>Month</label>
        <input type="month" value={a.month} min={firstPay} onChange={(e) => e.target.value && onChange({ month: e.target.value })} />
      </div>
      <div className="field">
        <label>Goes to</label>
        <select value={a.target || ''} onChange={(e) => onChange({ target: e.target.value || null })} style={{ maxWidth: 200 }}>
          <option value="">Focus debt ({strategy})</option>
          {debts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <button className="btn ghost icon sm" aria-label="Remove" title="Remove" onClick={onRemove} style={{ alignSelf: 'flex-end', marginBottom: 3 }}><Trash2 size={14} /></button>
      <div className="extra-note faint">
        {w ? (
          <>
            {w.gross < Number(a.amount) && <span className="bad">Only {fmt(w.gross)} is in this account. </span>}
            {w.costPct
              ? <>About <b>{fmt(w.cost)}</b> goes to tax & penalties ({w.costPct}%), leaving <b>{fmt(w.net)}</b> for debt. </>
              : <>No tax & penalty rate is set on this account (edit it on Accounts), so all {fmt(w.net)} goes to debt. </>}
            The account loses the full {fmt(w.gross)} and its future growth.
          </>
        ) : 'Pick the investment account this money comes from.'}
        {a.month < firstPay && <span className="bad"> This month is in the past, so it’s ignored.</span>}
      </div>
    </div>
  );
}

/** Debt saved vs. investment growth given up, for the theory's withdrawals. */
function InvestmentImpact({ accounts, draft, theory, without, colors: c }) {
  const [reinvest, setReinvest] = useState(true);
  const withExtras = toSimExtras(draft.adjustments, undefined, undefined, accounts);
  const withoutExtras = withExtras.filter((x) => !x.withdraw);
  const withdrawals = draft.adjustments.filter((a) => a.source === 'withdraw').map((a) => withdrawalInfo(a, accounts)).filter(Boolean);
  const gross = withdrawals.reduce((s, w) => s + w.gross, 0);
  const cost = withdrawals.reduce((s, w) => s + w.cost, 0);
  const net = gross - cost;
  const fin = (p) => Number.isFinite(p.months);
  // Compare once both versions are debt-free (at least a year out).
  const horizon = fin(theory) && fin(without) ? Math.min(600, Math.max(theory.months, without.months, 12)) : 360;
  const intoId = withdrawals[0]?.account.id;
  const pWith = projectInvestments({ accounts, plan: theory, budget: draft.budget, extras: withExtras, horizon, reinvest, intoId });
  const pWithout = projectInvestments({ accounts, plan: without, budget: draft.budget, extras: withoutExtras, horizon, reinvest, intoId });
  const interestSaved = without.totalInterest - theory.totalInterest;
  const sooner = fin(theory) && fin(without) ? without.months - theory.months : null;
  const investDiff = pWith.total - pWithout.total;
  // With reinvesting, the interest saved already shows up as earlier contributions.
  const netEffect = reinvest ? investDiff : interestSaved + investDiff;
  const ahead = netEffect >= 0;
  const chart = pWith.series.map((r, i) => ({ month: r.month, with: r.total, without: pWithout.series[i]?.total ?? null }));

  return (
    <Card className="mt" title="Investment impact" subtitle="Using investments to pay debt: the interest you save against the growth you give up.">
      <div className="grid g-2" style={{ gap: 20 }}>
        <div className="stack" style={{ gap: 10 }}>
          <div className="spread"><span className="muted">Withdrawn from investments</span><b>{money(gross)}</b></div>
          <div className="spread"><span className="muted">Tax & penalties</span><b className="bad">−{money(cost)}</b></div>
          <div className="spread"><span className="muted">Put toward debt</span><b>{money(net)}</b></div>
          <div className="spread"><span className="muted">Interest saved on debt</span><b className="pos">{money(interestSaved)}</b></div>
          <div className="spread"><span className="muted">Debt-free</span><b>{sooner == null ? '—' : sooner > 0 ? `${duration(sooner)} sooner` : 'no change'}</b></div>
          <div className="spread"><span className="muted">Investments by {monthsFromNow(horizon)}</span>
            <span><span className="muted">{money0(pWithout.total)} without</span> → <b>{money0(pWith.total)}</b> with</span>
          </div>
          <div className={ahead ? 'info-box' : 'warn-box'}>
            {ahead ? <>By {monthsFromNow(horizon)}, withdrawing comes out about <b>{money0(netEffect)} ahead</b>.</>
              : <>By {monthsFromNow(horizon)}, withdrawing leaves you about <b>{money0(-netEffect)} behind</b>, because the growth and tax cost outweigh the interest saved.</>}
          </div>
          <label className="row" style={{ gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={reinvest} onChange={(e) => setReinvest(e.target.checked)} />
            After you’re debt-free, assume the money you were paying toward debt gets invested
          </label>
        </div>
        <div>
          <div className="chart-box sm">
            <ResponsiveContainer>
              <LineChart data={chart}>
                <CartesianGrid vertical={false} stroke={c.grid} />
                <XAxis dataKey="month" {...axisProps(c)} ticks={monthTicks(horizon)} tickFormatter={tickLabel} />
                <YAxis tickFormatter={moneyCompact} width={56} {...axisProps(c)} axisLine={false} />
                <Tooltip content={<ChartTooltip labelFormatter={(m) => monthsFromNow(m)} />} />
                <Line type="monotone" dataKey="without" name="Investments without withdrawal" stroke={c.muted} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                <Line type="monotone" dataKey="with" name="Investments with withdrawal" stroke={c.series[2]} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: 'With withdrawal', color: c.series[2] }, { label: 'Without', color: c.muted }]} />
        </div>
      </div>
      <p className="faint mt">
        Investment returns aren’t guaranteed and can be negative. Retirement accounts also lose tax-advantaged growth that is hard to rebuild,
        and money in them may be protected in ways cash isn’t. Keep an emergency fund. This is an estimate to help you think it through, not financial or tax advice.
      </p>
    </Card>
  );
}
