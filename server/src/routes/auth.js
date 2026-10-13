import { Router } from 'express';
import { q } from '../db.js';
import {
  authRequired,
  hashPassword,
  publicUser,
  signToken,
  verifyPassword,
} from '../auth.js';

const router = Router();

const ROLES = ['provider', 'recipient', 'volunteer', 'delivery_partner'];

router.post('/register', (req, res) => {
  const {
    role,
    name,
    email,
    password,
    phone,
    org_name,
    lat,
    lng,
    address,
    veg_only,
    capacity_servings,
  } = req.body || {};

  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  const exists = q.get(`SELECT id FROM users WHERE email = ?`, [email.toLowerCase()]);
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const info = q.run(
    `INSERT INTO users (role, name, email, phone, password_hash, org_name, lat, lng, address,
      veg_only, capacity_servings, collection_open, collection_close)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'08:00','22:00')`,
    [
      role,
      name,
      email.toLowerCase(),
      phone || null,
      hashPassword(password),
      org_name || null,
      lat ?? null,
      lng ?? null,
      address || null,
      veg_only ? 1 : 0,
      capacity_servings ? Number(capacity_servings) : 0,
    ]
  );
  const user = q.get(`SELECT * FROM users WHERE id = ?`, [info.lastInsertRowid]);
  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = q.get(`SELECT * FROM users WHERE email = ?`, [String(email).toLowerCase()]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/** Convenience for the demo login screen (seeded accounts only). */
router.get('/demo-accounts', (_req, res) => {
  const users = q.all(
    `SELECT id, role, name, email, org_name FROM users WHERE email LIKE '%@demo.test' ORDER BY role, id`
  );
  res.json({ accounts: users, password: 'password123' });
});

export default router;
