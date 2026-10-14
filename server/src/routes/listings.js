import { Router } from 'express';
import { db, q } from '../db.js';
import { config } from '../config.js';
import { authRequired, requireRole } from '../auth.js';
import { logEvent, notify, transition } from '../services/workflow.js';
import { routeInfo } from '../services/geo.js';
import {
  acceptOffer,
  applyValidation,
  cascadeOffers,
  declineOffer,
  latestValidation,
  refreshMatching,
  serializeAssignment,
  serializeListing,
} from '../services/listings.js';
import { inviteVolunteers } from '../services/volunteerAssignment.js';

const router = Router();
router.use(authRequired);

const FIELDS = [
  'title',
  'description',
  'food_type',
  'quantity_kg',
  'servings',
  'prepared_at',
  'ready_at',
  'pickup_deadline',
  'lat',
  'lng',
  'address',
  'storage_condition',
  'allergens',
  'packaging',
  'handling_notes',
  'contact_name',
  'contact_phone',
];

router.get('/', (req, res) => {
  const { status, food_type, near } = req.query;
  const clauses = [];
  const params = [];

  if (req.user.role === 'provider') {
    clauses.push('provider_id = ?');
    params.push(req.user.id);
  } else if (req.user.role === 'recipient') {
    clauses.push(
      `provider_id != ? AND status IN ('ELIGIBLE','OFFERED','NO_MATCH','AT_RISK')
       AND datetime(pickup_deadline) > datetime('now')`
    );
    params.push(req.user.id);
  }
  if (status) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (food_type) {
    clauses.push('food_type = ?');
    params.push(food_type);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  let rows = q.all(`SELECT * FROM listings ${where} ORDER BY datetime(created_at) DESC LIMIT 200`, params);

  if (near === '1' && req.user.lat && req.user.lng) {
    rows = rows
      .map((l) => ({ ...l, _d: Math.hypot(l.lat - req.user.lat, l.lng - req.user.lng) }))
      .sort((a, b) => a._d - b._d);
  }
  res.json({ listings: rows.map((l) => serializeListing(l, req.user)) });
});

router.get('/:id', (req, res) => {
  const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [req.params.id]);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  const events = q.all(
    `SELECT e.*, u.name AS actor_name FROM status_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.listing_id = ? ORDER BY e.id ASC`,
    [listing.id]
  );

  let offers = null;
  if (req.user.role === 'provider' && listing.provider_id === req.user.id) {
    offers = q.all(
      `SELECT m.*, u.name AS recipient_name, r.org_name, r.veg_only, r.capacity_servings
       FROM offers m JOIN users u ON u.id = m.recipient_id
       LEFT JOIN recipients r ON r.user_id = m.recipient_id
       WHERE m.listing_id = ? AND (m.rank <= ? OR m.status != 'CANDIDATE')
       ORDER BY m.rank`,
      [listing.id, config.matching.resultLimit]
    );
  } else if (req.user.role === 'recipient') {
    offers = q.all(`SELECT * FROM offers WHERE listing_id = ? AND recipient_id = ?`, [
      listing.id,
      req.user.id,
    ]);
  }

  res.json({ listing: serializeListing(listing, req.user, { offers, events }) });
});

