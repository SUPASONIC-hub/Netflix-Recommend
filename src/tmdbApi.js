const axios = require('axios');

const GENRE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const genreCache = {
  fetchedAt: 0,
  movie: null,
  tv: null,
};

function getTmdbKey() {
  const tmdbKey = process.env.TMDB_API_KEY;
  if (!tmdbKey) {
    throw new Error('TMDB_API_KEY 환경 변수가 설정되지 않았습니다.');
  }
  return tmdbKey;
}

async function fetchGenreMap(mediaType, tmdbKey) {
  const url = `https://api.themoviedb.org/3/genre/${mediaType}/list`;
  const response = await axios.get(url, {
    params: {
      api_key: tmdbKey,
      language: 'ko-KR',
    },
  });
  const genres = response.data.genres || [];
  const map = new Map();
  genres.forEach((g) => {
    if (g && typeof g.id === 'number') {
      map.set(g.id, g.name || '');
    }
  });
  return map;
}

async function getGenreMap() {
  const now = Date.now();
  if (
    genreCache.movie &&
    genreCache.tv &&
    now - genreCache.fetchedAt < GENRE_CACHE_TTL_MS
  ) {
    return genreCache;
  }

  const tmdbKey = getTmdbKey();
  const [movieMap, tvMap] = await Promise.all([
    fetchGenreMap('movie', tmdbKey),
    fetchGenreMap('tv', tmdbKey),
  ]);

  genreCache.movie = movieMap;
  genreCache.tv = tvMap;
  genreCache.fetchedAt = now;
  return genreCache;
}

async function resolveGenreNames(genreIds, mediaType) {
  if (!Array.isArray(genreIds) || genreIds.length === 0) {
    return [];
  }
  try {
    const cache = await getGenreMap();
    const map =
      mediaType === 'tv' ? cache.tv : mediaType === 'movie' ? cache.movie : null;
    if (!map) return [];
    return genreIds
      .map((id) => map.get(id))
      .filter((name) => typeof name === 'string' && name.trim());
  } catch {
    return [];
  }
}

async function searchTmdbContents(query) {
  const tmdbKey = getTmdbKey();
  const url = 'https://api.themoviedb.org/3/search/multi';

  const response = await axios.get(url, {
    params: {
      api_key: tmdbKey,
      language: 'ko-KR',
      query,
      include_adult: false,
      page: 1,
    },
  });

  const items = response.data.results || [];

  return items.map((item) => {
    const title = item.title || '';
    const name = item.name || '';
    const releaseDate = item.release_date || '';
    const firstAirDate = item.first_air_date || '';
    const year = (releaseDate || firstAirDate || '').slice(0, 4) || '';

    return {
      tmdbId: String(item.id),
      title,
      name,
      overview: item.overview || '',
      releaseDate,
      firstAirDate,
      posterPath: item.poster_path || '',
      backdropPath: item.backdrop_path || '',
      genreIds: Array.isArray(item.genre_ids) ? item.genre_ids : [],
      popularity: typeof item.popularity === 'number' ? item.popularity : null,
      voteAverage:
        typeof item.vote_average === 'number' ? item.vote_average : null,
      voteCount: typeof item.vote_count === 'number' ? item.vote_count : null,
      adult: !!item.adult,
      mediaType: item.media_type || '',
      posterUrl: item.poster_path
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
        : '',
      pubDate: year,
      type: item.media_type || '',
    };
  });
}

module.exports = {
  searchTmdbContents,
  resolveGenreNames,
};
