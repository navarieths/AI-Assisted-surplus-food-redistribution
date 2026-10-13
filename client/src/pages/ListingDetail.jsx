import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  BadgeCheck,
  Clock,
  Pencil,
  RefreshCw,
  Sparkles,
  Truck,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { MapView } from '../components/MapView.jsx';
import { dropIcon, pickupIcon } from '../lib/leafletIcons.js';
import { ErrorNote, SafetyDisclaimer, Spinner, StatusBadge } from '../components/ui.jsx';
import { fmtDateTime, fromNow, num, severityMeta, statusMeta } from '../lib/format.js';

function ScoreBar({ label, value, max }) {
  const pct = max ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-xs text-navy-600">
        <span className="capitalize">{label}</span>
        <span>{num(value)}/{max}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-navy-50">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function MatchCard({ match, onExplain }) {
  const [explaining, setExplaining] = useState(false);
  const [text, setText] = useState(match.explanation);
  const b = match.breakdown || {};
  const w = b.weights || {};
  return (
    <div className="rounded-xl border border-navy-100 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-navy-800">
            #{match.rank} {match.recipient_name || match.org_name}
            <span className="ml-2 text-xs font-normal text-navy-600">{statusMeta(match.status).label}</span>
          </div>
          <div className="text-xs text-navy-600">
            {num(match.distance_km)} km · ~{num(match.duration_min, 0)} min {match.estimated ? '(estimated)' : '(road route)'}
          </div>
        </div>
        <span className="rounded-lg bg-navy-800 px-2.5 py-1 text-sm font-bold text-white">{num(match.score)}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <ScoreBar label="food fit" value={b.foodCompatibility} max={w.foodCompatibility} />
        <ScoreBar label="demand" value={b.demand} max={w.demand} />
        <ScoreBar label="quantity fit" value={b.quantityFit} max={w.quantityFit} />
        <ScoreBar label="road distance" value={b.roadDistance} max={w.roadDistance} />
        <ScoreBar label="time feasibility" value={b.timeFeasibility} max={w.timeFeasibility} />
      </div>
      {b.feasibilityReasons?.length > 0 && (
        <p className="mt-2 text-xs text-amber-700">{b.feasibilityReasons.join(' ')}</p>
      )}
      <p className="mt-2 text-xs text-navy-700">{text}</p>
      <button
        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline"
        disabled={explaining}
        onClick={async () => {
          setExplaining(true);
          const t = await onExplain(match.id);
          if (t) setText(t);
          setExplaining(false);
        }}
      >
        <Sparkles className="h-3 w-3" /> {explaining ? 'Rewriting…' : 'Rewrite explanation (optional AI)'}
      </button>
    </div>
  );
}

