import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, ReceiptText, Upload, CreditCard, Repeat, PiggyBank, Target, Settings as SettingsIcon,
  LogOut, Menu, TrendingUp,
} from 'lucide-react';
import { api, setUnauthorizedHandler } from './api.js';
import { DataProvider, useData } from './DataContext.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Transactions from './pages/Transactions.jsx';
import Import from './pages/Import.jsx';
import Accounts from './pages/Accounts.jsx';
import Recurring from './pages/Recurring.jsx';
import Budget from './pages/Budget.jsx';
import Payoff from './pages/Payoff.jsx';
import PayoffTheory from './pages/PayoffTheory.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'Transactions', icon: ReceiptText },
  { to: '/import', label: 'Import statements', icon: Upload },
  { to: '/accounts', label: 'Accounts', icon: CreditCard },
  { to: '/recurring', label: 'Recurring charges', icon: Repeat },
  { to: '/budget', label: 'Budget', icon: PiggyBank },
  {
    to: '/payoff', label: 'Debt payoff plan', icon: Target,
    children: [
      { to: '/payoff', label: 'Main plan', end: true },
      { to: '/payoff/theory', label: 'Payoff theory' },
    ],
  },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export default function App() {
  const [auth, setAuth] = useState(null);

  const refresh = useCallback(() => api('/auth/status').then(setAuth).catch(() => setAuth({ setUp: true, authenticated: false })), []);
  useEffect(() => {
    refresh();
    setUnauthorizedHandler(() => setAuth((a) => ({ ...a, authenticated: false })));
  }, [refresh]);

  if (!auth) return null;
  if (!auth.authenticated) return <Login setUp={auth.setUp} onDone={refresh} />;

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    refresh();
  };

  return (
    <DataProvider>
      <Shell username={auth.username} onLogout={logout} />
    </DataProvider>
  );
}

function Shell({ username, onLogout }) {
  const { data, error } = useData();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="app">
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Main navigation">
        <div className="brand">
          <span className="brand-mark"><TrendingUp size={17} strokeWidth={2.5} /></span>
          Vault Book
        </div>
        <nav className="stack" style={{ gap: 2 }}>
          {NAV.map(({ to, label, icon: Icon, end, children }) => (
            <div key={to}>
              <NavLink to={to} end={end} className="nav-link">
                <Icon size={18} strokeWidth={1.9} /> {label}
              </NavLink>
              {children && (
                <div className="nav-sub">
                  {children.map((ch) => (
                    <NavLink key={ch.to} to={ch.to} end={ch.end} className="nav-link nav-sublink">{ch.label}</NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <ThemeToggle />
          <div className="user-chip">
            <span className="avatar">{username?.[0]}</span>
            <span className="grow ellipsis">{username}</span>
            <button className="btn ghost icon sm" onClick={onLogout} title="Lock & sign out" aria-label="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        <div className="topbar-mobile">
          <button className="btn icon ghost" aria-label="Open menu" onClick={() => setOpen((o) => !o)}><Menu size={20} /></button>
          <strong>Vault Book</strong>
        </div>
        <main className="main">
          {error && <div className="error-box">{error}</div>}
          {data && (
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/import" element={<Import />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/recurring" element={<Recurring />} />
              <Route path="/budget" element={<Budget />} />
              <Route path="/payoff" element={<Payoff />} />
              <Route path="/payoff/theory" element={<PayoffTheory />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
        </main>
      </div>
    </div>
  );
}
