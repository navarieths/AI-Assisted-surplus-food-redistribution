import { config } from '../config.js';
import { q } from '../db.js';
import { routeInfo } from './geo.js';
import { activeCarriers, activeTaskCount } from './profiles.js';
import { assignVolunteer } from './listings.js';
import { notify } from './workflow.js';

/**
 * Volunteer assignment.
 *
 * Carriers (volunteers + delivery partners) are ranked deterministically by:
 *   - real travel time to the pickup (OSRM, Haversine fallback), weight 50
 *   - availability (opt-in flag + current workload), weight 30
 *   - feasibility (reach pickup before the deadline, deliver in collection
 *     hours), weight 20
 *
 * The top `limit` carriers are invited. Each invitation stores an expiry;
 * invitations are swept lazily on the next relevant request, then cascade to
 * the next ranked carriers (or tell the provider to trigger a fallback).
 */

const clamp01 = (n) => Math.max(0, Math.min(1, n));

function parseHm(v) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v || ''));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function clockWithin(open, close, minutesFromNow) {
  const openM = parseHm(open);
  const closeM = parseHm(close);
  if (openM == null || closeM == null) return true;
  const d = new Date(Date.now() + minutesFromNow * 60000);
  const t = d.getHours() * 60 + d.getMinutes();
  if (closeM >= openM) return t >= openM && t <= closeM;
  return t >= openM || t <= closeM; // window wraps past midnight
}

function expiresAtSql() {
  const ms = Date.now() + config.volunteerOffer.timeoutSec * 1000;
  // ISO-8601 with Z: SQLite's datetime() and JS Date both parse it as UTC.
  return new Date(ms).toISOString();
}

/** Recipient + user join used for the delivery leg and collection hours. */
function recipientFor(assignmentLike) {
  return q.get(
    `SELECT u.id, u.name, r.org_name, r.lat, r.lng, r.address,
            r.collection_open, r.collection_close
       FROM users u LEFT JOIN recipients r ON r.user_id = u.id
      WHERE u.id = ?`,
    [assignmentLike?.recipient_id ?? -1]
  );
}

export async function rankVolunteers({ listing, recipient, routeFn = routeInfo }) {
  const candidates = activeCarriers().filter((c) => c.lat != null && c.lng != null);
  const pickup = { lat: listing.lat, lng: listing.lng };
  const drop = recipient && recipient.lat != null ? { lat: recipient.lat, lng: recipient.lng } : null;
  const nowMs = Date.now();
  const deadlineMs = listing.pickup_deadline ? new Date(listing.pickup_deadline).getTime() : null;
  const { weights: w, maxTravelMin } = config.volunteerOffer;
  const maxTravel = Math.max(1, maxTravelMin);

  // The pickup -> drop leg is identical for every carrier, so route it once.
  let leg2 = null;
  if (drop) {
    try {
      leg2 = await routeFn(pickup, drop);
    } catch {
      leg2 = null;
    }
  }

  const ranked = await Promise.all(
    candidates.map(async (c) => {
      let leg1;
      try {
        leg1 = await routeFn({ lat: c.lat, lng: c.lng }, pickup);
      } catch {
        leg1 = { distanceKm: 0, durationMin: 0, estimated: true };
      }
      const travelMinToPickup = Number(leg1.durationMin) || 0;
      const distanceToPickupKm = Number(leg1.distanceKm) || 0;
      const totalTravelMin = travelMinToPickup + (leg2 ? Number(leg2.durationMin) || 0 : 0);

      const travelScore = clamp01(1 - travelMinToPickup / maxTravel);

      const tasks = activeTaskCount(c.id);
      const isAvailable = c.available !== 0;
      const availabilityScore = isAvailable ? clamp01(1 - Math.min(tasks, 3) * 0.3) : 0;

      const deadlineOk = deadlineMs == null ? true : nowMs + travelMinToPickup * 60000 <= deadlineMs;
      const collectionOk = recipient
        ? clockWithin(recipient.collection_open, recipient.collection_close, totalTravelMin)
        : true;
      const feasible = deadlineOk && collectionOk;
      const feasibilityScore = (deadlineOk ? 0.5 : 0) + (collectionOk ? 0.5 : 0);

      const score = Math.round(
        travelScore * w.travelTime + availabilityScore * w.availability + feasibilityScore * w.feasibility
      );

      const reasons = [];
      reasons.push(
        `${travelMinToPickup} min / ${distanceToPickupKm.toFixed(1)} km to pickup${leg1.estimated ? ' (estimated)' : ''}`
      );
      reasons.push(isAvailable ? (tasks ? `available, ${tasks} active task(s)` : 'available') : 'not accepting tasks');
      reasons.push(deadlineOk ? 'can reach pickup before the deadline' : 'may miss the pickup deadline');
      if (recipient) reasons.push(collectionOk ? 'delivery inside collection hours' : 'outside collection hours');

      return {
        id: c.id,
        user_id: c.id,
        name: c.name,
        role: c.role,
        vehicle: c.vehicle || null,
        org_name: c.org_name || null,
        phone: c.phone || null,
        lat: c.lat,
        lng: c.lng,
        available: isAvailable ? 1 : 0,
        activeTasks: tasks,
        feasible: feasible ? 1 : 0,
        score,
        travelMinToPickup,
        travelMinTotal: Math.round(totalTravelMin * 10) / 10,
        distanceKm: Math.round(distanceToPickupKm * 10) / 10,
        estimated: Boolean(leg1.estimated || (leg2 && leg2.estimated)),
        reasons,
        breakdown: {
          travelTime: Math.round(travelScore * w.travelTime),
          availability: Math.round(availabilityScore * w.availability),
          feasibility: Math.round(feasibilityScore * w.feasibility),
        },
      };
    })
  );

  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      a.travelMinToPickup - b.travelMinToPickup ||
      a.distanceKm - b.distanceKm
  );
  ranked.forEach((r, i) => {
    r.rank = i + 1;
  });
  return ranked;
}

