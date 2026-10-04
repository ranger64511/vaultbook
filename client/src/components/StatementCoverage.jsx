import { useMemo } from 'react';
import { CalendarRange, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { useData } from '../DataContext.jsx';
import { Card } from './ui.jsx';
import { statementCoverage, typeLabel } from '../lib/accounts.js';
import { monthLabel, monthShort, longDate, shortDate } from '../lib/format.js';

const MAX_MONTHS = 18;

/** Month-by-month view of which statements are in, worked out from your transactions. */
export default function StatementCoverage({ onPick }) {
  const { data } = useData();
  const cov = useMemo(() => statementCoverage(data.accounts, data.transactions), [data.accounts, data.transactions]);
  const active = cov.accounts.filter((r) => !r.empty);
  const never = cov.accounts.filter((r) => r.empty);
  if (!cov.accounts.length) return null;
  const months = cov.months.slice(-MAX_MONTHS);
  const offset = cov.months.length - months.length;
  const nextMonth = (r) => monthLabel(r.cells.find((c) => c.state === 'pending')?.month || months[months.length - 1], 'long');

  const status = (r) => {
    if (r.empty) return { tone: 'muted', icon: Clock, text: 'Nothing imported yet' };
    if (r.gaps.length) return { tone: 'warn', icon: AlertTriangle, text: `No transactions in ${r.gaps.map((m) => monthLabel(m, 'short')).join(', ')}. Missing a statement?` };
    if (r.stale) return { tone: 'warn', icon: Clock, text: `Last transaction ${longDate(r.last)}. Time to import ${nextMonth(r)}.` };
    return { tone: 'good', icon: CheckCircle2, text: `Up to date through ${longDate(r.last)}` };
  };

  return (
    <Card className="mt flush" title={<span className="row" style={{ gap: 8 }}><CalendarRange size={18} /> Statement coverage</span>}
      subtitle="Worked out from your transactions: which months each account has, any gaps, and what to import next. Click an account to import for it.">
      <div className="table-wrap">
        <table className="coverage">
          <thead>
            <tr>
              <th>Account</th>
              {months.map((m, i) => (
                <th key={m} className="cov-month" title={monthLabel(m, 'long')}>
                  {monthShort(m)}{(i === 0 || m.endsWith('-01')) && <div className="faint">{m.slice(0, 4)}</div>}
                </th>
              ))}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {active.map((r) => {
              const st = status(r);
              const Icon = st.icon;
              return (
                <tr key={r.account.id} className="cov-row" onClick={() => onPick?.(r.account.id)} title={`Import a statement for ${r.account.name}`}>
                  <td>
                    <b>{r.account.name}</b>
                    <div className="faint">{typeLabel(r.account.type, true)}{r.first && ` · ${shortDate(r.first)} – ${shortDate(r.last)}`}</div>
                  </td>
                  {r.cells.slice(offset).map((c) => (
                    <td key={c.month} className="cov-cell">
                      <span className={`cov-dot ${c.state}`}
                        title={`${monthLabel(c.month, 'long')}: ${c.count ? `${c.count} transaction${c.count === 1 ? '' : 's'}` : c.state === 'gap' ? 'no transactions (gap)' : c.state === 'pending' ? 'not imported yet' : 'before this account’s first import'}`} />
                    </td>
                  ))}
                  <td className={`cov-status ${st.tone}`}><span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><Icon size={14} style={{ flex: 'none' }} /> {st.text}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!active.length && <p className="muted" style={{ padding: '12px 20px 0' }}>No statements imported yet. Pick an account above and drop in a file.</p>}
      {never.length > 0 && (
        <p className="faint" style={{ padding: '12px 20px 0' }}>
          No statements yet for:{' '}
          {never.map((r, i) => (
            <span key={r.account.id}>{i > 0 && ', '}<button className="link-btn" onClick={() => onPick?.(r.account.id)}>{r.account.name}</button></span>
          ))}
          . That’s fine for accounts you only track by balance.
        </p>
      )}
      <div className="legend" style={{ padding: '10px 20px 14px' }}>
        <span><span className="cov-dot covered" /> Has transactions</span>
        <span><span className="cov-dot gap" /> Gap</span>
        <span><span className="cov-dot pending" /> Not imported yet</span>
      </div>
    </Card>
  );
}
