import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { monthLabel, addMonths, currentMonth } from '../lib/format.js';

/**
 * ◀ [month dropdown] ▶ plus a "This month" shortcut.
 * `months` are the months that have data (YYYY-MM); the current month and the
 * selected month are always included. Arrows stop at the earliest data month
 * and at the current month.
 */
export default function MonthPicker({ value, onChange, months = [] }) {
  const now = currentMonth();
  const options = useMemo(() => [...new Set([now, value, ...months])].sort().reverse(), [now, value, months]);
  const earliest = options[options.length - 1];
  return (
    <div className="row month-picker" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <button className="btn icon sm" aria-label="Previous month" title="Previous month" disabled={value <= earliest} onClick={() => onChange(addMonths(value, -1))}><ChevronLeft size={16} /></button>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Month">
        {options.map((m) => <option key={m} value={m}>{monthLabel(m, 'long')}{m === now ? ' (this month)' : ''}</option>)}
      </select>
      <button className="btn icon sm" aria-label="Next month" title="Next month" disabled={value >= now} onClick={() => onChange(addMonths(value, 1))}><ChevronRight size={16} /></button>
      {value !== now && <button className="btn ghost sm" onClick={() => onChange(now)}>This month</button>}
    </div>
  );
}
