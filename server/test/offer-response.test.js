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