import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DB_PATH = path.join(os.tmpdir(), `surplus-offers-test-${process.pid}.db`);

const { q } = await import('../src/db.js');
const { acceptOffer, declineOffer, cascadeOffers, offerNext } = await import(
  '../src/services/listings.js'
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

let seq = 0;
function makeUser(role) {
  seq += 1;
  const email = `${role}${seq}@offers.test`;
  const info = q.run(`INSERT INTO users (role, name, email, password_hash) VALUES (?,?,?,'x')`, [
    role,
    `${role} ${seq}`,
    email,
  ]);
  return q.get(`SELECT * FROM users WHERE id = ?`, [info.lastInsertRowid]);
}

function makeListing(providerId, status = 'OFFERED') {
  const info = q.run(
    `INSERT INTO listings (provider_id, title, ready_at, pickup_deadline, lat, lng, status)
     VALUES (?, 'Test listing', datetime('now','+1 hour'), datetime('now','+5 hours'), 12.9, 77.6, ?)`,
    [providerId, status]
  );
  return q.get(`SELECT * FROM listings WHERE id = ?`, [info.lastInsertRowid]);
}

function makeOffer(listingId, recipientId, rank, status) {
  const info = q.run(
    `INSERT INTO offers (listing_id, recipient_id, score, breakdown_json, explanation,
      distance_km, duration_min, estimated, rank, status)
     VALUES (?,?,?,?,?,?,?,1,?,?)`,
    [listingId, recipientId, 90 - rank, '{"ratios":{}}', `why #${rank}`, 3 + rank, 10, rank, status]
  );
  return q.get(`SELECT * FROM offers WHERE id = ?`, [info.lastInsertRowid]);
}

function statusOf(listingId) {
  return q.get(`SELECT status FROM listings WHERE id = ?`, [listingId]).status;
}

/* --------------------------- state-machine guards ------------------------ */

test('only an OFFERED offer can be accepted or declined', () => {
  const provider = makeUser('provider');
  const recipient = makeUser('recipient');
  const listing = makeListing(provider.id, 'OFFERED');
  const candidate = makeOffer(listing.id, recipient.id, 1, 'CANDIDATE');

  assert.throws(() => acceptOffer(candidate, recipient, recipient), /cannot accept/);
  assert.throws(() => declineOffer(candidate, recipient, recipient), /cannot decline/);

  // Still CANDIDATE after the rejected attempts.
  assert.equal(q.get(`SELECT status FROM offers WHERE id = ?`, [candidate.id]).status, 'CANDIDATE');
});

test('a recipient cannot act on another recipient\'s offer', () => {
  const provider = makeUser('provider');
  const owner = makeUser('recipient');
  const stranger = makeUser('recipient');
  const listing = makeListing(provider.id, 'OFFERED');
  const offer = makeOffer(listing.id, owner.id, 1, 'OFFERED');

  assert.throws(() => acceptOffer(offer, stranger, stranger), /does not belong/);
  assert.throws(() => declineOffer(offer, stranger, stranger), /does not belong/);
});

test('accepting is blocked when the listing is no longer live', () => {
  const provider = makeUser('provider');
  const recipient = makeUser('recipient');
  const listing = makeListing(provider.id, 'EXPIRED');
  const offer = makeOffer(listing.id, recipient.id, 1, 'OFFERED');

  assert.throws(() => acceptOffer(offer, recipient, recipient), /cannot accept/);
  // The offer must not have been mutated by the rejected accept.
  assert.equal(q.get(`SELECT status FROM offers WHERE id = ?`, [offer.id]).status, 'OFFERED');
});

/* ------------------------------ decline cascade -------------------------- */

test('declining offers the next ranked candidate, then NO_MATCH when exhausted', async () => {
  const provider = makeUser('provider');
  const r1 = makeUser('recipient');
  const r2 = makeUser('recipient');
  const r3 = makeUser('recipient');
  const listing = makeListing(provider.id, 'OFFERED');
  const o1 = makeOffer(listing.id, r1.id, 1, 'OFFERED');
  const o2 = makeOffer(listing.id, r2.id, 2, 'OFFERED');
  const o3 = makeOffer(listing.id, r3.id, 3, 'CANDIDATE');

  // r1 declines -> the queued rank-3 candidate is offered next.
  const d1 = declineOffer(o1, r1, r1);
  assert.equal(d1.offer.status, 'DECLINED');
  const c1 = await cascadeOffers(d1.listing, r1);
  assert.ok(c1.nextOffer, 'a next offer was made');
  assert.equal(c1.nextOffer.rank, 3);
  assert.equal(c1.nextOffer.status, 'OFFERED');
  assert.equal(statusOf(listing.id), 'OFFERED');

  // r2 declines -> no candidates left, but r3 still has a live offer.
  const d2 = declineOffer(o2, r2, r2);
  const c2 = await cascadeOffers(d2.listing, r2);
  assert.equal(c2.nextOffer, null);
  assert.equal(c2.noMatch, false);
  assert.equal(statusOf(listing.id), 'OFFERED');

  // r3 declines -> nothing live, nothing queued => NO_MATCH.
  const liveO3 = q.get(`SELECT * FROM offers WHERE id = ?`, [o3.id]);
  const d3 = declineOffer(liveO3, r3, r3);
  const c3 = await cascadeOffers(d3.listing, r3);
  assert.equal(c3.nextOffer, null);
  assert.equal(c3.noMatch, true);
  assert.equal(statusOf(listing.id), 'NO_MATCH');

  const events = q.all(
    `SELECT to_status FROM status_events WHERE listing_id = ? ORDER BY id`,
    [listing.id]
  );
  assert.ok(events.some((e) => e.to_status === 'NO_MATCH'));
});

test('declining with only queued candidates cascades without going to NO_MATCH', async () => {
  const provider = makeUser('provider');
  const r1 = makeUser('recipient');
  const r2 = makeUser('recipient');
  const listing = makeListing(provider.id, 'OFFERED');
  const o1 = makeOffer(listing.id, r1.id, 1, 'OFFERED');
  makeOffer(listing.id, r2.id, 2, 'CANDIDATE');

  const d1 = declineOffer(o1, r1, r1);
  const c1 = await cascadeOffers(d1.listing, r1);
  assert.ok(c1.nextOffer);
  assert.equal(c1.nextOffer.rank, 2);
  assert.equal(c1.noMatch, false);
  assert.equal(statusOf(listing.id), 'OFFERED');
});

test('offerNext promotes the lowest-ranked candidate and returns null when empty', async () => {
  const provider = makeUser('provider');
  const r1 = makeUser('recipient');
  const r2 = makeUser('recipient');
  const listing = makeListing(provider.id, 'OFFERED');
  const queued = makeOffer(listing.id, r2.id, 2, 'CANDIDATE');
  makeOffer(listing.id, r1.id, 1, 'OFFERED');

  const next = await offerNext(listing, r1);
  assert.equal(next.id, queued.id);
  assert.equal(next.status, 'OFFERED');
  assert.equal(await offerNext(listing, r1), null);
});

/* -------------------------------- acceptance ----------------------------- */

test('accepting supersedes other offers, queued candidates and creates an assignment', async () => {
  const provider = makeUser('provider');
  const r1 = makeUser('recipient');
  const r2 = makeUser('recipient');
  const r3 = makeUser('recipient');
  const listing = makeListing(provider.id, 'OFFERED');
  const o1 = makeOffer(listing.id, r1.id, 1, 'OFFERED');
  const o2 = makeOffer(listing.id, r2.id, 2, 'OFFERED');
  const o3 = makeOffer(listing.id, r3.id, 3, 'CANDIDATE');

  const { offer, assignment } = acceptOffer(o1, r1, r1);
  assert.equal(offer.status, 'ACCEPTED');
  assert.equal(assignment.listing_id, listing.id);
  assert.equal(assignment.recipient_id, r1.id);
  assert.equal(assignment.status, 'CREATED');
  assert.ok(assignment.delivery_otp);

  assert.equal(statusOf(listing.id), 'ACCEPTED');
  assert.equal(q.get(`SELECT status FROM offers WHERE id = ?`, [o1.id]).status, 'ACCEPTED');
  assert.equal(q.get(`SELECT status FROM offers WHERE id = ?`, [o2.id]).status, 'DECLINED');
  assert.equal(q.get(`SELECT status FROM offers WHERE id = ?`, [o3.id]).status, 'DECLINED');

  // A committed listing never cascades to NO_MATCH.
  const after = await cascadeOffers(q.get(`SELECT * FROM listings WHERE id = ?`, [listing.id]), r1);
  assert.equal(after.nextOffer, null);
  assert.equal(after.noMatch, false);
  assert.equal(statusOf(listing.id), 'ACCEPTED');

  const assignmentCount = q.get(
    `SELECT COUNT(*) AS n FROM assignments WHERE listing_id = ?`,
    [listing.id]
  ).n;
  assert.equal(assignmentCount, 1);
});

test('re-declining an already-declined offer is rejected', () => {
  const provider = makeUser('provider');
  const recipient = makeUser('recipient');
  const listing = makeListing(provider.id, 'OFFERED');
  const offer = makeOffer(listing.id, recipient.id, 1, 'OFFERED');

  declineOffer(offer, recipient, recipient);
  const declined = q.get(`SELECT * FROM offers WHERE id = ?`, [offer.id]);
  assert.throws(() => declineOffer(declined, recipient, recipient), /cannot decline/);
});
