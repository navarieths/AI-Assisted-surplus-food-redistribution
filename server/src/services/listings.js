import { config } from '../config.js';
import { q } from '../db.js';
import { persistOffers } from './matching.js';
import { generateOtp, logEvent, notify, transition } from './workflow.js';
import { validateListing } from './validate.js';
import { canViewContact } from './access.js';

/* ------------------------------- profile rows ----------------------------- */

function providerRow(userId) {
  return q.get(
    `SELECT u.id, u.role, u.name, u.phone, u.email, p.org_name, p.lat, p.lng, p.address
     FROM users u LEFT JOIN providers p ON p.user_id = u.id WHERE u.id = ?`,
    [userId]
  );
}

function recipientRow(userId) {
  return q.get(
    `SELECT u.id, u.role, u.name, u.phone, u.email, r.org_name, r.lat, r.lng, r.address
     FROM users u LEFT JOIN recipients r ON r.user_id = u.id WHERE u.id = ?`,
    [userId]
  );
}

function carrierRow(userId) {
  return q.get(
    `SELECT u.id, u.role, u.name, u.phone, u.email,
            COALESCE(v.lat, d.lat) AS lat, COALESCE(v.lng, d.lng) AS lng,
            COALESCE(v.address, d.address) AS address
     FROM users u
     LEFT JOIN volunteers v ON v.user_id = u.id
     LEFT JOIN delivery_partners d ON d.user_id = u.id
     WHERE u.id = ?`,
    [userId]
  );
}

/* ----------------------------- serialisation ----------------------------- */

export function latestValidation(listingId) {
  const row = q.get(
    `SELECT * FROM validation_results WHERE listing_id = ? ORDER BY id DESC LIMIT 1`,
    [listingId]
  );
  if (!row) return null;
  let flags = [];
  try {
    flags = row.flags_json ? JSON.parse(row.flags_json) : [];
  } catch {
    flags = [];
  }
  return {
    id: row.id,
    eligible: Boolean(row.eligible),
    summary: row.summary,
    disclaimer: row.disclaimer,
    flags,
    checkedAt: row.checked_at,
  };
}

export function serializeListing(listing, user, { offers = null, events = null } = {}) {
  if (!listing) return null;
  // Never leak the per-listing contact fields through the top-level spread;
  // they are re-added below only for authorised participants.
  const { contact_name, contact_phone, ...safe } = listing;
  const provider = providerRow(listing.provider_id);
  const authorized = canViewContact(listing, user);
  const providerPublic = {
    id: provider?.id,
    name: provider?.name,
    org_name: provider?.org_name,
    lat: provider?.lat,
    lng: provider?.lng,
    address: provider?.address,
    // contact details gated to authorized participants of this donation
    phone: authorized ? contact_phone || provider?.phone : null,
    email: authorized ? provider?.email : null,
    contact_name: authorized ? contact_name || provider?.name : null,
    contactVisible: authorized,
  };

  return {
    ...safe,
    validation: latestValidation(listing.id),
    provider: providerPublic,
    offers,
    events,
  };
}

/* ------------------------------ validation ------------------------------- */

export function applyValidation(listing, actor) {
  const result = validateListing(listing);
  q.run(
    `INSERT INTO validation_results (listing_id, eligible, summary, disclaimer, flags_json)
     VALUES (?,?,?,?,?)`,
    [listing.id, result.eligible ? 1 : 0, result.summary, result.disclaimer, JSON.stringify(result.flags)]
  );
  const fresh = q.get(`SELECT * FROM listings WHERE id = ?`, [listing.id]);

  const target = result.eligible ? 'ELIGIBLE' : 'FLAGGED';
  if (fresh.status === 'LISTED' || fresh.status === 'FLAGGED' || fresh.status === 'ELIGIBLE') {
    if (fresh.status !== target) {
      transition(listing.id, target, actor, result.summary);
    }
  }
  notify(
    listing.provider_id,
    'provider',
    `Listing #${listing.id} ${result.eligible ? 'passed checks' : 'flagged'}`,
    result.summary,
    listing.id
  );
  return { listing: q.get(`SELECT * FROM listings WHERE id = ?`, [listing.id]), result };
}

/* ------------------------------- matching -------------------------------- */

export async function refreshMatching(listing, actor) {
  const stored = await persistOffers(listing);
  const top = stored.slice(0, config.matching.offerLimit);
  for (const m of top) {
    if (m.status === 'CANDIDATE') {
      q.run(`UPDATE offers SET status = 'OFFERED', updated_at = datetime('now') WHERE id = ?`, [m.id]);
    }
  }
  const offered = q.all(
    `SELECT * FROM offers WHERE listing_id = ? AND status = 'OFFERED' ORDER BY rank`,
    [listing.id]
  );
  if (offered.length) {
    if (['ELIGIBLE', 'FLAGGED', 'LISTED', 'NO_MATCH', 'DECLINED', 'AT_RISK'].includes(listing.status)) {
      transition(listing.id, 'OFFERED', actor, `Offered to top ${offered.length} match(es)`);
    }
    for (const m of offered) {
      notify(
        m.recipient_id,
        'recipient',
        `New surplus match (score ${m.score})`,
        `${listing.title} — ${m.distance_km} km away.`,
        listing.id
      );
    }
  } else {
    if (!['NO_MATCH', 'DELIVERED', 'EXPIRED'].includes(listing.status)) {
      transition(listing.id, 'NO_MATCH', actor, 'No eligible recipients within range');
    }
  }
  return q.all(`SELECT * FROM offers WHERE listing_id = ? ORDER BY rank`, [listing.id]);
}

