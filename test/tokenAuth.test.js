const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createAdminSessionToken,
  verifyAdminSessionToken,
  ADMIN_SESSION_MAX_AGE_MS,
} = require('../src/tokenAuth');

test('createAdminSessionToken + verifyAdminSessionToken basic flow', () => {
  const secret = 'secret-key';
  const token = createAdminSessionToken(secret);
  assert.equal(typeof token, 'string');
  assert.equal(verifyAdminSessionToken(token, secret, ADMIN_SESSION_MAX_AGE_MS), true);
  assert.equal(verifyAdminSessionToken(token, 'wrong-secret', ADMIN_SESSION_MAX_AGE_MS), false);
});

test('verifyAdminSessionToken rejects expired token', () => {
  const secret = 'secret-key';
  const originalNow = Date.now;
  try {
    Date.now = () => 1000;
    const token = createAdminSessionToken(secret);
    Date.now = () => 1000 + 2_000;
    assert.equal(verifyAdminSessionToken(token, secret, 1_000), false);
  } finally {
    Date.now = originalNow;
  }
});
