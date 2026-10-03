import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowDownRight, ArrowUpRight, CreditCard, Repeat, Upload, Wallet, TrendingDown } from 'lucide-react';
import { useData } from '../DataContext.jsx';
import { PageHead, Card, Stat, Empty, Amount } from '../components/ui.jsx';
import MonthPicker from '../components/MonthPicker.jsx';
import { isLoan } from '../lib/accounts.js';
import { ChartTooltip, Legend, axisProps } from '../components/charts.jsx';
import { useChartColors } from '../lib/theme.js';
import { byCategory, byPeriod, detectRecurring, lastNMonths, summarize } from '../lib/analytics.js';
import { money, money0, moneyCompact, monthLabel, monthShort, addMonths, currentMonth, weekKey, weekLabel, shortDate, pct } from '../lib/format.js';

export default function Dashboard() {
  const { data, accountsById, categoriesById } = useData();
  const c = useChartColors();
  const txs = data.transactions;

  const [month, setMonth] = useState(currentMonth);
  const months = useMemo(() => [...new Set(txs.map((t) => t.date.slice(0, 7)))].sort().reverse(), [txs]);

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

  const cards = data.accounts.filter((a) => a.type === 'credit');
  const loans = data.accounts.filter((a) => isLoan(a.type));
  const cardDebt = cards.reduce((s, a) => s + (a.balance || 0), 0);
  const loanDebt = loans.reduce((s, a) => s + (a.balance || 0), 0);
  const debt = cardDebt + loanDebt;
  const limit = cards.reduce((s, a) => s + (a.creditLimit || 0), 0);
  const recurringMonthly = recurring.reduce((s, r) => s + r.monthly, 0);
  const flagged = recurring.filter((r) => data.recurring[r.key]?.status === 'cancel');
  const savings = flagged.reduce((s, r) => s + r.monthly, 0);

  if (!txs.length && !data.accounts.length) {
    return (
      <>
        <PageHead title="Dashboard" />
        <Card>
          <Empty icon={Upload} title="Let’s get your numbers in" action={<Link className="btn primary" to="/import"><Upload size={16} /> Import a statement</Link>}>
            Add your bank and credit card accounts, then import statements (CSV, OFX/QFX or PDF).
          </Empty>
        </Card>
      </>
    );
  }

  const delta = cur.spending - prev.spending;
  const maxCat = cats[0]?.total || 1;

  return (
    <>
      <PageHead title="Dashboard" subtitle={`Overview for ${monthLabel(month, 'long')}`}>
        <MonthPicker value={month} onChange={setMonth} months={months} />
      </PageHead>

      <div className="grid g-4">
        <Stat icon={CreditCard} label={loans.length ? 'Total debt' : 'Credit card debt'} value={money(debt)}
          sub={loans.length
            ? `Cards ${money0(cardDebt)} · Loans ${money0(loanDebt)}`
            : limit ? `${pct((cardDebt / limit) * 100)} of ${money0(limit)} limit used` : `${cards.length} card${cards.length === 1 ? '' : 's'}`} />
        <Stat icon={Wallet} label={month === currentMonth() ? "Spent this month" : `Spent in ${monthLabel(month, "long")}`} value={money(cur.spending)}
          sub={prev.spending ? (
            <span className="row" style={{ gap: 4 }}>
              {delta > 0 ? <ArrowUpRight size={14} className="bad" /> : <ArrowDownRight size={14} className="pos" />}
              <span className={delta > 0 ? 'bad' : 'pos'}>{money0(Math.abs(delta))}</span> {delta > 0 ? 'more' : 'less'} than last month
            </span>
          ) : `Needs ${money0(cur.needs)} · Wants ${money0(cur.wants)}`} />
        <Stat icon={TrendingDown} label={month === currentMonth() ? "Income this month" : `Income in ${monthLabel(month, "long")}`} value={money(cur.income)}
          sub={<>Net <span className={cur.net >= 0 ? 'pos' : 'bad'}>{cur.net >= 0 ? '+' : ''}{money0(cur.net)}</span></>} />
        <Stat icon={Repeat} label="Recurring charges" value={`${money0(recurringMonthly)}/mo`}
          sub={flagged.length ? <span className="pos">{money0(savings)}/mo planned to cancel</span> : `${recurring.length} active subscriptions & bills`} />
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

        <Card title="Credit cards" action={<Link className="btn sm ghost" to="/payoff">Payoff plan</Link>}>
          {cards.length ? cards.map((a) => {
            const util = a.creditLimit ? (a.balance / a.creditLimit) * 100 : null;
            return (
              <div key={a.id} className="list-row" style={{ display: 'block' }}>
                <div className="spread">
                  <span className="ellipsis"><b>{a.name}</b>{a.apr ? <span className="faint"> · {a.apr}% APR</span> : null}</span>
                  <b className="num">{money(a.balance || 0)}</b>
                </div>
                {util != null && (
                  <>
                    <div className={`bar mt ${util > 50 ? 'bad' : util > 30 ? 'warn' : ''}`} style={{ marginTop: 7 }}><span style={{ width: `${Math.min(100, util)}%` }} /></div>
                    <div className="faint" style={{ marginTop: 4 }}>{pct(util)} utilization · {money0(a.creditLimit)} limit</div>
                  </>
                )}
              </div>
            );
          }) : <p className="muted">No credit cards yet. <Link to="/accounts">Add one</Link>.</p>}
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
