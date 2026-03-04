const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCommentSummaryList,
  sortCommentSummaryItems,
  formatRelativeTimeLabel,
} = require('../src/utils/commentSummary');

test('buildCommentSummaryList maps grouped data and sorts by count desc then latest desc', () => {
  const groups = [
    {
      contentId: 'a',
      _count: { _all: 2 },
      _max: { createdAt: new Date('2026-03-01T10:00:00Z') },
    },
    {
      contentId: 'b',
      _count: { _all: 4 },
      _max: { createdAt: new Date('2026-03-01T08:00:00Z') },
    },
    {
      contentId: 'c',
      _count: { _all: 2 },
      _max: { createdAt: new Date('2026-03-02T08:00:00Z') },
    },
  ];
  const titles = new Map([
    ['a', 'A title'],
    ['b', 'B title'],
    ['c', 'C title'],
  ]);

  const summary = buildCommentSummaryList(groups, titles);
  assert.equal(summary[0].contentId, 'b');
  assert.equal(summary[1].contentId, 'c');
  assert.equal(summary[2].contentId, 'a');
  assert.equal(summary[0].title, 'B title');
});

test('sortCommentSummaryItems supports latest sort', () => {
  const items = [
    { contentId: 'x', count: 5, latestCommentAt: new Date('2026-03-01T01:00:00Z') },
    { contentId: 'y', count: 1, latestCommentAt: new Date('2026-03-02T01:00:00Z') },
  ];

  const sorted = sortCommentSummaryItems(items, 'latest');
  assert.equal(sorted[0].contentId, 'y');
  assert.equal(sorted[1].contentId, 'x');
});

test('formatRelativeTimeLabel returns minute/hour/day labels', () => {
  const now = new Date('2026-03-04T12:00:00Z').getTime();
  const tenMinutesAgo = now - 10 * 60 * 1000;
  const fiveHoursAgo = now - 5 * 60 * 60 * 1000;
  const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;

  assert.equal(formatRelativeTimeLabel(tenMinutesAgo, now), '10분 전');
  assert.equal(formatRelativeTimeLabel(fiveHoursAgo, now), '5시간 전');
  assert.equal(formatRelativeTimeLabel(threeDaysAgo, now), '3일 전');
});
