import { useEffect, useState } from 'react';
import { MapPin, Phone, Truck } from 'lucide-react';
import { api } from '../lib/api.js';
import { Field, Spinner, SafetyDisclaimer } from '../components/ui.jsx';
import { num } from '../lib/format.js';

export default function Carriers() {
  const [listings, setListings] = useState([]);
  const [listingId, setListingId] = useState('');
  const [carriers, setCarriers] = useState(null);

  useEffect(() => {
    api.get('/listings').then((d) => setListings(d.listings || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setCarriers(null);
    api
      .get(`/volunteers${api.searchParams({ listing_id: listingId })}`)
      .then((d) => setCarriers(d.carriers || []))
      .catch(() => setCarriers([]));
  }, [listingId]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-navy-800">Carriers</h1>
        <p className="text-sm text-navy-600">Volunteers and delivery partners, sorted by distance from a pickup.</p>
      </div>
      <SafetyDisclaimer />
      <div className="card p-4">
        <Field label="Distance from listing">
          <select className="input" value={listingId} onChange={(e) => setListingId(e.target.value)}>
            <option value="">My current location</option>
            {listings.map((l) => (
              <option key={l.id} value={l.id}>#{l.id} · {l.title}</option>
            ))}
          </select>
        </Field>
      </div>
      {!carriers ? (
        <Spinner />
      ) : (
        <div className="space-y-2">
          {carriers.map((c) => (
            <div key={c.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-50 text-navy-800">
                  <Truck className="h-4 w-4" />
                </span>
                <div>
                  <div className="font-medium text-navy-800">{c.name}</div>
                  <div className="text-xs capitalize text-navy-600">{c.role.replace('_', ' ')} · {c.org_name || 'individual'}</div>
                </div>
              </div>
              <div className="text-right text-xs text-navy-600">
                <div className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {c.address || '—'}</div>
                <div className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {c.phone || 'hidden'}</div>
                {c.distanceKm != null && <div className="font-semibold text-brand-700">{num(c.distanceKm)} km away</div>}
              </div>
            </div>
          ))}
          {carriers.length === 0 && <p className="text-sm text-navy-600">No carriers found.</p>}
        </div>
      )}
    </div>
  );
}
