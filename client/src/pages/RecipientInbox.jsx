import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Clock, MapPin, Package, Snowflake, Timer, TriangleAlert, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { EmptyState, ErrorNote, SafetyDisclaimer, Spinner, StatusBadge } from '../components/ui.jsx';
import { fmtDateTime, fmtTime, fromNow, num } from '../lib/format.js';

const FACTORS = [
  ['foodCompatibility', 'Food fit'],
  ['demand', 'Demand'],
  ['quantityFit', 'Quantity fit'],
  ['roadDistance', 'Distance'],
  ['timeFeasibility', 'Time fit'],
];

/** Turn a stored score breakdown into 0–100 factor rows for the "why" panel. */
function factorRows(breakdown = {}) {
  const ratios = breakdown.ratios || {};
  const weights = breakdown.weights || {};
  return FACTORS.map(([key, label]) => {
    let ratio = ratios[key];
    if (ratio == null && weights[key]) ratio = (breakdown[key] ?? 0) / weights[key];
    return { key, label, pct: Math.max(0, Math.min(100, Math.round((ratio ?? 0) * 100))) };
  });
}

function FactorBar({ label, pct }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-navy-600">
        <span>{label}</span>
        <span className="font-medium text-navy-800">{pct}%</span>
      </div>
      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-navy-100">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Detail({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 text-navy-600" />
      <div>
        <div className="text-[11px] uppercase tracking-wide text-navy-600">{label}</div>
        <div className="text-xs text-navy-800">{children}</div>
      </div>
    </div>
  );
}

export default function RecipientInbox() {
  const [offers, setOffers] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api
      .get('/offers')
      .then((d) => setOffers(d.offers))
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const accept = async (o) => {
    setBusy(`${o.id}-accept`);
    setError('');
    setNotice(null);
    try {
      await api.post(`/offers/${o.id}/accept`);
      setNotice({
        kind: 'ok',
        text: 'Accepted. A volunteer will be assigned to collect it.',
        link: '/recipient',
        linkText: 'View my deliveries',
      });
      load();
    } catch (e) {
      setError(e.message);
      load();
    } finally {
      setBusy(null);
    }
  };

  const decline = async (o) => {
    setBusy(`${o.id}-decline`);
    setError('');
    setNotice(null);
    setConfirming(null);
    try {
      const res = await api.post(`/offers/${o.id}/decline`);
      setNotice({
        kind: res.noMatch ? 'warn' : 'ok',
        text: res.noMatch
          ? 'Declined. No other recipient could take it, so this donation is now marked no match.'
          : res.nextOffered
            ? 'Declined. The offer has moved to the next ranked recipient.'
            : 'Declined. Other recipients still have this offer open.',
      });
      load();
    } catch (e) {
      setError(e.message);
      load();
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
        <h1 className="text-2xl font-bold text-navy-800">Incoming offers</h1>
        <p className="text-sm text-navy-600">
          Surplus food matched to you, ranked by a deterministic score. Accept to arrange delivery.
        </p>
      </div>
      <SafetyDisclaimer />
      <ErrorNote>{error}</ErrorNote>

      {notice && (
        <div
          className={
            notice.kind === 'warn'
              ? 'card border-amber-200 bg-amber-50 p-3 text-sm text-amber-800'
              : 'card border-brand-100 bg-brand-50 p-3 text-sm text-brand-700'
          }
        >
          {notice.text}
          {notice.link && (
            <Link to={notice.link} className="ml-2 font-medium underline">
              {notice.linkText}
            </Link>
          )}
        </div>
      )}

      {open.length === 0 && (
        <EmptyState title="No open offers" hint="New matches will appear here automatically." />
      )}

      {open.map((o) => {
        const l = o.listing;
        const b = o.breakdown || {};
        return (
          <div key={o.id} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-navy-800">{l.title}</h2>
                  <StatusBadge status={l.status} />
                  <span className="chip bg-brand-100 text-brand-700">score {num(o.score)}</span>
                </div>
                <p className="mt-1 text-sm text-navy-600">
                  {l.provider?.org_name} · {l.address}
                </p>
              </div>
              <div className="text-right text-xs text-navy-600">
                <div className="inline-flex items-center gap-1 font-medium text-navy-800">
                  <MapPin className="h-3.5 w-3.5" />
                  {num(o.distance_km)} km
                </div>
                <div className="inline-flex items-center gap-1">
                  <Timer className="h-3.5 w-3.5" />
                  ~{num(o.duration_min, 0)} min {o.estimated ? '(estimated)' : '(road route)'}
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Detail icon={Package} label="Food">
                <span className="capitalize">{l.food_type}</span> · {num(l.quantity_kg)} kg · {l.servings} servings
              </Detail>
              <Detail icon={Snowflake} label="Storage">
                {l.storage_condition || '—'}
              </Detail>
              <Detail icon={Clock} label="Ready from">
                {fmtTime(l.ready_at)}
              </Detail>
              <Detail icon={Timer} label="Pickup by">
                {fmtDateTime(l.pickup_deadline)} ({fromNow(l.pickup_deadline)})
              </Detail>
              <Detail icon={TriangleAlert} label="Allergens">
                {l.allergens || 'Not declared'}
              </Detail>
              <Detail icon={Package} label="Packaging">
                {l.packaging || '—'}
              </Detail>
            </div>

            {l.handling_notes && (
              <p className="mt-3 rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-800">
                <span className="font-medium">Handling:</span> {l.handling_notes}
              </p>
            )}

            <div className="mt-3 rounded-lg bg-brand-50 px-3 py-3">
              <div className="text-xs font-semibold text-brand-700">Why recommended</div>
              {o.explanation && <p className="mt-1 text-xs text-brand-700">{o.explanation}</p>}
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                {factorRows(b).map((f) => (
                  <FactorBar key={f.key} label={f.label} pct={f.pct} />
                ))}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                className="btn-green"
                disabled={busy === `${o.id}-accept`}
                onClick={() => accept(o)}
              >
                <Check className="h-4 w-4" />
                {busy === `${o.id}-accept` ? 'Accepting…' : 'Accept'}
              </button>

              {confirming === o.id ? (
                <>
                  <span className="text-xs text-navy-600">Decline this offer?</span>
                  <button
                    className="btn-ghost text-red-700"
                    disabled={busy === `${o.id}-decline`}
                    onClick={() => decline(o)}
                  >
                    {busy === `${o.id}-decline` ? 'Declining…' : 'Confirm decline'}
                  </button>
                  <button className="btn-ghost" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  className="btn-ghost"
                  disabled={busy === `${o.id}-accept`}
                  onClick={() => setConfirming(o.id)}
                >
                  <X className="h-4 w-4" /> Decline
                </button>
              )}

              <Link to={`/listings/${l.id}`} className="btn-ghost">
                View listing
              </Link>
            </div>
          </div>
        );
      })}

      {rest.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-semibold text-navy-800">History</h2>
          {rest.map((o) => (
            <div key={o.id} className="card flex items-center justify-between gap-3 p-4">
              <div>
                <div className="font-medium text-navy-800">{o.listing.title}</div>
                <div className="text-xs text-navy-600">
                  {fmtDateTime(o.updated_at)} · score {num(o.score)} ·{' '}
                  <span className="uppercase">{o.status}</span>
                </div>
              </div>
              <StatusBadge status={o.listing.status} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
