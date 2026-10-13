import { config } from '../config.js';
import { q } from '../db.js';
import { haversineKm, routeInfo } from './geo.js';
import { activeCarriers, activeRecipients } from './profiles.js';

/**
 * Deterministic matching. Works with no AI key.
 *
 * Pipeline:
 *   1. Haversine pre-filter to the closest N candidates (no API calls).
 *   2. Hard filters: recipient must accept the food category, and the pickup
 *      window must be feasible (pickup before deadline, delivery inside the
 *      recipient's collection hours).
 *   3. Weighted score (default 25/25/15/20/15, see config.matching.weights)
 *      using real road distance from OSRM for the routed candidates.
 *   4. Return the top `config.matching.resultLimit` (default 5) with
 *      explanation strings and an `estimated` flag for the distance.
 *
 * An LLM can only rewrite the human-readable explanation, never the score.
 */

export const WEIGHT_KEYS = [
  'foodCompatibility',
  'demand',
  'quantityFit',
  'roadDistance',
  'timeFeasibility',
];

const DEFAULT_VOLUNTEER_TRAVEL_MIN = 15;

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function parseHM(hm) {
  const [h, m] = String(hm || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ------------------------------ weights ---------------------------------- */

/** Merge overrides onto the configured weights, keeping only known keys. */
export function resolveWeights(overrides = {}) {
  const base = config.matching.weights || {};
  const merged = {};
  for (const key of WEIGHT_KEYS) {
    const value = overrides[key] ?? base[key];
    merged[key] = Number.isFinite(Number(value)) ? Number(value) : 0;
  }
  return merged;
}

export function weightsTotal(weights) {
  return round1(WEIGHT_KEYS.reduce((sum, key) => sum + (Number(weights[key]) || 0), 0));
}

/* --------------------------- hard-filter inputs -------------------------- */

/** Categories a recipient accepts. Falls back to `veg_only` for legacy rows. */
export function acceptedCategories(recipient) {
  const raw = recipient?.accepted_categories;
  if (raw && String(raw).trim()) {
    return String(raw)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return recipient?.veg_only ? ['veg'] : ['veg', 'nonveg'];
}

/**
 * A recipient's single preferred category, or null when they accept anything.
 * The first category in `accepted_categories` is treated as the preference.
 */
export function preferredCategory(recipient) {
  if (recipient?.veg_only) return 'veg';
  const raw = recipient?.accepted_categories;
  if (raw && String(raw).trim()) {
    const first = String(raw).split(',')[0].trim().toLowerCase();
    return first || null;
  }
  return null;
}

/** 0..1 — how well the listing's food type matches the recipient's preference. */
export function foodCompatibilityRatio(recipient, listing) {
  const cats = acceptedCategories(recipient);
  const foodType = String(listing?.food_type || '').toLowerCase();
  if (!cats.includes(foodType)) return 0; // would be hard-filtered
  const preferred = preferredCategory(recipient);
  if (!preferred) return 1; // accepts anything
  return preferred === foodType ? 1 : 0.6; // accepted, but not first choice
}

/** 0..1 — fit between listing servings and the recipient's capacity. */
export function quantityFitRatio(recipient, listing) {
  const capacity = Number(recipient?.capacity_servings) || 0;
  const servings = Number(listing?.servings) || 0;
  if (capacity <= 0) return 1; // unknown capacity -> no penalty
  if (servings <= capacity) return 1;
  const overflow = servings / capacity; // > 1
  return clamp01(2 - overflow); // 1x -> full, 2x -> 0
}

/** 0..1 — closer is better; 0 at or beyond the prefilter radius. */
export function roadDistanceRatio(distanceKm, radius = config.matching.haversinePrefilterKm) {
  const r = Number(radius) || config.matching.haversinePrefilterKm;
  return clamp01(1 - (Number(distanceKm) || 0) / r);
}

/** 0..1 — recipient demand/need level. */
export function demandRatio(recipient) {
  return clamp01(Number(recipient?.demand ?? 0.5));
}

/* --------------------------- time feasibility ---------------------------- */

/**
 * Evaluate the pickup/delivery window.
 *
 * Hard constraints: pickup must happen before the deadline and delivery must
 * land inside the recipient's collection hours. When feasible, `ratio` scores
 * how much slack remains (comfortable windows score higher).
 */
export function evaluateTimeFeasibility({
  listing,
  recipient,
  route,
  volunteerTravelMin = DEFAULT_VOLUNTEER_TRAVEL_MIN,
}) {
  const readyAt = new Date(listing.ready_at);
  const deadline = new Date(listing.pickup_deadline);
  const durationMin = Number(route?.durationMin) || 0;
  const pickupArrival = new Date(readyAt.getTime() + volunteerTravelMin * 60000);
  const recipientArrival = new Date(pickupArrival.getTime() + durationMin * 60000);

  const beforeDeadline = pickupArrival.getTime() <= deadline.getTime();

  const windowMin = (deadline.getTime() - readyAt.getTime()) / 60000;
  const deliverySlackMin = (deadline.getTime() - recipientArrival.getTime()) / 60000;
  const deadlineRatio =
    windowMin > 0 ? clamp01(deliverySlackMin / windowMin) : beforeDeadline ? 1 : 0;

  const open = parseHM(recipient.collection_open);
  const close = parseHM(recipient.collection_close);
  const arrivalMin = minutesOfDay(recipientArrival);
  const withinCollection = arrivalMin >= open && arrivalMin <= close;
  const halfSpan = Math.max(1, (close - open) / 2);
  const collectionRatio = withinCollection
    ? clamp01(Math.min(arrivalMin - open, close - arrivalMin) / halfSpan)
    : 0;

  const reasons = [];
  if (!beforeDeadline) reasons.push('Pickup would happen after the deadline.');
  if (!withinCollection) reasons.push('Delivery falls outside recipient collection hours.');

  const feasible = beforeDeadline && withinCollection;
  const ratio = feasible ? clamp01(0.6 * deadlineRatio + 0.4 * collectionRatio) : 0;

  return {
    feasible,
    beforeDeadline,
    withinCollection,
    deadlineRatio,
    collectionRatio,
    ratio,
    reasons,
    pickupArrival,
    recipientArrival,
  };
}

/** Reasons a recipient cannot serve a listing (empty array => passes). */
export function hardFilterReasons({ listing, recipient, route, volunteerTravelMin }) {
  const reasons = [];
  if (foodCompatibilityRatio(recipient, listing) === 0) {
    reasons.push(
      `Food category "${listing.food_type}" is not accepted (accepts ${acceptedCategories(recipient).join(', ')}).`
    );
  }
  const time = evaluateTimeFeasibility({ listing, recipient, route, volunteerTravelMin });
  reasons.push(...time.reasons);
  return reasons;
}

/* -------------------------------- scoring -------------------------------- */

/** Score one recipient against a listing. Pure — takes an already-fetched route. */
export function scoreCandidate({
  listing,
  recipient,
  route,
  volunteerTravelMin = DEFAULT_VOLUNTEER_TRAVEL_MIN,
  weights = config.matching.weights,
  radius = config.matching.haversinePrefilterKm,
}) {
  const w = resolveWeights(weights);
  const time = evaluateTimeFeasibility({ listing, recipient, route, volunteerTravelMin });
  const ratios = {
    foodCompatibility: foodCompatibilityRatio(recipient, listing),
    demand: demandRatio(recipient),
    quantityFit: quantityFitRatio(recipient, listing),
    roadDistance: roadDistanceRatio(route.distanceKm, radius),
    timeFeasibility: time.ratio,
  };

  const parts = {};
  for (const key of WEIGHT_KEYS) parts[key] = ratios[key] * w[key];
  const score = round1(WEIGHT_KEYS.reduce((sum, key) => sum + parts[key], 0));

  const breakdown = {
    foodCompatibility: round1(parts.foodCompatibility),
    demand: round1(parts.demand),
    quantityFit: round1(parts.quantityFit),
    roadDistance: round1(parts.roadDistance),
    timeFeasibility: round1(parts.timeFeasibility),
    weights: w,
    ratios,
    distanceKm: route.distanceKm,
    durationMin: route.durationMin,
    estimated: Boolean(route.estimated),
    volunteerTravelMin,
    pickupBy: time.pickupArrival.toISOString(),
    arrivalAt: time.recipientArrival.toISOString(),
    collectionHours: `${recipient.collection_open}-${recipient.collection_close}`,
    acceptedCategories: acceptedCategories(recipient),
    demandLevel: ratios.demand,
    capacityServings: recipient.capacity_servings,
    feasible: time.feasible,
    feasibilityReasons: time.reasons,
    score,
  };

  return { score, breakdown };
}

/** Deterministic, human-readable, no AI required. */
export function templateExplanation(listing, recipient, breakdown) {
  const bits = [];
  bits.push(
    `${recipient.name} is ${breakdown.distanceKm} km / ~${breakdown.durationMin} min from the pickup point (${breakdown.estimated ? 'estimated, not a live road route' : 'live road route'}).`
  );
  bits.push(
    breakdown.feasible
      ? `Timings fit: pickup by ${fmtTime(breakdown.pickupBy)} and delivery inside collection hours (${breakdown.collectionHours}).`
      : `Timing risk: ${breakdown.feasibilityReasons.join(' ') || 'delivery window is tight.'}`
  );
  bits.push(
    breakdown.ratios?.foodCompatibility === 1
      ? 'Food type matches their preference.'
      : 'Food type is accepted but not their first preference.'
  );
  const fitPct = Math.round((breakdown.ratios?.quantityFit ?? 0) * 100);
  const demandPct = Math.round((breakdown.demandLevel ?? 0) * 100);
  bits.push(`Quantity fit ${fitPct}% of capacity; demand ${demandPct}%.`);
  bits.push(`Deterministic score ${breakdown.score ?? ''} (0-100).`);
  return bits.join(' ');
}

/* ------------------------------ orchestration ---------------------------- */

/**
 * Apply hard filters, score, rank and cap the results.
 * `routeFn` is injectable so this can be unit-tested without the network.
 */
export async function rankCandidates({
  listing,
  candidates,
  routeFn = routeInfo,
  volunteerTravelMin = DEFAULT_VOLUNTEER_TRAVEL_MIN,
  weights = config.matching.weights,
  radius = config.matching.haversinePrefilterKm,
  limit = config.matching.resultLimit,
} = {}) {
  const scored = [];
  const filtered = { category: 0, time: 0 };

  for (const recipient of candidates || []) {
    if (foodCompatibilityRatio(recipient, listing) === 0) {
      filtered.category += 1;
      continue;
    }
    const route = await routeFn(listing, recipient);
    const time = evaluateTimeFeasibility({ listing, recipient, route, volunteerTravelMin });
    if (!time.feasible) {
      filtered.time += 1;
      continue;
    }
    const { score, breakdown } = scoreCandidate({
      listing,
      recipient,
      route,
      volunteerTravelMin,
      weights,
      radius,
    });
    const explanation = templateExplanation(listing, recipient, breakdown);
    scored.push({ recipient, score, breakdown, explanation, route, volunteerTravelMin });
  }

  scored.sort((a, b) => b.score - a.score || a.recipient.id - b.recipient.id);
  return {
    scored: scored.slice(0, limit),
    ranked: scored,
    filtered,
    considered: (candidates || []).length,
  };
}

/** Nearest active volunteer to the pickup point (Haversine, no API call). */
function nearestVolunteer(listing) {
  const vols = activeCarriers().filter((v) => v.lat != null && v.lng != null);
  let best = null;
  for (const v of vols) {
    const d = haversineKm(listing, v);
    if (!best || d < best.distanceKm) best = { ...v, distanceKm: d };
  }
  return best;
}

/**
 * Score every recipient for a listing: Haversine pre-filter, then routeInfo for
 * the top candidates, hard filters, weighted scoring, and the top N results.
 */
export async function scoreListing(listing) {
  const radius = config.matching.haversinePrefilterKm;
  const candidates = activeRecipients()
    .map((r) => ({ ...r, haversineKm: haversineKm(listing, r) }))
    .filter((r) => r.haversineKm <= radius)
    .sort((a, b) => a.haversineKm - b.haversineKm)
    .slice(0, config.matching.topN);

  const volunteer = nearestVolunteer(listing);
  let volunteerTravelMin = DEFAULT_VOLUNTEER_TRAVEL_MIN;
  if (volunteer) {
    const vr = await routeInfo(volunteer, listing);
    volunteerTravelMin = vr.durationMin;
  }

  const { scored, filtered, considered } = await rankCandidates({
    listing,
    candidates,
    volunteerTravelMin,
  });

  return { scored, filtered, considered, volunteer, volunteerTravelMin };
}

/* ------------------------------- persistence ----------------------------- */

/** Persist offers for a listing, returning the stored rows (ranked). */
export async function persistOffers(listing) {
  const { scored } = await scoreListing(listing);
  const existing = q.all(`SELECT recipient_id FROM offers WHERE listing_id = ?`, [listing.id]);
  const seen = new Set(existing.map((e) => e.recipient_id));

  scored.forEach((s, idx) => {
    const explanation = s.explanation;
    if (seen.has(s.recipient.id)) {
      q.run(
        `UPDATE offers SET score=?, breakdown_json=?, explanation=?, distance_km=?, duration_min=?,
         estimated=?, rank=?, updated_at=datetime('now') WHERE listing_id=? AND recipient_id=?`,
        [
          s.score,
          JSON.stringify(s.breakdown),
          explanation,
          s.route.distanceKm,
          s.route.durationMin,
          s.route.estimated ? 1 : 0,
          idx + 1,
          listing.id,
          s.recipient.id,
        ]
      );
    } else {
      q.run(
        `INSERT INTO offers (listing_id, recipient_id, score, breakdown_json, explanation,
          distance_km, duration_min, estimated, rank, status)
         VALUES (?,?,?,?,?,?,?,?,?, 'CANDIDATE')`,
        [
          listing.id,
          s.recipient.id,
          s.score,
          JSON.stringify(s.breakdown),
          explanation,
          s.route.distanceKm,
          s.route.durationMin,
          s.route.estimated ? 1 : 0,
          idx + 1,
        ]
      );
    }
  });

  return q.all(`SELECT * FROM offers WHERE listing_id = ? ORDER BY rank ASC`, [listing.id]);
}

/** Optionally polish the stored explanation with an LLM (never the score). */
export async function maybeEnhanceExplanation(listing, recipient, offer) {
  const breakdown = JSON.parse(offer.breakdown_json || '{}');
  breakdown.score = offer.score;
  const base = offer.explanation || templateExplanation(listing, recipient, breakdown);
  const rewritten = await llmRewrite(base);
  if (rewritten && rewritten !== base) {
    q.run(`UPDATE offers SET explanation = ? WHERE id = ?`, [rewritten, offer.id]);
    return rewritten;
  }
  return base;
}

async function llmRewrite(prompt) {
  if (!config.llm.apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: 0.2,
        max_tokens: 120,
        messages: [
          {
            role: 'system',
            content:
              'Rewrite the given match rationale in one short friendly sentence. Do not change numbers, distances or scores. Never claim food safety certification.',
          },
          { role: 'user', content: prompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
