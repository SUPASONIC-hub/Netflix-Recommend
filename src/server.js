const express = require('express');
const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');

// ?섍꼍蹂??濡쒕뱶
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const { prisma } = require('./prisma');
const { requireAdmin, isAdminMiddleware } = require('./tokenAuth');
const { getCommentSummary } = require('./utils/commentSummaryService');
const {
  searchTmdbContents,
  resolveGenreNames,
  resolveGenreNamesForContents,
} = require('./tmdbApi');

const app = express();
const PORT = process.env.PORT || 3000;
const COMMENT_SUMMARY_CACHE_TTL_MS = 20 * 1000;
let commentSummaryCache = {
  expiresAt: 0,
  value: null,
};

function parseTagList(tags) {
  return typeof tags === 'string'
    ? tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
}

function parseGenreIds(genreIds) {
  let parsedGenreIds = [];
  if (typeof genreIds === 'string' && genreIds.trim()) {
    try {
      const jsonValue = JSON.parse(genreIds);
      if (Array.isArray(jsonValue)) {
        parsedGenreIds = jsonValue
          .map((v) => Number(v))
          .filter((v) => !Number.isNaN(v));
      }
    } catch {
      parsedGenreIds = genreIds
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((v) => !Number.isNaN(v));
    }
  }
  return parsedGenreIds;
}

function invalidateCommentSummaryCache() {
  commentSummaryCache = {
    expiresAt: 0,
    value: null,
  };
}

async function getCachedCommentSummary() {
  const now = Date.now();
  if (commentSummaryCache.value && now < commentSummaryCache.expiresAt) {
    return commentSummaryCache.value;
  }

  const summary = await getCommentSummary(prisma);
  commentSummaryCache = {
    expiresAt: now + COMMENT_SUMMARY_CACHE_TTL_MS,
    value: summary,
  };
  return summary;
}

// 酉??붿쭊 ?ㅼ젙 (EJS)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// 怨듯넻 誘몃뱾?⑥뼱
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(process.env.ADMIN_PASSWORD || 'secret'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(isAdminMiddleware);
app.use(async (req, res, next) => {
  res.locals.totalCommentCount = 0;
  res.locals.commentSummaryList = [];

  if (req.path.startsWith('/api')) {
    return next();
  }

  try {
    const summary = await getCachedCommentSummary();
    res.locals.commentSummaryList = summary.commentSummaryList;
    res.locals.totalCommentCount = summary.totalCommentCount;
  } catch (error) {
    console.error('Failed to build comment summary locals:', error);
  }

  next();
});

// ??異붿쿇 肄섑뀗痢?紐⑸줉
app.get('/', async (req, res) => {
  const contents = await prisma.content.findMany();
  const contentsWithGenres = await resolveGenreNamesForContents(contents);

  const selectedGenre = typeof req.query.genre === 'string' ? req.query.genre : '';
  const selectedGenres = Array.isArray(req.query.genres)
    ? req.query.genres.map((g) => String(g).trim()).filter(Boolean)
    : typeof req.query.genres === 'string'
    ? req.query.genres
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean)
    : [];
  const searchQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const sort = typeof req.query.sort === 'string' ? req.query.sort : '';

  const normalizedGenres = selectedGenres.length
    ? selectedGenres
    : selectedGenre
    ? [selectedGenre]
    : [];

  const filteredByGenre = normalizedGenres.length
    ? contentsWithGenres.filter((c) =>
        Array.isArray(c.genreNames)
          ? normalizedGenres.some((g) => c.genreNames.includes(g))
          : false
      )
    : contentsWithGenres;

  const filteredBySearch = searchQuery
    ? filteredByGenre.filter((c) => {
        const haystack = [
          c.title,
          c.name,
          c.overview,
          c.myNote,
          Array.isArray(c.tags) ? c.tags.join(' ') : '',
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(searchQuery.toLowerCase());
      })
    : filteredByGenre;

  const sorted = [...filteredBySearch];
  if (sort === 'vote') {
    sorted.sort(
      (a, b) => (b.voteAverage || -1) - (a.voteAverage || -1)
    );
  } else if (sort === 'pop') {
    sorted.sort((a, b) => (b.popularity || -1) - (a.popularity || -1));
  } else if (sort === 'recent') {
    sorted.sort(
      (a, b) =>
        new Date(b.releaseDate || b.firstAirDate || b.year || 0) -
        new Date(a.releaseDate || a.firstAirDate || a.year || 0)
    );
  }


  res.render('home', {
    contents: sorted,
    isAdmin: req.isAdmin,
    selectedGenre,
    selectedGenres: normalizedGenres,
    searchQuery,
    sort,
    totalCommentCount: res.locals.totalCommentCount,
    commentSummaryList: res.locals.commentSummaryList,
  });
});

app.get('/api/comments/summary', async (req, res) => {
  try {
    const summary = await getCachedCommentSummary();
    res.json(summary);
  } catch (error) {
    console.error('Failed to fetch comment summary:', error);
    res.status(500).json({
      totalCommentCount: 0,
      commentSummaryList: [],
      error: 'failed_to_fetch_comment_summary',
    });
  }
});

// 肄섑뀗痢??곸꽭 + ?볤?
app.get('/content/:id', async (req, res) => {
  const id = req.params.id;
  const content = await prisma.content.findUnique({ where: { id } });
  if (!content) {
    return res.status(404).send('肄섑뀗痢좊? 李얠쓣 ???놁뒿?덈떎.');
  }
  const genreNames = await resolveGenreNames(
    content.genreIds,
    content.mediaType || content.type
  );
  const contentComments = await prisma.comment.findMany({
    where: { contentId: id },
    orderBy: { createdAt: 'asc' },
  });
  res.render('contentDetail', {
    content: { ...content, genreNames },
    comments: contentComments,
    isAdmin: req.isAdmin,
  });
});

// ?볤? ?묒꽦 (濡쒓렇??遺덊븘??
app.post('/content/:id/comments', async (req, res) => {
  const contentId = req.params.id;
  const { nickname, text } = req.body;

  if (!text || !nickname) {
    return res.status(400).send('?됰꽕?꾧낵 ?볤? ?댁슜???낅젰??二쇱꽭??');
  }

  const id = crypto.randomUUID();
  await prisma.comment.create({
    data: {
      id,
      contentId,
      nickname,
      text,
    },
  });
  invalidateCommentSummaryCache();

  res.redirect(`/content/${contentId}`);
});

// 愿由ъ옄 濡쒓렇???섏씠吏
app.get('/admin/login', (req, res) => {
  res.render('adminLogin', { isAdmin: req.isAdmin, error: null });
});

// 愿由ъ옄 濡쒓렇??泥섎━
app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(500).send('ADMIN_PASSWORD ?섍꼍 蹂?섎? ?ㅼ젙??二쇱꽭??');
  }

  if (password === adminPassword) {
    res.cookie('adminToken', adminPassword, {
      httpOnly: true,
      signed: true,
    });
    return res.redirect('/admin/new');
  }

  res.status(401).render('adminLogin', {
    isAdmin: false,
    error: '鍮꾨?踰덊샇媛 ?쇱튂?섏? ?딆뒿?덈떎.',
  });
});

