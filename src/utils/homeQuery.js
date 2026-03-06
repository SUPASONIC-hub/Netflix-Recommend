const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 48;

function clampPositiveInt(value, fallback, maxValue) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  if (typeof maxValue === 'number') return Math.min(parsed, maxValue);
  return parsed;
}

function resolvePageParams(query = {}) {
  const page = clampPositiveInt(query.page, 1);
  const pageSize = clampPositiveInt(query.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  return { page, pageSize };
}

function buildHomeOrderBy(sort) {
  if (sort === 'smart') {
    return [
      { myRating: 'desc' },
      { voteAverage: 'desc' },
      { popularity: 'desc' },
      { updatedAt: 'desc' },
    ];
  }
  if (sort === 'vote') {
    return [{ voteAverage: 'desc' }, { popularity: 'desc' }, { updatedAt: 'desc' }];
  }
  if (sort === 'pop') {
    return [{ popularity: 'desc' }, { updatedAt: 'desc' }];
  }
  if (sort === 'recent') {
    return [{ releaseDate: 'desc' }, { firstAirDate: 'desc' }, { createdAt: 'desc' }];
  }
  return [{ createdAt: 'desc' }];
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  resolvePageParams,
  buildHomeOrderBy,
};
