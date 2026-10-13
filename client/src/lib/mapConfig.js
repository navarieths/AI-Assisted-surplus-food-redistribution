import { useEffect, useState } from 'react';
import { api } from './api.js';

let cached = null;
let inflight = null;

/** Fetch map provider config (tiles) once; MAP_PROVIDER is swapped server-side. */
export function useMapConfig() {
  const [config, setConfig] = useState(cached);
  useEffect(() => {
    let alive = true;
    if (cached) {
      setConfig(cached);
      return undefined;
    }
    inflight = inflight || api.get('/geo/config').catch(() => null);
    inflight.then((c) => {
      cached = c || {
        provider: 'osm',
        tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      };
      if (alive) setConfig(cached);
    });
    return () => {
      alive = false;
    };
  }, []);
  return config;
}
