import { useEffect, useMemo, useState } from 'react';
import { Download, Save, X } from 'lucide-react';
import { useData } from '../DataContext.jsx';
import { Card } from './ui.jsx';
import MonthChips from './MonthChips.jsx';
import { money0, monthLabel, addMonths, currentMonth } from '../lib/format.js';

/** Settings that can differ month to month: expected income, plus a per-month export. */
export default function MonthlySettings() {
  const { data, mutate } = useData();
  const now = currentMonth();
  const [month, setMonth] = useState(now);
  const usual = data.settings.monthlyIncome || 0;
  const overrides = data.settings.incomeByMonth || {};
  const override = overrides[month];
  const [usualDraft, setUsualDraft] = useState(usual || '');
  const [monthDraft, setMonthDraft] = useState(override ?? '');
  useEffect(() => { setMonthDraft(override ?? ''); }, [month, override]);
  const txCount = useMemo(() => data.transactions.filter((t) => t.date.startsWith(month)).length, [data.transactions, month]);
  const customMonths = Object.keys(overrides).sort();
  // Months worth planning: the last 3 months with data, this month, the next 12, and any already customized.
  const incomeMonths = useMemo(() => {
    const recent = [...new Set(data.transactions.map((t) => t.date.slice(0, 7)))].filter((m) => m < now).sort().slice(-3);
    const ahead = Array.from({ length: 13 }, (_, i) => addMonths(now, i));
    return [...new Set([...recent, ...ahead, ...customMonths])].sort()
      .map((m) => ({ month: m, detail: overrides[m] != null ? money0(overrides[m]) : undefined }));
  }, [data.transactions, now, customMonths.join(), overrides]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveUsual = () => mutate('/settings', { method: 'PUT', body: { monthlyIncome: Number(usualDraft) || 0 } }, 'Usual income saved');
  const saveMonth = () => mutate('/settings', { method: 'PUT', body: { incomeByMonth: { [month]: monthDraft === '' ? null : Number(monthDraft) } } },
    monthDraft === '' ? `${monthLabel(month, 'long')} uses your usual income` : `Income for ${monthLabel(month, 'long')} saved`);
  const clearMonth = (m) => mutate('/settings', { method: 'PUT', body: { incomeByMonth: { [m]: null } } }, `${monthLabel(m, 'long')} uses your usual income`);

  return (
    <Card title="Monthly settings" subtitle="Settings that can change from month to month.">
      <div className="stack" style={{ gap: 16 }}>
        <div className="field">
          <label htmlFor="usual-income">Usual expected monthly income</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input id="usual-income" type="number" min="0" step="50" value={usualDraft} onChange={(e) => setUsualDraft(e.target.value)} placeholder="e.g. 4800" style={{ flex: 1 }} />
            <button className="btn" onClick={saveUsual}><Save size={14} /> Save</button>
          </div>
          <span className="hint">Used by the budget for any month without its own amount.</span>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <div className="spread" style={{ marginBottom: 10 }}>
            <b>{monthLabel(month, 'long')}</b>

          </div>
          <MonthChips className="bare" items={incomeMonths} isActive={(m) => m === month} onPick={setMonth} label="Months" />
          <div className="field">
            <label htmlFor="month-income">Expected income this month</label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input id="month-income" type="number" min="0" step="50" value={monthDraft} onChange={(e) => setMonthDraft(e.target.value)}
                placeholder={usual ? `${money0(usual)} (usual)` : 'Same as usual'} style={{ flex: 1 }} />
              <button className="btn" onClick={saveMonth}><Save size={14} /> Save</button>
            </div>
            <span className="hint">
              {override != null ? <>Set to <b>{money0(override)}</b> for this month. Clear the box and save to go back to your usual amount.</>
                : 'For months that differ, like a bonus, commission, or a month with an extra paycheck.'}
            </span>
          </div>
          <a className={`btn sm mt${txCount ? '' : ' disabled'}`} href={txCount ? `/api/export.csv?month=${month}` : undefined} download aria-disabled={!txCount}
            style={{ marginTop: 12, pointerEvents: txCount ? 'auto' : 'none', opacity: txCount ? 1 : 0.55 }}>
            <Download size={14} /> Export {monthLabel(month, 'long')} transactions ({txCount})
          </a>
        </div>

        {customMonths.length > 0 && (
          <div>
            <div className="faint" style={{ marginBottom: 6 }}>Months with their own income</div>
            {customMonths.map((m) => (
              <div key={m} className="row" style={{ gap: 8, fontSize: 13, padding: '2px 0' }}>
                <button className="btn ghost sm" onClick={() => setMonth(m)} style={{ padding: '0 6px' }}>{monthLabel(m, 'long')}</button>
                <b className="num">{money0(overrides[m])}</b>
                <button className="btn ghost icon sm" aria-label={`Clear ${monthLabel(m, 'long')}`} title="Use usual income" onClick={() => clearMonth(m)}><X size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
