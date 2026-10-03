import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight, Upload, Wallet, TrendingDown, Scale, CalendarCheck, CalendarClock, Repeat, PiggyBank } from 'lucide-react';
import { useData } from '../DataContext.jsx';
import { PageHead, Card, Stat, Empty, Amount } from '../components/ui.jsx';
import MonthPicker from '../components/MonthPicker.jsx';
import { accountType, interestInfo, assetInfo } from '../lib/accounts.js';
import { payoffDebts, debtsFrom, mainPlanSettings, runPlan, duration } from '../lib/payoff.js';
import { ChartTooltip, Legend, axisProps } from '../components/charts.jsx';
import { useChartColors } from '../lib/theme.js';
import { byCategory, byPeriod, detectRecurring, lastNMonths, summarize } from '../lib/analytics.js';
import {
  money, money0, moneyCompact, monthLabel, monthShort, addMonths, currentMonth, weekKey, weekLabel, shortDate, pct, isoDate, monthsFromNow,
} from '../lib/format.js';

// Net worth groups, in a fixed order so each keeps its colour.
const GROUPS = [
  { key: 'bank', label: 'Bank & cash', side: 'have', to: '/accounts' },
  { key: 'investment', label: 'Investments', side: 'have', to: '/accounts' },
  { key: 'asset', label: 'Property & assets', side: 'have', to: '/accounts' },
  { key: 'card', label: 'Credit cards', side: 'owe', to: '/accounts' },
  { key: 'loan', label: 'Loans', side: 'owe', to: '/accounts' },
];

