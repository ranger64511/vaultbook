import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Target, CalendarCheck, Flame, PiggyBank, AlertTriangle, Info } from 'lucide-react';
import { useData } from '../DataContext.jsx';
import { PageHead, Card, Stat, Empty, Segmented } from '../components/ui.jsx';
import { ChartTooltip, Legend, axisProps } from '../components/charts.jsx';
import { useChartColors } from '../lib/theme.js';
import { simulatePayoff, detectRecurring, summarize, defaultMinPayment } from '../lib/analytics.js';
import { money, money0, moneyCompact, monthsFromNow, monthLabel, addMonths, currentMonth } from '../lib/format.js';
import MonthPicker from '../components/MonthPicker.jsx';

const monthsBetween = (a, b) => (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));

const duration = (m) => {
  if (!Number.isFinite(m)) return 'Never at this rate';
  const y = Math.floor(m / 12), r = m % 12;
  return [y && `${y} yr${y > 1 ? 's' : ''}`, r && `${r} mo`].filter(Boolean).join(' ') || '0 mo';
};

const monthTicks = (len) => {
  const step = len <= 12 ? 2 : len <= 36 ? 6 : len <= 120 ? 12 : 24;
  return Array.from({ length: Math.floor(len / step) + 1 }, (_, i) => i * step);
};
const tickLabel = (m) => (m === 0 ? "Now" : m % 12 === 0 ? `${m / 12}y` : `${m}mo`);