function existingOfferStatuses(assignmentId) {
  const rows = q.all(`SELECT volunteer_id, status FROM assignment_offers WHERE assignment_id = ?`, [
    assignmentId,
  ]);
  return Object.fromEntries(rows.map((r) => [r.volunteer_id, r.status]));
}

/**
 * Rank carriers and invite the best `limit` of them. `onlyNew` is used when
 * cascading after a decline/expiry so already-invited carriers are not pinged
 * again. Returns the current offer rows for the assignment.
 */
export async function inviteVolunteers(assignment, actor, { limit, routeFn = routeInfo, onlyNew = false } = {}) {
  const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [assignment.listing_id]);
  if (!listing) {
    const err = new Error('Listing not found');
    err.status = 404;
    throw err;
  }
  const recipient = recipientFor(assignment);
  const ranked = await rankVolunteers({ listing, recipient, routeFn });
  const statuses = existingOfferStatuses(assignment.id);
  const take = limit ?? config.volunteerOffer.limit;

  const pool = ranked.filter((r) => {
    const status = statuses[r.id];
    if (status === 'ACCEPTED' || status === 'DECLINED') return false;
    if (onlyNew && status) return false;
    if (r.available === 0) return false; // don't invite carriers who opted out
    return true;
  });

  const expiresAt = expiresAtSql();
  const invited = [];
  pool.slice(0, take).forEach((r, index) => {
    q.run(
      `INSERT INTO assignment_offers
         (assignment_id, volunteer_id, rank, score, travel_min, distance_km, feasible, available,
          reasons_json, status, expires_at, responded_at)
       VALUES (?,?,?,?,?,?,?,?,?, 'OFFERED', ?, NULL)
       ON CONFLICT(assignment_id, volunteer_id) DO UPDATE SET
         rank = excluded.rank, score = excluded.score, travel_min = excluded.travel_min,
         distance_km = excluded.distance_km, feasible = excluded.feasible, available = excluded.available,
         reasons_json = excluded.reasons_json, status = 'OFFERED',
         expires_at = excluded.expires_at, responded_at = NULL`,
      [
        assignment.id,
        r.id,
        r.rank,
        r.score,
        r.travelMinToPickup,
        r.distanceKm,
        r.feasible,
        r.available,
        JSON.stringify({ reasons: r.reasons, breakdown: r.breakdown }),
        expiresAt,
      ]
    );
    invited.push(r);
    notify(
      r.id,
      r.role,
      `Pickup invitation: ${listing.title}`,
      `${r.travelMinToPickup} min to pickup (${listing.address || 'pickup point'}). Accept within ${Math.round(
        config.volunteerOffer.timeoutSec / 60
      )} min.`,
      listing.id
    );
  });

  return listAssignmentOffers(assignment.id);
}

