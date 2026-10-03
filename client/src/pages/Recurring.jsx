import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Repeat, CalendarX2, Check, EyeOff, TrendingUp, RotateCcw, AlertTriangle, PiggyBank } from 'lucide-react';
import { useData } from '../DataContext.jsx';
import { PageHead, Card, Stat, Empty, Segmented, KindBadge, Modal } from '../components/ui.jsx';
import { axisProps } from '../components/charts.jsx';
import { useChartColors } from '../lib/theme.js';
import { detectRecurring, projectPlannedSavings, plannedStopMonth } from '../lib/analytics.js';
import { money, money0, moneyCompact, longDate, shortDate, monthLabel, monthShort, currentMonth } from '../lib/format.js';

/** Shown wherever "cancel" appears: Vault Book plans, it never cancels anything. */
export function NotACancellationNotice({ compact }) {
  return (
    <div className="warn-box row" role="note" style={{ gap: 10, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
      <AlertTriangle size={18} style={{ flex: 'none', marginTop: 1 }} />
      <div>
        <b>Vault Book does not cancel anything.</b>{' '}
        {compact
          ? 'Planning to cancel only estimates your savings. You must cancel each charge yourself with the company.'
          : <>Marking a charge <i>Plan to cancel</i> only records your plan so you can see how much you’d save and when. It does not contact the company, your bank or your card issuer, and the charge will keep happening until <b>you</b> cancel it directly with the company (their website, app or phone line). Afterwards, check your next statement to confirm it stopped.</>}
      </div>
    </div>
  );
}

export default function Recurring() {
  const { data, mutate, notify, categoriesById, accountsById } = useData();
  const c = useChartColors();
  const [view, setView] = useState('review');
  const [planning, setPlanning] = useState(null); // recurring item being added to the plan
  const all = useMemo(() => detectRecurring(data.transactions, data.categories), [data.transactions, data.categories]);
  const plan = (r) => data.recurring[r.key];
  const status = (r) => plan(r)?.status;

  const active = all.filter((r) => r.active && status(r) !== 'ignore');
  const planned = active.filter((r) => status(r) === 'cancel');
  const wantsActive = active.filter((r) => r.kind === 'want');
  const lists = {
    review: active.filter((r) => !status(r)),
    cancel: planned,
    keep: active.filter((r) => status(r) === 'keep'),
    inactive: all.filter((r) => !r.active || status(r) === 'ignore'),
  };
  const list = lists[view];

  const savings = useMemo(
    () => projectPlannedSavings(planned.map((r) => ({ item: r, stopMonth: plannedStopMonth(r, plan(r)) }))),
    [planned, data.recurring], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const savings12 = savings.reduce((s, m) => s + m.total, 0);
  const firstSavingMonth = savings.find((m) => m.total > 0)?.key;

  const setStatus = (r, s, extra = {}, msg) =>
    mutate(`/recurring/${encodeURIComponent(r.key)}`, { method: 'PUT', body: { status: s, ...extra } }, msg);

  return (
    <>
      <PageHead title="Recurring charges" subtitle="Subscriptions and bills found by looking for charges that repeat on a schedule. Use this to plan which ones to stop and see what you’d save." />
      <NotACancellationNotice />

      <div className="grid g-4 mt">
        <Stat icon={Repeat} label="Active recurring" value={`${money0(active.reduce((s, r) => s + r.monthly, 0))}/mo`} sub={`${active.length} charges · ${money0(active.reduce((s, r) => s + r.yearly, 0))} per year`} />
        <Stat icon={TrendingUp} label="Non-essential (wants)" value={`${money0(wantsActive.reduce((s, r) => s + r.monthly, 0))}/mo`} sub={`${wantsActive.length} charges worth reviewing`} />
        <Stat icon={CalendarX2} label="Planned cancellations" value={<span className="pos">{money0(planned.reduce((s, r) => s + r.monthly, 0))}/mo</span>}
          sub={planned.length ? `${planned.length} planned · ~${money0(planned.reduce((s, r) => s + r.yearly, 0))}/yr once you cancel them` : 'Nothing planned yet'} />
        <Stat icon={PiggyBank} label="Planned savings, next 12 months" value={<span className="pos">{money0(savings12)}</span>}
          sub={firstSavingMonth ? `Starting ${monthLabel(firstSavingMonth, 'long')}, if cancelled on time` : 'Plan a cancellation to see this'} />
      </div>

      {planned.length > 0 && (
        <Card className="mt" title="Planned savings by month"
          subtitle="Money you’d keep each month if you cancel the planned charges yourself by their stop month. Charges are placed on their real billing schedule.">
          <div className="chart-box sm">
            <ResponsiveContainer>
              <BarChart data={savings} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke={c.grid} />
                <XAxis dataKey="key" tickFormatter={monthShort} {...axisProps(c)} />
                <YAxis tickFormatter={moneyCompact} width={56} {...axisProps(c)} axisLine={false} />
                <Tooltip cursor={{ fill: c.grid, opacity: 0.5 }} content={<SavingsTooltip />} />
                <Bar dataKey="total" name="Planned savings" fill={c.series[0]} radius={[4, 4, 0, 0]} maxBarSize={34} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <Card className="mt flush">
        <div className="spread" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <Segmented label="Filter" value={view} onChange={setView} options={[
            { value: 'review', label: `To review (${lists.review.length})` },
            { value: 'cancel', label: `Planning to cancel (${lists.cancel.length})` },
            { value: 'keep', label: `Keeping (${lists.keep.length})` },
            { value: 'inactive', label: `Ended / hidden (${lists.inactive.length})` },
          ]} />
          {view === 'cancel' && planned.length > 0 && (
            <span className="faint">Cancel each one yourself with the company. Once it stops showing up on your statements it will move to “Ended”.</span>
          )}
        </div>
        {!list.length ? (
          <Empty icon={Repeat} title={all.length ? 'Nothing here' : 'No recurring charges found yet'}>
            {all.length ? 'Nothing in this list right now.' : 'Import at least 2–3 months of statements so repeating charges can be detected.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Merchant</th><th>Category</th><th>How often</th><th className="amount">Amount</th><th className="amount">Per year</th>
                <th>{view === 'cancel' ? 'Plan to stop by' : 'Last / next'}</th><th />
              </tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <b>{r.name}</b>
                      <div className="faint ellipsis" style={{ maxWidth: 280 }} title={r.description}>{accountsById.get(r.accountId)?.name} · {r.count} charges since {shortDate(r.first)}</div>
                    </td>
                    <td><span className="row" style={{ gap: 6, flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>{categoriesById.get(r.category)?.name || 'Uncategorized'} <KindBadge kind={r.kind} /></span></td>
                    <td>{r.frequencyLabel}{r.confidence < 0.6 && <div className="faint">possible</div>}</td>
                    <td className="amount">
                      {money(r.amount)}
                      {r.priceChanged && <div><span className="badge warn" title={`Last charge was ${money(r.lastAmount)}`}>Changed: {money(r.lastAmount)}</span></div>}
                    </td>
                    <td className="amount"><b>{money0(r.yearly)}</b></td>
                    {view === 'cancel' ? (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <input type="month" value={plannedStopMonth(r, plan(r))} min={currentMonth()} aria-label={`Plan to stop ${r.name} by`}
                          onChange={(e) => e.target.value && setStatus(r, 'cancel', { stopMonth: e.target.value })} style={{ height: 30 }} />
                        <div className="faint">Next charge ~{shortDate(r.next)}</div>
                      </td>
                    ) : (
                      <td className="faint" style={{ whiteSpace: 'nowrap' }}>{longDate(r.last)}<br />{r.active ? `next ~${shortDate(r.next)}` : 'not seen recently'}</td>
                    )}
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {status(r) !== 'cancel' && <button className="btn sm" onClick={() => setPlanning(r)}><CalendarX2 size={14} /> Plan to cancel</button>}{' '}
                      {status(r) !== 'keep' && <button className="btn sm ghost" onClick={() => setStatus(r, 'keep')}><Check size={14} /> Keep</button>}
                      {status(r) !== 'ignore' && <button className="btn sm ghost icon" title="Not a recurring charge — hide" aria-label="Hide" onClick={() => setStatus(r, 'ignore')}><EyeOff size={14} /></button>}
                      {status(r) && <button className="btn sm ghost icon" title="Remove from plan / reset" aria-label="Reset" onClick={() => setStatus(r, null)}><RotateCcw size={14} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <PlanCancelModal item={planning} onClose={() => setPlanning(null)} onConfirm={async (r, stopMonth) => {
        setPlanning(null);
        await setStatus(r, 'cancel', { stopMonth });
        notify(`${r.name} added to your plan. Remember to cancel it with the company.`);
      }} />
    </>
  );
}

function SavingsTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="tooltip">
      <div className="t-title">{monthLabel(label, 'long')}</div>
      {row.items.length ? row.items.map((it, i) => (
        <div className="t-row" key={`${it.key}-${i}`}><span>{it.name}</span><b>{money(it.amount)}</b></div>
      )) : <div className="t-row"><span>No planned charges this month</span></div>}
      {row.items.length > 1 && <div className="t-row" style={{ marginTop: 4 }}><span>Total</span><b>{money(row.total)}</b></div>}
    </div>
  );
}

function PlanCancelModal({ item, onClose, onConfirm }) {
  const [stopMonth, setStopMonth] = useState('');
  const open = !!item;
  const month = stopMonth || (item ? item.next.slice(0, 7) : '');
  const close = () => { setStopMonth(''); onClose(); };
  return (
    <Modal open={open} onClose={close} title="Plan to cancel"
      footer={<>
        <button className="btn" onClick={close}>Back</button>
        <button className="btn primary" onClick={() => { setStopMonth(''); onConfirm(item, month); }}><CalendarX2 size={16} /> Add to my plan</button>
      </>}>
      {item && (
        <div className="stack" style={{ gap: 14 }}>
          <p><b>{item.name}</b>: {money(item.amount)} {item.frequencyLabel.toLowerCase()} (~{money0(item.yearly)} a year)</p>
          <NotACancellationNotice compact />
          <p className="muted">To actually stop this charge, cancel it with {item.name} directly. Vault Book can’t do that for you.</p>
          <div className="field">
            <label htmlFor="stop-month">I plan to have it cancelled by</label>
            <input id="stop-month" type="month" value={month} min={currentMonth()} onChange={(e) => setStopMonth(e.target.value)} data-autofocus style={{ maxWidth: 200 }} />
            <span className="hint">Its next charge is expected around {longDate(item.next)}. Savings are counted from this month on.</span>
          </div>
        </div>
      )}
    </Modal>
  );
}
