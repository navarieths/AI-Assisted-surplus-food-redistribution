import { Router } from 'express';
import { q } from '../db.js';
import { config } from '../config.js';
import { authRequired } from '../auth.js';
import { haversineKm, routeInfo, routeVia } from '../services/geo.js';
import { assignVolunteer, serializeAssignment } from '../services/listings.js';
import {
  inviteVolunteers,
  listAssignmentOffers,
  listInvitations,
  respondToOffer,
  revealPickupOtp,
  sweepExpiredOffers,
} from '../services/volunteerAssignment.js';
import { checkPickupOtp, notify, transition } from '../services/workflow.js';

const router = Router();
router.use(authRequired);

function assertParticipant(assignment, user) {
  const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [assignment.listing_id]);
  const ok =
    assignment.recipient_id === user.id ||
    assignment.volunteer_id === user.id ||
    (user.role === 'provider' && listing.provider_id === user.id);
  if (!ok) {
    const err = new Error('Not a participant of this assignment');
    err.status = 403;
    throw err;
  }
  return listing;
}

router.get('/', async (req, res, next) => {
  try {
    await sweepExpiredOffers();
    let rows;
    if (req.user.role === 'volunteer' || req.user.role === 'delivery_partner') {
      rows = q.all(`SELECT * FROM assignments WHERE volunteer_id = ? ORDER BY id DESC`, [req.user.id]);
    } else if (req.user.role === 'recipient') {
      rows = q.all(`SELECT * FROM assignments WHERE recipient_id = ? ORDER BY id DESC`, [req.user.id]);
    } else {
      rows = q.all(
        `SELECT a.* FROM assignments a JOIN listings l ON l.id = a.listing_id
         WHERE l.provider_id = ? ORDER BY a.id DESC`,
        [req.user.id]
      );
    }
    res.json({ assignments: rows.map((a) => serializeAssignment(a, req.user)) });
  } catch (err) {
    next(err);
  }
});