/** Ranked invitations for one assignment (participant view). */
export function listAssignmentOffers(assignmentId) {
  const rows = q.all(
    `SELECT ao.*, u.name, u.role, COALESCE(v.vehicle, d.vehicle) AS vehicle
       FROM assignment_offers ao
       JOIN users u ON u.id = ao.volunteer_id
       LEFT JOIN volunteers v ON v.user_id = u.id
       LEFT JOIN delivery_partners d ON d.user_id = u.id
      WHERE ao.assignment_id = ?
      ORDER BY ao.rank`,
    [assignmentId]
  );
  return rows.map(serializeOffer);
}

/** A carrier's own live invitations, across all assignments. */
export function listInvitations(user) {
  const rows = q.all(
    `SELECT ao.*, a.listing_id, a.recipient_id, a.volunteer_id,
            l.title, l.address, l.lat, l.lng, l.pickup_deadline, l.quantity_kg, l.servings
       FROM assignment_offers ao
       JOIN assignments a ON a.id = ao.assignment_id
       JOIN listings l ON l.id = a.listing_id
      WHERE ao.volunteer_id = ? AND ao.status = 'OFFERED'
        AND a.volunteer_id IS NULL
        AND datetime(ao.expires_at) > datetime('now')
      ORDER BY ao.score DESC`,
    [user.id]
  );
  return rows.map((row) => {
    const recipient = recipientFor({ recipient_id: row.recipient_id });
    return {
      ...serializeOffer(row),
      assignment_id: row.assignment_id,
      listing: {
        id: row.listing_id,
        title: row.title,
        address: row.address,
        lat: row.lat,
        lng: row.lng,
        pickup_deadline: row.pickup_deadline,
        quantity_kg: row.quantity_kg,
        servings: row.servings,
      },
      recipient: recipient ? { name: recipient.org_name || recipient.name, address: recipient.address } : null,
    };
  });
}

export function serializeOffer(row) {
  let payload = {};
  try {
    payload = row.reasons_json ? JSON.parse(row.reasons_json) : {};
  } catch {
    payload = {};
  }
  return {
    id: row.id,
    assignmentId: row.assignment_id,
    volunteerId: row.volunteer_id,
    name: row.name || null,
    role: row.role || null,
    vehicle: row.vehicle || null,
    rank: row.rank,
    score: row.score,
    travelMin: row.travel_min,
    distanceKm: row.distance_km,
    feasible: Boolean(row.feasible),
    available: Boolean(row.available),
    reasons: payload.reasons || [],
    breakdown: payload.breakdown || null,
    status: row.status,
    expiresAt: row.expires_at,
    secondsLeft: row.expires_at
      ? Math.max(0, Math.round((new Date(row.expires_at).getTime() - Date.now()) / 1000))
      : null,
    respondedAt: row.responded_at,
  };
}

/** Mark a single offered invitation expired and report whether it changed. */
function expireOffer(offer) {
  q.run(
    `UPDATE assignment_offers SET status = 'EXPIRED', responded_at = datetime('now') WHERE id = ? AND status = 'OFFERED'`,
    [offer.id]
  );
}

/**
 * Lazily expire stale invitations, then cascade each affected assignment to the
 * next ranked carriers (or prompt the provider to use a fallback carrier).
 */
export async function sweepExpiredOffers({ routeFn = routeInfo } = {}) {
  const stale = q.all(
    `SELECT * FROM assignment_offers
      WHERE status = 'OFFERED' AND expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now')`
  );
  if (!stale.length) return { expired: 0, cascaded: 0 };
  const assignmentIds = new Set();
  for (const offer of stale) {
    expireOffer(offer);
    assignmentIds.add(offer.assignment_id);
  }
  let cascaded = 0;
  for (const assignmentId of assignmentIds) {
    const assignment = q.get(`SELECT * FROM assignments WHERE id = ?`, [assignmentId]);
    if (assignment && !assignment.volunteer_id) {
      const result = await cascadeAssignment(assignment, null, { routeFn });
      if (result.invited) cascaded += 1;
    }
  }
  return { expired: stale.length, cascaded };
}

