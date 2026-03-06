const express = require('express');
const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// ?섍꼍 蹂??濡쒕뱶
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const { prisma } = require('./prisma');
const { asyncHandler } = require('./utils/asyncHandler');
const { selectCsrfCandidate, isValidCsrfToken } = require('./utils/csrf');
const { resolvePageParams, buildHomeOrderBy } = require('./utils/homeQuery');
const {
  ADMIN_SESSION_MAX_AGE_MS,
  createAdminSessionToken,
  requireAdmin,
  isAdminMiddleware,
} = require('./tokenAuth');
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
  resolveGenreNamesToIds,
} = require('./tmdbApi');

const app = express();
const PORT = process.env.PORT || 3000;
const COMMENT_SUMMARY_CACHE_TTL_MS = 30 * 1000;
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase();
const SSE_KEEPALIVE_MS = 25 * 1000;
const CSRF_COOKIE_NAME = 'csrfToken';
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

function getCookieSecret() {
  const secret = process.env.COOKIE_SECRET;
  if (secret) return secret;

  if (process.env.NODE_ENV === 'production') {
    console.error('COOKIE_SECRET is not set. Please configure it in environment variables.');
    process.exit(1);
  }

  const fallback = 'dev-cookie-secret';
  log('warn', 'COOKIE_SECRET is not set. Using insecure development fallback secret.');
  return fallback;
}

const cookieSecret = getCookieSecret();
app.locals.cookieSecret = cookieSecret;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Please configure it in environment variables.');
  process.exit(1);
}

function issueCsrfToken(res) {
  const token = crypto.randomBytes(24).toString('hex');
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: true,
    signed: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  return token;
}

function ensureCsrfToken(req, res, next) {
  const existing = req.signedCookies?.[CSRF_COOKIE_NAME];
  const token = typeof existing === 'string' && existing ? existing : issueCsrfToken(res);
  res.locals.csrfToken = token;
  next();
}

function requireCsrf(req, res, next) {
  const cookieToken = req.signedCookies?.[CSRF_COOKIE_NAME];
  const bodyToken = typeof req.body?._csrf === 'string' ? req.body._csrf : '';
  const headerToken =
    typeof req.headers['x-csrf-token'] === 'string' ? req.headers['x-csrf-token'] : '';
  const candidate = selectCsrfCandidate(bodyToken, headerToken);

  if (!isValidCsrfToken(cookieToken, candidate)) {
    return res.status(403).send('Invalid CSRF token');
  }

  return next();
}

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) =>
    res.status(429).render('adminLogin', {
      isAdmin: false,
      error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
    }),
});

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

// 酉??붿쭊 ?ㅼ젙 (EJS)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// 怨듯넻 誘몃뱾?⑥뼱
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(cookieSecret));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdn.jsdelivr.net',
          'https://fonts.googleapis.com',
        ],
        imgSrc: ["'self'", 'data:', 'https://image.tmdb.org', 'https:'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(ensureCsrfToken);
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

// 異붿쿇 肄섑뀗痢?紐⑸줉
app.get('/', asyncHandler(async (req, res) => {
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
  const { page, pageSize } = resolvePageParams(req.query);

  const normalizedGenres = selectedGenres.length
    ? selectedGenres
    : selectedGenre
    ? [selectedGenre]
    : [];

  const where = {};
  if (searchQuery) {
    where.OR = [
      { title: { contains: searchQuery, mode: 'insensitive' } },
      { name: { contains: searchQuery, mode: 'insensitive' } },
      { overview: { contains: searchQuery, mode: 'insensitive' } },
      { myNote: { contains: searchQuery, mode: 'insensitive' } },
      { tags: { has: searchQuery } },
    ];
  }

  if (normalizedGenres.length) {
    const selectedGenreIds = await resolveGenreNamesToIds(normalizedGenres);
    if (selectedGenreIds.length === 0) {
      return res.render('home', {
        contents: [],
        isAdmin: req.isAdmin,
        selectedGenre,
        selectedGenres: normalizedGenres,
        searchQuery,
        sort,
        page,
        pageSize,
        totalItems: 0,
        totalPages: 1,
        totalCommentCount: res.locals.totalCommentCount,
        commentSummaryList: res.locals.commentSummaryList,
      });
    }
    where.genreIds = { hasSome: selectedGenreIds };
  }

  const orderBy = buildHomeOrderBy(sort);

  const totalItems = await prisma.content.count({ where });
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, totalPages);
  const skip = (safePage - 1) * pageSize;

  const contents = await prisma.content.findMany({
    where,
    orderBy,
    skip,
    take: pageSize,
  });
  const contentsWithGenres = await resolveGenreNamesForContents(contents);


  res.render('home', {
    contents: contentsWithGenres,
    isAdmin: req.isAdmin,
    selectedGenre,
    selectedGenres: normalizedGenres,
    searchQuery,
    sort,
    page: safePage,
    pageSize,
    totalItems,
    totalPages,
    totalCommentCount: res.locals.totalCommentCount,
    commentSummaryList: res.locals.commentSummaryList,
  });
}));

