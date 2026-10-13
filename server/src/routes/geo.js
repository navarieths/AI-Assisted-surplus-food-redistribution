import { Router } from 'express';
import { geocode, mapConfig, reverseGeocode, routeInfo, routeVia } from '../services/geo.js';

const router = Router();

router.get('/config', (_req, res) => {
  const { provider, maxZoom } = mapConfig();
  // tileUrl is sent to the browser so MAP_PROVIDER can be swapped via env only.
  res.json(mapConfig());
});

router.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json({ results: [] });
  const results = await geocode(q, { limit: Number(req.query.limit || 5) });
  res.json({ results });
});

router.get('/reverse', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }
  res.json(await reverseGeocode(lat, lng));
});

router.post('/route', async (req, res) => {
  const { from, to, via } = req.body || {};
  if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
  const info = via ? await routeVia(from, via, to) : await routeInfo(from, to);
  res.json(info);
});

export default router;
