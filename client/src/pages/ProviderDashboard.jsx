import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Clock, Package, PlusCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { StatusBadge, SafetyDisclaimer, Spinner, EmptyState } from '../components/ui.jsx';
import { fmtDateTime, num } from '../lib/format.js';

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

function ListingRow({ listing }) {
  return (
    <Link to={`/listings/${listing.id}`} className="card block p-4 transition hover:border-brand">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold text-navy-800">{listing.title}</h3>
            <StatusBadge status={listing.status} />
          </div>
          <p className="mt-1 line-clamp-1 text-sm text-navy-600">{listing.description}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-navy-600">
            <span className="capitalize">{listing.food_type}</span>
            <span>{num(listing.quantity_kg)} kg · {listing.servings} servings</span>
            <span>Pickup by {fmtDateTime(listing.pickup_deadline)}</span>
          </div>
        </div>
        <span className="text-xs text-navy-500">#{listing.id}</span>
      </div>
      {listing.validation?.flags?.length > 0 && (
        <p className="mt-2 text-xs text-amber-700">
          {listing.validation.flags.length} validation note(s) — open to review, fix and resubmit.
        </p>
      )}
    </Link>
  );
}

export default function ProviderDashboard() {
  const { user } = useAuth();
  const [listings, setListings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = (showError = false) => {
      api
        .get('/listings')
        .then((d) => {
          if (!active) return;
          setListings(d.listings);
          setError('');
        })
        .catch((e) => {
          if (active && showError) setError(e.message);
        });
    };
    load(true);
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
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

  const history = (listings || [])
    .filter((listing) => ['DELIVERED', 'EXPIRED', 'NO_MATCH', 'DECLINED'].includes(listing.status))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  const current = (listings || []).filter(
    (listing) => !['DELIVERED', 'EXPIRED', 'NO_MATCH', 'DECLINED'].includes(listing.status)
  );

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
        <h2 className="font-semibold text-navy-800">Current listings</h2>
        {current.length === 0 && <EmptyState title="No current listings" hint="Create a listing to offer surplus food." />}
        {current.map((listing) => <ListingRow key={listing.id} listing={listing} />)}
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold text-navy-800">Listing history</h2>
        {history.length === 0 && <EmptyState title="No listing history" hint="Delivered, expired and unmatched listings will appear here." />}
        {history.map((listing) => <ListingRow key={listing.id} listing={listing} />)}
      </div>
    </div>
  );
}
