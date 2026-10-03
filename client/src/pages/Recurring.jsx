import { useMemo, useState } from 'react';
import { Repeat, Scissors, Check, EyeOff, TrendingUp, RotateCcw } from 'lucide-react';
import { useData } from '../DataContext.jsx';
import { PageHead, Card, Stat, Empty, Segmented, KindBadge } from '../components/ui.jsx';
import { detectRecurring } from '../lib/analytics.js';
import { money, money0, longDate, shortDate } from '../lib/format.js';

export default function Recurring() {
  const { data, mutate, categoriesById, accountsById } = useData();
  const [view, setView] = useState('review');
  const all = useMemo(() => detectRecurring(data.transactions, data.categories), [data.transactions, data.categories]);
  const status = (r) => data.recurring[r.key]?.status;

  const active = all.filter((r) => r.active && status(r) !== 'ignore');
  const toCancel = active.filter((r) => status(r) === 'cancel');
  const wantsActive = active.filter((r) => r.kind === 'want');
  const lists = {
    review: active.filter((r) => !status(r)),
    cancel: toCancel,
    keep: active.filter((r) => status(r) === 'keep'),
    inactive: all.filter((r) => !r.active || status(r) === 'ignore'),
  };
  const list = lists[view];

  const setStatus = (r, s, msg) => mutate(`/recurring/${encodeURIComponent(r.key)}`, { method: 'PUT', body: { status: s } }, msg);

  return (
    <>
      <PageHead title="Recurring charges" subtitle="Subscriptions and bills found by looking for charges that repeat on a schedule." />
      <div className="grid g-4">
        <Stat icon={Repeat} label="Active recurring" value={`${money0(active.reduce((s, r) => s + r.monthly, 0))}/mo`} sub={`${active.length} charges · ${money0(active.reduce((s, r) => s + r.yearly, 0))} per year`} />
        <Stat icon={TrendingUp} label="Non-essential (wants)" value={`${money0(wantsActive.reduce((s, r) => s + r.monthly, 0))}/mo`} sub={`${wantsActive.length} charges worth reviewing`} />
        <Stat icon={Scissors} label="Marked to cancel" value={<span className="pos">{money0(toCancel.reduce((s, r) => s + r.monthly, 0))}/mo</span>} sub={`${money0(toCancel.reduce((s, r) => s + r.yearly, 0))} per year back in your pocket`} />
      </div>

      <Card className="mt flush">
        <div className="spread" style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <Segmented label="Filter" value={view} onChange={setView} options={[
            { value: 'review', label: `To review (${lists.review.length})` },
            { value: 'cancel', label: `Cancel (${lists.cancel.length})` },
            { value: 'keep', label: `Keep (${lists.keep.length})` },
            { value: 'inactive', label: `Ended / hidden (${lists.inactive.length})` },
          ]} />
          {view === 'cancel' && toCancel.length > 0 && <span className="faint">Cancel these with each provider, then come back and mark them “keep” or hide them.</span>}
        </div>
        {!list.length ? (
          <Empty icon={Repeat} title={all.length ? 'Nothing here' : 'No recurring charges found yet'}>
            {all.length ? 'Nothing in this list right now.' : 'Import at least 2–3 months of statements so repeating charges can be detected.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Merchant</th><th>Category</th><th>How often</th><th className="amount">Amount</th><th className="amount">Per year</th><th>Last / next</th><th /></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <b>{r.name}</b>
                      <div className="faint ellipsis" style={{ maxWidth: 280 }} title={r.description}>{accountsById.get(r.accountId)?.name} · {r.count} charges since {shortDate(r.first)}</div>
                    </td>
                    <td><span className="row" style={{ gap: 6, flexWrap: "nowrap", whiteSpace: "nowrap" }}>{categoriesById.get(r.category)?.name || 'Uncategorized'} <KindBadge kind={r.kind} /></span></td>
                    <td>{r.frequencyLabel}{r.confidence < 0.6 && <div className="faint">possible</div>}</td>
                    <td className="amount">
                      {money(r.amount)}
                      {r.priceChanged && <div><span className="badge warn" title={`Last charge was ${money(r.lastAmount)}`}>Changed: {money(r.lastAmount)}</span></div>}
                    </td>
                    <td className="amount"><b>{money0(r.yearly)}</b></td>
                    <td className="faint" style={{ whiteSpace: 'nowrap' }}>{longDate(r.last)}<br />{r.active ? `next ~${shortDate(r.next)}` : 'not seen recently'}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {status(r) !== 'cancel' && <button className="btn sm" onClick={() => setStatus(r, 'cancel', `${r.name} marked to cancel`)}><Scissors size={14} /> Cancel</button>}{' '}
                      {status(r) !== 'keep' && <button className="btn sm ghost" onClick={() => setStatus(r, 'keep')}><Check size={14} /> Keep</button>}
                      {status(r) !== 'ignore' && <button className="btn sm ghost icon" title="Not a recurring charge — hide" aria-label="Hide" onClick={() => setStatus(r, 'ignore')}><EyeOff size={14} /></button>}
                      {status(r) && <button className="btn sm ghost icon" title="Reset" aria-label="Reset" onClick={() => setStatus(r, null)}><RotateCcw size={14} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
