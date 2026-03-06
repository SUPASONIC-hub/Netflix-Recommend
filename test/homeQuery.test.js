const test = require('node:test');
const assert = require('node:assert/strict');

const { resolvePageParams, buildHomeOrderBy } = require('../src/utils/homeQuery');

test('resolvePageParams clamps invalid values and page size max', () => {
  assert.deepEqual(resolvePageParams({}), { page: 1, pageSize: 12 });
  assert.deepEqual(resolvePageParams({ page: '0', pageSize: '-1' }), { page: 1, pageSize: 12 });
  assert.deepEqual(resolvePageParams({ page: '2', pageSize: '100' }), { page: 2, pageSize: 48 });
});

test('buildHomeOrderBy uses smart sort precedence', () => {
  const orderBy = buildHomeOrderBy('smart');
  assert.deepEqual(orderBy, [
    { myRating: 'desc' },
    { voteAverage: 'desc' },
    { popularity: 'desc' },
    { updatedAt: 'desc' },
  ]);
});
