import { Router } from 'express';
import { q } from '../db.js';
import {
  authRequired,
  publicUser,
  signToken,
  verifyPassword,
} from '../auth.js';
import { withProfile } from '../services/profiles.js';

const router = Router();

const ROLES = ['provider', 'recipient', 'volunteer', 'delivery_partner'];

router.post('/login', (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const user = q.get(`SELECT * FROM users WHERE email = ?`, [String(email).toLowerCase()]);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const full = withProfile({ ...user, role: role || user.role });
  res.json({ token: signToken(full), user: publicUser(full) });
});

router.post('/role', authRequired, (req, res) => {
  const { role } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const account = q.get(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
  const full = withProfile({ ...account, role });
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