export default function Dashboard() {
  const { data, accountsById, categoriesById } = useData();
  const c = useChartColors();
  const txs = data.transactions;

  const [month, setMonth] = useState(currentMonth);
  const months = useMemo(() => [...new Set(txs.map((t) => t.date.slice(0, 7)))].sort().reverse(), [txs]);
  const isThisMonth = month === currentMonth();

  const monthTx = useMemo(() => txs.filter((t) => t.date.startsWith(month)), [txs, month]);
  const prevTx = useMemo(() => txs.filter((t) => t.date.startsWith(addMonths(month, -1))), [txs, month]);
  const cur = summarize(monthTx, data.categories);
  const prev = summarize(prevTx, data.categories);

  const monthly = useMemo(() => lastNMonths(byPeriod(txs, data.categories, 'month'), 12, month), [txs, data.categories, month]);
  const weekly = useMemo(() => {
    const rows = byPeriod(txs, data.categories, 'week');
    const end = weekKey(`${month}-28`);
    return rows.filter((r) => r.key <= end).slice(-12);
  }, [txs, data.categories, month]);
  const cats = useMemo(() => byCategory(monthTx, data.categories).filter((r) => r.total > 0), [monthTx, data.categories]);
  const recurring = useMemo(() => detectRecurring(txs, data.categories).filter((r) => r.active && data.recurring[r.key]?.status !== 'ignore'), [txs, data.categories, data.recurring]);

  // ---- Net worth: what you have minus what you owe.
  const worth = useMemo(() => {
    const totals = Object.fromEntries(GROUPS.map((g) => [g.key, { total: 0, count: 0 }]));
    let savingsInterest = 0;
    for (const a of data.accounts) {
      const g = accountType(a.type).group;
      if (!totals[g]) continue;
      const info = g === 'bank' ? interestInfo(a) : null;
      totals[g].total += Math.max(0, info?.estimatedToday ?? (a.balance || 0));
      totals[g].count++;
      savingsInterest += info?.monthly || 0;
    }
    const have = totals.bank.total + totals.investment.total + totals.asset.total;
    const owe = totals.card.total + totals.loan.total;
    const equity = data.accounts.filter((a) => accountType(a.type).group === 'asset').reduce((s, a) => s + assetInfo(a, data.accounts).equity, 0);
    return { totals, have, owe, net: have - owe, equity, savingsInterest };
  }, [data.accounts]);

  // ---- Debt payoff (main plan).
  const payoff = useMemo(() => {
    const debts = debtsFrom(payoffDebts(data.accounts));
    if (!debts.length) return null;
    const settings = mainPlanSettings(data.settings, debts);
    return { plan: runPlan(debts, settings, data.accounts), budget: settings.budget };
  }, [data.accounts, data.settings]);

  // ---- This month at a glance.
  const budgetTotal = data.categories.filter((x) => x.kind === 'need' || x.kind === 'want').reduce((s, x) => s + (Number(x.budget) || 0), 0);
  const recurringMonthly = recurring.reduce((s, r) => s + r.monthly, 0);
  const planned = recurring.filter((r) => data.recurring[r.key]?.status === 'cancel');
  const today = isoDate(new Date());
  const in14 = isoDate(new Date(Date.now() + 14 * 86400000));
  const upcoming = recurring.filter((r) => r.next >= today && r.next <= in14).sort((a, b) => a.next.localeCompare(b.next));

  if (!txs.length && !data.accounts.length) {
    return (
      <>
        <PageHead title="Dashboard" />
        <Card>
          <Empty icon={Upload} title="Let’s get your numbers in" action={<Link className="btn primary" to="/import"><Upload size={16} /> Import a statement</Link>}>
            Add your bank and credit card accounts, then import statements (CSV, OFX/QFX, PDF or a photo).
          </Empty>
        </Card>
      </>
    );
  }

  const delta = cur.spending - prev.spending;
  const maxCat = cats[0]?.total || 1;
  const scale = Math.max(worth.have, worth.owe, 1);
  const colorOf = (key) => c.series[GROUPS.findIndex((g) => g.key === key)];
  const debtAccounts = data.accounts.filter((a) => ['card', 'loan'].includes(accountType(a.type).group) && a.balance > 0)
    .sort((a, b) => (b.apr || 0) - (a.apr || 0));

  return (
    <>
      <PageHead title="Dashboard" subtitle={`Your finances at a glance · ${monthLabel(month, 'long')}`}>
        <MonthPicker value={month} onChange={setMonth} months={months} />
      </PageHead>

      <div className="grid g-4">
        <Stat icon={Scale} label="Net worth" value={<span className={worth.net >= 0 ? 'pos' : 'bad'}>{money0(worth.net)}</span>}
          sub={`Have ${money0(worth.have)} · Owe ${money0(worth.owe)}`} />
        <Stat icon={Wallet} label={isThisMonth ? 'Spent this month' : `Spent in ${monthLabel(month, 'long')}`} value={money(cur.spending)}
          sub={prev.spending ? (
            <span className="row" style={{ gap: 4 }}>
              {delta > 0 ? <ArrowUpRight size={14} className="bad" /> : <ArrowDownRight size={14} className="pos" />}
              <span className={delta > 0 ? 'bad' : 'pos'}>{money0(Math.abs(delta))}</span> {delta > 0 ? 'more' : 'less'} than last month
            </span>
          ) : `Needs ${money0(cur.needs)} · Wants ${money0(cur.wants)}`} />
        <Stat icon={TrendingDown} label={isThisMonth ? 'Income this month' : `Income in ${monthLabel(month, 'long')}`} value={money(cur.income)}
          sub={<>Net <span className={cur.net >= 0 ? 'pos' : 'bad'}>{cur.net >= 0 ? '+' : ''}{money0(cur.net)}</span></>} />
        <Stat icon={CalendarCheck} label="Debt-free"
          value={payoff ? (Number.isFinite(payoff.plan.months) ? monthsFromNow(payoff.plan.months) : 'Not yet') : 'No debts'}
          sub={payoff
            ? (Number.isFinite(payoff.plan.months) ? <>{duration(payoff.plan.months)} at {money0(payoff.budget)}/mo · <Link to="/payoff">plan</Link></> : <Link to="/payoff">Raise your monthly payment</Link>)
            : 'Nothing in your payoff plan'} />
      </div>

      <div className="grid g-3-1 mt">
        <Card title="Net worth" subtitle="Everything you have, minus everything you owe." action={<Link className="btn sm ghost" to="/accounts">Accounts</Link>}>
          <div className="stack" style={{ gap: 14 }}>
            {[['have', 'What you have', worth.have], ['owe', 'What you owe', worth.owe]].map(([side, label, total]) => (
              <div key={side}>
                <div className="spread" style={{ marginBottom: 6 }}>
                  <span className="muted">{label}</span>
                  <b className="num">{money0(total)}</b>
                </div>
                <div className="worth-bar" role="img" aria-label={`${label}: ${money0(total)}`}>
                  {GROUPS.filter((g) => g.side === side && worth.totals[g.key].total > 0).map((g) => (
                    <span key={g.key} title={`${g.label}: ${money0(worth.totals[g.key].total)}`}
                      style={{ width: `${(worth.totals[g.key].total / scale) * 100}%`, background: colorOf(g.key) }} />
                  ))}
                </div>
              </div>
            ))}
            <div className="worth-legend">
              {GROUPS.map((g) => {
                const t = worth.totals[g.key];
                return (
                  <Link key={g.key} to={g.to} className="worth-item">
                    <span className="swatch" style={{ background: colorOf(g.key) }} />
                    <span className="grow">{g.label} <span className="faint">({t.count})</span></span>
                    <b className="num">{g.side === 'owe' && t.total ? '−' : ''}{money0(t.total)}</b>
                  </Link>
                );
              })}
            </div>
            {worth.totals.asset.count > 0 && (
              <p className="faint">Property equity after linked loans: <b>{money0(worth.equity)}</b>. Property values are your own estimates.</p>
            )}
          </div>
        </Card>

        <Card title="This month at a glance" subtitle={monthLabel(month, 'long')}>
          <div className="stack" style={{ gap: 14 }}>
            <div>
              <div className="spread" style={{ fontSize: 13, marginBottom: 5 }}>
                <span className="muted">Budget</span>
                {budgetTotal ? <b className="num">{money0(cur.spending)} of {money0(budgetTotal)}</b> : <Link to="/budget">Set a budget</Link>}
              </div>
              {budgetTotal > 0 && (
                <>
                  <div className={`bar ${cur.spending > budgetTotal ? 'bad' : cur.spending > budgetTotal * 0.85 ? 'warn' : ''}`}><span style={{ width: `${Math.min(100, (cur.spending / budgetTotal) * 100)}%` }} /></div>
                  <div className="faint" style={{ marginTop: 4 }}>{cur.spending > budgetTotal ? `${money0(cur.spending - budgetTotal)} over budget` : `${money0(budgetTotal - cur.spending)} left · ${pct((cur.spending / budgetTotal) * 100)} used`}</div>
                </>
              )}
            </div>
            <div className="spread" style={{ fontSize: 13 }}>
              <span className="row" style={{ gap: 6 }}><Repeat size={14} className="muted" /> Recurring charges</span>
              <Link to="/recurring"><b className="num">{money0(recurringMonthly)}/mo</b></Link>
            </div>
            {planned.length > 0 && (
              <div className="faint" style={{ marginTop: -8 }}>{planned.length} planned to cancel · {money0(planned.reduce((s, r) => s + r.monthly, 0))}/mo once you cancel them</div>
            )}
            {worth.savingsInterest > 0 && (
              <div className="spread" style={{ fontSize: 13 }}>
                <span className="row" style={{ gap: 6 }}><PiggyBank size={14} className="muted" /> Savings interest</span>
                <b className="num pos">+{money(worth.savingsInterest)}/mo</b>
              </div>
            )}
            <div>
              <div className="row" style={{ gap: 6, fontSize: 13, marginBottom: 6 }}><CalendarClock size={14} className="muted" /> <span className="muted">Coming up in the next 2 weeks</span></div>
              {upcoming.length ? upcoming.slice(0, 5).map((r) => (
                <div key={r.key} className="spread" style={{ fontSize: 13, padding: '3px 0' }}>
                  <span className="ellipsis"><span className="faint">{shortDate(r.next)}</span> · {r.name}</span>
                  <span className="num">{money(r.amount)}</span>
                </div>
              )) : <p className="faint">No recurring charges expected.</p>}
              {upcoming.length > 5 && <p className="faint">+ {upcoming.length - 5} more</p>}
            </div>
          </div>
        </Card>
      </div>

      <div className="grid g-3-1 mt">
        <Card title="Income vs. spending" subtitle="Last 12 months" action={<Legend items={[{ label: 'Income', color: c.series[0] }, { label: 'Spending', color: c.series[1] }]} />}>
          <div className="chart-box">
            <ResponsiveContainer>
              <BarChart data={monthly} barGap={2} barCategoryGap="22%">
                <CartesianGrid vertical={false} stroke={c.grid} />
                <XAxis dataKey="key" tickFormatter={monthShort} {...axisProps(c)} />
                <YAxis tickFormatter={moneyCompact} width={56} {...axisProps(c)} axisLine={false} />
                <Tooltip cursor={{ fill: c.grid, opacity: 0.5 }} content={<ChartTooltip labelFormatter={(k) => monthLabel(k, 'long')} />} />
                <Bar dataKey="income" name="Income" fill={c.series[0]} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="spending" name="Spending" fill={c.series[1]} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Where it went" subtitle={monthLabel(month, 'long')} action={<Link className="btn sm ghost" to="/budget">Budget</Link>}>
          {cats.length ? (
            <div className="stack" style={{ gap: 11 }}>
              {cats.slice(0, 7).map((r) => (
                <div key={r.id}>
                  <div className="spread" style={{ fontSize: 13, marginBottom: 5 }}>
                    <span className="row" style={{ gap: 8 }}>{r.name} <span className={`badge ${r.kind}`}>{r.kind === 'need' ? 'Need' : 'Want'}</span></span>
                    <b className="num">{money0(r.total)}</b>
                  </div>
                  <div className="bar"><span style={{ width: `${(r.total / maxCat) * 100}%`, background: r.kind === 'need' ? c.series[0] : c.series[1] }} /></div>
                </div>
              ))}
              {cats.length > 7 && <p className="faint">+ {cats.length - 7} more categories</p>}
            </div>
          ) : <p className="muted">No spending recorded this month.</p>}
        </Card>
      </div>

      <div className="grid g-3-1 mt">
        <Card title="Weekly spending" subtitle="Last 12 weeks with activity">
          <div className="chart-box sm">
            <ResponsiveContainer>
              <BarChart data={weekly} barCategoryGap="28%">
                <CartesianGrid vertical={false} stroke={c.grid} />
                <XAxis dataKey="key" tickFormatter={(k) => shortDate(k)} {...axisProps(c)} />
                <YAxis tickFormatter={moneyCompact} width={56} {...axisProps(c)} axisLine={false} />
                <Tooltip cursor={{ fill: c.grid, opacity: 0.5 }} content={<ChartTooltip labelFormatter={weekLabel} />} />
                <Bar dataKey="needs" name="Needs" stackId="s" fill={c.series[0]} maxBarSize={30} stroke={c.surface} strokeWidth={1} />
                <Bar dataKey="wants" name="Wants" stackId="s" fill={c.series[1]} radius={[4, 4, 0, 0]} maxBarSize={30} stroke={c.surface} strokeWidth={1} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legend items={[{ label: 'Needs', color: c.series[0] }, { label: 'Wants', color: c.series[1] }]} />
        </Card>

        <Card title="Debts" subtitle="Highest interest rate first" action={<Link className="btn sm ghost" to="/payoff">Payoff plan</Link>}>
          {debtAccounts.length ? debtAccounts.slice(0, 6).map((a) => {
            const util = a.type === 'credit' && a.creditLimit ? (a.balance / a.creditLimit) * 100 : null;
            return (
              <div key={a.id} className="list-row" style={{ display: 'block' }}>
                <div className="spread">
                  <span className="ellipsis"><b>{a.name}</b>{a.apr ? <span className="faint"> · {a.apr}% APR</span> : null}</span>
                  <b className="num">{money(a.balance || 0)}</b>
                </div>
                {util != null ? (
                  <>
                    <div className={`bar ${util > 50 ? 'bad' : util > 30 ? 'warn' : ''}`} style={{ marginTop: 7 }}><span style={{ width: `${Math.min(100, util)}%` }} /></div>
                    <div className="faint" style={{ marginTop: 4 }}>{pct(util)} of {money0(a.creditLimit)} limit used</div>
                  </>
                ) : a.minPayment ? (
                  <div className="faint" style={{ marginTop: 2 }}>{accountType(a.type).short || accountType(a.type).label} · {money0(a.minPayment)}/mo{a.excludeFromPayoff ? ' · not in payoff plan' : ''}</div>
                ) : null}
              </div>
            );
          }) : <p className="muted">No debts. Nice work!</p>}
          {debtAccounts.length > 6 && <p className="faint">+ {debtAccounts.length - 6} more on the <Link to="/accounts">Accounts</Link> page</p>}
        </Card>
      </div>

      <Card className="mt flush" title="Recent transactions" action={<Link className="btn sm ghost" to="/transactions" style={{ marginRight: -8 }}>View all</Link>}>
        <div className="table-wrap">
          <table>
            <tbody>
              {[...txs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map((t) => (
                <tr key={t.id}>
                  <td className="faint" style={{ width: 80 }}>{shortDate(t.date)}</td>
                  <td className="desc">{t.description}</td>
                  <td className="muted">{categoriesById.get(t.category)?.name || 'Uncategorized'}</td>
                  <td className="faint">{accountsById.get(t.accountId)?.name}</td>
                  <td className="amount"><Amount value={t.amount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