export default function ListingDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [matchMap, setMatchMap] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/listings/${id}`);
      setData(d.listing);
      if (user.role === 'provider') {
        const [t, mm] = await Promise.all([
          api.get('/assignments'),
          api.get(`/listings/${id}/matches`).catch(() => null),
        ]);
        setTasks((t.assignments || []).filter((x) => x.listing_id === Number(id)));
        setMatchMap(mm);
      }
    } catch (e) {
      setError(e.message);
    }
  }, [id, user.role]);

  useEffect(() => {
    load();
  }, [load]);

  const action = async (name, path) => {
    setBusy(name);
    setError('');
    setNotice('');
    try {
      await api.post(path);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const explain = async (matchId) => {
    try {
      const res = await api.post(`/offers/${matchId}/explain`);
      setNotice('Explanation rewritten.');
      return res.explanation;
    } catch (e) {
      setError(e.message);
      return null;
    }
  };

  if (error && !data) return <div className="card p-4 text-red-700">{error}</div>;
  if (!data) return <Spinner />;

  const isOwner = user.role === 'provider' && data.provider_id === user.id;
  const flags = data.validation?.flags || [];
  const task = tasks[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-navy-800">{data.title}</h1>
            <StatusBadge status={data.status} />
          </div>
          <p className="text-sm text-navy-600">
            #{data.id} · {data.provider?.org_name || data.provider?.name} · {data.address}
          </p>
        </div>
        {isOwner && !['DELIVERED', 'EXPIRED'].includes(data.status) && (
          <Link to={`/listings/${data.id}/edit`} className="btn-ghost">Edit</Link>
        )}
      </div>

      <SafetyDisclaimer />
      <ErrorNote>{error}</ErrorNote>

      {data.status === 'FLAGGED' && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div className="space-y-2">
              <div>
                <p className="font-semibold text-red-800">
                  This listing is flagged and is not being offered to recipients.
                </p>
                <p className="text-sm text-red-700">
                  Fix the blocking reasons below, then edit and resubmit to re-run the checks.
                </p>
              </div>
              <ul className="list-disc space-y-1 pl-4 text-sm text-red-700">
                {(flags.filter((f) => f.severity === 'high').length
                  ? flags.filter((f) => f.severity === 'high')
                  : flags
                ).map((f) => (
                  <li key={f.code}>{f.message}</li>
                ))}
              </ul>
              {isOwner && (
                <Link to={`/listings/${data.id}/edit`} className="btn-danger">
                  <Pencil className="h-4 w-4" /> Edit &amp; resubmit
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
      {notice && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{notice}</p>}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="mb-3 font-semibold text-navy-800">Details</h2>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div><dt className="text-navy-600">Food type</dt><dd className="font-medium capitalize">{data.food_type}</dd></div>
              <div><dt className="text-navy-600">Quantity</dt><dd className="font-medium">{num(data.quantity_kg)} kg · {data.servings} servings</dd></div>
              <div><dt className="text-navy-600">Storage</dt><dd className="font-medium capitalize">{data.storage_condition}</dd></div>
              <div><dt className="text-navy-600">Ready</dt><dd className="font-medium">{fmtDateTime(data.ready_at)}</dd></div>
              <div><dt className="text-navy-600">Pickup deadline</dt><dd className="font-medium">{fmtDateTime(data.pickup_deadline)} ({fromNow(data.pickup_deadline)})</dd></div>
              <div><dt className="text-navy-600">Allergens</dt><dd className="font-medium">{data.allergens || 'Not declared'}</dd></div>
              <div className="col-span-2"><dt className="text-navy-600">Packaging</dt><dd className="font-medium">{data.packaging || '—'}</dd></div>
              <div className="col-span-2"><dt className="text-navy-600">Handling &amp; storage</dt><dd className="font-medium">{data.handling_notes || '—'}</dd></div>
              <div className="col-span-2"><dt className="text-navy-600">Description</dt><dd>{data.description || '—'}</dd></div>
            </dl>
            {data.provider?.contactVisible ? (
              <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
                Provider contact: {data.provider.contact_name || data.provider.name} · {data.provider.phone || '—'} · {data.provider.email}
              </p>
            ) : (
              <p className="mt-3 text-xs text-navy-500">Contact details are visible only to authorized participants of this donation.</p>
            )}
          </div>

          <div className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-navy-800">
              {data.validation?.eligible ? <BadgeCheck className="h-5 w-5 text-brand" /> : <AlertTriangle className="h-5 w-5 text-red-600" />}
              Validation {data.validation ? (data.validation.eligible ? 'passed' : 'flagged') : 'pending'}
            </h2>
            {!data.validation && <p className="text-sm text-navy-600">Not yet validated.</p>}
            {data.validation && (
              <>
                <p className="text-sm text-navy-700">{data.validation.summary}</p>
                <ul className="mt-3 space-y-2">
                  {flags.map((f) => {
                    const sm = severityMeta(f.severity);
                    return (
                      <li key={f.code} className="flex items-start gap-2 text-sm">
                        <span className={`chip ${sm.cls}`}>{sm.label}</span>
                        <span className="text-navy-700">{f.message}</span>
                      </li>
                    );
                  })}
                  {flags.length === 0 && <li className="text-sm text-navy-600">No issues found by the rule checks.</li>}
                </ul>
              </>
            )}
            <p className="mt-3 text-xs text-navy-500">Checked {data.validation?.checkedAt ? fmtDateTime(data.validation.checkedAt) : '—'}</p>
          </div>

          {isOwner && data.offers && data.offers.length > 0 && (
            <div className="card p-5">
              <h2 className="mb-3 font-semibold text-navy-800">Ranked matches</h2>
              <div className="space-y-3">
                {(data.offers || []).map((m) => (
                  <MatchCard key={m.id} match={{ ...m, breakdown: safeJson(m.breakdown_json) }} onExplain={explain} />
                ))}
              </div>
            </div>
          )}

          {isOwner && matchMap && matchMap.matches && matchMap.matches.length > 0 && (
            <div className="card p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-navy-800">Match map</h2>
                <span className="text-xs text-navy-600">
                  Top {matchMap.matches.length} of {matchMap.resultLimit} ·{' '}
                  {matchMap.estimated ? 'some distances estimated' : 'live road routes'}
                </span>
              </div>
              <MapView
                markers={[
                  {
                    lat: matchMap.pickup.lat,
                    lng: matchMap.pickup.lng,
                    icon: pickupIcon,
                    title: `Pickup — ${matchMap.pickup.title}`,
                    label: matchMap.pickup.address,
                  },
                  ...matchMap.matches.map((m) => ({
                    lat: m.recipient.lat,
                    lng: m.recipient.lng,
                    icon: dropIcon,
                    title: `#${m.rank} ${m.recipient.org_name || m.recipient.name}`,
                    label: `${num(m.distanceKm)} km · score ${num(m.score)}${m.estimated ? ' (estimated)' : ''}`,
                  })),
                ]}
                polylines={matchMap.matches.map((m) => m.route).filter(Boolean)}
                height={360}
              />
              <p className="mt-2 text-xs text-navy-500">
                Green pin = pickup, navy pins = matched recipients. Distances marked “estimated” use a
                Haversine fallback because the live road route was unavailable.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="card p-4">
            <h2 className="mb-2 font-semibold text-navy-800">Pickup location</h2>
            <MapView
              markers={[{ lat: data.lat, lng: data.lng, icon: pickupIcon, title: data.title, label: data.address }]}
              height={240}
            />
          </div>

          {isOwner && (
            <div className="card space-y-2 p-4">
              <h2 className="font-semibold text-navy-800">Provider actions</h2>
              <button className="btn-ghost w-full" disabled={busy === 'validate'} onClick={() => action('validate', `/listings/${data.id}/validate`)}>
                <RefreshCw className="h-4 w-4" /> Re-run validation
              </button>
              <button
                className="btn-ghost w-full"
                disabled={busy === 'match' || data.status === 'FLAGGED'}
                onClick={() => action('match', `/listings/${data.id}/match`)}
              >
                <Sparkles className="h-4 w-4" /> Re-run matching
              </button>
              <button className="btn-ghost w-full" disabled={busy === 'risk'} onClick={() => action('risk', `/listings/${data.id}/at-risk`)}>
                <AlertTriangle className="h-4 w-4" /> Mark at risk
              </button>
              <button className="btn-danger w-full" disabled={busy === 'expire'} onClick={() => action('expire', `/listings/${data.id}/expire`)}>
                <XCircle className="h-4 w-4" /> Mark expired
              </button>
            </div>
          )}

          {task && (
            <Link to={`/tasks/${task.id}`} className="card block p-4 hover:border-brand">
              <div className="flex items-center gap-2 font-semibold text-navy-800">
                <Truck className="h-4 w-4" /> Manage delivery #{task.id}
              </div>
              <p className="mt-1 text-xs text-navy-600">Status: {statusMeta(task.status).label} · volunteer {task.volunteer?.name || 'unassigned'}</p>
            </Link>
          )}

          <div className="card p-4">
            <h2 className="mb-3 font-semibold text-navy-800">Status timeline</h2>
            <ol className="space-y-3">
              {(data.events || []).map((e) => (
                <li key={e.id} className="flex gap-3 text-sm">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0 text-navy-600" />
                  <div>
                    <div className="font-medium text-navy-800">
                      {e.from_status ? `${e.from_status} → ` : ''}{e.to_status}
                    </div>
                    <div className="text-xs text-navy-600">
                      {fmtDateTime(e.created_at)} · {e.actor_role || 'system'}{e.actor_name ? ` (${e.actor_name})` : ''}
                    </div>
                    {e.reason && <div className="text-xs text-navy-500">{e.reason}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

function safeJson(v) {
  try {
    return v ? JSON.parse(v) : {};
  } catch {
    return {};
  }
}
