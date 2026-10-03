import { useState } from 'react';
import { Lock, ShieldCheck, TrendingUp } from 'lucide-react';
import { api } from '../api.js';
import ThemeToggle from '../components/ThemeToggle.jsx';

export default function Login({ setUp, onDone }) {
  const creating = !setUp;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (creating && password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      await api(creating ? '/auth/setup' : '/auth/login', { method: 'POST', body: { username, password } });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card stack">
        <div className="card stack" style={{ padding: 28 }}>
          <div className="brand">
            <span className="brand-mark"><TrendingUp size={17} strokeWidth={2.5} /></span>
            Vault Book
          </div>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 20 }}>{creating ? 'Create your account' : 'Welcome back'}</h1>
            <p className="muted" style={{ marginTop: 4 }}>
              {creating ? 'Your password encrypts all of your financial data.' : 'Sign in to unlock your data.'}
            </p>
          </div>
          <form className="stack" style={{ gap: 14 }} onSubmit={submit}>
            <div className="field">
              <label htmlFor="u">Username</label>
              <input id="u" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
            </div>
            <div className="field">
              <label htmlFor="p">Password</label>
              <input id="p" type="password" autoComplete={creating ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={creating ? 10 : undefined} />
              {creating && <span className="hint">At least 10 characters. A passphrase works well.</span>}
            </div>
            {creating && (
              <div className="field">
                <label htmlFor="c">Confirm password</label>
                <input id="c" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              </div>
            )}
            {error && <div className="error-box" role="alert">{error}</div>}
            <button className="btn primary block" disabled={busy} style={{ height: 40 }}>
              <Lock size={16} /> {busy ? (creating ? 'Creating…' : 'Unlocking…') : creating ? 'Create account' : 'Unlock'}
            </button>
          </form>
          {creating && (
            <div className="warn-box">
              There is no password reset. If you forget it, the encrypted data can’t be recovered. Store it in a password manager.
            </div>
          )}
          <div className="row faint" style={{ justifyContent: 'center', flexWrap: 'nowrap', gap: 6 }}>
            <ShieldCheck size={14} /> AES-256-GCM encrypted · stored only on this computer
          </div>
        </div>
        <ThemeToggle />
      </div>
    </div>
  );
}
