import { Router } from 'express';
import { q } from '../db.js';
import { authRequired } from '../auth.js';
import { haversineKm, routeVia } from '../services/geo.js';
import { assignVolunteer, serializeTask } from '../services/listings.js';
import { notify, transition } from '../services/workflow.js';

const router = Router();
router.use(authRequired);

function assertParticipant(task, user) {
  const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [task.listing_id]);
  const ok =
    task.recipient_id === user.id ||
    task.volunteer_id === user.id ||
    (user.role === 'provider' && listing.provider_id === user.id);
  if (!ok) {
    const err = new Error('Not a participant of this task');
    err.status = 403;
    throw err;
  }
  return listing;
}

router.get('/', (req, res) => {
  let rows;
  if (req.user.role === 'volunteer' || req.user.role === 'delivery_partner') {
    rows = q.all(`SELECT * FROM tasks WHERE volunteer_id = ? ORDER BY id DESC`, [req.user.id]);
  } else if (req.user.role === 'recipient') {
    rows = q.all(`SELECT * FROM tasks WHERE recipient_id = ? ORDER BY id DESC`, [req.user.id]);
  } else {
    rows = q.all(
      `SELECT t.* FROM tasks t JOIN listings l ON l.id = t.listing_id
       WHERE l.provider_id = ? ORDER BY t.id DESC`,
      [req.user.id]
    );
  }
  res.json({ tasks: rows.map((t) => serializeTask(t, req.user)) });
});

/** Accepted donations that still need a carrier. */
router.get('/available', (req, res) => {
  const rows = q.all(
    `SELECT t.*, l.title, l.address, l.lat, l.lng, l.pickup_deadline, l.ready_at, l.quantity_kg, l.servings
     FROM tasks t JOIN listings l ON l.id = t.listing_id
     WHERE t.volunteer_id IS NULL AND t.status = 'CREATED' ORDER BY datetime(l.pickup_deadline) ASC`
  );
  const me = req.user.lat != null ? { lat: req.user.lat, lng: req.user.lng } : null;
  res.json({
    tasks: rows.map((t) => ({
      ...t,
      distanceFromMeKm: me ? Math.round(haversineKm(me, t) * 10) / 10 : null,
    })),
  });
});

router.get('/:id', (req, res) => {
  const task = q.get(`SELECT * FROM tasks WHERE id = ?`, [req.params.id]);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  try {
    assertParticipant(task, req.user);
  } catch (err) {
    return res.status(err.status || 403).json({ error: err.message });
  }
  res.json({ task: serializeTask(task, req.user) });
});

