import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Clock, KeyRound, Lock, MapPin, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import TaskMap from '../components/TaskMap.jsx';
import { ErrorNote, Spinner, StatusBadge } from '../components/ui.jsx';
import { fmtDateTime } from '../lib/format.js';

/**
 * Dedicated Verify Pickup screen: the carrier enters the provider's 6-digit OTP.
 * On success the server stamps `pickup_verified_at` and moves the listing to
 * PICKED_UP/IN_TRANSIT. The screen shows that timestamp.
 */
export default function VerifyPickup() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [task, setTask] = useState(null);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [verifiedAt, setVerifiedAt] = useState(null);

  const load = useCallback(() => {
    api
      .get(`/assignments/${id}`)
      .then((d) => {
        setTask(d.assignment);
        setVerifiedAt(d.assignment.pickup_verified_at || null);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/assignments/${id}/pickup`, { otp });
      setVerifiedAt(res.pickupVerifiedAt || res.assignment?.pickup_verified_at || 'now');
      setOtp('');
    } catch (err) {
      setError(err.message);
      load(); // refresh attempts / lock state
    } finally {
      setBusy(false);
    }
  };

  if (error && !task) return <div className="card p-4 text-red-700">{error}</div>;
  if (!task) return <Spinner />;

  const isVolunteer = task.volunteer_id === user.id;
  const delivered = task.status === 'DELIVERED';
  const locked = Boolean(task.pickup_otp_locked);
  const done = Boolean(verifiedAt) || Boolean(task.pickup_verified_at);

  if (!isVolunteer) {
    return (
      <div className="card space-y-3 p-5">
        <p className="inline-flex items-center gap-2 font-semibold text-navy-800">
          <ShieldAlert className="h-4 w-4 text-amber-600" /> Only the assigned carrier can verify this pickup.
        </p>
        <Link to={`/tasks/${id}`} className="btn-ghost w-fit">
          <ArrowLeft className="h-4 w-4" /> Back to delivery
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-navy-800">Verify pickup</h1>
            <StatusBadge status={task.listing?.status} />
          </div>
          <p className="text-sm text-navy-600">Delivery #{task.id} · {task.listing?.title}</p>
        </div>
        <button className="btn-ghost" onClick={() => navigate(`/tasks/${id}`)}>
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy-600">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" /> {task.listing?.address}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> Pickup by {fmtDateTime(task.listing?.pickup_deadline)}
          </span>
        </div>
        <div className="mt-3">
          <TaskMap taskId={task.id} height={220} pollMs={7000} />
        </div>
      </div>

      <ErrorNote>{error}</ErrorNote>

      {done ? (
        <div className="card space-y-3 p-5 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-brand" />
          <h2 className="text-lg font-bold text-navy-800">Pickup verified</h2>
          <p className="text-sm text-navy-700">
            Recorded at <strong>{fmtDateTime(verifiedAt || task.pickup_verified_at)}</strong>. The donation is now
            in transit — the recipient can follow the live map.
          </p>
          <div className="flex justify-center gap-2">
            <Link to={`/tasks/${id}`} className="btn-green">
              Open live delivery
            </Link>
          </div>
        </div>
      ) : (
        <form className="card space-y-4 p-5" onSubmit={submit}>
          <div className="flex items-start gap-2 rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-700">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-navy-800" />
            <span>Ask the provider for the 6-digit pickup OTP shown on their screen. It is stored hashed and
              verified with a limited number of attempts.</span>
          </div>

          <label className="block">
            <span className="label">Pickup OTP</span>
            <input
              className="input text-center text-2xl font-bold tracking-[0.5em]"
              placeholder="••••••"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoFocus
              disabled={locked}
            />
          </label>

          {locked ? (
            <p className="inline-flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <Lock className="h-4 w-4" /> Locked after too many incorrect attempts. Ask the provider to re-issue the OTP.
            </p>
          ) : (
            <p className="text-xs text-navy-600">{task.pickup_otp_remaining ?? 5} attempt(s) remaining.</p>
          )}

          <button className="btn-green w-full" type="submit" disabled={busy || locked || otp.length < 4}>
            <KeyRound className="h-4 w-4" /> {busy ? 'Verifying…' : 'Confirm pickup'}
          </button>
          {delivered && <p className="text-xs text-navy-600">This delivery is already complete.</p>}
        </form>
      )}
    </div>
  );
}
