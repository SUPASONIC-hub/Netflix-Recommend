const MAX_TEXT_LENGTH = 2000;
const MAX_NICKNAME_LENGTH = 40;
const MAX_TAGS = 20;

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asOptionalString(value, maxLength = 3000) {
  const normalized = toTrimmedString(value);
  return normalized ? normalized.slice(0, maxLength) : '';
}

function asRequiredString(value, fieldName, maxLength = 3000) {
  const normalized = toTrimmedString(value);
  if (!normalized) {
    return { ok: false, error: `${fieldName}은(는) 필수입니다.` };
  }
  return { ok: true, value: normalized.slice(0, maxLength) };
}

function asFloat(value, fieldName, { min = -Infinity, max = Infinity, required = false } = {}) {
  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '' || raw === null || raw === undefined) {
    return required
      ? { ok: false, error: `${fieldName} 값이 필요합니다.` }
      : { ok: true, value: null };
  }
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    return { ok: false, error: `${fieldName} 값이 올바르지 않습니다.` };
  }
  if (parsed < min || parsed > max) {
    return { ok: false, error: `${fieldName} 범위는 ${min}~${max}입니다.` };
  }
  return { ok: true, value: parsed };
}

function asInt(value, fieldName, { min = -Infinity, max = Infinity, required = false } = {}) {
  const floatResult = asFloat(value, fieldName, { min, max, required });
  if (!floatResult.ok) return floatResult;
  if (floatResult.value === null) return floatResult;
  if (!Number.isInteger(floatResult.value)) {
    return { ok: false, error: `${fieldName} 값은 정수여야 합니다.` };
  }
  return floatResult;
}

function validateCommentInput(payload) {
  const nicknameResult = asRequiredString(payload.nickname, '닉네임', MAX_NICKNAME_LENGTH);
  if (!nicknameResult.ok) return nicknameResult;
  const textResult = asRequiredString(payload.text, '댓글', MAX_TEXT_LENGTH);
  if (!textResult.ok) return textResult;

  return {
    ok: true,
    value: {
      nickname: nicknameResult.value,
      text: textResult.value,
    },
  };
}

function validateAdminContentInput(payload, parseTagList, parseGenreIds) {
  const tmdbId = asRequiredString(payload.tmdbId, 'TMDB ID', 80);
  if (!tmdbId.ok) return tmdbId;

  const title = asOptionalString(payload.title, 280);
  const name = asOptionalString(payload.name, 280);
  if (!title && !name) {
    return { ok: false, error: '제목 또는 이름은 필수입니다.' };
  }

  const myNote = asRequiredString(payload.myNote, '감상평', MAX_TEXT_LENGTH);
  if (!myNote.ok) return myNote;

  const myRating = asFloat(payload.myRating, '평점', { min: 0.5, max: 5, required: true });
  if (!myRating.ok) return myRating;

  const popularity = asFloat(payload.popularity, '인기 지표');
  if (!popularity.ok) return popularity;
  const voteAverage = asFloat(payload.voteAverage, 'TMDB 평점');
  if (!voteAverage.ok) return voteAverage;
  const voteCount = asInt(payload.voteCount, 'TMDB 투표 수');
  if (!voteCount.ok) return voteCount;

  const tagsRaw = parseTagList(payload.tags);
  const tags = Array.from(new Set(tagsRaw)).slice(0, MAX_TAGS);
  const genreIds = parseGenreIds(payload.genreIds);

  return {
    ok: true,
    value: {
      tmdbId: tmdbId.value,
      title: title || name || '',
      name,
      overview: asOptionalString(payload.overview, 6000),
      releaseDate: asOptionalString(payload.releaseDate, 40),
      firstAirDate: asOptionalString(payload.firstAirDate, 40),
      posterPath: asOptionalString(payload.posterPath, 255),
      posterUrl: asOptionalString(payload.posterUrl, 1024),
      backdropPath: asOptionalString(payload.backdropPath, 255),
      genreIds,
      popularity: popularity.value,
      voteAverage: voteAverage.value,
      voteCount: voteCount.value,
      adult: payload.adult === true || payload.adult === 'true' || payload.adult === '1' || payload.adult === 1,
      mediaType: asOptionalString(payload.mediaType, 40),
      year: asOptionalString(payload.year, 12),
      type: asOptionalString(payload.type, 40),
      myNote: myNote.value,
      myRating: myRating.value,
      tags,
    },
  };
}

function validateAdminContentUpdateInput(payload, parseTagList, parseGenreIds) {
  const title = asOptionalString(payload.title, 280);
  const name = asOptionalString(payload.name, 280);
  if (!title && !name) {
    return { ok: false, error: '제목 또는 이름은 필수입니다.' };
  }

  const myNote = asRequiredString(payload.myNote, '감상평', MAX_TEXT_LENGTH);
  if (!myNote.ok) return myNote;

  const myRating = asFloat(payload.myRating, '평점', { min: 0.5, max: 5, required: true });
  if (!myRating.ok) return myRating;

  const popularity = asFloat(payload.popularity, '인기 지표');
  if (!popularity.ok) return popularity;
  const voteAverage = asFloat(payload.voteAverage, 'TMDB 평점');
  if (!voteAverage.ok) return voteAverage;
  const voteCount = asInt(payload.voteCount, 'TMDB 투표 수');
  if (!voteCount.ok) return voteCount;

  const tagsRaw = parseTagList(payload.tags);
  const tags = Array.from(new Set(tagsRaw)).slice(0, MAX_TAGS);

  return {
    ok: true,
    value: {
      title: title || name || '',
      name,
      overview: asOptionalString(payload.overview, 6000),
      releaseDate: asOptionalString(payload.releaseDate, 40),
      firstAirDate: asOptionalString(payload.firstAirDate, 40),
      posterPath: asOptionalString(payload.posterPath, 255),
      posterUrl: asOptionalString(payload.posterUrl, 1024),
      backdropPath: asOptionalString(payload.backdropPath, 255),
      genreIds: parseGenreIds(payload.genreIds),
      popularity: popularity.value,
      voteAverage: voteAverage.value,
      voteCount: voteCount.value,
      adult: payload.adult === true || payload.adult === 'true' || payload.adult === '1' || payload.adult === 1,
      mediaType: asOptionalString(payload.mediaType, 40),
      year: asOptionalString(payload.year, 12),
      type: asOptionalString(payload.type, 40),
      myNote: myNote.value,
      myRating: myRating.value,
      tags,
    },
  };
}

module.exports = {
  validateCommentInput,
  validateAdminContentInput,
  validateAdminContentUpdateInput,
};
