import { Router } from 'express';
import { q } from '../db.js';
import { authRequired } from '../auth.js';

const router = Router();
router.use(authRequired);

router.get('/', (req, res) => {
  const rows = q.all(
    `SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50`,
    [req.user.id]
  );
  res.json({ notifications: rows });
});

router.post('/read-all', (req, res) => {
  q.run(`UPDATE notifications SET read = 1 WHERE user_id = ?`, [req.user.id]);
  res.json({ ok: true });
});

export default router;
