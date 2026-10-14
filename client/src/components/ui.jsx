import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { statusMeta } from '../lib/format.js';

export function StatusBadge({ status }) {
  const m = statusMeta(status);
  return <span className={`chip ${m.cls}`}>{m.label}</span>;
}

/** Mandatory safety disclaimer shown on listing/validation screens. */
export function SafetyDisclaimer({ className = '' }) {
  return (
    <p className={`flex items-start gap-2 rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-700 ${className}`}>
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-navy-800" />
      <span>Checks are rule-based on provider-entered details. This platform does not certify food safety.</span>
    </p>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2 p-8 text-sm text-navy-600">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-navy-100 border-t-brand" />
      {label}
    </div>
  );
}

export function EmptyState({ title, hint }) {
  return (
    <div className="rounded-2xl border border-dashed border-navy-100 bg-white/60 p-8 text-center">
      <p className="font-semibold text-navy-800">{title}</p>
      {hint && <p className="mt-1 text-sm text-navy-600">{hint}</p>}
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-navy-600">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ children }) {
  if (!children) return null;
  return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{children}</p>;
}

export function InfoNote({ children }) {
  if (!children) return null;
  return <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{children}</p>;
}

/** Live countdown to an ISO/SQLite expiry timestamp. */
export function Countdown({ expiresAt, className = '' }) {
  const secondsLeft = () =>
    expiresAt ? Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)) : 0;
  const [left, setLeft] = useState(secondsLeft);
  useEffect(() => {
    setLeft(secondsLeft());
    if (!expiresAt) return undefined;
    const t = setInterval(() => setLeft(secondsLeft()), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);
  if (!expiresAt) return null;
  const m = Math.floor(left / 60);
  const s = left % 60;
  return <span className={className}>{left <= 0 ? 'expired' : `${m}:${String(s).padStart(2, '0')} left`}</span>;
}