export async function offerNext(listing, actor) {
  const next = q.get(
    `SELECT * FROM offers WHERE listing_id = ? AND status = 'CANDIDATE' ORDER BY rank LIMIT 1`,
    [listing.id]
  );
  if (!next) return null;
  q.run(`UPDATE offers SET status = 'OFFERED', updated_at = datetime('now') WHERE id = ?`, [next.id]);
  if (listing.status !== 'OFFERED') transition(listing.id, 'OFFERED', actor, 'Offered next candidate');
  notify(
    next.recipient_id,
    'recipient',
    `New surplus match (score ${next.score})`,
    `${listing.title} — ${next.distance_km} km away.`,
    listing.id
  );
  return next;
}

/* --------------------------- accept / decline ---------------------------- */

export function acceptOffer(offer, recipient, actor) {
  if (offer.recipient_id !== recipient.id) {
    const err = new Error('This offer does not belong to you');
    err.status = 403;
    throw err;
  }
  if (offer.status !== 'OFFERED') {
    const err = new Error(`Offer is ${offer.status}, cannot accept`);
    err.status = 409;
    throw err;
  }
  const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [offer.listing_id]);
  q.run(`UPDATE offers SET status = 'ACCEPTED', updated_at = datetime('now') WHERE id = ?`, [
    offer.id,
  ]);
  // Supersede other open offers for the same listing.
  q.run(
    `UPDATE offers SET status = 'DECLINED', updated_at = datetime('now')
     WHERE listing_id = ? AND id != ? AND status IN ('OFFERED','CANDIDATE')`,
    [listing.id, offer.id]
  );
  if (listing.status !== 'ACCEPTED') transition(listing.id, 'ACCEPTED', actor, 'Recipient accepted');

  const info = q.run(
    `INSERT INTO assignments (listing_id, offer_id, recipient_id, status, delivery_otp)
     VALUES (?,?,?, 'CREATED', ?)`,
    [listing.id, offer.id, recipient.id, generateOtp()]
  );
  const assignment = q.get(`SELECT * FROM assignments WHERE id = ?`, [info.lastInsertRowid]);

  notify(listing.provider_id, 'provider', `Donation #${listing.id} accepted`, `${recipient.name} accepted — awaiting volunteer.`, listing.id);
  notify(recipient.id, 'recipient', `You accepted donation #${listing.id}`, 'A volunteer will be assigned shortly.', listing.id);
  return { offer: q.get(`SELECT * FROM offers WHERE id = ?`, [offer.id]), assignment };
}

export function declineOffer(offer, recipient, actor) {
  if (offer.recipient_id !== recipient.id) {
    const err = new Error('This offer does not belong to you');
    err.status = 403;
    throw err;
  }
  q.run(`UPDATE offers SET status = 'DECLINED', updated_at = datetime('now') WHERE id = ?`, [
    offer.id,
  ]);
  const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [offer.listing_id]);
  notify(listing.provider_id, 'provider', `Donation #${listing.id} declined`, `${recipient.name} declined.`, listing.id);
  void actor;
  return q.get(`SELECT * FROM offers WHERE id = ?`, [offer.id]);
}

/* ------------------------------ assignment ------------------------------- */

export function assignVolunteer(assignment, volunteer, actor, { fallback = false } = {}) {
  if (!volunteer) {
    const err = new Error('Volunteer not found');
    err.status = 404;
    throw err;
  }
  const pickupOtp = generateOtp();
  q.run(
    `UPDATE assignments SET volunteer_id = ?, status = 'ASSIGNED', pickup_otp = ?, fallback = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [volunteer.id, pickupOtp, fallback ? 1 : 0, assignment.id]
  );
  const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [assignment.listing_id]);
  if (listing.status !== 'VOLUNTEER_ASSIGNED') {
    transition(listing.id, 'VOLUNTEER_ASSIGNED', actor, fallback ? 'Fallback carrier assigned' : 'Volunteer assigned');
  }
  notify(volunteer.id, volunteer.role, `Pickup assigned: ${listing.title}`, `Collect from ${listing.address || 'pickup point'} before deadline.`, listing.id);
  notify(listing.provider_id, 'provider', `Volunteer assigned to #${listing.id}`, `${volunteer.name} will collect. Provider OTP: ${pickupOtp}`, listing.id);
  notify(assignment.recipient_id, 'recipient', `Volunteer assigned to #${listing.id}`, `${volunteer.name} is bringing your donation.`, listing.id);
  return q.get(`SELECT * FROM assignments WHERE id = ?`, [assignment.id]);
}

export function serializeAssignment(assignment, user) {
  if (!assignment) return null;
  const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [assignment.listing_id]);
  const recipient = recipientRow(assignment.recipient_id);
  const volunteer = assignment.volunteer_id ? carrierRow(assignment.volunteer_id) : null;
  const provider = providerRow(listing.provider_id);
  const authorized = canViewContact(listing, user);
  const mask = (u) => (u ? { ...u, phone: authorized ? u.phone : null, email: authorized ? u.email : null } : null);
  return {
    ...assignment,
    pickup_otp: user.role === 'volunteer' || user.role === 'delivery_partner' || user.id === provider.id
      ? assignment.pickup_otp
      : undefined,
    delivery_otp: user.id === assignment.recipient_id ? assignment.delivery_otp : undefined,
    listing: serializeListing(listing, user),
    recipient: mask(recipient),
    volunteer: mask(volunteer),
    provider: mask(provider),
    contactVisible: authorized,
  };
}
