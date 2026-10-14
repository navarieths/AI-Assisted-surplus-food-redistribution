import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DB_PATH = path.join(os.tmpdir(), `surplus-offer-response-test-${process.pid}.db`);
process.env.NODE_ENV = 'test';
process.env.OSRM_BASE = 'http://127.0.0.1:1';

const { default: app } = await import('../src/index.js');
const { q } = await import('../src/db.js');
const { signToken } = await import('../src/auth.js');

function createUser(role, email) {
  const info = q.run(
    `INSERT INTO users (role, name, email, password_hash) VALUES (?, ?, ?, 'test')`,
    [role, role, email]
  );
  return q.get(`SELECT * FROM users WHERE id = ?`, [info.lastInsertRowid]);
}

const provider = createUser('provider', 'provider@response.test');
const recipient = createUser('recipient', 'recipient@response.test');
const volunteer = createUser('volunteer', 'volunteer@response.test');
q.run(`INSERT INTO providers (user_id, org_name) VALUES (?, 'Provider Org')`, [provider.id]);
q.run(
  `INSERT INTO recipients (user_id, org_name, address, lat, lng, capacity_servings,
    accepted_categories, collection_open, collection_close)
   VALUES (?, 'Recipient Org', 'Drop point', 12.94, 77.61, 100, 'veg', '00:00', '23:59')`,
  [recipient.id]
);
q.run(`INSERT INTO volunteers (user_id, address, lat, lng) VALUES (?, 'Pickup area', 12.95, 77.60)`, [
  volunteer.id,
]);

function createOffer(title) {
  const listing = q.run(
    `INSERT INTO listings (provider_id, title, ready_at, pickup_deadline, lat, lng, status)
     VALUES (?, ?, datetime('now'), datetime('now','+4 hours'), 12.95, 77.60, 'OFFERED')`,
    [provider.id, title]
  );
  const offer = q.run(
    `INSERT INTO offers (listing_id, recipient_id, score, breakdown_json, status)
     VALUES (?, ?, 90, '{}', 'OFFERED')`,
    [listing.lastInsertRowid, recipient.id]
  );
  return { listingId: Number(listing.lastInsertRowid), offerId: Number(offer.lastInsertRowid) };
}

function createAvailableListing(title, status, pickupDeadline = new Date(Date.now() + 4 * 3600000).toISOString()) {
  const listing = q.run(
    `INSERT INTO listings (provider_id, title, ready_at, pickup_deadline, lat, lng, status)
     VALUES (?, ?, datetime('now'), ?, 12.95, 77.60, ?)`,
    [provider.id, title, pickupDeadline, status]
  );
  q.run(
    `INSERT INTO validation_results (listing_id, eligible, flags_json) VALUES (?, 1, '[]')`,
    [listing.lastInsertRowid]
  );
  return Number(listing.lastInsertRowid);
}

const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
const headersFor = (user) => ({ authorization: `Bearer ${signToken(user)}` });

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(`${process.env.DB_PATH}${suffix}`, { force: true });
    } catch {
      /* ignore */
    }
  }
});

test('accept invites volunteers and decline notifies provider', async () => {
  const accepted = createOffer('Accepted surplus');
  const acceptResponse = await fetch(`${baseUrl}/offers/${accepted.offerId}/accept`, {
    method: 'POST',
    headers: headersFor(recipient),
  });
  assert.equal(acceptResponse.status, 200);
  const { assignment } = await acceptResponse.json();
  assert.equal(assignment.listing_id, accepted.listingId);

  const invitation = q.get(
    `SELECT * FROM assignment_offers WHERE assignment_id = ? AND volunteer_id = ?`,
    [assignment.id, volunteer.id]
  );
  assert.equal(invitation.status, 'OFFERED');
  assert.ok(
    q.get(
      `SELECT id FROM notifications WHERE user_id = ? AND subject LIKE 'Pickup invitation:%'`,
      [volunteer.id]
    )
  );
  assert.ok(
    q.get(
      `SELECT id FROM notifications WHERE user_id = ? AND subject = ?`,
      [provider.id, `Donation #${accepted.listingId} accepted`]
    )
  );

  const volunteerInbox = await fetch(`${baseUrl}/assignments/invitations`, {
    headers: headersFor(volunteer),
  });
  const { invitations } = await volunteerInbox.json();
  assert.ok(invitations.some((row) => row.assignment_id === assignment.id));

  const claimResponse = await fetch(`${baseUrl}/assignments/${assignment.id}/claim`, {
    method: 'POST',
    headers: headersFor(volunteer),
  });
  assert.equal(claimResponse.status, 200);
  const claimed = await claimResponse.json();
  assert.equal(claimed.assignment.volunteer_id, volunteer.id);
  assert.equal(
    q.get(`SELECT status FROM listings WHERE id = ?`, [accepted.listingId]).status,
    'VOLUNTEER_ASSIGNED'
  );
  for (const user of [provider, recipient]) {
    assert.ok(
      q.get(
        `SELECT id FROM notifications WHERE user_id = ? AND subject = ?`,
        [user.id, `Volunteer assigned to #${accepted.listingId}`]
      )
    );
  }

  const declined = createOffer('Declined surplus');
  const declineResponse = await fetch(`${baseUrl}/offers/${declined.offerId}/decline`, {
    method: 'POST',
    headers: headersFor(recipient),
  });
  assert.equal(declineResponse.status, 200);
  assert.ok(
    q.get(
      `SELECT id FROM notifications WHERE user_id = ? AND subject = ?`,
      [provider.id, `Donation #${declined.listingId} declined`]
    )
  );
});

