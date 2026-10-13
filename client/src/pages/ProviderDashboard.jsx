import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, Package, PlusCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { StatusBadge, SafetyDisclaimer, Spinner, EmptyState } from '../components/ui.jsx';
import { fmtDateTime, fromNow, num } from '../lib/format.js';

function Stat({ icon: Icon, label, value, tone = 'navy' }) {
  const tones = {
    navy: 'bg-navy-50 text-navy-800',
    green: 'bg-brand-50 text-brand-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  };
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${tones[tone]}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <div className="text-xl font-bold text-navy-800">{value}</div>
        <div className="text-xs text-navy-600">{label}</div>
      </div>
    </div>
  );
}

export default function ProviderDashboard() {
  const { user } = useAuth();
  const [listings, setListings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/listings')
      .then((d) => setListings(d.listings))
      .catch((e) => setError(e.message));
  }, []);

  const stats = useMemo(() => {
    const l = listings || [];
    return {
      total: l.length,
      active: l.filter((x) => ['ELIGIBLE', 'OFFERED', 'ACCEPTED', 'VOLUNTEER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT'].includes(x.status)).length,
      flagged: l.filter((x) => x.status === 'FLAGGED').length,
      delivered: l.filter((x) => x.status === 'DELIVERED').length,
      kgDelivered: l.filter((x) => x.status === 'DELIVERED').reduce((s, x) => s + (x.quantity_kg || 0), 0),
    };
  }, [listings]);

  if (error) return <div className="card p-4 text-red-700">{error}</div>;
  if (!listings) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-navy-800">Provider dashboard</h1>
          <p className="text-sm text-navy-600">{user.org_name || user.name} · {user.address}</p>
        </div>
        <Link to="/listings/new" className="btn-green">
          <PlusCircle className="h-4 w-4" /> List surplus food
        </Link>
      </div>

      <SafetyDisclaimer />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={Package} label="Listings" value={stats.total} />
        <Stat icon={Clock} label="Active" value={stats.active} tone="amber" />
        <Stat icon={AlertTriangle} label="Flagged" value={stats.flagged} tone="red" />
        <Stat icon={CheckCircle2} label="Delivered" value={`${stats.delivered} · ${num(stats.kgDelivered)} kg`} tone="green" />
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold text-navy-800">Your listings</h2>
        {listings.length === 0 && <EmptyState title="No listings yet" hint="Create your first surplus food listing." />}
        {listings.map((l) => (
          <Link key={l.id} to={`/listings/${l.id}`} className="card block p-4 transition hover:border-brand">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-semibold text-navy-800">{l.title}</h3>
                  <StatusBadge status={l.status} />
                </div>
                <p className="mt-1 line-clamp-1 text-sm text-navy-600">{l.description}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-navy-600">
                  <span className="capitalize">{l.food_type}</span>
                  <span>{num(l.quantity_kg)} kg · {l.servings} servings</span>
                  <span>Pickup by {fmtDateTime(l.pickup_deadline)} ({fromNow(l.pickup_deadline)})</span>
                </div>
              </div>
              <span className="text-xs text-navy-500">#{l.id}</span>
            </div>
            {l.validation?.flags?.length > 0 && (
              <p className="mt-2 text-xs text-amber-700">{l.validation.flags.length} validation note(s) — open to review.</p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
