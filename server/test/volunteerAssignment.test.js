import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DB_PATH = path.join(os.tmpdir(), `surplus-volunteer-test-${process.pid}.db`);

const { q } = await import('../src/db.js');
const { rankVolunteers, inviteVolunteers, respondToOffer, sweepExpiredOffers } = await import(
  '../src/services/volunteerAssignment.js'
);

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${process.env.DB_PATH}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

const TABLES = [
  'volunteer_locations',
  'notifications',
  'assignment_offers',
  'assignments',
  'offers',
  'validation_results',
  'listings',
  'delivery_partners',
  'volunteers',
  'recipients',
  'providers',
  'users',
];
test.beforeEach(() => {
  for (const t of TABLES) q.run(`DELETE FROM ${t}`);
});

let seq = 0;
function makeUser(role) {
  seq += 1;
  const info = q.run(`INSERT INTO users (role, name, email, password_hash) VALUES (?,?,?,'x')`, [
    role,
    `${role} ${seq}`,
    `${role}${seq}@vol.test`,
  ]);
  return q.get(`SELECT * FROM users WHERE id = ?`, [info.lastInsertRowid]);
}

function makeVolunteer(lat, lng, available = 1) {
  const user = makeUser('volunteer');
  q.run(`INSERT INTO volunteers (user_id, address, lat, lng, available) VALUES (?,?,?,?,?)`, [
    user.id,
    'somewhere',
    lat,
    lng,
    available,
  ]);
  return { ...user, lat, lng, available };
}

function makeRecipient(lat, lng) {
  const user = makeUser('recipient');
  q.run(
    `INSERT INTO recipients (user_id, org_name, address, lat, lng, collection_open, collection_close)
     VALUES (?,?,?,?,?, '00:00', '23:59')`,
    [user.id, 'Hope', 'here', lat, lng]
  );
  return user;
}

function makeListing(providerId) {
  const info = q.run(
    `INSERT INTO listings (provider_id, title, ready_at, pickup_deadline, lat, lng, status)
     VALUES (?, 'Test listing', datetime('now'), datetime('now','+4 hours'), 12.95, 77.60, 'ACCEPTED')`,
    [providerId]
  );
  return q.get(`SELECT * FROM listings WHERE id = ?`, [info.lastInsertRowid]);
}

function makeAssignment(listing, recipientId) {
  const info = q.run(
    `INSERT INTO assignments (listing_id, recipient_id, status, delivery_otp) VALUES (?,?, 'CREATED', '111111')`,
    [listing.id, recipientId]
  );
  return q.get(`SELECT * FROM assignments WHERE id = ?`, [info.lastInsertRowid]);
}

/** Deterministic offline router: 25 km/h (~2.4 min per km). */
async function fakeRoute(from, to) {
  const R = 6371;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos((from.lat * Math.PI) / 180) * Math.cos((to.lat * Math.PI) / 180);
  const km = 2 * R * Math.asin(Math.sqrt(a));
  return { distanceKm: Math.round(km * 100) / 100, durationMin: Math.round(km * 2.4 * 10) / 10, estimated: false };
}

test('ranking puts the nearest available volunteer first', async () => {
  const provider = makeUser('provider');
  const recipient = makeRecipient(12.94, 77.61);
  const listing = makeListing(provider.id);
  const near = makeVolunteer(12.951, 77.601);
  const mid = makeVolunteer(12.97, 77.62);
  const far = makeVolunteer(13.05, 77.65);

  const ranked = await rankVolunteers({
    listing,
    recipient: { ...recipient, collection_open: '00:00', collection_close: '23:59' },
    routeFn: fakeRoute,
  });

  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].id, near.id);
  assert.equal(ranked[1].id, mid.id);
  assert.equal(ranked[2].id, far.id);
  assert.ok(ranked[0].score >= ranked[1].score);
  assert.ok(ranked[0].travelMinToPickup <= ranked[1].travelMinToPickup);
  assert.equal(ranked[0].rank, 1);
  // Availability weight is fully awarded to a free volunteer.
  assert.equal(ranked[0].breakdown.availability, 30);
});

