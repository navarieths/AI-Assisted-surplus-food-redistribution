import { q } from '../db.js';

/** Role -> profile table mapping. Each profile table is keyed by users.id. */
export const PROFILE_TABLE = {
  provider: 'providers',
  recipient: 'recipients',
  volunteer: 'volunteers',
  delivery_partner: 'delivery_partners',
};

export function getProfile(userId, role) {
  const table = PROFILE_TABLE[role];
  if (!table) return null;
  return q.get(`SELECT * FROM ${table} WHERE user_id = ?`, [userId]) || null;
}

/** Merge a users row with its role profile row. Profile fields win on conflict. */
export function withProfile(user) {
  if (!user) return null;
  const profile = getProfile(user.id, user.role) || {};
  const merged = { ...user, ...profile };
  merged.id = user.id;
  merged.user_id = user.id;
  merged.role = user.role;
  return merged;
}

export function getUserWithProfile(userId) {
  return withProfile(q.get(`SELECT * FROM users WHERE id = ?`, [userId]));
}

/** Active recipients with the profile fields matching needs, as a flat row. */
export function activeRecipients() {
  return q.all(
    `SELECT u.id, u.name, u.email, u.role, u.phone,
            r.org_name, r.address, r.lat, r.lng, r.capacity_servings, r.veg_only,
            r.collection_open, r.collection_close, r.reliability
     FROM recipients r JOIN users u ON u.id = r.user_id
     WHERE u.active = 1 AND r.lat IS NOT NULL`
  );
}

/** Every active carrier (volunteer or delivery partner) with coordinates. */
export function activeCarriers() {
  return q.all(
    `SELECT u.id, u.name, u.email, u.phone, u.role, u.active,
            v.address, v.lat, v.lng, v.vehicle, NULL AS org_name
     FROM volunteers v JOIN users u ON u.id = v.user_id
     WHERE u.active = 1
     UNION ALL
     SELECT u.id, u.name, u.email, u.phone, u.role, u.active,
            d.address, d.lat, d.lng, d.vehicle, d.company_name AS org_name
     FROM delivery_partners d JOIN users u ON u.id = d.user_id
     WHERE u.active = 1`
  );
}

/** Persist coordinates back onto whichever profile table a carrier belongs to. */
export function updateCarrierLocation(userId, role, lat, lng) {
  const table = role === 'delivery_partner' ? 'delivery_partners' : 'volunteers';
  if (!PROFILE_TABLE[role]) return;
  q.run(`UPDATE ${table} SET lat = ?, lng = ? WHERE user_id = ?`, [lat, lng, userId]);
}
