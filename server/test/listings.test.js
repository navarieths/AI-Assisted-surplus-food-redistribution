import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DB_PATH = path.join(os.tmpdir(), `surplus-listings-test-${process.pid}.db`);
process.env.NODE_ENV = 'test';

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

const provider = createUser('provider', 'provider@listings.test');
const recipient = createUser('recipient', 'recipient@listings.test');
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

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

test('a new listing is stored and visible to its provider and recipients', async () => {
  const future = (hours) => new Date(Date.now() + hours * 3600000).toISOString();
  const past = (hours) => new Date(Date.now() - hours * 3600000).toISOString();
  const response = await fetch(`${baseUrl}/listings`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${signToken(provider)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title: 'Fresh vegetarian meals',
      food_type: 'veg',
      quantity_kg: 5,
      servings: 20,
      prepared_at: past(1),
      ready_at: future(0.5),
      pickup_deadline: future(4),
      lat: 12.9716,
      lng: 77.5946,
      address: 'MG Road, Bengaluru',
      storage_condition: 'chilled',
      allergens: 'Contains milk',
      packaging: 'Sealed trays',
      handling_notes: 'Keep refrigerated below 5°C.',
      description: 'Fresh vegetarian food from the lunch service.',
    }),
  });
  assert.equal(response.status, 201);
  const { listing } = await response.json();
  assert.equal(listing.validation.eligible, true);

  const stored = q.get(`SELECT * FROM listings WHERE id = ?`, [listing.id]);
  assert.equal(stored.title, 'Fresh vegetarian meals');
  assert.equal(stored.provider_id, provider.id);

  const providerResponse = await fetch(`${baseUrl}/listings`, {
    headers: { authorization: `Bearer ${signToken(provider)}` },
  });
  const providerListings = await providerResponse.json();
  assert.ok(providerListings.listings.some((row) => row.id === listing.id));

  const recipientResponse = await fetch(`${baseUrl}/listings`, {
    headers: { authorization: `Bearer ${signToken(recipient)}` },
  });
  const recipientListings = await recipientResponse.json();
  assert.ok(recipientListings.listings.some((row) => row.id === listing.id));
});