/**
 * middleware/security.js
 * Konfigurasi helmet & CORS. Diterapkan sekali di app.js.
 */

const helmet = require('helmet');
const cors = require('cors');
const config = require('../config');

function applySecurity(app) {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net"],
          imgSrc: ["'self'", 'data:', 'https:'], // thumbnail YouTube dari domain eksternal
          connectSrc: ["'self'", "https://tfhub.dev", "https://*.tfhub.dev", "https://storage.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  app.use(
    cors({
      origin: config.security.corsOrigin,
      methods: ['GET', 'POST', 'DELETE'],
    })
  );

  // Nonaktifkan header yang membocorkan info stack teknologi
  app.disable('x-powered-by');
}

module.exports = applySecurity;
