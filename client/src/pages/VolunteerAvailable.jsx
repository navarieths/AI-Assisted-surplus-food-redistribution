import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, MapPin, Mail, Timer, Truck, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { Countdown, EmptyState, ErrorNote, SafetyDisclaimer, Spinner } from '../components/ui.jsx';
import { fmtDateTime, fromNow, num } from '../lib/format.js';

export default function VolunteerAvailable() {
  const navigate = useNavigate();
  const [invitations, setInvitations] = useState([]);
  const [tasks, setTasks] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [inv, avail] = await Promise.all([
        api.get('/assignments/invitations'),
        api.get('/assignments/available'),
      ]);
      setInvitations(inv.invitations || []);
      setTasks(avail.assignments || []);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const respond = async (offer, action) => {
    setBusy(offer.id);
    setError('');
    try {
      const res = await api.post(`/assignments/invitations/${offer.id}/respond`, { action });
      if (action === 'accept' && res.assignment?.id) {
        navigate(`/tasks/${res.assignment.id}`);
        return;
      }
      await load();
    } catch (e) {
      setError(e.message);
      load();
    } finally {
      setBusy(null);
    }
  };

  const claim = async (id) => {
    setBusy(id);
    setError('');
    try {
      await api.post(`/assignments/${id}/claim`);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (error && !tasks) return <div className="card p-4 text-red-700">{error}</div>;
  if (!tasks) return <Spinner />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-navy-800">Available pickups</h1>
        <p className="text-sm text-navy-600">
          Invitations you have been ranked for, plus open donations waiting for a carrier.
        </p>
      </div>
      <SafetyDisclaimer />
      <ErrorNote>{error}</ErrorNote>

      {invitations.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 font-semibold text-navy-800">
            <Mail className="h-4 w-4 text-brand" /> Invitations ({invitations.length})
          </h2>
          {invitations.map((inv) => (
            <div key={inv.id} className="card border-brand/40 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-navy-800">{inv.listing.title}</h3>
                    <span className="chip bg-brand-100 text-brand-700">rank #{inv.rank} · score {num(inv.score, 0)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-navy-600">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />{inv.listing.address}
                      {inv.travelMin != null ? ` · ${num(inv.travelMin, 1)} min to pickup` : ''}
                    </span>
                    {inv.distanceKm != null && <span>{num(inv.distanceKm)} km away</span>}
                    <span className="inline-flex items-center gap-1">
                      <Timer className="h-3 w-3" />Pickup by {fmtDateTime(inv.listing.pickup_deadline)} ({fromNow(inv.listing.pickup_deadline)})
                    </span>
                    <span>{num(inv.listing.quantity_kg)} kg · {inv.listing.servings} servings</span>
                    <span className="font-semibold text-amber-700">
                      <Countdown expiresAt={inv.expiresAt} />
                    </span>
                  </div>
                  {inv.reasons?.length > 0 && (
                    <ul className="mt-1 list-inside list-disc text-[11px] text-navy-600">
                      {inv.reasons.slice(0, 3).map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex gap-2">
                  <button className="btn-ghost" disabled={busy === inv.id} onClick={() => respond(inv, 'decline')}>
                    <X className="h-4 w-4" /> Decline
                  </button>
                  <button className="btn-green" disabled={busy === inv.id} onClick={() => respond(inv, 'accept')}>
                    <Check className="h-4 w-4" /> {busy === inv.id ? 'Saving…' : 'Accept'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold text-navy-800">Open pickups</h2>
        {tasks.length === 0 && <EmptyState title="No pickups available" hint="Check back soon." />}
        {tasks.map((t) => (
          <div key={t.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-navy-800">{t.title}</h3>
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-navy-600">
                  <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{t.address}{t.distanceFromMeKm != null ? ` · ${num(t.distanceFromMeKm)} km from you` : ''}</span>
                  <span className="inline-flex items-center gap-1"><Timer className="h-3 w-3" />Pickup by {fmtDateTime(t.pickup_deadline)} ({fromNow(t.pickup_deadline)})</span>
                  <span>{num(t.quantity_kg)} kg · {t.servings} servings</span>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-green" disabled={busy === t.id} onClick={() => claim(t.id)}>
                  <Truck className="h-4 w-4" /> {busy === t.id ? 'Claiming…' : 'Claim task'}
                </button>
              </div>
            </div>
          </div>
        ))}
      </section>

      <p className="text-xs text-navy-600">
        Tip: manage tasks from <Link to="/my-tasks" className="font-semibold text-brand-700 hover:underline">My tasks</Link>.
      </p>
    </div>
  );
}
