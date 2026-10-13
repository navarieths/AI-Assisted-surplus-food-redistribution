import { Router } from 'express';
import { q } from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();

// Public-ish impact data is still behind auth in the demo.
router.use(authRequired);

const CO2_PER_KG = 2.5; // kg CO2e avoided per kg of food rescued (estimate)

router.get('/', (_req, res) => {
  const totals = q.get(`
    SELECT
      (SELECT COUNT(*) FROM listings) AS listings,
      (SELECT COUNT(*) FROM listings WHERE status = 'DELIVERED') AS delivered,
      (SELECT COUNT(*) FROM listings WHERE status IN ('ELIGIBLE','OFFERED','ACCEPTED','VOLUNTEER_ASSIGNED','PICKED_UP','IN_TRANSIT')) AS active,
      (SELECT COUNT(*) FROM listings WHERE status = 'FLAGGED') AS flagged,
      (SELECT COUNT(*) FROM listings WHERE status = 'EXPIRED') AS expired,
      (SELECT COALESCE(SUM(l.quantity_kg),0) FROM listings l WHERE l.status = 'DELIVERED') AS kg_rescued,
      (SELECT COALESCE(SUM(l.servings),0) FROM listings l WHERE l.status = 'DELIVERED') AS servings_rescued,
      (SELECT COUNT(DISTINCT recipient_id) FROM tasks WHERE status = 'DELIVERED') AS recipients_served,
      (SELECT COUNT(DISTINCT volunteer_id) FROM tasks WHERE status = 'DELIVERED') AS volunteers_active
  `);

  const deliveries = q.all(`
    SELECT t.id, t.delivered_at, t.recipient_id, t.volunteer_id,
           l.id AS listing_id, l.title, l.lat, l.lng, l.quantity_kg, l.servings, l.food_type,
           u.name AS recipient_name, u.org_name
    FROM tasks t
    JOIN listings l ON l.id = t.listing_id
    JOIN users u ON u.id = t.recipient_id
    WHERE t.status = 'DELIVERED'
    ORDER BY datetime(t.delivered_at) DESC
  `);

  const byDay = q.all(`
    SELECT date(t.delivered_at) AS day, COUNT(*) AS deliveries, COALESCE(SUM(l.quantity_kg),0) AS kg
    FROM tasks t JOIN listings l ON l.id = t.listing_id
    WHERE t.status = 'DELIVERED' AND t.delivered_at IS NOT NULL
    GROUP BY date(t.delivered_at) ORDER BY day ASC
  `);

  const byFoodType = q.all(`
    SELECT l.food_type, COUNT(*) AS deliveries, COALESCE(SUM(l.quantity_kg),0) AS kg
    FROM tasks t JOIN listings l ON l.id = t.listing_id
    WHERE t.status = 'DELIVERED' GROUP BY l.food_type
  `);

  const breakdown = q.all(`SELECT status, COUNT(*) AS count FROM listings GROUP BY status ORDER BY count DESC`);

  res.json({
    totals: {
      ...totals,
      co2_saved_kg: Math.round((totals.kg_rescued || 0) * CO2_PER_KG),
      co2_note: 'Estimated at 2.5 kg CO2e avoided per kg of food rescued.',
    },
    deliveries: deliveries.map((d) => ({ ...d, co2_saved_kg: Math.round(d.quantity_kg * CO2_PER_KG) })),
    heatmap: deliveries.map((d) => [d.lat, d.lng, Math.max(0.3, d.quantity_kg / 10)]),
    byDay,
    byFoodType,
    breakdown,
    disclaimer:
      'Checks are rule-based on provider-entered details. This platform does not certify food safety.',
  });
});

export default router;
