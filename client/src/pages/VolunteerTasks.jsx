import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { EmptyState, Spinner, StatusBadge } from '../components/ui.jsx';
import { fmtDateTime, num } from '../lib/format.js';

export default function VolunteerTasks() {
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/assignments').then((d) => setTasks(d.assignments)).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="card p-4 text-red-700">{error}</div>;
  if (!tasks) return <Spinner />;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-navy-800">My tasks</h1>
      {tasks.length === 0 && <EmptyState title="No tasks assigned" hint="Claim an available pickup to get started." />}
      {tasks.map((t) => (
        <Link key={t.id} to={`/tasks/${t.id}`} className="card block p-4 hover:border-brand">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-navy-800">{t.listing?.title}</span>
                <StatusBadge status={t.listing?.status} />
              </div>
              <div className="mt-1 text-xs text-navy-600">
                Pickup: {t.listing?.address} · Drop: {t.recipient?.org_name || t.recipient?.name}
              </div>
              <div className="text-xs text-navy-600">{num(t.listing?.quantity_kg)} kg · by {fmtDateTime(t.listing?.pickup_deadline)}</div>
            </div>
            <span className="chip bg-navy-50 text-navy-700">#{t.id}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}
