import { config } from '../config.js';
import { q } from '../db.js';
import { persistMatches } from './matching.js';
import { generateOtp, logEvent, notify, transition } from './workflow.js';
import { validateListing } from './validate.js';
import { canViewContact } from './access.js';

/* ----------------------------- serialisation ----------------------------- */
export function serializeListing(listing, user, { matches = null, events = null } = {}) {
  if (!listing) return null;
  const provider = q.get(`SELECT id, role, name, org_name, phone, email, lat, lng, address FROM users WHERE id = ?`, [
    listing.provider_id,
  ]);
  let flags = null;
  try {
    flags = listing.flags_json ? JSON.parse(listing.flags_json) : null;
  } catch {
    flags = null;
  }

  const authorized = canViewContact(listing, user);
  const providerPublic = {
    id: provider?.id,
    name: provider?.name,
    org_name: provider?.org_name,
    lat: provider?.lat,
    lng: provider?.lng,
    address: provider?.address,
    // contact details gated to authorized participants of this donation
    phone: authorized ? provider?.phone : null,
    email: authorized ? provider?.email : null,
    contactVisible: authorized,
  };

  return {
    ...listing,
    flags,
    flags_json: undefined,
    provider: providerPublic,
    matches,
    events,
  };
}

/* ------------------------------ validation ------------------------------- */
export function applyValidation(listing, actor) {
  const result = validateListing(listing);
  q.run(`UPDATE listings SET flags_json = ?, updated_at = datetime('now') WHERE id = ?`, [
    JSON.stringify(result),
    listing.id,
  ]);
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
  const stored = await persistMatches(listing);
  const top = stored.slice(0, config.matching.offerLimit);
  for (const m of top) {
    if (m.status === 'CANDIDATE') {
      q.run(`UPDATE matches SET status = 'OFFERED', updated_at = datetime('now') WHERE id = ?`, [
        m.id,
      ]);
    }
  }
  const offered = q.all(
    `SELECT * FROM matches WHERE listing_id = ? AND status = 'OFFERED' ORDER BY rank`,
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
  return q.all(`SELECT * FROM matches WHERE listing_id = ? ORDER BY rank`, [listing.id]);
}

export async function offerNext(listing, actor) {
  const next = q.get(
    `SELECT * FROM matches WHERE listing_id = ? AND status = 'CANDIDATE' ORDER BY rank LIMIT 1`,
    [listing.id]
  );
  if (!next) return null;
  q.run(`UPDATE matches SET status = 'OFFERED', updated_at = datetime('now') WHERE id = ?`, [next.id]);
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
export function acceptMatch(match, recipient, actor) {
  if (match.recipient_id !== recipient.id) {
    const err = new Error('This offer does not belong to you');
    err.status = 403;
    throw err;
  }
  if (match.status !== 'OFFERED') {
    const err = new Error(`Offer is ${match.status}, cannot accept`);
    err.status = 409;
    throw err;
  }
  const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [match.listing_id]);
  q.run(`UPDATE matches SET status = 'ACCEPTED', updated_at = datetime('now') WHERE id = ?`, [
    match.id,
  ]);
  // Supersede other open offers for the same listing.
  q.run(
    `UPDATE matches SET status = 'DECLINED', updated_at = datetime('now')
     WHERE listing_id = ? AND id != ? AND status IN ('OFFERED','CANDIDATE')`,
    [listing.id, match.id]
  );
  if (listing.status !== 'ACCEPTED') transition(listing.id, 'ACCEPTED', actor, 'Recipient accepted');

  const info = q.run(
    `INSERT INTO tasks (listing_id, match_id, recipient_id, status, delivery_otp)
     VALUES (?,?,?, 'CREATED', ?)`,
    [listing.id, match.id, recipient.id, generateOtp()]
  );
  const task = q.get(`SELECT * FROM tasks WHERE id = ?`, [info.lastInsertRowid]);

  notify(listing.provider_id, 'provider', `Donation #${listing.id} accepted`, `${recipient.name} accepted — awaiting volunteer.`, listing.id);
  notify(recipient.id, 'recipient', `You accepted donation #${listing.id}`, 'A volunteer will be assigned shortly.', listing.id);
  return { match: q.get(`SELECT * FROM matches WHERE id = ?`, [match.id]), task };
}

export function declineMatch(match, recipient, actor) {
  if (match.recipient_id !== recipient.id) {
    const err = new Error('This offer does not belong to you');
    err.status = 403;
    throw err;
  }
  q.run(`UPDATE matches SET status = 'DECLINED', updated_at = datetime('now') WHERE id = ?`, [
    match.id,
  ]);
  const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [match.listing_id]);
  notify(listing.provider_id, 'provider', `Donation #${listing.id} declined`, `${recipient.name} declined.`, listing.id);
  return q.get(`SELECT * FROM matches WHERE id = ?`, [match.id]);
}

/* ------------------------------ assignment ------------------------------- */
export function assignVolunteer(task, volunteer, actor, { fallback = false } = {}) {
  if (!volunteer) {
    const err = new Error('Volunteer not found');
    err.status = 404;
    throw err;
  }
  const pickupOtp = generateOtp();
  q.run(
    `UPDATE tasks SET volunteer_id = ?, status = 'ASSIGNED', pickup_otp = ?, fallback = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [volunteer.id, pickupOtp, fallback ? 1 : 0, task.id]
  );
  const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [task.listing_id]);
  if (listing.status !== 'VOLUNTEER_ASSIGNED') {
    transition(listing.id, 'VOLUNTEER_ASSIGNED', actor, fallback ? 'Fallback carrier assigned' : 'Volunteer assigned');
  }
  notify(volunteer.id, volunteer.role, `Pickup assigned: ${listing.title}`, `Collect from ${listing.address || 'pickup point'} before deadline.`, listing.id);
  notify(listing.provider_id, 'provider', `Volunteer assigned to #${listing.id}`, `${volunteer.name} will collect. Provider OTP: ${pickupOtp}`, listing.id);
  notify(task.recipient_id, 'recipient', `Volunteer assigned to #${listing.id}`, `${volunteer.name} is bringing your donation.`, listing.id);
  return q.get(`SELECT * FROM tasks WHERE id = ?`, [task.id]);
}

export function serializeTask(task, user) {
  if (!task) return null;
  const listing = q.get(`SELECT * FROM listings WHERE id = ?`, [task.listing_id]);
  const recipient = q.get(`SELECT id, name, org_name, phone, email, lat, lng, address FROM users WHERE id = ?`, [task.recipient_id]);
  const volunteer = task.volunteer_id
    ? q.get(`SELECT id, name, phone, email, lat, lng, role FROM users WHERE id = ?`, [task.volunteer_id])
    : null;
  const provider = q.get(`SELECT id, name, org_name, phone, email, lat, lng, address FROM users WHERE id = ?`, [listing.provider_id]);
  const authorized = canViewContact(listing, user);
  const mask = (u) => (u ? { ...u, phone: authorized ? u.phone : null, email: authorized ? u.email : null } : null);
  return {
    ...task,
    pickup_otp: user.role === 'volunteer' || user.id === provider.id ? task.pickup_otp : undefined,
    delivery_otp: user.id === task.recipient_id ? task.delivery_otp : undefined,
    listing: serializeListing(listing, user),
    recipient: mask(recipient),
    volunteer: mask(volunteer),
    provider: mask(provider),
    contactVisible: authorized,
  };
}
