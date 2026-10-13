import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, MapPin, Timer, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { EmptyState, ErrorNote, SafetyDisclaimer, Spinner, StatusBadge } from '../components/ui.jsx';
import { fmtDateTime, fromNow, num } from '../lib/format.js';

export default function RecipientInbox() {
  const [offers, setOffers] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get('/matches/offers').then((d) => setOffers(d.offers)).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id, action) => {
    setBusy(`${id}-${action}`);
    setError('');
    try {
      await api.post(`/matches/${id}/${action}`);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (error && !offers) return <div className="card p-4 text-red-700">{error}</div>;
  if (!offers) return <Spinner />;

  const open = offers.filter((o) => o.status === 'OFFERED');
  const rest = offers.filter((o) => o.status !== 'OFFERED');

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-navy-800">Offers</h1>
        <p className="text-sm text-navy-600">Donations matched to you, ranked by a deterministic score.</p>
      </div>
      <SafetyDisclaimer />
      <ErrorNote>{error}</ErrorNote>

      {open.length === 0 && <EmptyState title="No open offers" hint="New matches will appear here automatically." />}

      {open.map((o) => (
        <div key={o.id} className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-navy-800">{o.listing.title}</h2>
                <StatusBadge status={o.listing.status} />
                <span className="chip bg-brand-100 text-brand-700">score {num(o.score)}</span>
              </div>
              <p className="mt-1 text-sm text-navy-600">{o.listing.provider?.org_name} · {o.listing.address}</p>
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-navy-600">
                <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{num(o.distance_km)} km · ~{num(o.duration_min, 0)} min {o.estimated ? '(est.)' : ''}</span>
                <span className="inline-flex items-center gap-1"><Timer className="h-3 w-3" />Pickup by {fmtDateTime(o.listing.pickup_deadline)} ({fromNow(o.listing.pickup_deadline)})</span>
                <span className="capitalize">{o.listing.food_type} · {num(o.listing.quantity_kg)} kg · {o.listing.servings} servings</span>
              </div>
            </div>
          </div>
          {o.explanation && <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">{o.explanation}</p>}
          <div className="mt-4 flex gap-2">
            <button className="btn-green" disabled={busy === `${o.id}-accept`} onClick={() => act(o.id, 'accept')}>
              <Check className="h-4 w-4" /> {busy === `${o.id}-accept` ? 'Accepting…' : 'Accept'}
            </button>
            <button className="btn-ghost" disabled={busy === `${o.id}-decline`} onClick={() => act(o.id, 'decline')}>
              <X className="h-4 w-4" /> Decline
            </button>
            <Link to={`/listings/${o.listing.id}`} className="btn-ghost">View listing</Link>
          </div>
        </div>
      ))}

      {rest.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold text-navy-800">History</h2>
          {rest.map((o) => (
            <div key={o.id} className="card flex items-center justify-between gap-3 p-4">
              <div>
                <div className="font-medium text-navy-800">{o.listing.title}</div>
                <div className="text-xs text-navy-600">{fmtDateTime(o.updated_at)} · score {num(o.score)}</div>
              </div>
              <StatusBadge status={o.listing.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
