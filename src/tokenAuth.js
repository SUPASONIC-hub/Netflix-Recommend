const crypto = require('crypto');

const ADMIN_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function toBase64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createAdminSessionToken(secret) {
  const payloadObject = {
    iat: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  const payload = JSON.stringify(payloadObject);
  const encodedPayload = toBase64Url(payload);
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function verifyAdminSessionToken(token, secret, maxAgeMs = ADMIN_SESSION_MAX_AGE_MS) {
  if (typeof token !== 'string' || !token.includes('.')) return false;
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return false;

  const expectedSignature = signPayload(encodedPayload, secret);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  const isValidSignature = crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  if (!isValidSignature) return false;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!payload || typeof payload.iat !== 'number') return false;
    if (Date.now() - payload.iat > maxAgeMs) return false;
    return true;
  } catch {
    return false;
  }
}

function isAdminMiddleware(req, res, next) {
  const cookieSecret = req.app.locals.cookieSecret || process.env.COOKIE_SECRET;
  const token = req.signedCookies?.adminToken;
  req.isAdmin = !!(
    cookieSecret &&
    token &&
    verifyAdminSessionToken(token, cookieSecret, ADMIN_SESSION_MAX_AGE_MS)
  );
  next();
}

function requireAdmin(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).send('관리자만 접근 가능합니다.');
  }
  next();
}

module.exports = {
  ADMIN_SESSION_MAX_AGE_MS,
  createAdminSessionToken,
  verifyAdminSessionToken,
  isAdminMiddleware,
  requireAdmin,
};
