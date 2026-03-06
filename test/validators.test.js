const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateCommentInput,
  validateAdminContentInput,
  validateAdminContentUpdateInput,
} = require('../src/utils/validators');

function parseTagList(tags) {
  return typeof tags === 'string'
    ? tags
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : [];
}

function parseGenreIds(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(value)
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => !Number.isNaN(v));
  }
}

test('validateCommentInput enforces required fields and max length trimming', () => {
  const missing = validateCommentInput({ nickname: '', text: '' });
  assert.equal(missing.ok, false);

  const longText = 'a'.repeat(3000);
  const ok = validateCommentInput({ nickname: '  user  ', text: longText });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.nickname, 'user');
  assert.equal(ok.value.text.length, 2000);
});

test('validateAdminContentInput validates rating boundary and normalizes fields', () => {
  const low = validateAdminContentInput(
    {
      tmdbId: '1',
      title: 'Title',
      myNote: 'memo',
      myRating: '0.4',
    },
    parseTagList,
    parseGenreIds
  );
  assert.equal(low.ok, false);

  const ok = validateAdminContentInput(
    {
      tmdbId: '10',
      title: 'Title',
      myNote: 'memo',
      myRating: '4.5',
      tags: 'a, b, a',
      genreIds: '[12, 14]',
      adult: '1',
    },
    parseTagList,
    parseGenreIds
  );
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value.tags, ['a', 'b']);
  assert.deepEqual(ok.value.genreIds, [12, 14]);
  assert.equal(ok.value.adult, true);
});

test('validateAdminContentUpdateInput rejects non-integer voteCount', () => {
  const result = validateAdminContentUpdateInput(
    {
      title: 'Title',
      myNote: 'memo',
      myRating: '3',
      voteCount: '10.2',
    },
    parseTagList,
    parseGenreIds
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /정수/);
});