test('invitations skip unavailable carriers and cap at the configured limit', async () => {
  const provider = makeUser('provider');
  const recipient = makeRecipient(12.94, 77.61);
  const listing = makeListing(provider.id);
  const assignment = makeAssignment(listing, recipient.id);
  makeVolunteer(12.951, 77.601);
  makeVolunteer(12.952, 77.602);
  makeVolunteer(12.953, 77.603);
  const off = makeVolunteer(12.954, 77.604, 0); // opted out

  const offers = await inviteVolunteers(assignment, provider, { routeFn: fakeRoute, limit: 2 });
  assert.equal(offers.length, 2);
  assert.ok(offers.every((o) => o.volunteerId !== off.id));
  assert.ok(offers.every((o) => o.status === 'OFFERED'));
  assert.ok(offers.every((o) => o.secondsLeft > 0));
});

test('accepting an invitation assigns the carrier and issues a hashed OTP', async () => {
  const provider = makeUser('provider');
  const recipient = makeRecipient(12.94, 77.61);
  const listing = makeListing(provider.id);
  const assignment = makeAssignment(listing, recipient.id);
  const volunteer = makeVolunteer(12.951, 77.601);

  const [offer] = await inviteVolunteers(assignment, provider, { routeFn: fakeRoute });
  const result = await respondToOffer(offer.id, volunteer, 'accept');
  assert.equal(result.status, 'ACCEPTED');
  assert.equal(result.assignment.volunteer_id, volunteer.id);

  const stored = q.get(`SELECT * FROM assignments WHERE id = ?`, [assignment.id]);
  assert.equal(stored.volunteer_id, volunteer.id);
  assert.equal(stored.pickup_otp, null); // never stored in clear text
  assert.ok(stored.pickup_otp_hash && stored.pickup_otp_hash !== null);
  assert.ok(stored.pickup_otp_issued_at);

  const listingRow = q.get(`SELECT status FROM listings WHERE id = ?`, [listing.id]);
  assert.equal(listingRow.status, 'VOLUNTEER_ASSIGNED');

  // The provider notification carries the plaintext OTP exactly once.
  const note = q.get(
    `SELECT * FROM notifications WHERE listing_id = ? AND body LIKE '%Pickup OTP:%' ORDER BY id DESC LIMIT 1`,
    [listing.id]
  );
  assert.ok(note);
});

test('declining cascades to the next ranked carrier', async () => {
  const provider = makeUser('provider');
  const recipient = makeRecipient(12.94, 77.61);
  const listing = makeListing(provider.id);
  const assignment = makeAssignment(listing, recipient.id);
  const near = makeVolunteer(12.951, 77.601);
  makeVolunteer(12.97, 77.62);

  const offers = await inviteVolunteers(assignment, provider, { routeFn: fakeRoute, limit: 1 });
  assert.equal(offers[0].volunteerId, near.id);

  await respondToOffer(offers[0].id, near, 'decline');
  const live = q.all(
    `SELECT * FROM assignment_offers WHERE assignment_id = ? AND status = 'OFFERED'`,
    [assignment.id]
  );
  assert.equal(live.length, 1, 'the next candidate is invited automatically');
  assert.notEqual(live[0].volunteer_id, near.id);
});

test('expired invitations are swept and reassigned', async () => {
  const provider = makeUser('provider');
  const recipient = makeRecipient(12.94, 77.61);
  const listing = makeListing(provider.id);
  const assignment = makeAssignment(listing, recipient.id);
  makeVolunteer(12.951, 77.601);
  makeVolunteer(12.97, 77.62);

  await inviteVolunteers(assignment, provider, { routeFn: fakeRoute, limit: 1 });
  // Force the live invitation to expire.
  q.run(`UPDATE assignment_offers SET expires_at = datetime('now','-1 minute') WHERE assignment_id = ?`, [
    assignment.id,
  ]);

  const res = await sweepExpiredOffers({ routeFn: fakeRoute });
  assert.equal(res.expired, 1);
  const statuses = q
    .all(`SELECT status FROM assignment_offers WHERE assignment_id = ?`, [assignment.id])
    .map((r) => r.status);
  assert.ok(statuses.includes('EXPIRED'));
  assert.ok(statuses.includes('OFFERED'), 'a fresh invitation was issued after expiry');
});
