import { useEffect, useState, useSyncExternalStore } from 'react';

const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

function readPref() {
  try { return localStorage.getItem('color-scheme') || 'system'; } catch { return 'system'; }
}

/** Stored preference: 'light' | 'dark' | 'system'. */
export function useThemePreference() {
  const [pref, setPref] = useState(readPref);
  useEffect(() => {
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (pref === 'system') {
      delete document.documentElement.dataset.theme;
      meta.content = 'light dark';
      try { localStorage.removeItem('color-scheme'); } catch { /* storage unavailable */ }
    } else {
      document.documentElement.dataset.theme = pref;
      meta.content = pref;
      try { localStorage.setItem('color-scheme', pref); } catch { /* storage unavailable */ }
    }
    window.dispatchEvent(new Event('themechange'));
  }, [pref]);
  return [pref, setPref];
}

function subscribe(cb) {
  const m = mq();
  m.addEventListener('change', cb);
  window.addEventListener('themechange', cb);
  return () => {
    m.removeEventListener('change', cb);
    window.removeEventListener('themechange', cb);
  };
}
const snapshot = () => document.documentElement.dataset.theme || (mq().matches ? 'dark' : 'light');

/** The theme actually in effect ('light' | 'dark'), tracking OS changes. */
export const useResolvedTheme = () => useSyncExternalStore(subscribe, snapshot);

// Chart palette: validated categorical order, stepped separately for each mode.
const PALETTE = {
  light: {
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
    grid: '#e9e8e2', axis: '#c3c2b7', muted: '#898781', ink: '#52514e', surface: '#ffffff',
  },
  dark: {
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
    grid: '#2a2a28', axis: '#383835', muted: '#898781', ink: '#c3c2b7', surface: '#171716',
  },
};
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };

export function useChartColors() {
  return PALETTE[useResolvedTheme()];
}
