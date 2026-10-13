import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'hackathon-dev-secret-change-me',
  jwtExpiry: process.env.JWT_EXPIRY || '7d',
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db'),

  // Map provider abstraction: osm | mapbox | google. Default osm (no key).
  mapProvider: (process.env.MAP_PROVIDER || 'osm').toLowerCase(),
  mapboxToken: process.env.MAPBOX_TOKEN || '',
  googleMapsKey: process.env.GOOGLE_MAPS_KEY || '',

  // Optional LLM only rewrites the explanation text. Everything works without it.
  llm: {
    apiKey: process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || '',
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.LLM_MODEL || 'gpt-4o-mini',
  },

  // Matching tunables (deterministic; no AI needed).
  matching: {
    haversinePrefilterKm: Number(process.env.MATCH_RADIUS_KM || 30),
    topN: Number(process.env.MATCH_TOP_N || 10),
    offerLimit: Number(process.env.MATCH_OFFER_LIMIT || 5),
  },

  geo: {
    nominatimBase: process.env.NOMINATIM_BASE || 'https://nominatim.openstreetmap.org',
    osrmBase: process.env.OSRM_BASE || 'https://router.project-osrm.org',
    userAgent: process.env.GEO_USER_AGENT || 'surplus-food-redistribution-hackathon/1.0',
    timeoutMs: Number(process.env.GEO_TIMEOUT_MS || 4000),
    maxRequestsPerSecond: 1,
  },

  otpExpiryMin: Number(process.env.OTP_EXPIRY_MIN || 30),
};
