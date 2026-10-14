import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Default matching weights (must total 100). Override with MATCH_WEIGHTS (JSON). */
export const DEFAULT_MATCH_WEIGHTS = Object.freeze({
  foodCompatibility: 25,
  demand: 25,
  quantityFit: 15,
  roadDistance: 20,
  timeFeasibility: 15,
});

function parseWeights(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

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
    resultLimit: Number(process.env.MATCH_RESULT_LIMIT || 5),
    offerLimit: Number(process.env.MATCH_OFFER_LIMIT || 5),
    weights: { ...DEFAULT_MATCH_WEIGHTS, ...(parseWeights(process.env.MATCH_WEIGHTS) || {}) },
  },

  // Volunteer assignment: how many ranked volunteers are invited at once and how
  // long each invitation stays open before it cascades to the next volunteer.
  volunteerOffer: {
    timeoutSec: Number(process.env.VOLUNTEER_OFFER_TIMEOUT_SEC || 600),
    limit: Number(process.env.VOLUNTEER_OFFER_LIMIT || 3),
    // Travel time to pickup (minutes) that scores zero on the travel component.
    maxTravelMin: Number(process.env.VOLUNTEER_MAX_TRAVEL_MIN || 60),
    weights: {
      travelTime: 50,
      availability: 30,
      feasibility: 20,
      ...(parseWeights(process.env.VOLUNTEER_WEIGHTS) || {}),
    },
  },

  // Pickup OTP policy: OTPs are stored hashed and verification attempts capped.
  otp: {
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
    hashRounds: Number(process.env.OTP_HASH_ROUNDS || 8),
  },

  geo: {
    nominatimBase: process.env.NOMINATIM_BASE || 'https://nominatim.openstreetmap.org',
    osrmBase: process.env.OSRM_BASE || 'https://router.project-osrm.org',
    userAgent: process.env.GEO_USER_AGENT || 'surplus-food-redistribution-hackathon/1.0',
    timeoutMs: Number(process.env.GEO_TIMEOUT_MS || 4000),
    maxRequestsPerSecond: 1,
  },

  otpExpiryMin: Number(process.env.OTP_EXPIRY_MIN || 30),

  // Dev-only conveniences. `simulateMovement` lets a participant advance the
  // volunteer marker along the route so the tracking demo works from a laptop.
  dev: {
    simulateMovement: process.env.ALLOW_SIMULATION !== 'false',
  },
};