/** Volunteer self-claims an open task. */
router.post('/:id/claim', async (req, res, next) => {
  try {
    if (!['volunteer', 'delivery_partner'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only carriers can claim tasks' });
    }
    const task = q.get(`SELECT * FROM tasks WHERE id = ?`, [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.volunteer_id && task.volunteer_id !== req.user.id) {
      return res.status(409).json({ error: 'Already claimed' });
    }
    const updated = assignVolunteer(task, req.user, req.user);
    res.json({ task: serializeTask(updated, req.user) });
  } catch (err) {
    next(err);
  }
});

/** Recipient/provider explicitly assigns a carrier. */
router.post('/:id/assign', async (req, res, next) => {
  try {
    const task = q.get(`SELECT * FROM tasks WHERE id = ?`, [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const listing = assertParticipant(task, req.user);
    if (!(task.recipient_id === req.user.id || (req.user.role === 'provider' && listing.provider_id === req.user.id))) {
      return res.status(403).json({ error: 'Only the recipient or provider can assign' });
    }
    const vol = q.get(`SELECT * FROM users WHERE id = ? AND role IN ('volunteer','delivery_partner')`, [
      req.body?.volunteer_id,
    ]);
    if (!vol) return res.status(400).json({ error: 'volunteer_id is required and must be a carrier' });
    const updated = assignVolunteer(task, vol, req.user);
    res.json({ task: serializeTask(updated, req.user) });
  } catch (err) {
    next(err);
  }
});

/** Fallback: reassign to the nearest available delivery partner / volunteer. */
router.post('/:id/fallback', async (req, res, next) => {
  try {
    const task = q.get(`SELECT * FROM tasks WHERE id = ?`, [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    const listing = assertParticipant(task, req.user);
    const candidates = q.all(
      `SELECT * FROM users WHERE role IN ('volunteer','delivery_partner') AND active = 1
       AND id != COALESCE(?, -1) AND lat IS NOT NULL`,
      [task.volunteer_id]
    );
    if (!candidates.length) {
      return res.status(409).json({ error: 'No fallback carrier available' });
    }
    candidates.sort((a, b) => haversineKm(listing, a) - haversineKm(listing, b));
    const chosen = candidates[0];
    q.run(`UPDATE tasks SET volunteer_id = NULL, updated_at = datetime('now') WHERE id = ?`, [task.id]);
    const updated = assignVolunteer(task, chosen, req.user, { fallback: true });
    notify(listing.provider_id, 'provider', `Fallback carrier assigned to #${listing.id}`, `${chosen.name} (${chosen.role}) stepped in.`, listing.id);
    res.json({ task: serializeTask(updated, req.user), fallback: chosen.name });
  } catch (err) {
    next(err);
  }
});

/** Volunteer verifies pickup OTP. On success: PICKED_UP then IN_TRANSIT. */
router.post('/:id/pickup', (req, res, next) => {
  try {
    const task = q.get(`SELECT * FROM tasks WHERE id = ?`, [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.volunteer_id !== req.user.id) return res.status(403).json({ error: 'Not your task' });
    if (task.pickup_verified_at) return res.status(409).json({ error: 'Pickup already verified' });
    if (String(req.body?.otp || '') !== String(task.pickup_otp || '')) {
      return res.status(400).json({ error: 'Incorrect OTP' });
    }
    q.run(
      `UPDATE tasks SET pickup_verified_at = datetime('now'), status = 'IN_TRANSIT', updated_at = datetime('now') WHERE id = ?`,
      [task.id]
    );
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [task.listing_id]);
    if (listing.status !== 'PICKED_UP') transition(listing.id, 'PICKED_UP', req.user, 'Pickup OTP verified');
    transition(listing.id, 'IN_TRANSIT', req.user, 'En route to recipient');
    notify(task.recipient_id, 'recipient', `Your donation #${listing.id} is on the way`, `${req.user.name} picked it up.`, listing.id);
    res.json({ task: serializeTask(q.get(`SELECT * FROM tasks WHERE id = ?`, [task.id]), req.user) });
  } catch (err) {
    next(err);
  }
});

/** Recipient confirms delivery. */
router.post('/:id/confirm-delivery', (req, res, next) => {
  try {
    const task = q.get(`SELECT * FROM tasks WHERE id = ?`, [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.recipient_id !== req.user.id) return res.status(403).json({ error: 'Only the recipient confirms delivery' });
    if (task.status === 'DELIVERED') {
      return res.json({ task: serializeTask(task, req.user) });
    }
    q.run(`UPDATE tasks SET status = 'DELIVERED', delivered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, [
      task.id,
    ]);
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [task.listing_id]);
    if (listing.status !== 'DELIVERED') transition(listing.id, 'DELIVERED', req.user, 'Recipient confirmed delivery');
    notify(listing.provider_id, 'provider', `Donation #${listing.id} delivered`, `${req.user.name} confirmed receipt.`, listing.id);
    if (task.volunteer_id) notify(task.volunteer_id, 'volunteer', `Delivery complete for #${listing.id}`, 'Thank you!', listing.id);
    // update reliability signal
    q.run(`UPDATE users SET reliability = MIN(1.0, reliability + 0.02) WHERE id = ?`, [task.recipient_id]);
    res.json({ task: serializeTask(q.get(`SELECT * FROM tasks WHERE id = ?`, [task.id]), req.user) });
  } catch (err) {
    next(err);
  }
});

/** Tracking: markers, OSRM polyline, remaining distance + ETA. */
router.get('/:id/track', async (req, res, next) => {
  try {
    const task = q.get(`SELECT * FROM tasks WHERE id = ?`, [req.params.id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    try {
      assertParticipant(task, req.user);
    } catch (err) {
      return res.status(err.status || 403).json({ error: err.message });
    }
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [task.listing_id]);
    const recipient = q.get(`SELECT * FROM users WHERE id = ?`, [task.recipient_id]);
    const latest = q.get(
      `SELECT * FROM volunteer_locations WHERE task_id = ? ORDER BY id DESC LIMIT 1`,
      [task.id]
    );

    const pickupPoint = { lat: listing.lat, lng: listing.lng };
    const dropPoint = { lat: recipient.lat, lng: recipient.lng };
    const pickedUp = Boolean(task.pickup_verified_at) || ['IN_TRANSIT'].includes(listing.status);
    const volPoint = latest ? { lat: latest.lat, lng: latest.lng } : null;

    let route;
    if (pickedUp && volPoint) route = await routeVia(volPoint, null, dropPoint);
    else if (volPoint) route = await routeVia(volPoint, pickupPoint, dropPoint);
    else route = await routeVia(pickupPoint, null, dropPoint);

    res.json({
      taskId: task.id,
      status: task.status,
      listingStatus: listing.status,
      pickedUp,
      pickup: { ...pickupPoint, label: listing.address, title: listing.title },
      drop: { ...dropPoint, label: recipient.address, title: recipient.org_name || recipient.name },
      volunteer: volPoint
        ? { ...volPoint, updatedAt: latest.recorded_at, name: (q.get(`SELECT name FROM users WHERE id = ?`, [latest.volunteer_id]) || {}).name }
        : null,
      distanceKm: route.distanceKm,
      durationMin: route.durationMin,
      estimated: route.estimated,
      geometry: route.geometryLatLng,
      googleMapsUrl: `https://www.google.com/maps/dir/?api=1&origin=${pickupPoint.lat},${pickupPoint.lng}&destination=${dropPoint.lat},${dropPoint.lng}&travelmode=driving`,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