// 愿由ъ옄: 異붿쿇 肄섑뀗痢??깅줉 ?섏씠吏
app.get('/admin/new', requireAdmin, async (req, res) => {
  const manageQuery =
    typeof req.query.manageQ === 'string' ? req.query.manageQ.trim() : '';
  const manageSort =
    req.query.manageSort === 'rating' || req.query.manageSort === 'latest'
      ? req.query.manageSort
      : 'latest';

  const allContents = await prisma.content.findMany();
  const filtered = manageQuery
    ? allContents.filter((c) =>
        String(c.title || c.name || '')
          .toLowerCase()
          .includes(manageQuery.toLowerCase())
      )
    : [...allContents];

  const contents = [...filtered].sort((a, b) => {
    if (manageSort === 'rating') {
      return (Number(b.myRating) || -1) - (Number(a.myRating) || -1);
    }
    const aTime = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bTime - aTime;
  });

  res.render('adminNew', { isAdmin: true, contents, manageQuery, manageSort });
});

// TMDB 寃??API (愿由ъ옄 ?꾩슜)
app.get('/api/tmdb/search', requireAdmin, async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'q 荑쇰━ ?뚮씪誘명꽣媛 ?꾩슂?⑸땲??' });
  }

  try {
    const results = await searchTmdbContents(query);
    res.json(results);
  } catch (err) {
    // TMDB?먯꽌 ?대젮???먮윭 硫붿떆吏瑜?理쒕???洹몃?濡??꾨떖
    console.error('TMDB 寃???ㅻ쪟:', err.response?.data || err.message);
    const apiErrorMessage = err.response?.data?.errorMessage;
    res.status(500).json({
      error:
        apiErrorMessage || 'TMDB 寃??以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎. (?쒕쾭 濡쒓렇瑜??뺤씤??二쇱꽭??)',
    });
  }
});

