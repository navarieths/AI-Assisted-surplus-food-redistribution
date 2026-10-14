import { Router } from 'express';
import { q } from '../db.js';
import { authRequired, requireRole } from '../auth.js';
import {
  acceptOffer,
  cascadeOffers,
  declineOffer,
  serializeAssignment,
  serializeListing,
} from '../services/listings.js';
import { maybeEnhanceExplanation } from '../services/matching.js';
import { withProfile } from '../services/profiles.js';
import { inviteVolunteers } from '../services/volunteerAssignment.js';

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

router.post('/:id/accept', requireRole('recipient'), async (req, res, next) => {
  try {
    const offer = q.get(`SELECT * FROM offers WHERE id = ?`, [req.params.id]);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    const { assignment } = acceptOffer(offer, req.user, req.user);
    const invitations = await inviteVolunteers(assignment, req.user);
    res.json({
      assignment: serializeAssignment(assignment, req.user),
      invitedVolunteers: invitations.filter((invitation) => invitation.status === 'OFFERED').length,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/decline', requireRole('recipient'), async (req, res, next) => {
  try {
    const offer = q.get(`SELECT * FROM offers WHERE id = ?`, [req.params.id]);
    if (!offer) return res.status(404).json({ error: 'Offer not found' });
    const { listing } = declineOffer(offer, req.user, req.user);
    const { nextOffer, noMatch } = await cascadeOffers(listing, req.user);
    const current = q.get(`SELECT status FROM listings WHERE id = ?`, [listing.id]);
    res.json({
      declined: Number(req.params.id),
      nextOffered: nextOffer ? nextOffer.id : null,
      noMatch,
      listingStatus: current.status,
    });
  } catch (err) {
    next(err);
  }
});

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
