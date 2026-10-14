import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.DB_PATH = path.join(os.tmpdir(), `surplus-auth-test-${process.pid}.db`);
process.env.NODE_ENV = 'test';

const { default: app } = await import('../src/index.js');
const { q } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

const created = q.run(
  `INSERT INTO users (role, name, email, password_hash) VALUES ('delivery_partner', ?, ?, ?)`,
  ['Multi-role account', 'multi-role@test', hashPassword('password123')]
);
const userId = created.lastInsertRowid;
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

test('one account can sign in and switch between role sessions', async () => {
  const loginResponse = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'multi-role@test', password: 'password123', role: 'provider' }),
  });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  assert.equal(login.user.id, userId);
  assert.equal(login.user.role, 'provider');

  const meResponse = await fetch(`${baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${login.token}` },
  });
  assert.equal((await meResponse.json()).user.role, 'provider');

  const switchResponse = await fetch(`${baseUrl}/auth/role`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${login.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ role: 'recipient' }),
  });
  assert.equal(switchResponse.status, 200);
  const switched = await switchResponse.json();
  assert.equal(switched.user.id, userId);
  assert.equal(switched.user.role, 'recipient');

  const switchedMe = await fetch(`${baseUrl}/auth/me`, {
    headers: { authorization: `Bearer ${switched.token}` },
  });
  assert.equal((await switchedMe.json()).user.role, 'recipient');
});