router.post('/:id/respond', requireRole('recipient'), async (req, res, next) => {
  try {
    const { action } = req.body || {};
    if (!['accept', 'decline'].includes(action)) {
      return res.status(400).json({ error: 'Action must be accept or decline' });
    }

    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [req.params.id]);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.provider_id === req.user.id) {
      return res.status(403).json({ error: 'You cannot respond to your own listing' });
    }
    if (!Number.isFinite(Date.parse(listing.pickup_deadline)) || Date.parse(listing.pickup_deadline) <= Date.now()) {
      return res.status(409).json({ error: 'Pickup deadline has passed; this listing is no longer available' });
    }
    if (!latestValidation(listing.id)?.eligible) {
      return res.status(409).json({ error: 'Only validated listings can be accepted or declined' });
    }

    const availableStatuses = ['ELIGIBLE', 'OFFERED', 'NO_MATCH', 'AT_RISK'];
    if (!availableStatuses.includes(listing.status)) {
      return res.status(409).json({ error: `Listing is ${listing.status} and is no longer available` });
    }

    let offer = q.get(`SELECT * FROM offers WHERE listing_id = ? AND recipient_id = ?`, [
      listing.id,
      req.user.id,
    ]);

    if (action === 'decline') {
      if (offer?.status === 'ACCEPTED' || offer?.status === 'DECLINED') {
        return res.status(409).json({ error: `Offer is already ${offer.status.toLowerCase()}` });
      }
      if (offer?.status === 'OFFERED') {
        const { listing: declinedListing } = declineOffer(offer, req.user, req.user);
        const result = await cascadeOffers(declinedListing, req.user);
        return res.json({ declined: true, noMatch: result.noMatch });
      }

      if (offer?.status === 'CANDIDATE') {
        q.run(`UPDATE offers SET status = 'DECLINED', updated_at = datetime('now') WHERE id = ?`, [
          offer.id,
        ]);
      } else {
        const rank = q.get(
          `SELECT COALESCE(MAX(rank), 0) + 1 AS rank FROM offers WHERE listing_id = ?`,
          [listing.id]
        ).rank;
        q.run(
          `INSERT INTO offers (listing_id, recipient_id, score, breakdown_json, explanation, rank, status)
           VALUES (?, ?, 0, '{}', 'Declined from available surplus', ?, 'DECLINED')`,
          [listing.id, req.user.id, rank]
        );
      }
      notify(
        listing.provider_id,
        'provider',
        `Donation #${listing.id} declined`,
        `${req.user.name} declined from available surplus.`,
        listing.id
      );
      const result = await cascadeOffers(listing, req.user);
      return res.json({ declined: true, noMatch: result.noMatch });
    }

    const accepted = db.transaction(() => {
      const current = q.get(`SELECT * FROM listings WHERE id = ?`, [listing.id]);
      if (!current || !availableStatuses.includes(current.status)) {
        const error = new Error(`Listing is ${current?.status || 'missing'} and is no longer available`);
        error.status = 409;
        throw error;
      }
      if (!Number.isFinite(Date.parse(current.pickup_deadline)) || Date.parse(current.pickup_deadline) <= Date.now()) {
        const error = new Error('Pickup deadline has passed; this listing is no longer available');
        error.status = 409;
        throw error;
      }
      const currentOffer = q.get(`SELECT * FROM offers WHERE listing_id = ? AND recipient_id = ?`, [
        current.id,
        req.user.id,
      ]);
      if (currentOffer?.status === 'ACCEPTED' || currentOffer?.status === 'DECLINED') {
        const error = new Error(`Offer is already ${currentOffer.status.toLowerCase()}`);
        error.status = 409;
        throw error;
      }

      if (current.status !== 'OFFERED' && current.status !== 'AT_RISK') {
        transition(current.id, 'OFFERED', req.user, 'Recipient accepted from available surplus');
      }
      if (currentOffer?.status === 'CANDIDATE') {
        q.run(`UPDATE offers SET status = 'OFFERED', updated_at = datetime('now') WHERE id = ?`, [
          currentOffer.id,
        ]);
      } else if (!currentOffer) {
        const rank = q.get(
          `SELECT COALESCE(MAX(rank), 0) + 1 AS rank FROM offers WHERE listing_id = ?`,
          [current.id]
        ).rank;
        q.run(
          `INSERT INTO offers (listing_id, recipient_id, score, breakdown_json, explanation, rank, status)
           VALUES (?, ?, 0, '{}', 'Accepted from available surplus', ?, 'OFFERED')`,
          [current.id, req.user.id, rank]
        );
      }
      offer = q.get(`SELECT * FROM offers WHERE listing_id = ? AND recipient_id = ?`, [
        current.id,
        req.user.id,
      ]);
      return acceptOffer(offer, req.user, req.user);
    })();

    const invitations = await inviteVolunteers(accepted.assignment, req.user);
    res.json({
      assignment: serializeAssignment(accepted.assignment, req.user),
      invitedVolunteers: invitations.filter((invitation) => invitation.status === 'OFFERED').length,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', requireRole('provider'), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.title || !body.ready_at || !body.pickup_deadline || body.lat == null || body.lng == null) {
      return res.status(400).json({ error: 'title, ready_at, pickup_deadline, lat and lng are required' });
    }
    const cols = FIELDS.filter((f) => body[f] !== undefined);
    const info = q.run(
      `INSERT INTO listings (provider_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
      [req.user.id, ...cols.map((c) => (c === 'veg_only' ? Number(body[c]) : body[c]))]
    );
    let listing = q.get(`SELECT * FROM listings WHERE id = ?`, [info.lastInsertRowid]);
    logEvent(listing.id, null, 'LISTED', req.user, 'Listing created');

    const { listing: validated } = applyValidation(listing, req.user);
    listing = validated;
    let offers = [];
    if (listing.status === 'ELIGIBLE') {
      offers = await refreshMatching(listing, req.user);
      listing = q.get(`SELECT * FROM listings WHERE id = ?`, [listing.id]);
    }
    res.status(201).json({ listing: serializeListing(listing, req.user, { offers }) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', requireRole('provider'), async (req, res, next) => {
  try {
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [req.params.id]);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.provider_id !== req.user.id) return res.status(403).json({ error: 'Not your listing' });
    if (['DELIVERED', 'EXPIRED'].includes(listing.status)) {
      return res.status(409).json({ error: `Cannot edit a ${listing.status} listing` });
    }
    const body = req.body || {};
    const cols = FIELDS.filter((f) => body[f] !== undefined);
    if (cols.length) {
      q.run(
        `UPDATE listings SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
        [...cols.map((c) => body[c]), listing.id]
      );
    }
    const fresh = q.get(`SELECT * FROM listings WHERE id = ?`, [listing.id]);
    const { listing: validated } = applyValidation(fresh, req.user);
    let updated = validated;
    let offers = [];
    if (updated.status === 'ELIGIBLE') {
      offers = await refreshMatching(updated, req.user);
      updated = q.get(`SELECT * FROM listings WHERE id = ?`, [updated.id]);
    }
    res.json({ listing: serializeListing(updated, req.user, { offers }) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/validate', requireRole('provider'), (req, res) => {
  const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [req.params.id]);
  if (!listing || listing.provider_id !== req.user.id) {
    return res.status(404).json({ error: 'Listing not found' });
  }
  const { listing: updated, result } = applyValidation(listing, req.user);
  res.json({ listing: serializeListing(updated, req.user), result });
});

