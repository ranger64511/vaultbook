import { useEffect, useState } from 'react';
import { Users, Wifi, Trash2, UserPlus, AlertTriangle, ShieldCheck, RotateCw } from 'lucide-react';
import { api } from '../api.js';
import { Card, Modal } from './ui.jsx';

/** Settings card for the household admin: multi-user mode, members and home-network access. */
export default function Household() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = () => api('/admin/household').then(setInfo).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const update = async (patch, confirmText) => {
    if (confirmText && !confirm(confirmText)) return;
    setError('');
    try { setInfo(await api('/admin/household', { method: 'PUT', body: patch })); } catch (e) { setError(e.message); }
  };
  const remove = async (u) => {
    if (!confirm(`Remove ${u.username}? Their vault and saved statements will be permanently deleted. This can’t be undone.`)) return;
    try { setInfo(await api(`/admin/users/${u.id}`, { method: 'DELETE' })); } catch (e) { setError(e.message); }
  };

  if (!info) return error ? <Card title="Household"><div className="error-box">{error}</div></Card> : null;
  const others = info.users.filter((u) => u.id !== info.you);

  return (
    <Card className="mt" title={<span className="row" style={{ gap: 8 }}><Users size={18} /> Household (multiple users)</span>}
      subtitle="Let family members use Vault Book on this computer or your home network. Each person gets their own private, separately encrypted vault.">
      <div className="stack" style={{ gap: 16 }}>
        <label className="row" style={{ gap: 10, cursor: 'pointer', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
          <input type="checkbox" checked={info.multiUser} style={{ marginTop: 3 }}
            onChange={(e) => update({ multiUser: e.target.checked }, e.target.checked ? null
              : 'Turn off household mode? Other members will be signed out and can’t sign in until it’s turned back on. Their data is kept.')} />
          <span>
            <b>Enable household mode</b> <span className="badge">{info.multiUser ? 'On' : 'Off'}</span>
            <div className="faint">Off by default. When on, you can add members. Each member’s data is encrypted with their own password. You can’t see their data, and they can’t see yours.</div>
          </span>
        </label>

        {info.multiUser && (
          <div>
            <div className="spread" style={{ marginBottom: 8 }}>
              <h3>Members</h3>
              <button className="btn sm" onClick={() => setAdding(true)}><UserPlus size={14} /> Add member</button>
            </div>
            {info.users.map((u) => (
              <div key={u.id} className="list-row">
                <span className="avatar">{u.username[0]}</span>
                <span className="grow"><b>{u.username}</b>{u.id === info.you && <span className="faint"> (you)</span>}</span>
                <span className={`badge ${u.role === 'admin' ? 'need' : ''}`}>{u.role === 'admin' ? 'Admin' : 'Member'}</span>
                {u.id !== info.you && <button className="btn ghost icon sm" aria-label={`Remove ${u.username}`} title="Remove" onClick={() => remove(u)}><Trash2 size={14} /></button>}
              </div>
            ))}
            {!others.length && <p className="faint">No other members yet.</p>}
            <p className="faint" style={{ marginTop: 8 }}>
              Passwords can’t be reset, even by an admin, because the password is what unlocks that person’s data. If a member forgets theirs, remove them and add them again (their old data is lost).
            </p>
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <label className="row" style={{ gap: 10, cursor: 'pointer', alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <input type="checkbox" checked={info.lanAccess} style={{ marginTop: 3 }}
              onChange={(e) => update({ lanAccess: e.target.checked }, e.target.checked
                ? 'Allow other devices on your home network to reach Vault Book? Only turn this on for a network you trust (not public Wi-Fi). Everyone still needs their own username and password.'
                : null)} />
            <span>
              <b><Wifi size={14} style={{ verticalAlign: -2 }} /> Allow access from other devices on my home network</b> <span className="badge">{info.lanActive ? 'Active' : 'Off'}</span>
              <div className="faint">Off by default, so Vault Book only works on this computer. Turn on to use it from phones or laptops on the same home network.</div>
            </span>
          </label>
          {info.restartNeeded && (
            <div className="info-box mt row" style={{ gap: 8, flexWrap: 'nowrap' }}>
              <RotateCw size={16} style={{ flex: 'none' }} /> Restart Vault Book (close and re-open it) for this change to take effect.
            </div>
          )}
          {info.lanActive && (
            <div className="stack mt" style={{ gap: 8 }}>
              {info.addresses.length > 0 && (
                <div>Open one of these on another device: {info.addresses.map((a) => <code key={a} style={{ marginRight: 10 }}>{a}</code>)}</div>
              )}
              {info.https ? (
                <div className="info-box row" style={{ gap: 8 }}><ShieldCheck size={16} /> HTTPS is on, so traffic on your network is encrypted.</div>
              ) : (
                <div className="warn-box row" style={{ gap: 8, flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <AlertTriangle size={16} style={{ flex: 'none', marginTop: 2 }} />
                  <span>Traffic between devices isn’t encrypted (plain HTTP), so someone else on your network could see it. For better protection, set up HTTPS (see the README section “Household mode & home-network access”). Your stored data is always encrypted.</span>
                </div>
              )}
              <p className="faint">Your computer’s firewall may ask whether to allow Vault Book on private networks. Allow it for private networks only.</p>
            </div>
          )}
        </div>
        {error && <div className="error-box">{error}</div>}
      </div>

      <AddMember open={adding} onClose={() => setAdding(false)} onAdded={(next) => { setInfo(next); setAdding(false); }} />
    </Card>
  );
}

function AddMember({ open, onClose, onAdded }) {
  const blank = { username: '', password: '', confirm: '', role: 'member' };
  const [f, setF] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF(blank); setError(''); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setError('Passwords do not match');
    setBusy(true);
    setError('');
    try {
      onAdded(await api('/admin/users', { method: 'POST', body: { username: f.username.trim(), password: f.password, role: f.role } }));
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add household member"
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="submit" form="add-member" className="btn primary" disabled={busy}><UserPlus size={16} /> {busy ? 'Adding…' : 'Add member'}</button>
      </>}>
      <form id="add-member" className="stack" style={{ gap: 14 }} onSubmit={submit}>
        <div className="field">
          <label htmlFor="m-user">Username</label>
          <input id="m-user" data-autofocus autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="m-pass">Password for them</label>
          <input id="m-pass" type="password" autoComplete="new-password" minLength={10} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
          <span className="hint">At least 10 characters. Let them sign in and change it in Settings. Share it in person, not by text or email.</span>
        </div>
        <div className="field">
          <label htmlFor="m-conf">Confirm password</label>
          <input id="m-conf" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required />
        </div>
        <div className="field">
          <label>Role</label>
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} style={{ maxWidth: 260 }}>
            <option value="member">Member: uses their own vault</option>
            <option value="admin">Admin: can also manage members and settings</option>
          </select>
        </div>
        <div className="warn-box">There’s no password recovery. If they forget it, their data can’t be opened by anyone, including you.</div>
        {error && <div className="error-box">{error}</div>}
      </form>
    </Modal>
  );
}
