import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { monthLabel, addMonths, currentMonth } from '../lib/format.js';

/**
 * ◀ [month dropdown] ▶ plus a "This month" shortcut.
 *
 * Past-looking pages pass `months` (YYYY-MM months that have data); the
 * current and selected months are always included and the arrows stop at the
 * earliest data month and at the current month.
 *
 * Forward-looking pages pass `min` and `max` instead to offer every month in
 * that range (listed oldest first).
 */
export default function MonthPicker({ value, onChange, months = [], min, max }) {
  const now = currentMonth();
  const ranged = !!(min && max);
  const options = useMemo(() => {
    if (ranged) {
      const out = [];
      for (let m = min; m <= max && out.length < 600; m = addMonths(m, 1)) out.push(m);
      return out;
    }
    return [...new Set([now, value, ...months])].sort().reverse();
  }, [ranged, min, max, now, value, months]);
  const lo = ranged ? min : options[options.length - 1];
  const hi = ranged ? max : now;
  return (
    <div className="row month-picker" style={{ gap: 6, flexWrap: 'nowrap' }}>
      <button className="btn icon sm" aria-label="Previous month" title="Previous month" disabled={value <= lo} onClick={() => onChange(addMonths(value, -1))}><ChevronLeft size={16} /></button>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Month">
        {options.map((m) => <option key={m} value={m}>{monthLabel(m, 'long')}{m === now ? ' (this month)' : ''}</option>)}
      </select>
      <button className="btn icon sm" aria-label="Next month" title="Next month" disabled={value >= hi} onClick={() => onChange(addMonths(value, 1))}><ChevronRight size={16} /></button>
      {value !== now && options.includes(now) && <button className="btn ghost sm" onClick={() => onChange(now)}>This month</button>}
    </div>
  );
}
