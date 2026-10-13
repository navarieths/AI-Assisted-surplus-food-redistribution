import { Router } from 'express';
import { q } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import {
  acceptOffer,
  declineOffer,
  offerNext,
  serializeAssignment,
  serializeListing,
} from '../services/listings.js';
import { maybeEnhanceExplanation } from '../services/matching.js';
import { transition } from '../services/workflow.js';
import { withProfile } from '../services/profiles.js';

const router = Router();
router.use(authRequired);

/** Recipient inbox: offers and accepted donations. */
router.get('/', requireRole('recipient'), (req, res) => {
  const rows = q.all(
    `SELECT * FROM offers WHERE recipient_id = ? AND status IN ('OFFERED','ACCEPTED','DECLINED')
     ORDER BY CASE status WHEN 'OFFERED' THEN 0 WHEN 'ACCEPTED' THEN 1 ELSE 2 END, score DESC`,
    [req.user.id]
  );
  const offers = rows.map((m) => {
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [m.listing_id]);
    return {
      ...m,
      breakdown: JSON.parse(m.breakdown_json || '{}'),
      breakdown_json: undefined,
      listing: serializeListing(listing, req.user),
    };
  });
  res.json({ offers });
});

router.post('/:id/accept', requireRole('recipient'), (req, res, next) => {
  try {
    const offer = q.get(`SELECT * FROM offers WHERE id = ?`, [req.params.id]);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    const { assignment } = acceptOffer(offer, req.user, req.user);
    res.json({ assignment: serializeAssignment(assignment, req.user) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/decline', requireRole('recipient'), async (req, res, next) => {
  try {
    const offer = q.get(`SELECT * FROM offers WHERE id = ?`, [req.params.id]);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    declineOffer(offer, req.user, req.user);
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [offer.listing_id]);
    const nextOffer = await maybeNextOffer(listing, req.user);
    res.json({ declined: Number(req.params.id), nextOffered: nextOffer ? nextOffer.id : null });
  } catch (err) {
    next(err);
  }
});

async function maybeNextOffer(listing, actor) {
  if (['DELIVERED', 'EXPIRED', 'ACCEPTED'].includes(listing.status)) return null;
  const offered = q.get(
    `SELECT COUNT(*) AS n FROM offers WHERE listing_id = ? AND status = 'OFFERED'`,
    [listing.id]
  );
  if (offered.n > 0) return null; // other recipients still have live offers
  const next = await offerNext(listing, actor);
  if (!next) {
    try {
      transition(listing.id, 'NO_MATCH', actor, 'All offers declined');
    } catch {
      /* already in a side/terminal state */
    }
  }
  return next;
}

/** Optional: ask the LLM to rewrite the explanation (never the score). */
router.post('/:id/explain', async (req, res, next) => {
  try {
    const offer = q.get(`SELECT * FROM offers WHERE id = ?`, [req.params.id]);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [offer.listing_id]);
    const recipient = withProfile(q.get(`SELECT * FROM users WHERE id = ?`, [offer.recipient_id]));
    const authorized =
      (req.user.role === 'provider' && listing.provider_id === req.user.id) ||
      (req.user.role === 'recipient' && offer.recipient_id === req.user.id);
    if (!authorized) return res.status(403).json({ error: 'Not authorized' });
    const explanation = await maybeEnhanceExplanation(listing, recipient, offer);
    res.json({ explanation, score: offer.score });
  } catch (err) {
    next(err);
  }
});

export default router;
