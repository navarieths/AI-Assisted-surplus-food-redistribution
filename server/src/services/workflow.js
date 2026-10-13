import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';
import { q } from '../db.js';

/**
 * Server-side enforced workflow.
 * LISTED -> FLAGGED | ELIGIBLE -> OFFERED -> ACCEPTED -> VOLUNTEER_ASSIGNED
 * -> PICKED_UP -> IN_TRANSIT -> DELIVERED
 * side: DECLINED, NO_MATCH, EXPIRED, AT_RISK
 */
export const TRANSITIONS = {
  LISTED: ['FLAGGED', 'ELIGIBLE', 'EXPIRED'],
  FLAGGED: ['LISTED', 'ELIGIBLE', 'EXPIRED'],
  ELIGIBLE: ['OFFERED', 'NO_MATCH', 'FLAGGED', 'EXPIRED', 'AT_RISK'],
  OFFERED: ['ACCEPTED', 'DECLINED', 'NO_MATCH', 'EXPIRED', 'AT_RISK'],
  DECLINED: ['OFFERED', 'NO_MATCH', 'EXPIRED'],
  ACCEPTED: ['VOLUNTEER_ASSIGNED', 'AT_RISK', 'EXPIRED'],
  VOLUNTEER_ASSIGNED: ['PICKED_UP', 'AT_RISK', 'NO_MATCH', 'EXPIRED'],
  PICKED_UP: ['IN_TRANSIT', 'AT_RISK'],
  IN_TRANSIT: ['DELIVERED', 'AT_RISK'],
  DELIVERED: [],
  NO_MATCH: ['OFFERED', 'EXPIRED'],
  AT_RISK: ['OFFERED', 'ACCEPTED', 'VOLUNTEER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'NO_MATCH', 'EXPIRED'],
  EXPIRED: [],
};

export const ACTIVE_STATES = [
  'LISTED',
  'FLAGGED',
  'ELIGIBLE',
  'OFFERED',
  'ACCEPTED',
  'VOLUNTEER_ASSIGNED',
  'PICKED_UP',
  'IN_TRANSIT',
  'AT_RISK',
];

export function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

export function logEvent(listingId, fromStatus, toStatus, actor, reason = null) {
  q.run(
    `INSERT INTO status_events (listing_id, from_status, to_status, actor_id, actor_role, reason)
     VALUES (?,?,?,?,?,?)`,
    [listingId, fromStatus, toStatus, actor?.id ?? null, actor?.role ?? null, reason]
  );
}

export function transition(listingId, toStatus, actor, reason = null) {
  const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [listingId]);
  if (!listing) {
    const err = new Error('Listing not found');
    err.status = 404;
    throw err;
  }
  if (listing.status === toStatus) return listing;
  if (!canTransition(listing.status, toStatus)) {
    const err = new Error(`Illegal transition ${listing.status} -> ${toStatus}`);
    err.status = 409;
    throw err;
  }
  q.run(`UPDATE listings SET status = ?, updated_at = datetime('now') WHERE id = ?`, [
    toStatus,
    listingId,
  ]);
  logEvent(listingId, listing.status, toStatus, actor, reason);
  return q.get(`SELECT * FROM listings WHERE id = ?`, [listingId]);
}

/** Simulated notifications: recorded in DB and printed to the server console. */
export function notify(userId, role, subject, body, listingId = null) {
  q.run(
    `INSERT INTO notifications (user_id, role, subject, body, listing_id) VALUES (?,?,?,?,?)`,
    [userId, role, subject, body, listingId]
  );
  // eslint-disable-next-line no-console
  console.log(`[SIMULATED NOTIFY] -> ${role}#${userId}: ${subject} :: ${body}`);
}

export function generateOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/**
 * Pickup OTPs are never stored in clear text. The provider is the only party
 * who sees the plain value (delivered through the simulated notification
 * channel); the database stores a bcrypt hash used for verification.
 */
export function hashOtp(otp) {
  return bcrypt.hashSync(String(otp), config.otp.hashRounds);
}

export function verifyOtp(otp, hash) {
  if (!hash) return false;
  try {
    return bcrypt.compareSync(String(otp), String(hash));
  } catch {
    return false;
  }
}
