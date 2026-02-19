function isAdminMiddleware(req, res, next) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const token = req.signedCookies?.adminToken;
  req.isAdmin = !!(adminPassword && token === adminPassword);
  next();
}

function requireAdmin(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).send('관리자만 접근 가능합니다.');
  }
  next();
}

module.exports = {
  isAdminMiddleware,
  requireAdmin,
};
