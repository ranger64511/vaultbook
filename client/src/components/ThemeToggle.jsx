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
    <div className="segmented theme-toggle" role="group" aria-label="Color theme">
      {OPTIONS.map(({ id, label, icon: Icon }) => (
        <button key={id} aria-pressed={pref === id} onClick={() => setPref(id)}>
          <Icon size={14} /> {label}
        </button>
      ))}
    </div>
  );
}
