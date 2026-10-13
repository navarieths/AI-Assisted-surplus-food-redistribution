import { Router } from 'express';
import { q } from '../db.js';
import { authRequired } from '../auth.js';
import { haversineKm } from '../services/geo.js';

const router = Router();
router.use(authRequired);

/** Carriers available to be assigned, sorted by distance to a pickup. */
router.get('/', (req, res) => {
  const listingId = Number(req.query.listing_id);
  const listing = listingId ? q.get(`SELECT * FROM listings WHERE id = ?`, [listingId]) : null;
  const lat = listing ? listing.lat : req.user.lat;
  const lng = listing ? listing.lng : req.user.lng;

  let carriers = q.all(
    `SELECT id, name, role, phone, email, org_name, lat, lng, address, active
     FROM users WHERE role IN ('volunteer','delivery_partner') AND active = 1`
  );
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
 * Volunteer live tracking: the app posts navigator.geolocation every 10s while a
 * task is active. Recipient/provider screens poll /tasks/:id/track every 5s.
 */
router.post('/location', (req, res) => {
  if (!['volunteer', 'delivery_partner'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only carriers post locations' });
  }
  const { task_id, lat, lng } = req.body || {};
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!task_id || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({ error: 'task_id, lat and lng are required' });
  }
  const task = q.get(`SELECT * FROM tasks WHERE id = ?`, [task_id]);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.volunteer_id !== req.user.id) {
    return res.status(403).json({ error: 'Not your task' });
  }
  q.run(`INSERT INTO volunteer_locations (task_id, volunteer_id, lat, lng) VALUES (?,?,?,?)`, [
    task.id,
    req.user.id,
    latitude,
    longitude,
  ]);
  q.run(`UPDATE users SET lat = ?, lng = ? WHERE id = ?`, [latitude, longitude, req.user.id]);
  const latest = q.get(`SELECT * FROM volunteer_locations WHERE task_id = ? ORDER BY id DESC LIMIT 1`, [
    task.id,
  ]);
  res.json({ ok: true, recorded_at: latest.recorded_at });
});

export default router;
