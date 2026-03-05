const express = require('express');
const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');

// 환경 변수 로드
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const { prisma } = require('./prisma');
const { requireAdmin, isAdminMiddleware } = require('./tokenAuth');
const { getCommentSummary } = require('./utils/commentSummaryService');
const {
  validateCommentInput,
  validateAdminContentInput,
  validateAdminContentUpdateInput,
} = require('./utils/validators');
const {
  searchTmdbContents,
  resolveGenreNames,
  resolveGenreNamesForContents,
} = require('./tmdbApi');

const app = express();
const PORT = process.env.PORT || 3000;
const COMMENT_SUMMARY_CACHE_TTL_MS = 30 * 1000;
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const SSE_KEEPALIVE_MS = 25 * 1000;
let commentSummaryCache = {
  expiresAt: 0,
  value: null,
};
const commentSummarySubscribers = new Set();

function shouldLog(level) {
  const order = { error: 0, warn: 1, info: 2, debug: 3 };
  const current = order[LOG_LEVEL] ?? order.info;
  return (order[level] ?? order.info) <= current;
}

function log(level, message, payload) {
  if (!shouldLog(level)) return;
  if (payload !== undefined) {
    console[level](`[${level.toUpperCase()}] ${message}`, payload);
    return;
  }
  console[level](`[${level.toUpperCase()}] ${message}`);
}

function buildRequestId() {
  return crypto.randomBytes(8).toString('hex');
}

function buildSummaryEtag(summary) {
  const serialized = JSON.stringify(summary);
  const hash = crypto.createHash('sha1').update(serialized).digest('hex');
  return `W/"${hash}"`;
}

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

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Please configure it in environment variables.');
  process.exit(1);
}

function invalidateCommentSummaryCache() {
  commentSummaryCache = {
    expiresAt: 0,
    value: null,
  };
}

function sendSummaryForSse(res, summary) {
  res.write(`event: summary\n`);
  res.write(`data: ${JSON.stringify(summary)}\n\n`);
}

async function broadcastCommentSummaryUpdate() {
  if (commentSummarySubscribers.size === 0) return;
  try {
    const summary = await getCachedCommentSummary();
    for (const client of commentSummarySubscribers) {
      sendSummaryForSse(client, summary);
    }
  } catch (error) {
    log('warn', 'Failed to broadcast comment summary update', error);
  }
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

// 뷰 엔진 설정 (EJS)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// 공통 미들웨어
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(process.env.ADMIN_PASSWORD || 'secret'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use((req, res, next) => {
  req.requestId = buildRequestId();
  res.locals.requestId = req.requestId;

  const startedAt = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/assets/') || req.path.startsWith('/styles/')) return;
    log(
      'info',
      `${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - startedAt}ms) [${req.requestId}]`
    );
  });

  next();
});
app.use(isAdminMiddleware);
app.use(async (req, res, next) => {
  res.locals.totalCommentCount = 0;
  res.locals.commentSummaryList = [];

  if (req.path.startsWith('/api') || req.path === '/healthz') {
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

// 추천 콘텐츠 목록
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

app.get('/healthz', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      uptimeSec: Math.floor(process.uptime()),
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log('error', 'Health check failed', error);
    res.status(503).json({
      status: 'degraded',
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
    });
  }
});

app.get('/api/comments/summary', async (req, res) => {
  try {
    const summary = await getCachedCommentSummary();
    const etag = buildSummaryEtag(summary);
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, max-age=10, must-revalidate');
    res.json(summary);
  } catch (error) {
    log('error', 'Failed to fetch comment summary', error);
    res.status(500).json({
      totalCommentCount: 0,
      commentSummaryList: [],
      error: 'failed_to_fetch_comment_summary',
    });
  }
});

app.get('/api/comments/summary/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  commentSummarySubscribers.add(res);
  log('debug', `SSE subscriber connected (${commentSummarySubscribers.size})`);

  try {
    const summary = await getCachedCommentSummary();
    sendSummaryForSse(res, summary);
  } catch (error) {
    log('warn', 'Failed to send initial SSE summary', error);
  }

  const keepAliveTimer = setInterval(() => {
    res.write(': ping\n\n');
  }, SSE_KEEPALIVE_MS);

  req.on('close', () => {
    clearInterval(keepAliveTimer);
    commentSummarySubscribers.delete(res);
    log('debug', `SSE subscriber disconnected (${commentSummarySubscribers.size})`);
  });
});

