import { config } from '../config.js';

/**
 * Map provider abstraction. `MAP_PROVIDER=osm|mapbox|google` selects tiles and
 * any keyed service, without changing call sites elsewhere. Routing uses OSRM
 * for osm (public server) and falls back to the same OSRM endpoint otherwise,
 * with a Haversine estimate as the final safety net.
 */
export function mapConfig() {
  const p = config.mapProvider;
  if (p === 'mapbox' && config.mapboxToken) {
    return {
      provider: 'mapbox',
      tileUrl: `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${config.mapboxToken}`,
      attribution: '&copy; Mapbox &copy; OpenStreetMap',
      maxZoom: 19,
      hasKey: true,
    };
  }
  if (p === 'google' && config.googleMapsKey) {
    return {
      provider: 'google',
      tileUrl: `https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&key=${config.googleMapsKey}`,
      attribution: '&copy; Google',
      maxZoom: 20,
      hasKey: true,
    };
  }
  return {
    provider: 'osm',
    tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
    hasKey: false,
  };
}

/* ------------------------------------------------------------------ */
/* Small in-memory caches + a global 1 request/second limiter.        */
/* ------------------------------------------------------------------ */
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24h
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, at: Date.now() });
  return value;
}

export function clearGeoCache() {
  cache.clear();
}

let lastRequestAt = 0;
let gate = Promise.resolve();

/** Serialise outbound geocoding calls to at most 1/second. */
function rateLimit() {
  const minGap = 1000 / Math.max(1, config.geo.maxRequestsPerSecond);
  gate = gate.then(async () => {
    const wait = lastRequestAt + minGap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
  });
  return gate;
}

async function fetchJson(url, { headers = {}, timeoutMs = config.geo.timeoutMs } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': config.geo.userAgent, Accept: 'application/json', ...headers },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Haversine + estimated helpers                                      */
/* ------------------------------------------------------------------ */
export function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

const ESTIMATED_SPEED_KMH = 25;

/* ------------------------------------------------------------------ */
/* Geocoding (Nominatim, India-biased, debounced/cached upstream)     */
/* ------------------------------------------------------------------ */
export async function geocode(query, { limit = 5 } = {}) {
  const clean = String(query || '').trim();
  if (!clean) return [];
  const key = `geo:${clean.toLowerCase()}:${limit}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  await rateLimit();
  const url =
    `${config.geo.nominatimBase}/search?format=jsonv2&addressdetails=1&limit=${limit}` +
    `&countrycodes=in&accept-language=en&q=${encodeURIComponent(clean)}`;
  try {
    const rows = await fetchJson(url);
    const results = (Array.isArray(rows) ? rows : []).map((r) => ({
      label: r.display_name,
      short: shorten(r),
      lat: Number(r.lat),
      lng: Number(r.lon),
      type: r.type,
      importance: r.importance,
    }));
    return cacheSet(key, results);
  } catch (err) {
    // never block the UI: return cached or empty list
    return cacheGet(key) || [];
  }
}

function shorten(r) {
  const a = r.address || {};
  const parts = [
    a.road || r.name,
    a.suburb || a.neighbourhood || a.village || a.town || a.city_district,
    a.city || a.state_district,
  ].filter(Boolean);
  return parts.join(', ') || r.display_name;
}

export async function reverseGeocode(lat, lng) {
  const key = `rev:${Number(lat).toFixed(5)}:${Number(lng).toFixed(5)}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  await rateLimit();
  const url =
    `${config.geo.nominatimBase}/reverse?format=jsonv2&addressdetails=1` +
    `&accept-language=en&lat=${lat}&lon=${lng}`;
  try {
    const r = await fetchJson(url);
    const value = {
      label: r.display_name || '',
      short: shorten(r),
      lat: Number(r.lat ?? lat),
      lng: Number(r.lon ?? lng),
    };
    return cacheSet(key, value);
  } catch {
    return { label: '', short: '', lat: Number(lat), lng: Number(lng) };
  }
}

/* ------------------------------------------------------------------ */
/* Routing (OSRM) with timeout, cache and estimated fallback          */
/* ------------------------------------------------------------------ */
export async function routeInfo(from, to) {
  const key = `route:${from.lat},${from.lng}->${to.lat},${to.lng}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const url =
    `${config.geo.osrmBase}/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=full&geometries=geojson`;
  try {
    const data = await fetchJson(url);
    const route = data?.routes?.[0];
    if (!route) throw new Error('no route');
    const coords = route.geometry?.coordinates || [];
    const value = {
      distanceKm: Math.round((route.distance / 1000) * 100) / 100,
      durationMin: Math.round((route.duration / 60) * 10) / 10,
      geometry: coords, // [lng, lat] (GeoJSON)
      geometryLatLng: coords.map(([lng, lat]) => [lat, lng]), // Leaflet-friendly
      estimated: false,
      source: 'osrm',
    };
    return cacheSet(key, value);
  } catch {
    const distanceKm = Math.round(haversineKm(from, to) * 100) / 100;
    const durationMin = Math.round((distanceKm / ESTIMATED_SPEED_KMH) * 60 * 10) / 10;
    const value = {
      distanceKm,
      durationMin,
      geometry: [
        [from.lng, from.lat],
        [to.lng, to.lat],
      ],
      geometryLatLng: [
        [from.lat, from.lng],
        [to.lat, to.lng],
      ],
      estimated: true,
      source: 'haversine',
    };
    return cacheSet(key, value);
  }
}

/** Route through an optional waypoint: from -> via -> to. */
export async function routeVia(from, via, to) {
  if (!via) return routeInfo(from, to);
  const [a, b] = await Promise.all([routeInfo(from, via), routeInfo(via, to)]);
  return {
    distanceKm: Math.round((a.distanceKm + b.distanceKm) * 100) / 100,
    durationMin: Math.round((a.durationMin + b.durationMin) * 10) / 10,
    geometry: [...a.geometry, ...b.geometry.slice(1)],
    geometryLatLng: [...a.geometryLatLng, ...b.geometryLatLng.slice(1)],
    estimated: a.estimated || b.estimated,
    source: a.estimated || b.estimated ? 'haversine' : 'osrm',
  };
}
