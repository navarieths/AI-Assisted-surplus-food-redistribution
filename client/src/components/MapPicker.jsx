import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import { Crosshair, Loader2, MapPin, Search, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useMapConfig } from '../lib/mapConfig.js';
import { pinIcon } from '../lib/leafletIcons.js';

const DEFAULT_CENTER = [12.9716, 77.5946]; // Bengaluru fallback
const searchCache = new Map();

function Recenter({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView(position, Math.max(map.getZoom(), 15));
  }, [position, map]);
  return null;
}

function ClickHandler({ onPick }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng, address: '' });
    },
  });
  return null;
}

export default function MapPicker({ value, onChange, height = 280, label = 'Location' }) {
  const mapConfig = useMapConfig();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const lastReqRef = useRef(0);

  const position = useMemo(
    () => (value?.lat != null && value?.lng != null ? [value.lat, value.lng] : null),
    [value?.lat, value?.lng]
  );

  // Debounced Nominatim search (500ms) with an in-memory cache and 1 req/sec cap.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      return undefined;
    }
    const handle = setTimeout(async () => {
      const key = q.toLowerCase();
      if (searchCache.has(key)) {
        setResults(searchCache.get(key));
        setOpen(true);
        return;
      }
      const wait = Math.max(0, 1000 - (Date.now() - lastReqRef.current));
      await new Promise((r) => setTimeout(r, wait));
      lastReqRef.current = Date.now();
      setSearching(true);
      try {
        const { results: rows } = await api.get(`/geo/search${api.searchParams({ q })}`);
        searchCache.set(key, rows || []);
        setResults(rows || []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 500);
    return () => clearTimeout(handle);
  }, [query]);

  const reverseFill = useCallback(
    async (lat, lng) => {
      try {
        const r = await api.get(`/geo/reverse${api.searchParams({ lat, lng })}`);
        onChange({ lat, lng, address: r.label || r.short || `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
      } catch {
        onChange({ lat, lng, address: `${lat.toFixed(5)}, ${lng.toFixed(5)}` });
      }
    },
    [onChange]
  );

  const pick = useCallback(
    (p) => {
      setOpen(false);
      setQuery(p.short || p.label || '');
      onChange({ lat: p.lat, lng: p.lng, address: p.label || p.short });
    },
    [onChange]
  );

  const useMyLocation = () => {
    setError('');
    if (!navigator.geolocation) {
      setError('Geolocation is not supported by this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        reverseFill(latitude, longitude).finally(() => setLocating(false));
      },
      (err) => {
        setError(err.message || 'Could not get your location.');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="label mb-0">{label}</span>
        <button type="button" className="text-xs font-semibold text-brand-700 hover:underline" onClick={useMyLocation}>
          <span className="inline-flex items-center gap-1">
            {locating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Crosshair className="h-3 w-3" />}
            Use my current location
          </span>
        </button>
      </div>

      <div className="relative z-10">
        <div className="flex items-center gap-2 rounded-lg border border-navy-100 bg-white px-3 py-2">
          <Search className="h-4 w-4 text-navy-600" />
          <input
            className="w-full bg-transparent text-sm outline-none"
            placeholder="Search for an address or landmark…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length && setOpen(true)}
          />
          {searching && <Loader2 className="h-4 w-4 animate-spin text-navy-600" />}
          {query && !searching && (
            <button type="button" onClick={() => { setQuery(''); setResults([]); setOpen(false); }}>
              <X className="h-4 w-4 text-navy-600" />
            </button>
          )}
        </div>
        {open && results.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-[1000] mt-1 max-h-60 overflow-auto rounded-lg border border-navy-100 bg-white shadow-card">
            {results.map((r, i) => (
              <li key={`${r.lat}-${r.lng}-${i}`}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-brand-50"
                  onClick={() => pick(r)}
                >
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  <span>{r.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2 overflow-hidden rounded-xl border border-navy-100" style={{ height }}>
        <MapContainer
          center={position || DEFAULT_CENTER}
          zoom={position ? 15 : 12}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom
        >
          {mapConfig && (
            <TileLayer
              url={mapConfig.tileUrl}
              attribution={mapConfig.attribution}
              maxZoom={mapConfig.maxZoom || 19}
            />
          )}
          <ClickHandler onPick={(p) => reverseFill(p.lat, p.lng)} />
          {position && (
            <>
              <Marker
                position={position}
                icon={pinIcon}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    const { lat, lng } = e.target.getLatLng();
                    reverseFill(lat, lng);
                  },
                }}
              />
              <Recenter position={position} />
            </>
          )}
        </MapContainer>
      </div>

      <p className="mt-1 text-xs text-navy-600">
        {value?.address || (position ? `${position[0].toFixed(5)}, ${position[1].toFixed(5)}` : 'Tap the map or search to drop a pin.')}
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
