import { monthLabel } from '../lib/format.js';

/**
 * A row of months worked out from the data (newest first), as clickable chips.
 * items: [{ month: 'YYYY-MM', detail?: string }]; isActive(month) marks the selected one(s).
 */
export default function MonthChips({ items, isActive, onPick, label = 'Months', className = '' }) {
  if (items.length < 2) return null;
  return (
    <div className={`month-strip ${className}`} role="navigation" aria-label={label}>
      {items.map(({ month, detail }) => {
        const active = !!isActive?.(month);
        return (
          <button key={month} className={`month-chip${active ? ' active' : ''}`} aria-pressed={active} onClick={() => onPick(month)}>
            {monthLabel(month, 'short')}{detail != null && <span className="faint"> · {detail}</span>}
          </button>
        );
      })}
    </div>
  );
}
