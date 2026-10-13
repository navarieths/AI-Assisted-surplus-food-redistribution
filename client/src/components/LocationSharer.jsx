import { useEffect, useRef, useState } from 'react';
import { MapPin, Radio } from 'lucide-react';
import { api } from '../lib/api.js';

/**
 * Posts navigator.geolocation to POST /volunteers/location every 10s while the
 * task is active. Recipient/provider tracking screens poll every 5s.
 */
export default function LocationSharer({ taskId, active }) {
  const [status, setStatus] = useState('idle');
  const [last, setLast] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    if (!active || !taskId) {
      setStatus('idle');
      return undefined;
    }
    const send = () => {
      if (!navigator.geolocation) {
        setError('Geolocation unavailable in this browser.');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            await api.post('/volunteers/location', {
              assignment_id: taskId,
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            });
            setLast(new Date());
            setStatus('sharing');
            setError('');
          } catch (e) {
            setError(e.message);
          }
        },
        (err) => setError(err.message || 'Location permission denied.'),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 }
      );
    };
    send();
    timer.current = setInterval(send, 10000);
    return () => clearInterval(timer.current);
  }, [active, taskId]);

  return (
    <div className="rounded-xl border border-navy-100 bg-white p-3 text-sm">
      <div className="flex items-center gap-2 font-semibold text-navy-800">
        <Radio className={`h-4 w-4 ${status === 'sharing' ? 'text-brand animate-pulse' : 'text-navy-600'}`} />
        Live location sharing {status === 'sharing' ? 'active' : 'paused'}
      </div>
      <p className="mt-1 text-xs text-navy-600">
        Sends your position every 10 seconds while this task is active.
        {last ? ` Last sent ${last.toLocaleTimeString()}.` : ''}
      </p>
      {error && (
        <p className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700">
          <MapPin className="h-3 w-3" /> {error}
        </p>
      )}
    </div>
  );
}
