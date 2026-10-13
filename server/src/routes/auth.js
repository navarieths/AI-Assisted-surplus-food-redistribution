import { Router } from 'express';
import { db, q } from '../db.js';
import {
  authRequired,
  hashPassword,
  publicUser,
  signToken,
  verifyPassword,
} from '../auth.js';
import { withProfile } from '../services/profiles.js';

const router = Router();

const ROLES = ['provider', 'recipient', 'volunteer', 'delivery_partner'];

function insertProfile(role, userId, body) {
  const { org_name, address, lat, lng, veg_only, capacity_servings, vehicle } = body || {};
  if (role === 'provider') {
    q.run(`INSERT INTO providers (user_id, org_name, address, lat, lng) VALUES (?,?,?,?,?)`, [
      userId, org_name || null, address || null, lat ?? null, lng ?? null,
    ]);
  } else if (role === 'recipient') {
    const available = body?.accepted_categories || body?.accepted_food;
    const accepted =
      available !== undefined
        ? String(available).trim() || null
        : veg_only
          ? 'veg'
          : 'veg,nonveg';
    const demand = body?.demand !== undefined && body?.demand !== null && body?.demand !== ''
      ? Math.max(0, Math.min(1, Number(body.demand)))
      : 0.5;
    q.run(
      `INSERT INTO recipients (user_id, org_name, address, lat, lng, capacity_servings, veg_only, accepted_categories, demand)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        userId, org_name || null, address || null, lat ?? null, lng ?? null,
        capacity_servings ? Number(capacity_servings) : 0, veg_only ? 1 : 0,
        accepted, demand,
      ]
    );
  } else if (role === 'volunteer') {
    q.run(`INSERT INTO volunteers (user_id, address, lat, lng, vehicle) VALUES (?,?,?,?,?)`, [
      userId, address || null, lat ?? null, lng ?? null, vehicle || null,
    ]);
  } else if (role === 'delivery_partner') {
    q.run(
      `INSERT INTO delivery_partners (user_id, company_name, address, lat, lng, vehicle)
       VALUES (?,?,?,?,?,?)`,
      [userId, org_name || null, address || null, lat ?? null, lng ?? null, vehicle || null]
    );
  }
}

router.post('/register', (req, res) => {
  const { role, name, email, password, phone } = req.body || {};

  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  const exists = q.get(`SELECT id FROM users WHERE email = ?`, [email.toLowerCase()]);
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const create = db.transaction(() => {
    const info = q.run(
      `INSERT INTO users (role, name, email, phone, password_hash) VALUES (?,?,?,?,?)`,
      [role, name, email.toLowerCase(), phone || null, hashPassword(password)]
    );
    const userId = Number(info.lastInsertRowid);
    insertProfile(role, userId, req.body);
    return userId;
  });

  const userId = create();
  const user = withProfile(q.get(`SELECT * FROM users WHERE id = ?`, [userId]));
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = q.get(`SELECT * FROM users WHERE email = ?`, [String(email).toLowerCase()]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const full = withProfile(user);
  res.json({ token: signToken(full), user: publicUser(full) });
});

router.get('/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/** Convenience for the demo login screen (seeded accounts only). */
router.get('/demo-accounts', (_req, res) => {
  const users = q.all(
    `SELECT u.id, u.role, u.name, u.email,
            COALESCE(p.org_name, r.org_name, d.company_name) AS org_name
     FROM users u
     LEFT JOIN providers p ON p.user_id = u.id
     LEFT JOIN recipients r ON r.user_id = u.id
     LEFT JOIN delivery_partners d ON d.user_id = u.id
     WHERE u.email LIKE '%@demo.test' ORDER BY u.role, u.id`
  );
  res.json({ accounts: users, password: 'password123' });
});

export default router;
