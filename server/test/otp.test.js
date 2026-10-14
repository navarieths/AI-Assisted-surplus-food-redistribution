import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DB_PATH = path.join(os.tmpdir(), `surplus-otp-test-${process.pid}.db`);

const { q } = await import('../src/db.js');
const { config } = await import('../src/config.js');
const { issuePickupOtp, checkPickupOtp } = await import('../src/services/workflow.js');

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
function makeAssignment() {
  seq += 1;
  const provider = q.run(
    `INSERT INTO users (role, name, email, password_hash) VALUES ('provider','P',?,'x')`,
    [`otp-prov${seq}@test`]
  );
  const recipient = q.run(
    `INSERT INTO users (role, name, email, password_hash) VALUES ('recipient','R',?,'x')`,
    [`otp-rec${seq}@test`]
  );
  const listing = q.run(
    `INSERT INTO listings (provider_id, title, ready_at, pickup_deadline, lat, lng, status)
     VALUES (?, 'L', datetime('now'), datetime('now','+4 hours'), 12.9, 77.6, 'ACCEPTED')`,
    [provider.lastInsertRowid]
  );
  const info = q.run(
    `INSERT INTO assignments (listing_id, recipient_id, status, delivery_otp) VALUES (?,?, 'ASSIGNED', '111111')`,
    [listing.lastInsertRowid, recipient.lastInsertRowid]
  );
  return q.get(`SELECT * FROM assignments WHERE id = ?`, [info.lastInsertRowid]);
}

test('pickup OTP is stored hashed, never in clear text', () => {
  const assignment = makeAssignment();
  const otp = issuePickupOtp(assignment.id, '135790');
  const stored = q.get(`SELECT * FROM assignments WHERE id = ?`, [assignment.id]);
  assert.equal(otp, '135790');
  assert.equal(stored.pickup_otp, null);
  assert.ok(stored.pickup_otp_hash);
  assert.notEqual(stored.pickup_otp_hash, '135790');

  const good = checkPickupOtp(stored, '135790');
  assert.equal(good.ok, true);
  assert.equal(good.locked, false);
});

test('pickup OTP locks after the configured number of wrong attempts', () => {
  const assignment = makeAssignment();
  issuePickupOtp(assignment.id, '246810');
  const max = config.otp.maxAttempts;

  let last;
  for (let i = 1; i <= max; i += 1) {
    const row = q.get(`SELECT * FROM assignments WHERE id = ?`, [assignment.id]);
    last = checkPickupOtp(row, '000000');
    assert.equal(last.ok, false);
    assert.equal(last.remaining, max - i);
  }
  assert.equal(last.locked, true, `locked after ${max} attempts`);

  // Even the correct OTP is rejected once locked.
  const lockedRow = q.get(`SELECT * FROM assignments WHERE id = ?`, [assignment.id]);
  const afterLock = checkPickupOtp(lockedRow, '246810');
  assert.equal(afterLock.ok, false);
  assert.equal(afterLock.locked, true);
});
