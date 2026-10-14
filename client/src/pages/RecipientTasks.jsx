import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { EmptyState, Spinner, StatusBadge } from '../components/ui.jsx';
import { fmtDateTime, num } from '../lib/format.js';

export default function RecipientTasks() {
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(null);
  const [confirming, setConfirming] = useState(null);
  useEffect(() => {
    let active = true;
    const load = (showError = false) => {
      api
        .get('/assignments')
        .then((d) => {
          if (!active) return;
          setTasks(d.assignments);
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

  const confirmReceived = async (taskId) => {
    setBusy(taskId);
    setError('');
    setNotice('');
    try {
      await api.post(`/assignments/${taskId}/confirm-delivery`);
      const { assignments } = await api.get('/assignments');
      setTasks(assignments);
      setNotice(`Delivery #${taskId} confirmed. The provider has been notified.`);
      setConfirming(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (error) return <div className="card p-4 text-red-700">{error}</div>;
  if (!tasks) return <Spinner />;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-navy-800">My deliveries</h1>
      {notice && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">{notice}</p>}
      {tasks.length === 0 && <EmptyState title="No deliveries yet" hint="Accept an offer to start a delivery." />}
      {tasks.map((t) => (
        <div key={t.id} className="card p-4 hover:border-brand">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link to={`/tasks/${t.id}`} className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-navy-800">{t.listing?.title}</span>
                <StatusBadge status={t.listing?.status} />
              </div>
              <div className="mt-1 text-xs text-navy-600">
                {num(t.listing?.quantity_kg)} kg · {t.listing?.servings} servings · from {t.listing?.provider?.org_name}
              </div>
              <div className="text-xs text-navy-600">
                Volunteer: {t.volunteer?.name || 'not yet assigned'} · {fmtDateTime(t.delivered_at || t.created_at)}
              </div>
            </Link>
            <div className="flex flex-wrap items-center gap-2">
              {t.pickup_verified_at && t.status !== 'DELIVERED' && (
                confirming === t.id ? (
                  <>
                    <span className="text-xs text-navy-600">Confirm the food was received?</span>
                    <button
                      className="btn-green"
                      disabled={busy === t.id}
                      onClick={() => confirmReceived(t.id)}
                    >
                      <Check className="h-4 w-4" />
                      {busy === t.id ? 'Confirming…' : 'Confirm received'}
                    </button>
                    <button className="btn-ghost" disabled={busy === t.id} onClick={() => setConfirming(null)}>
                      <X className="h-4 w-4" /> Cancel
                    </button>
                  </>
                ) : (
                  <button className="btn-green" onClick={() => setConfirming(t.id)}>
                    <Check className="h-4 w-4" /> Confirm received
                  </button>
                )
              )}
              <span className="chip bg-navy-50 text-navy-700">#{t.id}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
