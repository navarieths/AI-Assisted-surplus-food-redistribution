export function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function fromNow(v) {
  if (!v) return '—';
  const d = new Date(v).getTime();
  if (Number.isNaN(d)) return '—';
  const diff = d - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const label =
    mins < 60 ? `${mins}m` : abs < 86400000 ? `${Math.round(mins / 60)}h` : `${Math.round(mins / 1440)}d`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

export const STATUS_META = {
  LISTED: { label: 'Listed', cls: 'bg-navy-50 text-navy-800' },
  FLAGGED: { label: 'Flagged', cls: 'bg-red-100 text-red-700' },
  ELIGIBLE: { label: 'Eligible', cls: 'bg-brand-100 text-brand-700' },
  OFFERED: { label: 'Offered', cls: 'bg-amber-100 text-amber-700' },
  ACCEPTED: { label: 'Accepted', cls: 'bg-amber-100 text-amber-700' },
  VOLUNTEER_ASSIGNED: { label: 'Volunteer assigned', cls: 'bg-indigo-100 text-indigo-700' },
  PICKED_UP: { label: 'Picked up', cls: 'bg-indigo-100 text-indigo-700' },
  IN_TRANSIT: { label: 'In transit', cls: 'bg-blue-100 text-blue-700' },
  DELIVERED: { label: 'Delivered', cls: 'bg-brand-100 text-brand-700' },
  DECLINED: { label: 'Declined', cls: 'bg-slate-100 text-slate-600' },
  NO_MATCH: { label: 'No match', cls: 'bg-slate-100 text-slate-600' },
  EXPIRED: { label: 'Expired', cls: 'bg-slate-100 text-slate-600' },
  AT_RISK: { label: 'At risk', cls: 'bg-orange-100 text-orange-700' },
};

export function statusMeta(s) {
  return STATUS_META[s] || { label: s || '—', cls: 'bg-slate-100 text-slate-600' };
}

export function severityMeta(s) {
  if (s === 'high') return { label: 'High', cls: 'bg-red-100 text-red-700' };
  if (s === 'medium') return { label: 'Medium', cls: 'bg-amber-100 text-amber-700' };
  return { label: 'Low', cls: 'bg-slate-100 text-slate-600' };
}

export function num(v, digits = 1) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}