router.post('/:id/match', requireRole('provider'), async (req, res, next) => {
  try {
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [req.params.id]);
    if (!listing || listing.provider_id !== req.user.id) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    if (listing.status === 'FLAGGED') {
      return res.status(409).json({ error: 'Flagged listings cannot be matched until resolved' });
    }
    const offers = await refreshMatching(listing, req.user);
    const updated = q.get(`SELECT * FROM listings WHERE id = ?`, [listing.id]);
    res.json({ listing: serializeListing(updated, req.user, { offers }) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/expire', requireRole('provider'), (req, res, next) => {
  try {
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [req.params.id]);
    if (!listing || listing.provider_id !== req.user.id) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    const updated = transition(listing.id, 'EXPIRED', req.user, req.body?.reason || 'Marked expired');
    res.json({ listing: serializeListing(updated, req.user) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/at-risk', requireRole('provider'), (req, res, next) => {
  try {
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [req.params.id]);
    if (!listing || listing.provider_id !== req.user.id) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    const updated = transition(listing.id, 'AT_RISK', req.user, req.body?.reason || 'Timing at risk');
    res.json({ listing: serializeListing(updated, req.user) });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/offers', requireRole('provider'), (req, res) => {
  const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [req.params.id]);
  if (!listing || listing.provider_id !== req.user.id) {
    return res.status(404).json({ error: 'Listing not found' });
  }
  const offers = q.all(
    `SELECT m.*, u.name AS recipient_name, r.org_name FROM offers m
     JOIN users u ON u.id = m.recipient_id
     LEFT JOIN recipients r ON r.user_id = m.recipient_id
     WHERE m.listing_id = ? AND (m.rank <= ? OR m.status != 'CANDIDATE')
     ORDER BY m.rank`,
    [listing.id, config.matching.resultLimit]
  );
  res.json({
    offers: offers.map((m) => ({
      ...m,
      breakdown: JSON.parse(m.breakdown_json || '{}'),
      breakdown_json: undefined,
    })),
  });
});

/**
 * Provider match map: the top matches with recipient coordinates and the road
 * route from the pickup point, for drawing markers + polylines.
 */
router.get('/:id/matches', requireRole('provider'), async (req, res, next) => {
  try {
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [req.params.id]);
    if (!listing || listing.provider_id !== req.user.id) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    const rows = q.all(
      `SELECT m.id, m.score, m.rank, m.status, m.explanation, m.breakdown_json,
              m.distance_km, m.duration_min, m.estimated,
              u.id AS recipient_id, u.name AS recipient_name, u.phone, u.email,
              r.org_name, r.lat, r.lng, r.address, r.capacity_servings, r.accepted_categories, r.demand
       FROM offers m
       JOIN users u ON u.id = m.recipient_id
       JOIN recipients r ON r.user_id = m.recipient_id
       WHERE m.listing_id = ?
       ORDER BY m.rank ASC
       LIMIT ?`,
      [listing.id, config.matching.resultLimit]
    );

    const matches = [];
    for (const m of rows) {
      let route = null;
      let estimated = Boolean(m.estimated);
      if (m.lat != null && m.lng != null) {
        const info = await routeInfo(
          { lat: listing.lat, lng: listing.lng },
          { lat: m.lat, lng: m.lng }
        );
        route = info.geometryLatLng;
        estimated = info.estimated;
      }
      matches.push({
        offerId: m.id,
        rank: m.rank,
        status: m.status,
        score: m.score,
        explanation: m.explanation,
        breakdown: JSON.parse(m.breakdown_json || '{}'),
        distanceKm: m.distance_km,
        durationMin: m.duration_min,
        estimated,
        route,
        recipient: {
          id: m.recipient_id,
          name: m.recipient_name,
          org_name: m.org_name,
          address: m.address,
          lat: m.lat,
          lng: m.lng,
          capacityServings: m.capacity_servings,
          acceptedCategories: m.accepted_categories,
          demand: m.demand,
        },
      });
    }

    res.json({
      pickup: {
        lat: listing.lat,
        lng: listing.lng,
        title: listing.title,
        address: listing.address,
      },
      resultLimit: config.matching.resultLimit,
      estimated: matches.some((m) => m.estimated),
      weights: config.matching.weights,
      matches,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