// 콘텐츠 상세 + 댓글
app.get('/content/:id', async (req, res) => {
  const id = req.params.id;
  const content = await prisma.content.findUnique({ where: { id } });
  if (!content) {
    return res.status(404).send('콘텐츠를 찾을 수 없습니다.');
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

// 댓글 작성 (로그인 불필요)
app.post('/content/:id/comments', async (req, res) => {
  const contentId = req.params.id;
  const validation = validateCommentInput(req.body || {});
  if (!validation.ok) {
    return res.status(400).send(validation.error);
  }

  const id = crypto.randomUUID();
  await prisma.comment.create({
    data: {
      id,
      contentId,
      nickname: validation.value.nickname,
      text: validation.value.text,
    },
  });
  invalidateCommentSummaryCache();
  void broadcastCommentSummaryUpdate();

  res.redirect(`/content/${contentId}`);
});

// 관리자 로그인 페이지
app.get('/admin/login', (req, res) => {
  res.render('adminLogin', { isAdmin: req.isAdmin, error: null });
});

// 관리자 로그인 처리
app.post('/admin/login', (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(500).send('ADMIN_PASSWORD 환경 변수를 설정해 주세요.');
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
    error: '비밀번호가 일치하지 않습니다.',
  });
});

// 관리자: 추천 콘텐츠 등록 페이지
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

// TMDB 검색 API (관리자 전용)
app.get('/api/tmdb/search', requireAdmin, async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'q 쿼리 파라미터가 필요합니다.' });
  }

  try {
    const results = await searchTmdbContents(query);
    res.json(results);
  } catch (err) {
    // TMDB에서 내려준 에러 메시지를 가능한 그대로 전달
    console.error('TMDB 검색 오류:', err.response?.data || err.message);
    const apiErrorMessage = err.response?.data?.errorMessage;
    res.status(500).json({
      error:
        apiErrorMessage || 'TMDB 검색 중 오류가 발생했습니다. (서버 로그를 확인해 주세요.)',
    });
  }
});

// 콘텐츠 등록 (관리자 전용)
app.post('/admin/content', requireAdmin, async (req, res) => {
  const validation = validateAdminContentInput(req.body || {}, parseTagList, parseGenreIds);
  if (!validation.ok) {
    return res.status(400).send(validation.error);
  }
  const payload = validation.value;

  const id = crypto.randomUUID();

  await prisma.content.create({
    data: {
      id,
      ...payload,
    },
  });
  invalidateCommentSummaryCache();
  void broadcastCommentSummaryUpdate();

  res.redirect('/');
});

// 관리자: 추천 콘텐츠 수정 페이지
app.get('/admin/content/:id/edit', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const content = await prisma.content.findUnique({ where: { id } });
  if (!content) {
    return res.status(404).send('콘텐츠를 찾을 수 없습니다.');
  }
  res.render('adminEdit', { isAdmin: true, content });
});

// 관리자: 추천 콘텐츠 수정
app.post('/admin/content/:id/edit', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const current = await prisma.content.findUnique({ where: { id } });
  if (!current) {
    return res.status(404).send('콘텐츠를 찾을 수 없습니다.');
  }
  const validation = validateAdminContentUpdateInput(req.body || {}, parseTagList, parseGenreIds);
  if (!validation.ok) {
    return res.status(400).send(validation.error);
  }

  await prisma.content.update({
    where: { id },
    data: validation.value,
  });
  invalidateCommentSummaryCache();
  void broadcastCommentSummaryUpdate();
  res.redirect(`/content/${id}`);
});

// 관리자: 추천 콘텐츠 삭제
app.post('/admin/content/:id/delete', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const content = await prisma.content.findUnique({ where: { id } });
  if (!content) {
    return res.status(404).send('콘텐츠를 찾을 수 없습니다.');
  }

  await prisma.$transaction([
    prisma.comment.deleteMany({ where: { contentId: id } }),
    prisma.content.delete({ where: { id } }),
  ]);
  invalidateCommentSummaryCache();
  void broadcastCommentSummaryUpdate();

  res.redirect('/');
});

app.use((req, res) => {
  if (req.originalUrl && req.originalUrl.startsWith('/api')) {
    return res.status(404).json({ error: 'not_found', requestId: req.requestId });
  }
  return res.status(404).render('error', {
    title: '페이지를 찾을 수 없습니다',
    message: '요청한 페이지가 없거나 이동되었습니다.',
    statusCode: 404,
    requestId: req.requestId,
    isAdmin: req.isAdmin,
  });
});

app.use((err, req, res, next) => {
  log('error', `Unhandled error on ${req.method} ${req.originalUrl} [${req.requestId}]`, err);
  if (req.originalUrl && req.originalUrl.startsWith('/api')) {
    return res.status(500).json({ error: 'internal_server_error', requestId: req.requestId });
  }
  return res.status(500).render('error', {
    title: '서버 오류가 발생했습니다',
    message: '잠시 후 다시 시도해 주세요.',
    statusCode: 500,
    requestId: req.requestId,
    isAdmin: req.isAdmin,
  });
});

// 서버 시작
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

