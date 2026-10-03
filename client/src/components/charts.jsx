import { money } from '../lib/format.js';

/** Shared tooltip for Recharts: swatch + series name + value, text in ink tokens. */
export function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter = money, hideZero }) {
  if (!active || !payload?.length) return null;
  const rows = hideZero ? payload.filter((p) => Math.abs(p.value) > 0.004) : payload;
  return (
    <div className="tooltip">
      <div className="t-title">{labelFormatter ? labelFormatter(label, payload) : label}</div>
      {rows.map((p) => (
        <div className="t-row" key={p.dataKey}>
          <span><i style={{ background: p.color || p.fill || p.stroke }} />{p.name}</span>
          <b>{valueFormatter(p.value)}</b>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.label}><i style={{ background: it.color }} />{it.label}</span>
      ))}
    </div>
  );
}

export const axisProps = (c) => ({
  stroke: c.axis,
  tick: { fill: c.muted, fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: c.axis },
});
