import { Router } from 'express';
import { q } from '../db.js';
import { authRequired } from '../auth.js';
import { haversineKm } from '../services/geo.js';
import { activeCarriers, updateCarrierLocation } from '../services/profiles.js';

const router = Router();
router.use(authRequired);

/** Carriers available to be assigned, sorted by distance to a pickup. */
router.get('/', (req, res) => {
  const listingId = Number(req.query.listing_id);
  const listing = listingId ? q.get(`SELECT * FROM listings WHERE id = ?`, [listingId]) : null;
  const lat = listing ? listing.lat : req.user.lat;
  const lng = listing ? listing.lng : req.user.lng;

  let carriers = activeCarriers();
  if (lat != null && lng != null) {
    carriers = carriers
      .map((c) => ({
        ...c,
        distanceKm: c.lat != null ? Math.round(haversineKm({ lat, lng }, c) * 10) / 10 : null,
      }))
      .sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
  }
  res.json({ carriers });
});

/**
 * Volunteer live tracking: the app posts navigator.geolocation every 10s while an
 * assignment is active. Recipient/provider screens poll /assignments/:id/track.
 */
router.post('/location', (req, res) => {
  if (!['volunteer', 'delivery_partner'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only carriers post locations' });
  }
  const { assignment_id, task_id, lat, lng } = req.body || {};
  const assignmentId = assignment_id ?? task_id;
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!assignmentId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ error: 'assignment_id, lat and lng are required' });
  }
  const assignment = q.get(`SELECT * FROM assignments WHERE id = ?`, [assignmentId]);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  if (assignment.volunteer_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your assignment' });
  }
  q.run(
    `INSERT INTO volunteer_locations (assignment_id, volunteer_id, lat, lng) VALUES (?,?,?,?)`,
    [assignment.id, req.user.id, latitude, longitude]
  );
  updateCarrierLocation(req.user.id, req.user.role, latitude, longitude);
  const latest = q.get(
    `SELECT * FROM volunteer_locations WHERE assignment_id = ? ORDER BY id DESC LIMIT 1`,
    [assignment.id]
  );
  res.json({ ok: true, recorded_at: latest.recorded_at });
});

export default router;
