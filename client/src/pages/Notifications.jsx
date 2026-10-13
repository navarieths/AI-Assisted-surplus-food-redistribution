import { useEffect, useState } from 'react';
import { Bell, MailCheck } from 'lucide-react';
import { api } from '../lib/api.js';
import { EmptyState, Spinner } from '../components/ui.jsx';
import { fmtDateTime } from '../lib/format.js';

export default function Notifications() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get('/notifications').then((d) => setItems(d.notifications)).catch((e) => setError(e.message));
  }, []);

  const markAll = async () => {
    await api.post('/notifications/read-all');
    setItems((list) => (list || []).map((n) => ({ ...n, read: 1 })));
  };

  if (error) return <div className="card p-4 text-red-700">{error}</div>;
  if (!items) return <Spinner />;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy-800">Notifications</h1>
        <button className="btn-ghost" onClick={markAll}><MailCheck className="h-4 w-4" /> Mark all read</button>
      </div>
      <p className="rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-700">
        Notifications are simulated — they are stored here and printed to the server console. No real SMS or email is sent.
      </p>
      {items.length === 0 && <EmptyState title="No notifications yet" />}
      {items.map((n) => (
        <div key={n.id} className={`card p-4 ${n.read ? 'opacity-70' : ''}`}>
          <div className="flex items-start gap-3">
            <Bell className="mt-0.5 h-4 w-4 text-brand" />
            <div>
              <div className="font-medium text-navy-800">{n.subject}</div>
              <div className="text-sm text-navy-600">{n.body}</div>
              <div className="mt-1 text-xs text-navy-500">{fmtDateTime(n.created_at)} · {n.channel}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
