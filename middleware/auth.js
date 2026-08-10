/**
 * middleware/auth.js
 * Basic Authentication sederhana berbasis env.
 *
 * AKTIF hanya jika APP_USER DAN APP_PASS keduanya di-set:
 *   APP_USER=admin APP_PASS=rahasia node app.js
 * Jika salah satu kosong → middleware dilewati (auth nonaktif).
 *
 * Melindungi SEMUA route (UI, API, /downloads, /output) kecuali
 * /health & /api/health yang sengaja dibiarkan publik untuk monitoring.
 *
 * Perbandingan kredensial memakai timing-safe compare.
 */

const config = require('../config');

const AUTH_REALM = 'yt-clipper';

function timingSafeEqual(a, b) {
  // Fallback manual agar tidak bergantung pada crypto.timingSafeEqual
  // yang butuh Buffer dengan panjang sama.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function authEnabled() {
  return Boolean(config.security.authUser && config.security.authPass);
}

function isPublicPath(req) {
  return req.path === '/health' || req.path === '/api/health' || req.path === '/favicon.ico';
}

function parseBasicAuth(header) {
  if (!header || !header.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx === -1) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
  } catch (e) {
    return null;
  }
}

function auth(req, res, next) {
  if (!authEnabled() || isPublicPath(req)) return next();

  const cred = parseBasicAuth(req.headers.authorization);

  if (
    cred &&
    timingSafeEqual(cred.user, config.security.authUser) &&
    timingSafeEqual(cred.pass, config.security.authPass)
  ) {
    return next();
  }

  res.set('WWW-Authenticate', `Basic realm="${AUTH_REALM}", charset="UTF-8"`);
  return res.status(401).json({
    success: false,
    error: 'UNAUTHORIZED',
    message: 'Autentikasi diperlukan.',
  });
}

module.exports = auth;