test('recipient can accept or decline available surplus listings', async () => {
  const acceptedListingId = createAvailableListing('Browse accept', 'NO_MATCH');
  const acceptResponse = await fetch(`${baseUrl}/listings/${acceptedListingId}/respond`, {
    method: 'POST',
    headers: { ...headersFor(recipient), 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'accept' }),
  });
  assert.equal(acceptResponse.status, 200);
  const accepted = await acceptResponse.json();
  assert.equal(accepted.assignment.listing_id, acceptedListingId);
  assert.equal(accepted.invitedVolunteers, 1);
  assert.equal(
    q.get(`SELECT status FROM listings WHERE id = ?`, [acceptedListingId]).status,
    'ACCEPTED'
  );
  assert.ok(
    q.get(
      `SELECT id FROM notifications WHERE user_id = ? AND subject = ?`,
      [provider.id, `Donation #${acceptedListingId} accepted`]
    )
  );

  const declinedListingId = createAvailableListing('Browse decline', 'ELIGIBLE');
  const declineResponse = await fetch(`${baseUrl}/listings/${declinedListingId}/respond`, {
    method: 'POST',
    headers: { ...headersFor(recipient), 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'decline' }),
  });
  assert.equal(declineResponse.status, 200);
  assert.equal((await declineResponse.json()).noMatch, true);
  assert.equal(
    q.get(`SELECT status FROM offers WHERE listing_id = ? AND recipient_id = ?`, [
      declinedListingId,
      recipient.id,
    ]).status,
    'DECLINED'
  );
  assert.ok(
    q.get(
      `SELECT id FROM notifications WHERE user_id = ? AND subject = ?`,
      [provider.id, `Donation #${declinedListingId} declined`]
    )
  );
});

test('available surplus excludes own and past-deadline listings', async () => {
  const ownListingId = createAvailableListing('Own surplus', 'ELIGIBLE');
  const ownAsRecipient = { ...provider, role: 'recipient' };
  const ownFeedResponse = await fetch(`${baseUrl}/listings`, {
    headers: headersFor(ownAsRecipient),
  });
  assert.equal(ownFeedResponse.status, 200);
  const ownFeed = await ownFeedResponse.json();
  assert.ok(!ownFeed.listings.some((listing) => listing.id === ownListingId));

  const expiredListingId = createAvailableListing(
    'Expired surplus',
    'NO_MATCH',
    new Date(Date.now() - 3600000).toISOString()
  );
  const feedResponse = await fetch(`${baseUrl}/listings`, {
    headers: headersFor(recipient),
  });
  const feed = await feedResponse.json();
  assert.ok(!feed.listings.some((listing) => listing.id === expiredListingId));

  const response = await fetch(`${baseUrl}/listings/${expiredListingId}/respond`, {
    method: 'POST',
    headers: { ...headersFor(recipient), 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'accept' }),
  });
  assert.equal(response.status, 409);
});

test('tracking omits route values when the recipient has no location', async () => {
  const recipientWithoutLocation = createUser('recipient', 'no-location@response.test');
  const listing = q.run(
    `INSERT INTO listings (provider_id, title, ready_at, pickup_deadline, lat, lng, status)
     VALUES (?, 'Missing drop location', datetime('now'), datetime('now','+4 hours'), 12.95, 77.60,
       'VOLUNTEER_ASSIGNED')`,
    [provider.id]
  );
  const assignment = q.run(
    `INSERT INTO assignments (listing_id, recipient_id, volunteer_id, status)
     VALUES (?, ?, ?, 'ASSIGNED')`,
    [listing.lastInsertRowid, recipientWithoutLocation.id, volunteer.id]
  );
  const response = await fetch(`${baseUrl}/assignments/${assignment.lastInsertRowid}/track`, {
    headers: headersFor(provider),
  });

  assert.equal(response.status, 200);
  const tracking = await response.json();
  assert.equal(tracking.drop.lat, null);
  assert.equal(tracking.drop.lng, null);
  assert.equal(tracking.distanceKm, null);
  assert.equal(tracking.durationMin, null);
  assert.deepEqual(tracking.geometry, []);
  assert.equal(tracking.googleMapsUrl, null);
});