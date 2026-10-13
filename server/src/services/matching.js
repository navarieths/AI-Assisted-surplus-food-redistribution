import { config } from '../config.js';
import { q } from '../db.js';
import { haversineKm, routeInfo } from './geo.js';

/**
 * Deterministic matching. Works with no AI key.
 * An LLM can only rewrite the human-readable explanation, never the score.
 */

const WEIGHTS = {
  proximity: 35,
  capacity: 20,
  feasibility: 25,
  foodPreference: 10,
  reliability: 10,
};

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function parseHM(hm) {
  const [h, m] = String(hm || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Nearest active volunteer to the pickup point (Haversine, no API call). */
function nearestVolunteer(listing) {
  const vols = q.all(
    `SELECT id, name, lat, lng FROM users WHERE role IN ('volunteer','delivery_partner') AND active = 1 AND lat IS NOT NULL`
  );
  let best = null;
  for (const v of vols) {
    const d = haversineKm(listing, v);
    if (!best || d < best.distanceKm) best = { ...v, distanceKm: d };
  }
  return best;
}

function feasibility({ listing, recipient, readyAt, volunteerTravelMin, deliveryMin }) {
  const deadline = new Date(listing.pickup_deadline);
  const pickupArrival = new Date(readyAt.getTime() + volunteerTravelMin * 60000);
  const recipientArrival = new Date(pickupArrival.getTime() + deliveryMin * 60000);

  const reasons = [];
  const beforeDeadline = pickupArrival <= deadline;
  if (!beforeDeadline) reasons.push('Pickup would happen after the deadline.');

  const open = parseHM(recipient.collection_open);
  const close = parseHM(recipient.collection_close);
  const arr = minutesOfDay(recipientArrival);
  const withinCollection = arr >= open && arr <= close;
  if (!withinCollection) reasons.push('Delivery falls outside recipient collection hours.');

  return {
    feasible: beforeDeadline && withinCollection,
    beforeDeadline,
    withinCollection,
    pickupArrival,
    recipientArrival,
    reasons,
  };
}

function scoreOne({ listing, recipient, route, volunteerTravelMin }) {
  const radius = config.matching.haversinePrefilterKm;

  // proximity: 35 at 0km, 0 at radius+
  const proximity = Math.max(0, 1 - route.distanceKm / radius) * WEIGHTS.proximity;

  // capacity fit
  let capacity = WEIGHTS.capacity;
  if (recipient.capacity_servings > 0) {
    if (listing.servings <= recipient.capacity_servings) capacity = WEIGHTS.capacity;
    else {
      const overflow = listing.servings / recipient.capacity_servings;
      capacity = Math.max(0, WEIGHTS.capacity * (2 - overflow) / 1); // 1x -> full, 2x -> 0
    }
  }

  // food preference
  const foodPreference =
    recipient.veg_only && listing.food_type === 'nonveg' ? 0 : WEIGHTS.foodPreference;

  // reliability
  const reliability = Math.max(0, Math.min(1, recipient.reliability)) * WEIGHTS.reliability;

  // feasibility
  const readyAt = new Date(listing.ready_at);
  const feas = feasibility({
    listing,
    recipient,
    readyAt,
    volunteerTravelMin,
    deliveryMin: route.durationMin,
  });
  const feasibilityScore = feas.feasible ? WEIGHTS.feasibility : 0;

  const score =
    Math.round((proximity + capacity + foodPreference + reliability + feasibilityScore) * 10) / 10;

  const breakdown = {
    proximity: Math.round(proximity * 10) / 10,
    capacity: Math.round(capacity * 10) / 10,
    feasibility: feasibilityScore,
    foodPreference,
    reliability: Math.round(reliability * 10) / 10,
    weights: WEIGHTS,
    distanceKm: route.distanceKm,
    durationMin: route.durationMin,
    estimated: route.estimated,
    volunteerTravelMin,
    pickupBy: feas.pickupArrival.toISOString(),
    arrivalAt: feas.recipientArrival.toISOString(),
    feasibilityReasons: feas.reasons,
    collectionHours: `${recipient.collection_open}-${recipient.collection_close}`,
    movable: feas.feasible,
  };

  return { score, breakdown };
}

/** Deterministic, human-readable, no AI required. */
export function templateExplanation(listing, recipient, breakdown) {
  const bits = [];
  bits.push(
    `${recipient.name} is ${breakdown.distanceKm} km / ~${breakdown.durationMin} min from the pickup point (${breakdown.estimated ? 'estimated' : 'live road route'}).`
  );
  bits.push(
    breakdown.movable
      ? `Timings fit: a volunteer can collect by ${new Date(breakdown.pickupBy).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} and deliver inside collection hours (${breakdown.collectionHours}).`
      : `Timing risk: ${breakdown.feasibilityReasons.join(' ') || 'delivery window is tight.'}`
  );
  if (breakdown.foodPreference === 0) bits.push('Food type conflicts with this recipient preference.');
  if (recipient.capacity_servings > 0) bits.push(`Capacity ${recipient.capacity_servings} servings vs ${listing.servings} offered.`);
  bits.push(`Deterministic score ${breakdown.score ?? ''} (0-100).`);
  return bits.join(' ');
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

/**
 * Score all eligible recipients for a listing.
 * Pre-filter by Haversine radius, then use real road distance for top N.
 */
export async function scoreListing(listing) {
  const candidates = q
    .all(
      `SELECT * FROM users WHERE role = 'recipient' AND active = 1 AND lat IS NOT NULL`
    )
    .map((r) => ({ ...r, haversineKm: haversineKm(listing, r) }))
    .filter((r) => r.haversineKm <= config.matching.haversinePrefilterKm)
    .sort((a, b) => a.haversineKm - b.haversineKm)
    .slice(0, config.matching.topN);

  const vol = nearestVolunteer(listing);
  let volunteerTravelMin = 15; // fallback assumption when no volunteer exists
  if (vol) {
    const vr = await routeInfo(vol, listing);
    volunteerTravelMin = vr.durationMin;
  }

  const scored = [];
  for (const recipient of candidates) {
    const route = await routeInfo(listing, recipient);
    const { score, breakdown } = scoreOne({
      listing,
      recipient,
      route,
      volunteerTravelMin,
    });
    breakdown.score = score;
    const explanation = templateExplanation(listing, recipient, breakdown);
    scored.push({ recipient, score, breakdown, explanation, route, volunteerTravelMin });
  }

  scored.sort((a, b) => b.score - a.score || a.recipient.id - b.recipient.id);
  return { scored, volunteer: vol, volunteerTravelMin };
}

/** Persist matches for a listing, returning the stored rows (ranked). */
export async function persistMatches(listing) {
  const { scored } = await scoreListing(listing);
  const existing = q.all(`SELECT recipient_id FROM matches WHERE listing_id = ?`, [listing.id]);
  const seen = new Set(existing.map((e) => e.recipient_id));

  scored.forEach((s, idx) => {
    const explanation = s.explanation;
    if (seen.has(s.recipient.id)) {
      q.run(
        `UPDATE matches SET score=?, breakdown_json=?, explanation=?, distance_km=?, duration_min=?,
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
        `INSERT INTO matches (listing_id, recipient_id, score, breakdown_json, explanation,
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

  return q.all(`SELECT * FROM matches WHERE listing_id = ? ORDER BY rank ASC`, [listing.id]);
}

/** Optionally polish the stored explanation with an LLM (never the score). */
export async function maybeEnhanceExplanation(listing, recipient, match) {
  const breakdown = JSON.parse(match.breakdown_json || '{}');
  breakdown.score = match.score;
  const base = match.explanation || templateExplanation(listing, recipient, breakdown);
  const rewritten = await llmRewrite(base);
  if (rewritten && rewritten !== base) {
    q.run(`UPDATE matches SET explanation = ? WHERE id = ?`, [rewritten, match.id]);
    return rewritten;
  }
  return base;
}
