function selectCsrfCandidate(bodyToken, headerToken) {
  return bodyToken || headerToken || '';
}

function isValidCsrfToken(cookieToken, candidateToken) {
  return (
    typeof cookieToken === 'string' &&
    cookieToken.length > 0 &&
    typeof candidateToken === 'string' &&
    candidateToken.length > 0 &&
    cookieToken === candidateToken
  );
}

module.exports = {
  selectCsrfCandidate,
  isValidCsrfToken,
};
