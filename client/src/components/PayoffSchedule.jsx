import { useState } from 'react';
import { Card } from './ui.jsx';
import { money, money0, monthsFromNow, monthLabel, addMonths, currentMonth } from '../lib/format.js';
import { monthsBetween } from '../lib/payoff.js';

/** Month-by-month payments per debt, 12 months from a chosen month. */
export default function PayoffSchedule({ plan, cards, title = 'Month-by-month plan' }) {
  const [viewMonth, setViewMonth] = useState(null); // first month in the table
  const [picked, setPicked] = useState(null); // month whose summary is shown
  const thisMonth = currentMonth();
  const lastIdx = Math.max(1, plan.schedule.length - 1);
  const firstPay = addMonths(thisMonth, 1);
  const lastPay = addMonths(thisMonth, lastIdx);
  const shown = viewMonth && viewMonth >= firstPay ? (viewMonth > lastPay ? lastPay : viewMonth) : firstPay;
  const shownIdx = monthsBetween(thisMonth, shown);
  // The summary follows a clicked row; otherwise it shows the table's first month.
  const pickedIdx = picked ? monthsBetween(thisMonth, picked) : -1;
  const selIdx = pickedIdx >= shownIdx && pickedIdx < shownIdx + 12 && pickedIdx <= lastIdx ? pickedIdx : shownIdx;
  const selMonth = addMonths(thisMonth, selIdx);
  const row0 = plan.schedule[selIdx];
  const hasExtras = plan.schedule.some((r) => r.extra > 0);

  return (
    <Card className="mt flush" title={title} subtitle={`What to pay on each debt, 12 months starting ${monthLabel(shown, 'long')}. Click a month for its summary.`}>
      <YearChips plan={plan} cards={cards} thisMonth={thisMonth} shown={shown} onPick={(m) => { setViewMonth(m); setPicked(null); }} />
      {row0 && (
        <div className="period-bar">
          <b>{monthLabel(selMonth, 'long')}:</b> pay {money(Object.values(row0.payments).reduce((s, p) => s + p, 0))} in total
          {cards.filter((a) => row0.payments[a.id] > 0.004).map((a) => <span key={a.id}> · {a.name} <b>{money(row0.payments[a.id])}</b></span>)}
          {row0.extra > 0 && <span className="pos"> · includes {money(row0.extra)} extra</span>}
          <span className="faint"> · {money(row0.total)} left after this month{row0.total <= 0.005 ? ', debt-free!' : ''}</span>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr>
            <th>Month</th>{cards.map((a) => <th key={a.id} className="amount">{a.name}</th>)}
            {hasExtras && <th className="amount">Extra</th>}
            <th className="amount">Remaining debt</th>
          </tr></thead>
          <tbody>
            {plan.schedule.slice(shownIdx, shownIdx + 12).map((row) => (
              <tr key={row.month} className={`schedule-row${row.month === selIdx ? ' selected-row' : ''}`} onClick={() => setPicked(addMonths(thisMonth, row.month))}>
                <td className="faint">{monthsFromNow(row.month)}</td>
                {cards.map((a) => {
                  const p = row.payments[a.id] || 0;
                  const focus = p > (plan.debts.find((d) => d.id === a.id)?.min || 0) + 0.5;
                  return <td key={a.id} className="amount">{p > 0 ? <span style={{ fontWeight: focus ? 650 : 400 }}>{money0(p)}</span> : <span className="faint">—</span>}</td>;
                })}
                {hasExtras && <td className="amount">{row.extra > 0 ? <span className="pos">+{money0(row.extra)}</span> : <span className="faint">—</span>}</td>}
                <td className="amount"><b>{money0(row.total)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** The plan's years as chips (worked out from the schedule), noting which debts are paid off each year. */
function YearChips({ plan, cards, thisMonth, shown, onPick }) {
  const byYear = new Map();
  for (const row of plan.schedule.slice(1)) {
    const m = addMonths(thisMonth, row.month);
    const y = m.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, { first: m, paidOff: [] });
  }
  for (const d of plan.debts) {
    if (!d.paidOffMonth) continue;
    const y = addMonths(thisMonth, d.paidOffMonth).slice(0, 4);
    byYear.get(y)?.paidOff.push(cards.find((c) => c.id === d.id)?.name || d.name);
  }
  if (byYear.size < 2) return null;
  return (
    <div className="month-strip" role="navigation" aria-label="Plan years">
      {[...byYear.entries()].map(([y, info]) => {
        const active = shown.slice(0, 4) === y;
        return (
          <button key={y} className={`month-chip${active ? ' active' : ''}`} aria-pressed={active} onClick={() => onPick(info.first)}
            title={info.paidOff.length ? `Paid off in ${y}: ${info.paidOff.join(', ')}` : undefined}>
            {y}{info.paidOff.length > 0 && <span className="faint"> · {info.paidOff.length} paid off</span>}
          </button>
        );
      })}
    </div>
  );
}
