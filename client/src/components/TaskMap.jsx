import { useCallback, useEffect, useRef, useState } from 'react';
import { ExternalLink, Navigation, Pause, Play, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.js';
import { MapView } from './MapView.jsx';
import { dropIcon, pickupIcon, volunteerIcon } from '../lib/leafletIcons.js';
import { num } from '../lib/format.js';

export default function TaskMap({ taskId, height = 340, pollMs = 5000, canSimulate = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/assignments/${taskId}/track`);
      setData(d);
      setUpdated(new Date());
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, [taskId]);

  useEffect(() => {
    load();
    timer.current = setInterval(load, pollMs);
    return () => clearInterval(timer.current);
  }, [load, pollMs]);

  // Dev toggle: advance the marker along the route server-side so the demo
  // works from a laptop without real GPS. Both provider and recipient see it.
  useEffect(() => {
    if (!simulating) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const res = await api.post(`/assignments/${taskId}/simulate-location`);
        if (!alive) return;
        await load();
        if (res?.arrived) setSimulating(false);
      } catch (e) {
        if (alive) {
          setError(e.message);
          setSimulating(false);
        }
      }
    };
    tick();
    const t = setInterval(tick, 1200);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [simulating, taskId, load]);

  if (error && !data) return <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="flex h-40 items-center justify-center text-sm text-navy-600">Loading live map…</div>;

  const markers = [
    { ...data.pickup, icon: pickupIcon, title: `Pickup: ${data.pickup.title}` },
    { ...data.drop, icon: dropIcon, title: `Drop: ${data.drop.title}` },
  ];
  if (data.volunteer) {
    markers.push({ ...data.volunteer, icon: volunteerIcon, title: `Volunteer ${data.volunteer.name || ''}` });
  }

  const delivered = data.listingStatus === 'DELIVERED' || data.status === 'DELIVERED';

  return (
    <div className="space-y-2">
      <MapView markers={markers} polyline={data.geometry || []} height={height} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-navy-700">
        <span className="inline-flex items-center gap-1">
          <Navigation className="h-3.5 w-3.5 text-brand" />
          Remaining: <strong>{num(data.distanceKm)} km</strong> · ETA <strong>{num(data.durationMin, 0)} min</strong>
          {data.estimated && <span className="chip bg-amber-100 text-amber-700">estimated</span>}
        </span>
        <span className="inline-flex items-center gap-1 text-navy-600">
          <RefreshCw className="h-3 w-3" /> updates every {pollMs / 1000}s{updated ? ` · ${updated.toLocaleTimeString()}` : ''}
        </span>
        <a className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:underline" href={data.googleMapsUrl} target="_blank" rel="noreferrer">
          <ExternalLink className="h-3.5 w-3.5" /> Open in Google Maps
        </a>
      </div>
      {canSimulate && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-navy-100 bg-white/70 px-3 py-2 text-xs">
          <button
            type="button"
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold ${
              simulating ? 'bg-navy-800 text-white' : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
            }`}
            onClick={() => setSimulating((s) => !s)}
            disabled={delivered}
          >
            {simulating ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {simulating ? 'Stop simulation' : 'Simulate movement'}
          </button>
          <span className="text-navy-600">
            Dev tool: moves the volunteer marker along the route{delivered ? ' (delivered)' : ''}.
          </span>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
