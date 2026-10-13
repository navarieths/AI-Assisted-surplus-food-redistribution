import { q } from '../db.js';

/** Contact details are visible only to authorized participants of that donation. */
export function canViewContact(listing, user) {
  if (!user || !listing) return false;
  if (user.role === 'provider' && listing.provider_id === user.id) return true;

  const task = q.get(
    `SELECT * FROM tasks WHERE listing_id = ? AND (recipient_id = ? OR volunteer_id = ?)`,
    [listing.id, user.id, user.id]
  );
  if (task) return true;

  const match = q.get(
    `SELECT * FROM matches WHERE listing_id = ? AND recipient_id = ? AND status = 'ACCEPTED'`,
    [listing.id, user.id]
  );
  return Boolean(match);
}

export function listingParties(listingId) {
  const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [listingId]);
  const task = q.get(`SELECT * FROM tasks WHERE listing_id = ? ORDER BY id DESC LIMIT 1`, [
    listingId,
  ]);
  return { listing, task };
}
