import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { money } from '../lib/format.js';

export function PageHead({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Card({ title, subtitle, action, children, className = '', ...rest }) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || action) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, icon: Icon, tone }) {
  return (
    <div className="card">
      <div className="stat-label">
        {Icon && <span className="stat-icon"><Icon size={16} /></span>}
        {label}
      </div>
      <div className={`stat-value ${tone || ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="empty">
      {Icon && <Icon size={34} strokeWidth={1.5} />}
      <h3>{title}</h3>
      <p>{children}</p>
      {action && <div className="mt">{action}</div>}
    </div>
  );
}

/** Native <dialog> modal: Esc and backdrop clicks close it. */
export function Modal({ open, onClose, title, children, footer, width }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal() moves focus to the first control; prefer a field marked data-autofocus.
      d.querySelector('[data-autofocus]')?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal"
      style={width ? { width: `min(${width}px, calc(100vw - 32px))` } : undefined}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      {open && (
        <>
          <div className="modal-head">
            <h2>{title}</h2>
            <button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

export function Amount({ value, signed = true, className = '' }) {
  const cls = value > 0 ? 'pos' : '';
  return <span className={`num ${cls} ${className}`}>{signed && value > 0 ? '+' : ''}{money(value)}</span>;
}

export function KindBadge({ kind }) {
  const label = { need: 'Need', want: 'Want', income: 'Income', transfer: 'Transfer' }[kind] || kind;
  return <span className={`badge ${kind}`}>{label}</span>;
}

export function Segmented({ value, onChange, options, label }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function CategorySelect({ categories, value, onChange, className = '', includeAll }) {
  const groups = [
    ['need', 'Needs'], ['want', 'Wants'], ['income', 'Income'], ['transfer', 'Transfers'],
  ];
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label="Category">
      {includeAll && <option value="">All categories</option>}
      {groups.map(([kind, label]) => (
        <optgroup key={kind} label={label}>
          {categories.filter((c) => c.kind === kind).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}
