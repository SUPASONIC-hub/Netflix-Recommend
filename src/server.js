const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');

// 환경변수 로드
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const { prisma } = require('./prisma');
const { requireAdmin, isAdminMiddleware } = require('./tokenAuth');
const { searchTmdbContents, resolveGenreNames } = require('./tmdbApi');

const app = express();
const PORT = process.env.PORT || 3000;

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

// 뷰 엔진 설정 (EJS)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// 공통 미들웨어
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(process.env.ADMIN_PASSWORD || 'secret'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(isAdminMiddleware);

// 내 추천 콘텐츠 목록
app.get('/', async (req, res) => {
  const contents = await prisma.content.findMany();
  const contentsWithGenres = await Promise.all(
    contents.map(async (c) => {
      const genreNames = await resolveGenreNames(
        c.genreIds,
        c.mediaType || c.type
      );
      return { ...c, genreNames };
    })
  );

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
  const { nickname, text } = req.body;

  if (!text || !nickname) {
    return res.status(400).send('닉네임과 댓글 내용을 입력해 주세요.');
  }

  const id = Date.now().toString();
  await prisma.comment.create({
    data: {
      id,
      contentId,
      nickname,
      text,
    },
  });

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
    // TMDB에서 내려온 에러 메시지를 최대한 그대로 전달
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
    return res.status(400).send('필수 값이 누락되었습니다.');
  }

  const id = Date.now().toString();
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
    return res.status(400).send('필수 값이 누락되었습니다.');
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

  res.redirect('/');
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
