import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DB_PATH = path.join(os.tmpdir(), `surplus-workflow-test-${process.pid}.db`);

const { q } = await import('../src/db.js');
const { canTransition, transition, logEvent } = await import('../src/services/workflow.js');

test.after(() => {
  try {
    fs.rmSync(process.env.DB_PATH, { force: true });
    fs.rmSync(`${process.env.DB_PATH}-wal`, { force: true });
    fs.rmSync(`${process.env.DB_PATH}-shm`, { force: true });
  } catch {
    /* ignore */
  }
});

test('workflow allows the happy path and blocks illegal jumps', () => {
  assert.equal(canTransition('LISTED', 'ELIGIBLE'), true);
  assert.equal(canTransition('LISTED', 'DELIVERED'), false);
  assert.equal(canTransition('OFFERED', 'ACCEPTED'), true);
  assert.equal(canTransition('DELIVERED', 'IN_TRANSIT'), false);
});

test('transitions are recorded in status_events', () => {
  const info = q.run(
    `INSERT INTO users (role, name, email, password_hash) VALUES ('provider','P','p@test','x')`
  );
  const provider = q.get(`SELECT * FROM users WHERE id = ?`, [info.lastInsertRowid]);
  const l = q.run(
    `INSERT INTO listings (provider_id, title, ready_at, pickup_deadline, lat, lng)
     VALUES (?, 'Test', datetime('now'), datetime('now','+4 hours'), 12.9, 77.6)`,
    [provider.id]
  );
  const id = Number(l.lastInsertRowid);

  // Created directly in LISTED then validated.
  logEvent(id, null, 'LISTED', { id: provider.id, role: 'provider' });
  transition(id, 'ELIGIBLE', provider, 'passed');
  transition(id, 'OFFERED', provider, 'offered');
  transition(id, 'ACCEPTED', provider, 'accepted');
  transition(id, 'VOLUNTEER_ASSIGNED', provider, 'assigned');
  transition(id, 'PICKED_UP', provider, 'otp');
  transition(id, 'IN_TRANSIT', provider, 'en route');
  transition(id, 'DELIVERED', provider, 'confirmed');

  const listing = q.get(`SELECT status FROM listings WHERE id = ?`, [id]);
  assert.equal(listing.status, 'DELIVERED');
  const events = q.all(`SELECT * FROM status_events WHERE listing_id = ? ORDER BY id`, [id]);
  assert.equal(events.length, 8); // LISTED + 7 transitions
  assert.equal(events.at(-1).to_status, 'DELIVERED');

  assert.throws(() => transition(id, 'IN_TRANSIT', provider), /Illegal transition/);
});