/**
 * When no live invitations remain for an assignment, invite the next ranked
 * carriers; if none are left, nudge the provider toward the fallback path.
 */
export async function cascadeAssignment(assignment, actor, { routeFn = routeInfo } = {}) {
  if (assignment.volunteer_id) return { invited: false };
  const live = q.get(
    `SELECT COUNT(*) AS n FROM assignment_offers
      WHERE assignment_id = ? AND status = 'OFFERED'
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))`,
    [assignment.id]
  ).n;
  if (live > 0) return { invited: false };

  const offers = await inviteVolunteers(assignment, actor, { routeFn, onlyNew: true });
  const invited = offers.some((o) => o.status === 'OFFERED');
  if (!invited) {
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [assignment.listing_id]);
    notify(
      listing.provider_id,
      'provider',
      `No volunteer accepted #${listing.id}`,
      'All invitations expired or declined. Consider triggering a fallback carrier.',
      listing.id
    );
  }
  return { invited };
}

/**
 * Carrier responds to an invitation. Accepting assigns the carrier and issues a
 * hashed pickup OTP (the plain value goes to the provider only). Declining
 * cascades to the next ranked carrier.
 */
export async function respondToOffer(offerId, user, action, { routeFn = routeInfo } = {}) {
  const offer = q.get(`SELECT * FROM assignment_offers WHERE id = ?`, [offerId]);
  if (!offer) {
    const err = new Error('Invitation not found');
    err.status = 404;
    throw err;
  }
  if (offer.volunteer_id !== user.id) {
    const err = new Error('This invitation does not belong to you');
    err.status = 403;
    throw err;
  }
  if (offer.status !== 'OFFERED') {
    const err = new Error(`Invitation is ${offer.status}`);
    err.status = 409;
    throw err;
  }
  if (offer.expires_at && new Date(offer.expires_at).getTime() <= Date.now()) {
    expireOffer(offer);
    await cascadeAssignment(q.get(`SELECT * FROM assignments WHERE id = ?`, [offer.assignment_id]), user, {
      routeFn,
    });
    const err = new Error('Invitation expired');
    err.status = 409;
    throw err;
  }

  const assignment = q.get(`SELECT * FROM assignments WHERE id = ?`, [offer.assignment_id]);
  if (!assignment) {
    const err = new Error('Assignment not found');
    err.status = 404;
    throw err;
  }

  if (action === 'decline') {
    q.run(
      `UPDATE assignment_offers SET status = 'DECLINED', responded_at = datetime('now') WHERE id = ?`,
      [offer.id]
    );
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [assignment.listing_id]);
    notify(
      listing.provider_id,
      'provider',
      `Volunteer declined #${listing.id}`,
      `${user.name} can no longer make the pickup. Finding the next carrier.`,
      listing.id
    );
    await cascadeAssignment(assignment, user, { routeFn });
    return { status: 'DECLINED' };
  }

  if (assignment.volunteer_id) {
    const err = new Error('This pickup already has a carrier');
    err.status = 409;
    throw err;
  }

  q.run(
    `UPDATE assignment_offers SET status = 'ACCEPTED', responded_at = datetime('now') WHERE id = ?`,
    [offer.id]
  );
  // Supersede every other live invitation for the same assignment.
  q.run(
    `UPDATE assignment_offers SET status = 'DECLINED', responded_at = datetime('now')
      WHERE assignment_id = ? AND id != ? AND status = 'OFFERED'`,
    [assignment.id, offer.id]
  );
  const updated = assignVolunteer(assignment, user, user);
  return { status: 'ACCEPTED', assignment: updated };
}

/** Extract the latest plaintext pickup OTP for the owning provider. */
export function revealPickupOtp(assignment) {
  if (assignment.pickup_otp) return { otp: assignment.pickup_otp, source: 'legacy' };
  if (!assignment.pickup_otp_hash) return null;
  const note = q.get(
    `SELECT body, created_at FROM notifications
      WHERE listing_id = ? AND body LIKE '%Pickup OTP:%'
      ORDER BY id DESC LIMIT 1`,
    [assignment.listing_id]
  );
  const match = note ? /Pickup OTP:\s*(\d{4,8})/.exec(note.body) : null;
  if (!match) return null;
  return { otp: match[1], issuedAt: assignment.pickup_otp_issued_at, source: 'notification' };
}