export default function Payoff() {
  const { data, mutate } = useData();
  const c = useChartColors();
  const cards = data.accounts.filter((a) => a.type === 'credit' && a.balance > 0);
  const debts = cards.map((a) => ({ id: a.id, name: a.name, balance: a.balance, apr: a.apr || 0, minPayment: a.minPayment || 0 }));
  const minTotal = debts.reduce((s, d) => s + (d.minPayment || defaultMinPayment(d.balance, d.apr)), 0);

  const [budget, setBudget] = useState(() => data.settings.payoffBudget || Math.ceil((minTotal * 1.5) / 10) * 10);
  const [strategy, setStrategy] = useState(data.settings.payoffStrategy || 'avalanche');
  const [viewMonth, setViewMonth] = useState(null); // month shown in the month-by-month plan
  // Persist the user's choices (debounced).
  useEffect(() => {
    if (budget === data.settings.payoffBudget && strategy === data.settings.payoffStrategy) return;
    const t = setTimeout(() => mutate('/settings', { method: 'PUT', body: { payoffBudget: budget, payoffStrategy: strategy } }), 600);
    return () => clearTimeout(t);
  }, [budget, strategy]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = useMemo(() => simulatePayoff(debts, budget, strategy), [JSON.stringify(debts), budget, strategy]); // eslint-disable-line
  const minOnly = useMemo(() => simulatePayoff(debts, 0, 'minimum'), [JSON.stringify(debts)]); // eslint-disable-line
  const other = useMemo(() => simulatePayoff(debts, budget, strategy === 'avalanche' ? 'snowball' : 'avalanche'), [JSON.stringify(debts), budget, strategy]); // eslint-disable-line

  // Money that could be redirected to cards.
  const cancelSavings = useMemo(() => detectRecurring(data.transactions, data.categories)
    .filter((r) => r.active && data.recurring[r.key]?.status === 'cancel').reduce((s, r) => s + r.monthly, 0), [data]);
  const avgWants = useMemo(() => {
    const months = [...new Set(data.transactions.map((t) => t.date.slice(0, 7)))].sort().slice(-3);
    if (!months.length) return 0;
    return summarize(data.transactions.filter((t) => months.some((m) => t.date.startsWith(m))), data.categories).wants / months.length;
  }, [data.transactions, data.categories]);

  // Payment month i of the plan is i months from now; month 0 is the starting balance.
  const thisMonth = currentMonth();
  const lastIdx = Math.max(1, plan.schedule.length - 1);
  const firstPay = addMonths(thisMonth, 1);
  const lastPay = addMonths(thisMonth, lastIdx);
  const shown = viewMonth && viewMonth >= firstPay ? (viewMonth > lastPay ? lastPay : viewMonth) : firstPay;
  const shownIdx = monthsBetween(thisMonth, shown);
  const selectedRow = plan.schedule[shownIdx];

  if (!cards.length) {
    return (
      <>
        <PageHead title="Debt payoff plan" />
        <Card><Empty icon={Target} title="No credit card balances" action={<Link className="btn primary" to="/accounts">Manage accounts</Link>}>
          Add your credit cards with their current balance, APR and minimum payment to build a payoff plan. Importing a PDF statement fills these in automatically.
        </Empty></Card>
      </>
    );
  }

  const missingApr = cards.filter((a) => !a.apr);
  const tooLow = budget < minTotal - 0.005;
  const horizon = Math.min(Math.max(Number.isFinite(plan.months) ? plan.months : 120, 6), 360);
  const minHorizon = Number.isFinite(minOnly.months) ? Math.min(minOnly.months, 360) : 360;
  const chartLen = Math.max(horizon, Math.min(minHorizon, horizon * 3));
  const compare = Array.from({ length: chartLen + 1 }, (_, i) => ({
    month: i,
    plan: plan.schedule[i]?.total ?? 0,
    minimum: minOnly.schedule[i]?.total ?? (Number.isFinite(minOnly.months) ? 0 : null),
  }));
  const ordered = plan.order.map((id) => plan.debts.find((d) => d.id === id));
  const colorOf = (id) => c.series[cards.findIndex((a) => a.id === id) % 8];

  const boosts = [
    cancelSavings > 1 && { label: `Redirect planned cancellations once you’ve cancelled them (+${money0(cancelSavings)}/mo)`, extra: cancelSavings },
    avgWants > 20 && { label: `Cut “wants” spending by 25% (+${money0(avgWants * 0.25)}/mo)`, extra: avgWants * 0.25 },
    { label: '+$100/month', extra: 100 },
    { label: '+$250/month', extra: 250 },
  ].filter(Boolean).map((b) => ({ ...b, sim: simulatePayoff(debts, budget + b.extra, strategy) }));

  return (
    <>
      <PageHead title="Debt payoff plan" subtitle="See how fast your cards reach $0 and what each extra dollar saves." />

      <Card>
        <div className="row" style={{ gap: 24, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 320px' }}>
            <label htmlFor="budget">Total paid toward cards each month</label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input id="budget-range" type="range" min={Math.floor(minTotal)} max={Math.max(Math.ceil(minTotal * 5), 1000)} step="10" value={budget}
                onChange={(e) => setBudget(Number(e.target.value))} style={{ flex: 1, height: 'auto', padding: 0, border: 0 }} aria-label="Monthly payment slider" />
              <input id="budget" type="number" min="0" step="10" value={budget} onChange={(e) => setBudget(Number(e.target.value) || 0)} style={{ width: 110 }} />
            </div>
            <span className="hint">Minimum payments add up to {money(minTotal)}/mo</span>
          </div>
          <div className="field">
            <label>Strategy</label>
            <Segmented label="Strategy" value={strategy} onChange={setStrategy} options={[{ value: 'avalanche', label: 'Avalanche' }, { value: 'snowball', label: 'Snowball' }]} />
          </div>
        </div>
        <p className="faint" style={{ marginTop: 12 }}>
          <b>Avalanche</b> pays highest-APR cards first (least interest). <b>Snowball</b> pays smallest balances first (quick wins).
          Minimums are always paid on every card; the rest goes to the focus card, and freed-up minimums roll over.
        </p>
        {tooLow && <div className="error-box mt"><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> This is less than your combined minimum payments ({money(minTotal)}). Missing minimums causes late fees and credit damage.</div>}
        {missingApr.length > 0 && <div className="warn-box mt">Add the APR for {missingApr.map((a) => a.name).join(', ')} on the <Link to="/accounts">Accounts</Link> page for an accurate plan (currently assumed 0%).</div>}
      </Card>

      <div className="grid g-4 mt">
        <Stat icon={CalendarCheck} label="Debt-free" value={Number.isFinite(plan.months) ? monthsFromNow(plan.months) : '—'} sub={duration(plan.months)} />
        <Stat icon={Flame} label="Interest you’ll pay" value={money0(plan.totalInterest)} sub={`${money0(plan.totalPaid)} paid in total`} />
        <Stat icon={PiggyBank} label="Saved vs. minimums only" value={<span className="pos">{Number.isFinite(minOnly.months) ? money0(minOnly.totalInterest - plan.totalInterest) : 'A lot'}</span>}
          sub={`Minimums only: ${duration(minOnly.months)}, ${money0(minOnly.totalInterest)} interest`} />
        <Stat icon={Target} label={strategy === 'avalanche' ? 'vs. Snowball' : 'vs. Avalanche'}
          value={`${other.totalInterest - plan.totalInterest >= 0 ? '' : '+'}${money0(Math.abs(other.totalInterest - plan.totalInterest))}`}
          sub={other.totalInterest - plan.totalInterest >= 0 ? `less interest with ${strategy}` : `more interest than ${strategy === 'avalanche' ? 'snowball' : 'avalanche'}`} />
      </div>

      <div className="grid g-2 mt">
        <Card title="Total balance over time" action={<Legend items={[{ label: 'Your plan', color: c.series[0] }, { label: 'Minimums only', color: c.muted }]} />}>
          <div className="chart-box">
            <ResponsiveContainer>
              <LineChart data={compare}>
                <CartesianGrid vertical={false} stroke={c.grid} />
                <XAxis dataKey="month" {...axisProps(c)} ticks={monthTicks(chartLen)} tickFormatter={tickLabel} />
                <YAxis tickFormatter={moneyCompact} width={56} {...axisProps(c)} axisLine={false} />
                <Tooltip content={<ChartTooltip labelFormatter={(m) => `${monthsFromNow(m)} (month ${m})`} />} />
                <Line type="monotone" dataKey="minimum" name="Minimums only" stroke={c.muted} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                <Line type="monotone" dataKey="plan" name="Your plan" stroke={c.series[0]} strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Balance by card" action={<Legend items={cards.slice(0, 8).map((a) => ({ label: a.name, color: colorOf(a.id) }))} />}>
          <div className="chart-box">
            <ResponsiveContainer>
              <AreaChart data={plan.schedule.slice(0, horizon + 1)}>
                <CartesianGrid vertical={false} stroke={c.grid} />
                <XAxis dataKey="month" {...axisProps(c)} ticks={monthTicks(horizon)} tickFormatter={tickLabel} />
                <YAxis tickFormatter={moneyCompact} width={56} {...axisProps(c)} axisLine={false} />
                <Tooltip content={<ChartTooltip hideZero labelFormatter={(m) => monthsFromNow(m)} />} />
                {cards.map((a) => (
                  <Area key={a.id} type="monotone" dataKey={a.id} name={a.name} stackId="1" stroke={c.surface} strokeWidth={1.5} fill={colorOf(a.id)} fillOpacity={0.9} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid g-3-1 mt">
        <Card className="flush" title="Payoff order" subtitle="Focus extra money on the top card until it’s gone, then move down the list.">
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Card</th><th className="amount">Balance</th><th className="amount">APR</th><th className="amount">Minimum</th><th className="amount">Interest</th><th>Paid off</th></tr></thead>
              <tbody>
                {ordered.map((d, i) => (
                  <tr key={d.id}>
                    <td><span className="badge">{i + 1}</span></td>
                    <td><span className="row" style={{ gap: 8, flexWrap: "nowrap", whiteSpace: "nowrap" }}><span className="swatch" style={{ background: colorOf(d.id) }} /><b>{d.name}</b></span></td>
                    <td className="amount">{money(d.startBalance)}</td>
                    <td className="amount">{d.apr}%</td>
                    <td className="amount">{money(d.min)}</td>
                    <td className="amount">{money0(d.interest)}</td>
                    <td>{d.paidOffMonth ? <>{monthsFromNow(d.paidOffMonth)} <span className="faint">· {duration(d.paidOffMonth)}</span></> : <span className="badge bad">Not paid off</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Speed it up" subtitle="What extra money each month would do">
          {boosts.map((b) => (
            <div key={b.label} className="list-row" style={{ display: 'block' }}>
              <div style={{ fontWeight: 550, fontSize: 13.5 }}>{b.label}</div>
              <div className="faint">
                Debt-free {Number.isFinite(b.sim.months) ? monthsFromNow(b.sim.months) : '—'}
                {Number.isFinite(plan.months) && Number.isFinite(b.sim.months) && <> · <span className="pos">{plan.months - b.sim.months} months sooner</span></>}
                {' · '}saves <span className="pos">{money0(plan.totalInterest - b.sim.totalInterest)}</span> interest
              </div>
            </div>
          ))}
          <button className="btn sm mt" onClick={() => setBudget(Math.round(budget + cancelSavings + avgWants * 0.25))}>Apply the first two</button>
        </Card>
      </div>

      <Card className="mt flush" title="Month-by-month plan" subtitle={`What to pay on each card, 12 months starting ${monthLabel(shown, 'long')}`}
        action={<MonthPicker value={shown} onChange={setViewMonth} min={firstPay} max={lastPay} />}>
        {selectedRow && (
          <div className="period-bar">
            <b>{monthLabel(shown, 'long')}:</b> pay {money(Object.values(selectedRow.payments).reduce((s, p) => s + p, 0))} in total
            {cards.filter((a) => selectedRow.payments[a.id] > 0.004).map((a) => <span key={a.id}> · {a.name} <b>{money(selectedRow.payments[a.id])}</b></span>)}
            <span className="faint"> · {money(selectedRow.total)} left after this month{selectedRow.total <= 0.005 ? ', debt-free!' : ''}</span>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Month</th>{cards.map((a) => <th key={a.id} className="amount">{a.name}</th>)}<th className="amount">Remaining debt</th></tr></thead>
            <tbody>
              {plan.schedule.slice(shownIdx, shownIdx + 12).map((row) => (
                <tr key={row.month} className={row.month === shownIdx ? 'selected-row' : ''}>
                  <td className="faint">{monthsFromNow(row.month)}</td>
                  {cards.map((a) => {
                    const p = row.payments[a.id] || 0;
                    const focus = p > (plan.debts.find((d) => d.id === a.id)?.min || 0) + 0.5;
                    return <td key={a.id} className="amount">{p > 0 ? <span style={{ fontWeight: focus ? 650 : 400 }}>{money0(p)}</span> : <span className="faint">—</span>}</td>;
                  })}
                  <td className="amount"><b>{money0(row.total)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="faint mt row" style={{ gap: 6 }}><Info size={13} /> Estimates assume no new charges, fixed APRs and fixed minimum payments. This is a planning tool, not financial advice.</p>
    </>
  );
}