/** Accepted donations that still need a carrier. */
router.get('/available', async (req, res, next) => {
  try {
    await sweepExpiredOffers();
    const rows = q.all(
      `SELECT a.*, l.title, l.address, l.lat, l.lng, l.pickup_deadline, l.ready_at, l.quantity_kg, l.servings
       FROM assignments a JOIN listings l ON l.id = a.listing_id
       WHERE a.volunteer_id IS NULL AND a.status = 'CREATED' ORDER BY datetime(l.pickup_deadline) ASC`
    );
    const me = req.user.lat != null ? { lat: req.user.lat, lng: req.user.lng } : null;
    res.json({
      assignments: rows.map((a) => ({
        ...a,
        distanceFromMeKm: me ? Math.round(haversineKm(me, a) * 10) / 10 : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/** A carrier's live invitations (ranked, with expiry). */
router.get('/invitations', async (req, res, next) => {
  try {
    if (!['volunteer', 'delivery_partner'].includes(req.user.role)) {
      return res.json({ invitations: [] });
    }
    await sweepExpiredOffers();
    res.json({ invitations: listInvitations(req.user) });
  } catch (err) {
    next(err);
  }
});

/** Accept or decline a ranked invitation. */
router.post('/invitations/:offerId/respond', async (req, res, next) => {
  try {
    if (!['volunteer', 'delivery_partner'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only carriers can respond to invitations' });
    }
    const action = req.body?.action === 'decline' ? 'decline' : 'accept';
    const result = await respondToOffer(Number(req.params.offerId), req.user, action);
    res.json({
      status: result.status,
      assignment: result.assignment ? serializeAssignment(result.assignment, req.user) : undefined,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const assignment = q.get(`SELECT * FROM assignments WHERE id = ?`, [req.params.id]);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    try {
      assertParticipant(assignment, req.user);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message });
    }
    await sweepExpiredOffers();
    const fresh = q.get(`SELECT * FROM assignments WHERE id = ?`, [assignment.id]);
    res.json({ assignment: serializeAssignment(fresh, req.user) });
  } catch (err) {
    next(err);
  }
});

/**
 * Rank carriers and invite the best few (provider or recipient). The ranking
 * combines real travel time to pickup, availability and feasibility.
 */
router.post('/:id/invite', async (req, res, next) => {
  try {
    const assignment = q.get(`SELECT * FROM assignments WHERE id = ?`, [req.params.id]);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    const listing = assertParticipant(assignment, req.user);
    const isOwnerParty =
      assignment.recipient_id === req.user.id ||
      (req.user.role === 'provider' && listing.provider_id === req.user.id);
    if (!isOwnerParty) {
      return res.status(403).json({ error: 'Only the recipient or provider can invite volunteers' });
    }
    if (assignment.volunteer_id) {
      return res.status(409).json({ error: 'This pickup already has a carrier' });
    }
    const limit = Number(req.body?.limit) || undefined;
    await inviteVolunteers(assignment, req.user, { limit });
    res.json({ offers: listAssignmentOffers(assignment.id) });
  } catch (err) {
    next(err);
  }
});

/** Ranked invitations for one assignment (participant view). */
router.get('/:id/volunteer-offers', async (req, res, next) => {
  try {
    const assignment = q.get(`SELECT * FROM assignments WHERE id = ?`, [req.params.id]);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    try {
      assertParticipant(assignment, req.user);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message });
    }
    await sweepExpiredOffers();
    res.json({ offers: listAssignmentOffers(assignment.id) });
  } catch (err) {
    next(err);
  }
});

/**
 * Provider-only reveal of the plaintext pickup OTP. The database stores only
 * the bcrypt hash; the plain value was delivered via the simulated provider
 * notification, which is where this reads it from.
 */
router.get('/:id/pickup-otp', (req, res, next) => {
  try {
    const assignment = q.get(`SELECT * FROM assignments WHERE id = ?`, [req.params.id]);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [assignment.listing_id]);
    if (!(req.user.role === 'provider' && listing.provider_id === req.user.id)) {
      return res.status(403).json({ error: 'Only the provider can view the pickup OTP' });
    }
    const revealed = revealPickupOtp(assignment);
    if (!revealed) return res.status(404).json({ error: 'No pickup OTP issued yet' });
    res.json(revealed);
  } catch (err) {
    next(err);
  }
});

/** Volunteer self-claims an open assignment. */
router.post('/:id/claim', async (req, res, next) => {
  try {
    if (!['volunteer', 'delivery_partner'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only carriers can claim assignments' });
    }
    const assignment = q.get(`SELECT * FROM assignments WHERE id = ?`, [req.params.id]);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    if (assignment.volunteer_id && assignment.volunteer_id !== req.user.id) {
      return res.status(409).json({ error: 'Already claimed' });
    }
    const updated = assignVolunteer(assignment, req.user, req.user);
    res.json({ assignment: serializeAssignment(updated, req.user) });
  } catch (err) {
    next(err);
  }
});

/** Recipient/provider explicitly assigns a carrier. */
router.post('/:id/assign', async (req, res, next) => {
  try {
    const assignment = q.get(`SELECT * FROM assignments WHERE id = ?`, [req.params.id]);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    const listing = assertParticipant(assignment, req.user);
    if (!(assignment.recipient_id === req.user.id || (req.user.role === 'provider' && listing.provider_id === req.user.id))) {
      return res.status(403).json({ error: 'Only the recipient or provider can assign' });
    }
    const vol = q.get(`SELECT * FROM users WHERE id = ? AND role IN ('volunteer','delivery_partner')`, [
      req.body?.volunteer_id,
    ]);
    if (!vol) return res.status(400).json({ error: 'volunteer_id is required and must be a carrier' });
    const updated = assignVolunteer(assignment, vol, req.user);
    res.json({ assignment: serializeAssignment(updated, req.user) });
  } catch (err) {
    next(err);
  }
});

/** Fallback: reassign to the nearest available delivery partner / volunteer. */
router.post('/:id/fallback', async (req, res, next) => {
  try {
    const assignment = q.get(`SELECT * FROM assignments WHERE id = ?`, [req.params.id]);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    const listing = assertParticipant(assignment, req.user);
    const candidates = q.all(
      `SELECT u.id, u.name, u.role, u.active, COALESCE(v.lat, d.lat) AS lat, COALESCE(v.lng, d.lng) AS lng
       FROM users u
       LEFT JOIN volunteers v ON v.user_id = u.id
       LEFT JOIN delivery_partners d ON d.user_id = u.id
       WHERE u.role IN ('volunteer','delivery_partner') AND u.active = 1
       AND u.id != COALESCE(?, -1) AND COALESCE(v.lat, d.lat) IS NOT NULL`,
      [assignment.volunteer_id]
    );
    if (!candidates.length) {
      return res.status(409).json({ error: 'No fallback carrier available' });
    }
    candidates.sort((a, b) => haversineKm(listing, a) - haversineKm(listing, b));
    const chosen = candidates[0];
    q.run(`UPDATE assignments SET volunteer_id = NULL, updated_at = datetime('now') WHERE id = ?`, [assignment.id]);
    const updated = assignVolunteer(assignment, chosen, req.user, { fallback: true });
    notify(listing.provider_id, 'provider', `Fallback carrier assigned to #${listing.id}`, `${chosen.name} (${chosen.role}) stepped in.`, listing.id);
    res.json({ assignment: serializeAssignment(updated, req.user), fallback: chosen.name });
  } catch (err) {
    next(err);
  }
});

/** Assigned carrier or listing provider verifies the hashed, attempt-capped pickup OTP. */
router.post('/:id/pickup', (req, res, next) => {
  try {
    const assignment = q.get(`SELECT * FROM assignments WHERE id = ?`, [req.params.id]);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [assignment.listing_id]);
    const isAssignedCarrier = assignment.volunteer_id === req.user.id;
    const isListingProvider = req.user.role === 'provider' && listing.provider_id === req.user.id;
    if (!isAssignedCarrier && !isListingProvider) {
      return res.status(403).json({ error: 'Only the assigned carrier or listing provider can verify pickup' });
    }
    if (assignment.pickup_verified_at) return res.status(409).json({ error: 'Pickup already verified' });

    const result = checkPickupOtp(assignment, String(req.body?.otp || ''));
    const attempts = Number(
      q.get(`SELECT pickup_otp_attempts FROM assignments WHERE id = ?`, [assignment.id]).pickup_otp_attempts || 0
    );
    if (!result.ok) {
      if (result.locked) {
        return res.status(423).json({
          error: `Too many incorrect attempts. Pickup OTP locked after ${config.otp.maxAttempts} tries.`,
          locked: true,
          remaining: 0,
        });
      }
      return res.status(400).json({
        error: `Incorrect OTP. ${result.remaining} attempt(s) remaining.`,
        locked: false,
        remaining: result.remaining,
        attempts,
      });
    }

    q.run(
      `UPDATE assignments SET pickup_verified_at = datetime('now'), status = 'IN_TRANSIT', updated_at = datetime('now') WHERE id = ?`,
      [assignment.id]
    );
    if (listing.status !== 'PICKED_UP') transition(listing.id, 'PICKED_UP', req.user, 'Pickup OTP verified');
    transition(listing.id, 'IN_TRANSIT', req.user, 'En route to recipient');
    notify(assignment.recipient_id, 'recipient', `Your donation #${listing.id} is on the way`, `${req.user.name} picked it up.`, listing.id);
    const updated = q.get(`SELECT * FROM assignments WHERE id = ?`, [assignment.id]);
    res.json({
      assignment: serializeAssignment(updated, req.user),
      pickupVerifiedAt: updated.pickup_verified_at,
    });
  } catch (err) {
    next(err);
  }
});

/** Recipient confirms delivery. */
router.post('/:id/confirm-delivery', (req, res, next) => {
  try {
    const assignment = q.get(`SELECT * FROM assignments WHERE id = ?`, [req.params.id]);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    if (assignment.recipient_id !== req.user.id) return res.status(403).json({ error: 'Only the recipient confirms delivery' });
    if (assignment.status === 'DELIVERED') {
      return res.json({ assignment: serializeAssignment(assignment, req.user) });
    }
    if (!assignment.pickup_verified_at && assignment.status !== 'IN_TRANSIT') {
      return res.status(409).json({ error: 'Delivery can only be confirmed after pickup is verified' });
    }
    q.run(`UPDATE assignments SET status = 'DELIVERED', delivered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, [
      assignment.id,
    ]);
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [assignment.listing_id]);
    if (listing.status !== 'DELIVERED') transition(listing.id, 'DELIVERED', req.user, 'Recipient confirmed delivery');
    notify(listing.provider_id, 'provider', `Donation #${listing.id} delivered`, `${req.user.name} confirmed receipt.`, listing.id);
    if (assignment.volunteer_id) notify(assignment.volunteer_id, 'volunteer', `Delivery complete for #${listing.id}`, 'Thank you!', listing.id);
    // update reliability signal
    q.run(`UPDATE recipients SET reliability = MIN(1.0, reliability + 0.02) WHERE user_id = ?`, [assignment.recipient_id]);
    res.json({ assignment: serializeAssignment(q.get(`SELECT * FROM assignments WHERE id = ?`, [assignment.id]), req.user) });
  } catch (err) {
    next(err);
  }
});

/** Index in a polyline nearest to a point. */
function nearestIndex(points, point) {
  let best = 0;
  let bestD = Infinity;
  points.forEach(([lat, lng], i) => {
    const d = (lat - point.lat) ** 2 + (lng - point.lng) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * Dev-only: advance the volunteer marker one step along the route so the live
 * tracking demo works from a laptop without a real GPS. Any participant can
 * drive it; the resulting breadcrumb is recorded like a real geolocation post.
 */
router.post('/:id/simulate-location', async (req, res, next) => {
  try {
    if (!config.dev.simulateMovement) {
      return res.status(403).json({ error: 'Movement simulation is disabled' });
    }
    const assignment = q.get(`SELECT * FROM assignments WHERE id = ?`, [req.params.id]);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    try {
      assertParticipant(assignment, req.user);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message });
    }
    if (assignment.status === 'DELIVERED') {
      return res.status(409).json({ error: 'Assignment already delivered' });
    }

    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [assignment.listing_id]);
    const recipient = q.get(
      `SELECT u.id, r.lat, r.lng FROM users u LEFT JOIN recipients r ON r.user_id = u.id WHERE u.id = ?`,
      [assignment.recipient_id]
    );
    const pickup = { lat: listing.lat, lng: listing.lng };
    const drop = recipient?.lat != null ? { lat: recipient.lat, lng: recipient.lng } : pickup;
    const latest = q.get(
      `SELECT * FROM volunteer_locations WHERE assignment_id = ? ORDER BY id DESC LIMIT 1`,
      [assignment.id]
    );
    const pickedUp = Boolean(assignment.pickup_verified_at) || listing.status === 'IN_TRANSIT';

    let origin = latest ? { lat: latest.lat, lng: latest.lng } : null;
    if (!origin && !pickedUp) {
      const vol = assignment.volunteer_id
        ? q.get(
            `SELECT COALESCE(v.lat, d.lat) AS lat, COALESCE(v.lng, d.lng) AS lng
               FROM users u
               LEFT JOIN volunteers v ON v.user_id = u.id
               LEFT JOIN delivery_partners d ON d.user_id = u.id
              WHERE u.id = ?`,
            [assignment.volunteer_id]
          )
        : null;
      origin = vol?.lat != null ? { lat: vol.lat, lng: vol.lng } : pickup;
    }
    if (!origin) origin = pickup;

    const destination = pickedUp ? drop : pickup;
    const route = await routeInfo(origin, destination);
    const geometry = (route.geometryLatLng || []).filter((p) => p && p.length === 2);
    if (geometry.length < 2) {
      return res.status(409).json({ error: 'No route available to simulate along' });
    }
    const stepIdx = Math.max(1, Math.round((geometry.length - 1) * 0.25));
    const nextIdx = Math.min(nearestIndex(geometry, origin) + stepIdx, geometry.length - 1);
    const remainingKm = (1 - nextIdx / (geometry.length - 1)) * (Number(route.distanceKm) || 0);
    const arrived = remainingKm <= 0.3;
    const [lat, lng] = arrived ? [destination.lat, destination.lng] : geometry[nextIdx];
    const mover = assignment.volunteer_id || req.user.id;
    q.run(`INSERT INTO volunteer_locations (assignment_id, volunteer_id, lat, lng) VALUES (?,?,?,?)`, [
      assignment.id,
      mover,
      lat,
      lng,
    ]);
    res.json({
      lat,
      lng,
      remainingKm: Math.round(remainingKm * 100) / 100,
      arrived,
      simulated: true,
    });
  } catch (err) {
    next(err);
  }
});

/** Tracking: markers, OSRM polyline, remaining distance + ETA. */
router.get('/:id/track', async (req, res, next) => {
  try {
    const assignment = q.get(`SELECT * FROM assignments WHERE id = ?`, [req.params.id]);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    try {
      assertParticipant(assignment, req.user);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message });
    }
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [assignment.listing_id]);
    const recipient = q.get(
      `SELECT u.id, u.name, r.org_name, r.lat, r.lng, r.address
       FROM users u LEFT JOIN recipients r ON r.user_id = u.id WHERE u.id = ?`,
      [assignment.recipient_id]
    );
    const latest = q.get(
      `SELECT * FROM volunteer_locations WHERE assignment_id = ? ORDER BY id DESC LIMIT 1`,
      [assignment.id]
    );

    const pickupPoint = { lat: listing.lat, lng: listing.lng };
    const hasDropLocation = Number.isFinite(recipient?.lat) && Number.isFinite(recipient?.lng);
    const dropPoint = hasDropLocation ? { lat: recipient.lat, lng: recipient.lng } : null;
    const pickedUp = Boolean(assignment.pickup_verified_at) || ['IN_TRANSIT'].includes(listing.status);
    const volPoint = latest ? { lat: latest.lat, lng: latest.lng } : null;

    let route = null;
    if (dropPoint) {
      if (pickedUp && volPoint) route = await routeVia(volPoint, null, dropPoint);
      else if (volPoint) route = await routeVia(volPoint, pickupPoint, dropPoint);
      else route = await routeVia(pickupPoint, null, dropPoint);
    }

    res.json({
      assignmentId: assignment.id,
      status: assignment.status,
      listingStatus: listing.status,
      pickedUp,
      pickup: { ...pickupPoint, label: listing.address, title: listing.title },
      drop: {
        lat: dropPoint?.lat ?? null,
        lng: dropPoint?.lng ?? null,
        label: recipient.address,
        title: recipient.org_name || recipient.name,
      },
      volunteer: volPoint
        ? { ...volPoint, updatedAt: latest.recorded_at, name: (q.get(`SELECT name FROM users WHERE id = ?`, [latest.volunteer_id]) || {}).name }
        : null,
      distanceKm: route?.distanceKm ?? null,
      durationMin: route?.durationMin ?? null,
      estimated: route?.estimated ?? true,
      geometry: (route?.geometryLatLng || []).filter(
        (point) => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1])
      ),
      googleMapsUrl: dropPoint
        ? `https://www.google.com/maps/dir/?api=1&origin=${pickupPoint.lat},${pickupPoint.lng}&destination=${dropPoint.lat},${dropPoint.lng}&travelmode=driving`
        : null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
