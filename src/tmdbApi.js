const axios = require('axios');

async function searchTmdbContents(query) {
  const tmdbKey = process.env.TMDB_API_KEY;

  if (!tmdbKey) {
    throw new Error('TMDB_API_KEY 환경변수를 .env에 설정해주세요.');
  }

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
    const title = item.title || item.name || '';
    const year =
      (item.release_date || item.first_air_date || '').slice(0, 4) || '';

    return {
      tmdbId: String(item.id),
      title,
      posterUrl: item.poster_path
        ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
        : '',
      pubDate: year,
      type: item.media_type,
    };
  });
}

module.exports = {
  searchTmdbContents,
};