// 肄섑뀗痢??깅줉 (愿由ъ옄 ?꾩슜)
app.post('/admin/content', requireAdmin, async (req, res) => {
  const {
    tmdbId,
    title,
    name,
    overview,
    releaseDate,
    firstAirDate,
    posterPath,
    posterUrl,
    backdropPath,
    genreIds,
    popularity,
    voteAverage,
    voteCount,
    adult,
    mediaType,
    year,
    type,
    myNote,
    myRating,
    tags,
  } = req.body;

  if (!tmdbId || !(title || name) || !myNote || !myRating) {
    return res.status(400).send('?꾩닔 媛믪씠 ?꾨씫?섏뿀?듬땲??');
  }

  const id = crypto.randomUUID();
  const tagList = parseTagList(tags);
  const parsedGenreIds = parseGenreIds(genreIds);

  await prisma.content.create({
    data: {
      id,
      tmdbId,
      title: title || name || '',
      name: name || '',
      overview: overview || '',
      releaseDate: releaseDate || '',
      firstAirDate: firstAirDate || '',
      posterPath: posterPath || '',
      posterUrl: posterUrl || '',
      backdropPath: backdropPath || '',
      genreIds: parsedGenreIds,
      popularity:
        typeof popularity === 'string' && popularity.trim()
          ? Number(popularity)
          : typeof popularity === 'number'
          ? popularity
          : null,
      voteAverage:
        typeof voteAverage === 'string' && voteAverage.trim()
          ? Number(voteAverage)
          : typeof voteAverage === 'number'
          ? voteAverage
          : null,
      voteCount:
        typeof voteCount === 'string' && voteCount.trim()
          ? Number(voteCount)
          : typeof voteCount === 'number'
          ? voteCount
          : null,
      adult:
        adult === true ||
        adult === 'true' ||
        adult === '1' ||
        adult === 1,
      mediaType: mediaType || '',
      year: year || '',
      type: type || '',
      myNote,
      myRating: Number(myRating),
      tags: tagList,
    },
  });
  invalidateCommentSummaryCache();

  res.redirect('/');
});

// 愿由ъ옄: 異붿쿇 肄섑뀗痢??섏젙 ?섏씠吏
app.get('/admin/content/:id/edit', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const content = await prisma.content.findUnique({ where: { id } });
  if (!content) {
    return res.status(404).send('肄섑뀗痢좊? 李얠쓣 ???놁뒿?덈떎.');
  }
  res.render('adminEdit', { isAdmin: true, content });
});

// 愿由ъ옄: 異붿쿇 肄섑뀗痢??섏젙
app.post('/admin/content/:id/edit', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const current = await prisma.content.findUnique({ where: { id } });
  if (!current) {
    return res.status(404).send('肄섑뀗痢좊? 李얠쓣 ???놁뒿?덈떎.');
  }
  const {
    title,
    name,
    overview,
    releaseDate,
    firstAirDate,
    posterPath,
    posterUrl,
    backdropPath,
    genreIds,
    popularity,
    voteAverage,
    voteCount,
    adult,
    mediaType,
    year,
    type,
    myNote,
    myRating,
    tags,
  } = req.body;

  if (!(title || name) || !myNote || !myRating) {
    return res.status(400).send('?꾩닔 媛믪씠 ?꾨씫?섏뿀?듬땲??');
  }

  await prisma.content.update({
    where: { id },
    data: {
      title: title || name || '',
      name: name || '',
      overview: overview || '',
      releaseDate: releaseDate || '',
      firstAirDate: firstAirDate || '',
      posterPath: posterPath || '',
      posterUrl: posterUrl || '',
      backdropPath: backdropPath || '',
      genreIds: parseGenreIds(genreIds),
      popularity:
        typeof popularity === 'string' && popularity.trim()
          ? Number(popularity)
          : typeof popularity === 'number'
          ? popularity
          : null,
      voteAverage:
        typeof voteAverage === 'string' && voteAverage.trim()
          ? Number(voteAverage)
          : typeof voteAverage === 'number'
          ? voteAverage
          : null,
      voteCount:
        typeof voteCount === 'string' && voteCount.trim()
          ? Number(voteCount)
          : typeof voteCount === 'number'
          ? voteCount
          : null,
      adult:
        adult === true ||
        adult === 'true' ||
        adult === '1' ||
        adult === 1,
      mediaType: mediaType || '',
      year: year || '',
      type: type || '',
      myNote,
      myRating: Number(myRating),
      tags: parseTagList(tags),
    },
  });
  invalidateCommentSummaryCache();
  res.redirect(`/content/${id}`);
});

// 愿由ъ옄: 異붿쿇 肄섑뀗痢???젣
app.post('/admin/content/:id/delete', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const content = await prisma.content.findUnique({ where: { id } });
  if (!content) {
    return res.status(404).send('肄섑뀗痢좊? 李얠쓣 ???놁뒿?덈떎.');
  }

  await prisma.$transaction([
    prisma.comment.deleteMany({ where: { contentId: id } }),
    prisma.content.delete({ where: { id } }),
  ]);
  invalidateCommentSummaryCache();

  res.redirect('/');
});

// ?쒕쾭 ?쒖옉
prisma
  .$connect()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to database:', err);
    process.exit(1);
  });

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

