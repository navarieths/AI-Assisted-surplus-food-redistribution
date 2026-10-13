import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Timer, Truck } from 'lucide-react';
import { api } from '../lib/api.js';
import { EmptyState, ErrorNote, SafetyDisclaimer, Spinner } from '../components/ui.jsx';
import { fmtDateTime, fromNow, num } from '../lib/format.js';

export default function VolunteerAvailable() {
  const [tasks, setTasks] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api.get('/tasks/available').then((d) => setTasks(d.tasks)).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const claim = async (id) => {
    setBusy(id);
    setError('');
    try {
      await api.post(`/tasks/${id}/claim`);
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
        <p className="text-sm text-navy-600">Accepted donations waiting for a carrier. Claim one near you.</p>
      </div>
      <SafetyDisclaimer />
      <ErrorNote>{error}</ErrorNote>
      {tasks.length === 0 && <EmptyState title="No pickups available" hint="Check back soon." />}
      {tasks.map((t) => (
        <div key={t.id} className="card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-navy-800">{t.title}</h2>
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
    </div>
  );
}
