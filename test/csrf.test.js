const test = require('node:test');
const assert = require('node:assert/strict');

const { selectCsrfCandidate, isValidCsrfToken } = require('../src/utils/csrf');

test('selectCsrfCandidate prefers body token over header token', () => {
  assert.equal(selectCsrfCandidate('body-token', 'header-token'), 'body-token');
  assert.equal(selectCsrfCandidate('', 'header-token'), 'header-token');
  assert.equal(selectCsrfCandidate('', ''), '');
});

test('isValidCsrfToken validates matching non-empty tokens only', () => {
  assert.equal(isValidCsrfToken('abc', 'abc'), true);
  assert.equal(isValidCsrfToken('abc', 'def'), false);
  assert.equal(isValidCsrfToken('', 'abc'), false);
});
