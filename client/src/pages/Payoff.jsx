import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Target, CalendarCheck, Flame, PiggyBank, AlertTriangle, Info, FlaskConical, X } from 'lucide-react';
import { useData } from '../DataContext.jsx';
import { PageHead, Card, Stat, Empty, Segmented } from '../components/ui.jsx';
import { ChartTooltip, Legend, axisProps } from '../components/charts.jsx';
import PayoffSchedule from '../components/PayoffSchedule.jsx';
import { isLoan } from '../lib/accounts.js';
import { useChartColors } from '../lib/theme.js';
import { simulatePayoff, detectRecurring, summarize } from '../lib/analytics.js';
import { money, money0, moneyCompact, monthsFromNow } from '../lib/format.js';
import {
  duration, monthTicks, tickLabel, payoffDebts, debtsFrom, minimumTotal, mainPlanSettings, toSimExtras, describeAdjustment, totalExtra,
} from '../lib/payoff.js';

export default function Payoff() {
  const { data, mutate } = useData();
  const c = useChartColors();
  const cards = payoffDebts(data.accounts);
  const debts = debtsFrom(cards);
  const debtsKey = JSON.stringify(debts);
  const minTotal = minimumTotal(debts);
  const main = mainPlanSettings(data.settings, debts);
  const adjustments = main.adjustments;
  const extras = useMemo(() => toSimExtras(adjustments, undefined, undefined, data.accounts), [JSON.stringify(adjustments), data.accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const [budget, setBudget] = useState(main.budget);
  const [strategy, setStrategy] = useState(main.strategy);
  // Keep in sync when a Payoff theory is applied from the other page.
  useEffect(() => { setBudget(main.budget); setStrategy(main.strategy); }, [data.settings.payoffBudget, data.settings.payoffStrategy]); // eslint-disable-line react-hooks/exhaustive-deps
  // Persist the user's choices (debounced).
  useEffect(() => {
    if (budget === data.settings.payoffBudget && strategy === data.settings.payoffStrategy) return;
    const t = setTimeout(() => mutate('/settings', { method: 'PUT', body: { payoffBudget: budget, payoffStrategy: strategy } }), 600);
    return () => clearTimeout(t);
  }, [budget, strategy]); // eslint-disable-line react-hooks/exhaustive-deps

  const plan = useMemo(() => simulatePayoff(debts, budget, strategy, 600, extras), [debtsKey, budget, strategy, extras]); // eslint-disable-line
  const minOnly = useMemo(() => simulatePayoff(debts, 0, 'minimum'), [debtsKey]); // eslint-disable-line
  const other = useMemo(() => simulatePayoff(debts, budget, strategy === 'avalanche' ? 'snowball' : 'avalanche', 600, extras), [debtsKey, budget, strategy, extras]); // eslint-disable-line

  // Money that could be redirected to debts.
  const cancelSavings = useMemo(() => detectRecurring(data.transactions, data.categories)
    .filter((r) => r.active && data.recurring[r.key]?.status === 'cancel').reduce((s, r) => s + r.monthly, 0), [data]);
  const avgWants = useMemo(() => {
    const months = [...new Set(data.transactions.map((t) => t.date.slice(0, 7)))].sort().slice(-3);
    if (!months.length) return 0;
    return summarize(data.transactions.filter((t) => months.some((m) => t.date.startsWith(m))), data.categories).wants / months.length;
  }, [data.transactions, data.categories]);

  if (!cards.length) {
    return (
      <>
        <PageHead title="Debt payoff plan" />
        <Card><Empty icon={Target} title="No debts to pay off" action={<Link className="btn primary" to="/accounts">Manage accounts</Link>}>
          Add your credit cards and loans (car, mortgage, student, personal, medical…) with their balance, APR and monthly payment to build a payoff plan. Importing a card’s PDF statement fills these in automatically.
        </Empty></Card>
      </>
    );
  }

  const cardName = (id) => cards.find((a) => a.id === id)?.name;
  const missingApr = cards.filter((a) => !a.apr);
  const missingPayment = cards.filter((a) => isLoan(a.type) && !a.minPayment);
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
  ].filter(Boolean).map((b) => ({ ...b, sim: simulatePayoff(debts, budget + b.extra, strategy, 600, extras) }));

  const removeAdjustment = (id) => mutate('/settings', { method: 'PUT', body: { payoffAdjustments: adjustments.filter((a) => a.id !== id) } }, 'Removed from your main plan');

  return (
    <>
      <PageHead title="Debt payoff plan" subtitle="Your main plan: how fast your debts reach $0 and what each extra dollar saves.">
        <Link className="btn" to="/payoff/theory"><FlaskConical size={16} /> Try a payoff theory</Link>
      </PageHead>

      <Card>
        <div className="row" style={{ gap: 24, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: '1 1 320px' }}>
            <label htmlFor="budget">Total paid toward debts each month</label>
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
          <b>Avalanche</b> pays highest-APR debts first (least interest). <b>Snowball</b> pays smallest balances first (quick wins).
          Minimum and loan payments are always made on every debt; the rest goes to the focus debt, and freed-up minimums roll over.
        </p>
        {tooLow && <div className="error-box mt"><AlertTriangle size={14} style={{ verticalAlign: -2 }} /> This is less than your combined minimum payments ({money(minTotal)}). Missing minimums causes late fees and credit damage.</div>}
        {missingPayment.length > 0 && <div className="warn-box mt">Add the monthly payment for {missingPayment.map((a) => a.name).join(', ')} on the <Link to="/accounts">Accounts</Link> page. Until then it’s estimated like a credit card minimum.</div>}
        {missingApr.length > 0 && <div className="warn-box mt">Add the APR for {missingApr.map((a) => a.name).join(', ')} on the <Link to="/accounts">Accounts</Link> page for an accurate plan (currently assumed 0%).</div>}

        <div className="mt" style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div className="spread">
            <h3>Extra payments in your main plan</h3>
            <Link className="btn ghost sm" to="/payoff/theory"><FlaskConical size={14} /> {adjustments.length ? 'Edit in Payoff theory' : 'Add some in Payoff theory'}</Link>
          </div>
          {adjustments.length ? (
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              {adjustments.map((a) => (
                <div key={a.id} className="row" style={{ gap: 8 }}>
                  <span className={`badge ${a.type === 'lump' ? 'income' : 'need'}`}>{a.type === 'lump' ? 'Lump sum' : 'Monthly increase'}</span>
                  <span>{describeAdjustment(a, cardName, data.accounts)}</span>
                  <button className="btn ghost icon sm" aria-label="Remove from main plan" title="Remove from main plan" onClick={() => removeAdjustment(a.id)}><X size={14} /></button>
                </div>
              ))}
              <p className="faint">{money0(totalExtra(plan))} in extra payments over the life of the plan. Make these payments and any withdrawals yourself; Vault Book doesn’t move money.</p>
            </div>
          ) : (
            <p className="faint" style={{ marginTop: 6 }}>None yet. Use Payoff theory to test lump sums (like a tax refund or bonus) or raising your monthly payment, then apply the ones you like here.</p>
          )}
        </div>
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
        <Card title="Balance by debt" action={<Legend items={cards.slice(0, 8).map((a) => ({ label: a.name, color: colorOf(a.id) }))} />}>
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
        <Card className="flush" title="Payoff order" subtitle="Focus extra money on the top debt until it’s gone, then move down the list.">
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Debt</th><th className="amount">Balance</th><th className="amount">APR</th><th className="amount">Minimum</th><th className="amount">Interest</th><th>Paid off</th></tr></thead>
              <tbody>
                {ordered.map((d, i) => (
                  <tr key={d.id}>
                    <td><span className="badge">{i + 1}</span></td>
                    <td><span className="row" style={{ gap: 8, flexWrap: 'nowrap', whiteSpace: 'nowrap' }}><span className="swatch" style={{ background: colorOf(d.id) }} /><b>{d.name}</b></span></td>
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
          <div className="row mt">
            <button className="btn sm" onClick={() => setBudget(Math.round(budget + cancelSavings + avgWants * 0.25))}>Apply the first two</button>
            <Link className="btn sm ghost" to="/payoff/theory">More in Payoff theory</Link>
          </div>
        </Card>
      </div>

      <PayoffSchedule plan={plan} cards={cards} />

      <p className="faint mt row" style={{ gap: 6 }}><Info size={13} /> Estimates assume no new charges, fixed APRs and fixed minimum payments. Vault Book never makes payments for you. This is a planning tool, not financial advice.</p>
    </>
  );
}