app.get('/healthz', asyncHandler(async (req, res) => {
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
}));

app.get('/api/comments/summary', asyncHandler(async (req, res) => {
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
}));

app.get('/api/comments/summary/stream', asyncHandler(async (req, res) => {
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
}));

// 肄섑뀗痢??곸꽭 + ?볤?
app.get('/content/:id', asyncHandler(async (req, res) => {
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
}));

// ?볤? ?묒꽦 (濡쒓렇??遺덊븘??
app.post('/content/:id/comments', asyncHandler(async (req, res) => {
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
}));

// 愿由ъ옄 濡쒓렇???섏씠吏
app.get('/admin/login', (req, res) => {
  res.render('adminLogin', { isAdmin: req.isAdmin, error: null });
});

// 愿由ъ옄 濡쒓렇??泥섎━
app.post('/admin/login', adminLoginLimiter, requireCsrf, (req, res) => {
  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword) {
    return res.status(500).send('ADMIN_PASSWORD 환경 변수를 설정해 주세요.');
  }

  if (password === adminPassword) {
    const sessionToken = createAdminSessionToken(cookieSecret);
    res.cookie('adminToken', sessionToken, {
      httpOnly: true,
      signed: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: ADMIN_SESSION_MAX_AGE_MS,
    });
    return res.redirect('/admin/new');
  }

  res.status(401).render('adminLogin', {
    isAdmin: false,
    error: '비밀번호가 일치하지 않습니다.',
  });
});

app.post('/admin/logout', requireAdmin, requireCsrf, (req, res) => {
  res.clearCookie('adminToken');
  res.redirect('/');
});

// 愿由ъ옄: 異붿쿇 肄섑뀗痢??깅줉 ?섏씠吏
app.get('/admin/new', requireAdmin, asyncHandler(async (req, res) => {
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
}));

// TMDB 寃??API (愿由ъ옄 ?꾩슜)
app.get('/api/tmdb/search', requireAdmin, asyncHandler(async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'q 쿼리 파라미터가 필요합니다.' });
  }

  try {
    const results = await searchTmdbContents(query);
    res.json(results);
  } catch (err) {
    // TMDB?먯꽌 ?대젮以 ?먮윭 硫붿떆吏瑜?媛?ν븳 洹몃?濡??꾨떖
    console.error('TMDB 寃???ㅻ쪟:', err.response?.data || err.message);
    const apiErrorMessage = err.response?.data?.errorMessage;
    res.status(500).json({
      error:
        apiErrorMessage || 'TMDB 寃??以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎. (?쒕쾭 濡쒓렇瑜??뺤씤??二쇱꽭??)',
    });
  }
}));

// 肄섑뀗痢??깅줉 (愿由ъ옄 ?꾩슜)
app.post('/admin/content', requireAdmin, requireCsrf, asyncHandler(async (req, res) => {
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
}));

// 愿由ъ옄: 異붿쿇 肄섑뀗痢??섏젙 ?섏씠吏
app.get('/admin/content/:id/edit', requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const content = await prisma.content.findUnique({ where: { id } });
  if (!content) {
    return res.status(404).send('콘텐츠를 찾을 수 없습니다.');
  }
  res.render('adminEdit', { isAdmin: true, content });
}));

// 愿由ъ옄: 異붿쿇 肄섑뀗痢??섏젙
app.post('/admin/content/:id/edit', requireAdmin, requireCsrf, asyncHandler(async (req, res) => {
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
}));

// 愿由ъ옄: 異붿쿇 肄섑뀗痢???젣
app.post('/admin/content/:id/delete', requireAdmin, requireCsrf, asyncHandler(async (req, res) => {
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
}));

app.use((req, res) => {
  if (req.originalUrl && req.originalUrl.startsWith('/api')) {
    return res.status(404).json({ error: 'not_found', requestId: req.requestId });
  }
  return res.status(404).render('error', {
    title: '페이지를 찾을 수 없습니다',
    message: '요청하신 페이지가 없거나 이동되었습니다.',
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





