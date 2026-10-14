import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertOctagon,
  CheckCircle2,
  Clock,
  Eye,
  KeyRound,
  Lock,
  PackageCheck,
  RefreshCw,
  Send,
  ShieldCheck,
  Truck,
  Users,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import TaskMap from '../components/TaskMap.jsx';
import LocationSharer from '../components/LocationSharer.jsx';
import { Countdown, ErrorNote, SafetyDisclaimer, Spinner, StatusBadge } from '../components/ui.jsx';
import { fmtDateTime, num } from '../lib/format.js';

const OFFER_META = {
  OFFERED: { label: 'Invited', cls: 'bg-amber-100 text-amber-700' },
  ACCEPTED: { label: 'Accepted', cls: 'bg-brand-100 text-brand-700' },
  DECLINED: { label: 'Declined', cls: 'bg-slate-100 text-slate-600' },
  EXPIRED: { label: 'Expired', cls: 'bg-slate-100 text-slate-600' },
};

function OfferRow({ offer }) {
  const meta = OFFER_META[offer.status] || OFFER_META.OFFERED;
  return (
    <div className="rounded-lg border border-navy-100 px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          #{offer.rank} {offer.name}
          <span className="ml-2 text-xs capitalize text-navy-600">{String(offer.role).replace('_', ' ')}</span>
        </span>
        <span className={`chip ${meta.cls}`}>{meta.label}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-navy-600">
        <span>score {num(offer.score, 0)}</span>
        <span>{num(offer.travelMin, 1)} min to pickup</span>
        <span>{num(offer.distanceKm)} km</span>
        {!offer.feasible && <span className="text-amber-700">feasibility risk</span>}
        {offer.status === 'OFFERED' && <Countdown expiresAt={offer.expiresAt} />}
      </div>
      {offer.reasons?.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-[11px] text-navy-600">
          {offer.reasons.slice(0, 3).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TaskDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [task, setTask] = useState(null);
  const [carriers, setCarriers] = useState([]);
  const [offers, setOffers] = useState([]);
  const [otpReveal, setOtpReveal] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const isProvider = user.role === 'provider';

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/assignments/${id}`);
      setTask(d.assignment);
      if (isProvider) {
        const [v, o] = await Promise.all([
          api.get(`/volunteers${api.searchParams({ listing_id: d.assignment.listing_id })}`).catch(() => ({ carriers: [] })),
          api.get(`/assignments/${id}/volunteer-offers`).catch(() => ({ offers: [] })),
        ]);
        setCarriers(v.carriers || []);
        setOffers(o.offers || []);
      }
    } catch (e) {
      setError(e.message);
    }
  }, [id, isProvider]);

  const refreshAssignment = useCallback(async () => {
    try {
      const d = await api.get(`/assignments/${id}`);
      setTask(d.assignment);
    } catch {
      // Keep the last successful assignment state visible during brief network failures.
    }
  }, [id]);

  useEffect(() => {
    load();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshAssignment();
    }, 5000);
    return () => window.clearInterval(interval);
  }, [load, refreshAssignment]);

  const run = async (name, fn) => {
    setBusy(name);
    setError('');
    setMessage('');
    try {
      const res = await fn();
      setMessage(res?.message || 'Done.');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const confirmDelivery = () =>
    run('deliver', async () => {
      await api.post(`/assignments/${id}/confirm-delivery`);
      return { message: 'Delivery confirmed. Thank you!' };
    });

  const assign = (volunteerId) =>
    run('assign', async () => {
      await api.post(`/assignments/${id}/assign`, { volunteer_id: volunteerId });
      return { message: 'Carrier assigned.' };
    });

  const invite = () =>
    run('invite', async () => {
      const res = await api.post(`/assignments/${id}/invite`);
      const live = (res.offers || []).filter((o) => o.status === 'OFFERED').length;
      setOffers(res.offers || []);
      return { message: `Invited ${live} ranked volunteer(s). Invitations expire automatically.` };
    });

  const revealOtp = async () => {
    setBusy('reveal');
    setError('');
    try {
      const res = await api.get(`/assignments/${id}/pickup-otp`);
      setOtpReveal(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const fallback = () =>
    run('fallback', async () => {
      const res = await api.post(`/assignments/${id}/fallback`);
      return { message: `Fallback assigned to ${res.fallback}.` };
    });

  if (error && !task) return <div className="card p-4 text-red-700">{error}</div>;
  if (!task) return <Spinner />;

  const isVolunteer = task.volunteer_id === user.id;
  const isRecipient = task.recipient_id === user.id;
  const pickedUp = Boolean(task.pickup_verified_at);
  const delivered = task.status === 'DELIVERED';
  const liveOffers = offers.filter((o) => o.status === 'OFFERED');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-navy-800">Delivery #{task.id}</h1>
            <StatusBadge status={task.listing?.status} />
          </div>
          <p className="text-sm text-navy-600">{task.listing?.title} · {num(task.listing?.quantity_kg)} kg</p>
        </div>
        <Link to={`/listings/${task.listing_id}`} className="btn-ghost">View listing</Link>
      </div>

      <SafetyDisclaimer />
      <ErrorNote>{error}</ErrorNote>
      {message && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{message}</p>}

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="card p-4">
          <h2 className="mb-3 font-semibold text-navy-800">Live tracking</h2>
          <TaskMap taskId={task.id} canSimulate />
        </div>

        <div className="space-y-4">
          <div className="card p-4">
            <h2 className="mb-3 font-semibold text-navy-800">Parties</h2>
            <div className="space-y-2 text-sm">
              <div><span className="text-navy-600">Provider:</span> {task.provider?.org_name || task.provider?.name}</div>
              <div><span className="text-navy-600">Recipient:</span> {task.recipient?.org_name || task.recipient?.name}</div>
              <div><span className="text-navy-600">Carrier:</span> {task.volunteer?.name || 'unassigned'}</div>
              {task.contactVisible && (
                <div className="rounded-lg bg-brand-50 p-2 text-xs text-brand-700">
                  Provider {task.provider?.phone} · Recipient {task.recipient?.phone} · Carrier {task.volunteer?.phone || '—'}
                </div>
              )}
              <div className="text-xs text-navy-600">Pickup deadline: {fmtDateTime(task.listing?.pickup_deadline)}</div>
              {pickedUp && (
                <div className="inline-flex items-center gap-1 text-xs text-indigo-700">
                  <Clock className="h-3.5 w-3.5" /> Pickup verified {fmtDateTime(task.pickup_verified_at)}
                </div>
              )}
            </div>
          </div>

          {/* Volunteer controls */}
          {isVolunteer && !delivered && (
            <div className="card space-y-3 p-4">
              <h2 className="font-semibold text-navy-800">Carrier actions</h2>
              <LocationSharer taskId={task.id} active={!delivered} />
              {!pickedUp ? (
                <div className="space-y-2">
                  <p className="text-sm text-navy-700">
                    Confirm collection by entering the provider's 6-digit OTP. Verifying timestamps the
                    pickup and starts the live route to the recipient.
                  </p>
                  {task.pickup_otp_locked ? (
                    <p className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                      <Lock className="h-4 w-4" /> OTP locked after too many attempts. Ask the provider to re-issue.
                    </p>
                  ) : (
                    <p className="text-xs text-navy-600">
                      {task.pickup_otp_remaining ?? 5} attempt(s) remaining.
                    </p>
                  )}
                  <Link to={`/tasks/${task.id}/verify`} className="btn-green w-full justify-center">
                    <KeyRound className="h-4 w-4" /> Verify pickup
                  </Link>
                </div>
              ) : (
                <p className="inline-flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
                  <Truck className="h-4 w-4" /> Picked up at {fmtDateTime(task.pickup_verified_at)} — en route.
                </p>
              )}
              <button className="btn-ghost w-full" disabled={busy === 'fallback'} onClick={fallback}>
                <RefreshCw className="h-4 w-4" /> I can't make it — fallback
              </button>
            </div>
          )}

          {/* Recipient controls */}
          {isRecipient && (
            <div className="card space-y-3 p-4">
              <h2 className="font-semibold text-navy-800">Recipient actions</h2>
              {pickedUp && !delivered && (
                <button className="btn-green w-full" disabled={busy === 'deliver'} onClick={confirmDelivery}>
                  <PackageCheck className="h-4 w-4" /> Confirm delivery received
                </button>
              )}
              {delivered && (
                <p className="inline-flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
                  <CheckCircle2 className="h-4 w-4" /> Delivered and confirmed.
                </p>
              )}
              {!pickedUp && !delivered && <p className="text-sm text-navy-600">Waiting for the volunteer to collect and verify pickup.</p>}
              <p className="text-xs text-navy-600">Simulated delivery OTP: <code className="rounded bg-navy-50 px-1">{task.delivery_otp}</code></p>
            </div>
          )}

          {/* Provider controls */}
          {isProvider && (
            <div className="card space-y-3 p-4">
              <h2 className="font-semibold text-navy-800">Provider actions</h2>

              <div className="rounded-lg border border-navy-100 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-navy-800">
                  <ShieldCheck className="h-4 w-4 text-brand" /> Pickup OTP
                </div>
                {otpReveal?.otp ? (
                  <div className="mt-1">
                    <code className="rounded bg-navy-50 px-2 py-1 text-lg font-bold tracking-widest">{otpReveal.otp}</code>
                    <p className="mt-1 text-xs text-navy-600">
                      Issued {fmtDateTime(task.pickup_otp_issued_at)} · stored hashed · share only with the carrier.
                    </p>
                  </div>
                ) : task.pickup_otp_available ? (
                  <button className="btn-ghost mt-2 w-full" disabled={busy === 'reveal'} onClick={revealOtp}>
                    <Eye className="h-4 w-4" /> Reveal pickup OTP
                  </button>
                ) : (
                  <p className="mt-1 text-xs text-navy-600">No pickup OTP yet — invite or assign a carrier to issue one.</p>
                )}
              </div>

              {!task.volunteer_id && !delivered && (
                <div className="space-y-2">
                  <button className="btn-green w-full" disabled={busy === 'invite'} onClick={invite}>
                    <Send className="h-4 w-4" /> Rank &amp; invite volunteers
                  </button>
                  <p className="text-xs text-navy-600">
                    Invitations are ranked by real travel time to pickup, availability and feasibility.
                  </p>
                  {offers.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1 text-xs font-semibold text-navy-700">
                        <Users className="h-3.5 w-3.5" /> {liveOffers.length} live invitation(s)
                      </div>
                      {offers.map((o) => (
                        <OfferRow key={o.id} offer={o} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!task.volunteer_id && (
                <details>
                  <summary className="cursor-pointer text-xs font-semibold text-navy-700">Or assign a carrier directly</summary>
                  <div className="mt-2 max-h-56 space-y-2 overflow-auto">
                    {carriers.map((c) => (
                      <button
                        key={c.id}
                        className="flex w-full items-center justify-between rounded-lg border border-navy-100 px-3 py-2 text-left text-sm hover:bg-brand-50"
                        disabled={busy === 'assign'}
                        onClick={() => assign(c.id)}
                      >
                        <span>
                          <span className="font-medium">{c.name}</span>
                          <span className="ml-2 text-xs capitalize text-navy-600">{c.role.replace('_', ' ')}</span>
                        </span>
                        <span className="text-xs text-navy-600">{c.distanceKm != null ? `${num(c.distanceKm)} km` : ''}</span>
                      </button>
                    ))}
                  </div>
                </details>
              )}

              <button className="btn-ghost w-full" disabled={busy === 'fallback'} onClick={fallback}>
                <AlertOctagon className="h-4 w-4" /> Trigger fallback carrier
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
