import { Router } from 'express';
import { q } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import { logEvent, transition } from '../services/workflow.js';
import {
  applyValidation,
  refreshMatching,
  serializeListing,
} from '../services/listings.js';

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
];

router.get('/', (req, res) => {
  const { status, food_type, near } = req.query;
  const clauses = [];
  const params = [];

  if (req.user.role === 'provider') {
    clauses.push('provider_id = ?');
    params.push(req.user.id);
  } else if (req.user.role === 'recipient') {
    // recipients only see listings offered/accepted to them
    clauses.push(
      `id IN (SELECT listing_id FROM offers WHERE recipient_id = ? AND status IN ('OFFERED','ACCEPTED'))`
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
       WHERE m.listing_id = ? ORDER BY m.rank`,
      [listing.id]
    );
  } else if (req.user.role === 'recipient') {
    offers = q.all(`SELECT * FROM offers WHERE listing_id = ? AND recipient_id = ?`, [
      listing.id,
      req.user.id,
    ]);
  }

  res.json({ listing: serializeListing(listing, req.user, { offers, events }) });
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
     WHERE m.listing_id = ? ORDER BY m.rank`,
    [listing.id]
  );
  res.json({
    offers: offers.map((m) => ({
      ...m,
      breakdown: JSON.parse(m.breakdown_json || '{}'),
      breakdown_json: undefined,
    })),
  });
});

export default router;
