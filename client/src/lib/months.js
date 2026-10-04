// Working out which months to show from the data itself.
import { currentMonth } from './format.js';

/** Unique 'YYYY-MM' months from dated items, newest first. */
export function monthsOf(items, getDate = (x) => x.date) {
  return [...new Set(items.map((x) => getDate(x).slice(0, 7)))].sort().reverse();
}

/** Start on this month if it has data, otherwise the latest month that does. */
export function startMonth(months) {
  const now = currentMonth();
  return months.includes(now) || !months.length ? now : months[0];
}

/** Sum a value per month: returns Map('YYYY-MM' -> total). */
export function totalsByMonth(items, value, getDate = (x) => x.date) {
  const m = new Map();
  for (const x of items) {
    const v = value(x);
    if (v) m.set(getDate(x).slice(0, 7), (m.get(getDate(x).slice(0, 7)) || 0) + v);
  }
  return m;
}
