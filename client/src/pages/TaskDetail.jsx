import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertOctagon,
  CheckCircle2,
  KeyRound,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import TaskMap from '../components/TaskMap.jsx';
import LocationSharer from '../components/LocationSharer.jsx';
import { ErrorNote, SafetyDisclaimer, Spinner, StatusBadge } from '../components/ui.jsx';
import { fmtDateTime, num } from '../lib/format.js';

export default function TaskDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [task, setTask] = useState(null);
  const [carriers, setCarriers] = useState([]);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    api
      .get(`/tasks/${id}`)
      .then((d) => {
        setTask(d.task);
        return api.get(`/volunteers${api.searchParams({ listing_id: d.task.listing_id })}`);
      })
      .then((d) => setCarriers(d.carriers || []))
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (name, fn) => {
    setBusy(name);
    setError('');
    setMessage('');
    try {
      const res = await fn();
      setMessage(res?.message || 'Done.');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const confirmPickup = () =>
    run('pickup', async () => {
      await api.post(`/tasks/${id}/pickup`, { otp });
      return { message: 'Pickup verified. Status set to IN_TRANSIT.' };
    });

  const confirmDelivery = () =>
    run('deliver', async () => {
      await api.post(`/tasks/${id}/confirm-delivery`);
      return { message: 'Delivery confirmed. Thank you!' };
    });

  const assign = (volunteerId) =>
    run('assign', async () => {
      await api.post(`/tasks/${id}/assign`, { volunteer_id: volunteerId });
      return { message: 'Carrier assigned.' };
    });

  const fallback = () =>
    run('fallback', async () => {
      const res = await api.post(`/tasks/${id}/fallback`);
      return { message: `Fallback assigned to ${res.fallback}.` };
    });

  if (error && !task) return <div className="card p-4 text-red-700">{error}</div>;
  if (!task) return <Spinner />;

  const isVolunteer = task.volunteer_id === user.id;
  const isRecipient = task.recipient_id === user.id;
  const isProvider = user.role === 'provider';
  const pickedUp = Boolean(task.pickup_verified_at);
  const delivered = task.status === 'DELIVERED';

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
          <TaskMap taskId={task.id} />
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
            </div>
          </div>

          {/* Volunteer controls */}
          {isVolunteer && !delivered && (
            <div className="card space-y-3 p-4">
              <h2 className="font-semibold text-navy-800">Carrier actions</h2>
              <LocationSharer taskId={task.id} active={!delivered} />
              {!pickedUp ? (
                <div>
                  <label className="label">Enter pickup OTP</label>
                  <div className="flex gap-2">
                    <input className="input" placeholder="6-digit OTP" value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" />
                    <button className="btn-green" disabled={busy === 'pickup' || otp.length < 4} onClick={confirmPickup}>
                      <KeyRound className="h-4 w-4" /> Verify
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-navy-600">
                    Simulated OTP for this demo: <code className="rounded bg-navy-50 px-1">{task.pickup_otp}</code> (also printed in the server console)
                  </p>
                </div>
              ) : (
                <p className="inline-flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm text-indigo-700">
                  <Truck className="h-4 w-4" /> Picked up — en route. Recipient will confirm delivery.
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
              <p className="inline-flex items-center gap-2 text-sm text-navy-700">
                <ShieldCheck className="h-4 w-4 text-brand" /> Pickup OTP to share with the carrier:{' '}
                <code className="rounded bg-navy-50 px-1">{task.pickup_otp}</code>
              </p>
              {!task.volunteer_id && (
                <div>
                  <p className="label">Assign a carrier</p>
                  <div className="max-h-56 space-y-2 overflow-auto">
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
                </div>
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
