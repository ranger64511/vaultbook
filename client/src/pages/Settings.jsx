import { useState } from 'react';
import { ShieldCheck, KeyRound, Download, Trash2, RefreshCw, Plus } from 'lucide-react';
import { api } from '../api.js';
import { useData } from '../DataContext.jsx';
import { PageHead, Card, CategorySelect } from '../components/ui.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import Household from '../components/Household.jsx';

export default function Settings({ role }) {
  const { data, mutate, notify, categoriesById } = useData();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [income, setIncome] = useState(data.settings.monthlyIncome || '');
  const [rule, setRule] = useState({ pattern: '', category: 'subscriptions' });

  const changePassword = async (e) => {
    e.preventDefault();
    setPwMsg(null);
    if (pw.newPassword !== pw.confirm) return setPwMsg({ error: 'New passwords do not match' });
    try {
      await api('/auth/change-password', { method: 'POST', body: pw });
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      setPwMsg({ ok: 'Password changed. Your data key was re-encrypted with the new password.' });
    } catch (err) { setPwMsg({ error: err.message }); }
  };

  const addRule = async (e) => {
    e.preventDefault();
    if (!rule.pattern.trim()) return;
    const res = await mutate('/rules', { method: 'POST', body: { ...rule, applyToExisting: true } });
    notify(`Rule added · ${res.changed} transactions updated`);
    setRule((r) => ({ ...r, pattern: '' }));
  };

  return (
    <>
      <PageHead title="Settings" />
      <div className="grid g-2">
        <Card title="Security" subtitle="How your data is protected">
          <div className="stack" style={{ gap: 10, fontSize: 13.5 }}>
            <p className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}><ShieldCheck size={16} className="pos" style={{ flex: 'none', marginTop: 2 }} /> All data is encrypted on disk with AES-256-GCM. The key is derived from your password (scrypt) and only kept in memory while you’re signed in.</p>
            <p className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}><ShieldCheck size={16} className="pos" style={{ flex: 'none', marginTop: 2 }} /> The server only listens on this computer (127.0.0.1) and locks automatically after 30 minutes of inactivity.</p>
            <p className="row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}><ShieldCheck size={16} className="pos" style={{ flex: 'none', marginTop: 2 }} /> Uploaded statements are parsed in memory and never written to disk.</p>
          </div>
          <form className="stack mt" style={{ gap: 12 }} onSubmit={changePassword}>
            <h3 className="row" style={{ gap: 8 }}><KeyRound size={16} /> Change password</h3>
            <input type="password" placeholder="Current password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} required />
            <input type="password" placeholder="New password (10+ characters)" autoComplete="new-password" minLength={10} value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} required />
            <input type="password" placeholder="Confirm new password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required />
            {pwMsg?.error && <div className="error-box">{pwMsg.error}</div>}
            {pwMsg?.ok && <div className="info-box">{pwMsg.ok}</div>}
            <div><button className="btn primary">Update password</button></div>
          </form>
        </Card>

        <div className="stack">
          <Card title="Appearance"><ThemeToggle /></Card>
          <Card title="Expected monthly income" subtitle="Optional. Used by the budget when a month’s income isn’t fully imported yet.">
            <div className="row">
              <input type="number" min="0" step="50" value={income} onChange={(e) => setIncome(e.target.value)} placeholder="e.g. 4800" style={{ flex: 1 }} />
              <button className="btn" onClick={() => mutate('/settings', { method: 'PUT', body: { monthlyIncome: Number(income) || 0 } }, 'Saved')}>Save</button>
            </div>
          </Card>
          <Card title="Backup & export">
            <div className="stack" style={{ gap: 10 }}>
              <a className="btn" href="/api/backup" download><Download size={16} /> Download encrypted backup</a>
              <a className="btn" href="/api/export.csv" download><Download size={16} /> Export transactions (CSV, not encrypted)</a>
              <p className="faint">The backup stays encrypted and needs your password to restore. The CSV export is plain text, so store it carefully.</p>
            </div>
          </Card>
        </div>
      </div>

      {role === 'admin' && <Household />}

      <Card className="mt" title="Categorization rules" subtitle="Your rules run before the built-in ones. Patterns are case-insensitive and can use | for “or” (e.g. netflix|hulu)."
        action={<button className="btn sm" onClick={async () => { const r = await mutate('/recategorize', { method: 'POST' }); notify(`${r.changed} transactions re-categorized`); }}><RefreshCw size={14} /> Re-run on all</button>}>
        <form className="row" onSubmit={addRule}>
          <input placeholder="Text in the description, e.g. PLANET FITNESS" value={rule.pattern} onChange={(e) => setRule({ ...rule, pattern: e.target.value })} style={{ flex: '1 1 260px' }} />
          <CategorySelect categories={data.categories} value={rule.category} onChange={(c) => setRule({ ...rule, category: c })} />
          <button className="btn primary"><Plus size={16} /> Add rule</button>
        </form>
        {data.rules.length > 0 && (
          <div className="mt">
            {data.rules.map((r) => (
              <div key={r.id} className="list-row">
                <code className="grow ellipsis">{r.pattern}</code>
                <span className="muted">→ {categoriesById.get(r.category)?.name || r.category}</span>
                <button className="btn ghost icon sm" aria-label="Delete rule" onClick={() => mutate(`/rules/${r.id}`, { method: 'DELETE' }, 'Rule removed')}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <p className="faint mt">Transactions whose category you changed by hand are never overwritten by “Re-run”.</p>
      </Card>
    </>
  );
}
