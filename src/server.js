const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');

// 환경변수 로드
dotenv.config();

const { initDb, db } = require('./storage');
const { requireAdmin, isAdminMiddleware } = require('./tokenAuth');
const { searchTmdbContents } = require('./tmdbApi');

const app = express();
const PORT = process.env.PORT || 3000;

// 뷰 엔진 설정 (EJS)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// 공통 미들웨어
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(process.env.ADMIN_PASSWORD || 'secret'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(isAdminMiddleware);

// 홈: 추천 콘텐츠 목록
app.get('/', async (req, res) => {
  const { contents } = db.data;
  res.render('home', { contents, isAdmin: req.isAdmin });
});

// 콘텐츠 상세 + 댓글
app.get('/content/:id', async (req, res) => {
  const id = req.params.id;
  const { contents, comments } = db.data;
  const content = contents.find((c) => c.id === id);
  if (!content) {
    return res.status(404).send('콘텐츠를 찾을 수 없습니다.');
  }
  const contentComments = comments.filter((cm) => cm.contentId === id);
  res.render('contentDetail', {
    content,
    comments: contentComments,
    isAdmin: req.isAdmin,
  });
});

// 댓글 작성 (로그인 불필요)
app.post('/content/:id/comments', async (req, res) => {
  const contentId = req.params.id;
  const { nickname, text } = req.body;

  if (!text || !nickname) {
    return res.status(400).send('닉네임과 댓글 내용을 입력해주세요.');
  }

  const id = Date.now().toString();
  db.data.comments.push({
    id,
    contentId,
    nickname,
    text,
    createdAt: new Date().toISOString(),
  });
  await db.write();

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
    return res.status(500).send('.env에 ADMIN_PASSWORD를 설정해주세요.');
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

// 관리자: 새 콘텐츠 등록 페이지
app.get('/admin/new', requireAdmin, (req, res) => {
  res.render('adminNew', { isAdmin: true });
});

// TMDB 검색 프록시 (관리자 전용)
app.get('/api/tmdb/search', requireAdmin, async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: 'q 쿼리 파라미터가 필요합니다.' });
  }

  try {
    const results = await searchTmdbContents(query);
    res.json(results);
  } catch (err) {
    // TMDB에서 내려준 에러 메시지를 함께 전달
    console.error('TMDB 검색 오류:', err.response?.data || err.message);
    const apiErrorMessage = err.response?.data?.errorMessage;
    res.status(500).json({
      error:
        apiErrorMessage || 'TMDB 검색 중 오류가 발생했습니다. (서버 로그를 확인하세요.)',
    });
  }
});

// 콘텐츠 등록 (관리자 전용)
app.post('/admin/content', requireAdmin, async (req, res) => {
  const {
    tmdbId,
    title,
    posterUrl,
    year,
    type,
    myNote,
    myRating,
    tags,
  } = req.body;

  if (!tmdbId || !title || !myNote || !myRating) {
    return res.status(400).send('필수 값이 누락되었습니다.');
  }

  const id = Date.now().toString();
  const tagList =
    typeof tags === 'string'
      ? tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  db.data.contents.push({
    id,
    tmdbId,
    title,
    posterUrl,
    year,
    type,
    myNote,
    myRating: Number(myRating),
    tags: tagList,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await db.write();

  res.redirect('/');
});

// 서버 시작
initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
});

