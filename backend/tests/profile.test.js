'use strict';

require('dotenv').config();

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const connectDB = require('../db');
const app = require('../app');
const mongoose = require('mongoose');
const User = require('../models/User');

function request(server, { method = 'GET', path, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = { hostname: '127.0.0.1', port: addr.port, path, method, headers: { 'Content-Type': 'application/json' } };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => { let p; try { p = JSON.parse(raw); } catch { p = raw; } resolve({ status: res.statusCode, body: p }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

let server, token, testUserId;
const TS = Date.now();
const TEST_EMAIL = 'testuser_' + TS + '@proxispeak.test';
const TEST_PASSWORD = 'TestPass123!';
const TEST_NAME = 'Task4 Tester';

before(async () => {
  await connectDB();
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  const reg = await request(server, { method: 'POST', path: '/api/users/register', body: { name: TEST_NAME, email: TEST_EMAIL, password: TEST_PASSWORD } });
  if (reg.status !== 201) throw new Error('Registration failed: ' + JSON.stringify(reg.body));
  testUserId = reg.body.user.id;
  const login = await request(server, { method: 'POST', path: '/api/users/login', body: { email: TEST_EMAIL, password: TEST_PASSWORD } });
  if (login.status !== 200) throw new Error('Login failed: ' + JSON.stringify(login.body));
  token = login.body.token;
});

after(async () => {
  if (testUserId) await User.findByIdAndDelete(testUserId).catch(() => {});
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
});

describe('GET /api/users/me', () => {
  test('200 - own profile returned for valid token', async () => {
    const { status, body } = await request(server, { path: '/api/users/me', token });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.ok(body.user);
    assert.equal(body.user.email, TEST_EMAIL);
    assert.equal(body.user.name, TEST_NAME);
    assert.ok(body.user.id);
    assert.ok(Array.isArray(body.user.position));
    assert.ok('createdAt' in body.user);
    assert.ok('updatedAt' in body.user);
  });
  test('passwordHash never exposed', async () => {
    const { body } = await request(server, { path: '/api/users/me', token });
    assert.equal(body.user.passwordHash, undefined);
  });
  test('401 - no auth header', async () => {
    const { status, body } = await request(server, { path: '/api/users/me' });
    assert.equal(status, 401); assert.equal(body.success, false);
  });
  test('401 - malformed token', async () => {
    const { status, body } = await request(server, { path: '/api/users/me', token: 'not.a.token' });
    assert.equal(status, 401); assert.equal(body.success, false);
  });
  test('401 - Bearer prefix missing', async () => {
    const addr = server.address();
    const res = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: addr.port, path: '/api/users/me', method: 'GET', headers: { 'Content-Type': 'application/json', Authorization: token } }, (r) => {
        let raw = ''; r.on('data', (c) => (raw += c)); r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(raw) }));
      });
      req.on('error', reject); req.end();
    });
    assert.equal(res.status, 401); assert.equal(res.body.success, false);
  });
});

describe('PATCH /api/users/me', () => {
  test('200 - update name only', async () => {
    const { status, body } = await request(server, { method: 'PATCH', path: '/api/users/me', body: { name: 'Updated Name' }, token });
    assert.equal(status, 200); assert.equal(body.user.name, 'Updated Name'); assert.equal(body.user.email, TEST_EMAIL);
  });
  test('200 - update position only', async () => {
    const { status, body } = await request(server, { method: 'PATCH', path: '/api/users/me', body: { position: [100, 200] }, token });
    assert.equal(status, 200); assert.deepEqual(body.user.position, [100, 200]);
  });
  test('200 - update name and position', async () => {
    const { status, body } = await request(server, { method: 'PATCH', path: '/api/users/me', body: { name: 'Both Updated', position: [50, 60] }, token });
    assert.equal(status, 200); assert.equal(body.user.name, 'Both Updated'); assert.deepEqual(body.user.position, [50, 60]);
  });
  test('passwordHash not returned in PATCH response', async () => {
    const { body } = await request(server, { method: 'PATCH', path: '/api/users/me', body: { name: 'HashCheck' }, token });
    assert.equal(body.user.passwordHash, undefined);
  });
  test('email not changed even if sent', async () => {
    const { status, body } = await request(server, { method: 'PATCH', path: '/api/users/me', body: { name: 'EmailTest', email: 'attacker@evil.com' }, token });
    assert.equal(status, 200); assert.equal(body.user.email, TEST_EMAIL);
  });
  test('400 - empty body', async () => {
    const { status, body } = await request(server, { method: 'PATCH', path: '/api/users/me', body: {}, token });
    assert.equal(status, 400); assert.equal(body.success, false);
  });
  test('400 - name is whitespace only', async () => {
    const { status, body } = await request(server, { method: 'PATCH', path: '/api/users/me', body: { name: '   ' }, token });
    assert.equal(status, 400); assert.equal(body.success, false);
  });
  test('400 - position not an array', async () => {
    const { status, body } = await request(server, { method: 'PATCH', path: '/api/users/me', body: { position: 'bad' }, token });
    assert.equal(status, 400); assert.equal(body.success, false);
  });
  test('400 - position wrong length', async () => {
    const { status, body } = await request(server, { method: 'PATCH', path: '/api/users/me', body: { position: [100] }, token });
    assert.equal(status, 400); assert.equal(body.success, false);
  });
  test('400/500 - position out of bounds', async () => {
    const { status, body } = await request(server, { method: 'PATCH', path: '/api/users/me', body: { position: [1500, 300] }, token });
    assert.ok([400, 500].includes(status), 'Expected 400 or 500, got ' + status);
    assert.equal(body.success, false);
  });
  test('401 - unauthenticated PATCH rejected', async () => {
    const { status, body } = await request(server, { method: 'PATCH', path: '/api/users/me', body: { name: 'Hacker' } });
    assert.equal(status, 401); assert.equal(body.success, false);
  });
  test('protected fields silently ignored', async () => {
    const { status, body } = await request(server, { method: 'PATCH', path: '/api/users/me', body: { name: 'LegitUpdate', passwordHash: 'fake-hash', _id: '000000000000000000000001' }, token });
    assert.equal(status, 200);
    assert.equal(body.user.name, 'LegitUpdate');
    assert.equal(body.user.passwordHash, undefined);
    assert.equal(String(body.user.id), testUserId);
  });
});