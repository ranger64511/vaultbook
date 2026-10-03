import { Monitor, Moon, Sun } from 'lucide-react';
import { useThemePreference } from '../lib/theme.js';

const OPTIONS = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'Auto', icon: Monitor },
];

export default function ThemeToggle() {
  const [pref, setPref] = useThemePreference();
  return (
    <div className="segmented" role="group" aria-label="Color theme" style={{ width: '100%' }}>
      {OPTIONS.map(({ id, label, icon: Icon }) => (
        <button key={id} aria-pressed={pref === id} onClick={() => setPref(id)} style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          <Icon size={14} /> {label}
        </button>
      ))}
    </div>
  );
}
