/**
 * routes/highlights.routes.js
 * Routing untuk API Deteksi Highlights.
 */

const express = require('express');
const router = express.Router();

const { getHighlights } = require('../controllers/highlights.controller');
const { generalLimiter } = require('../middleware/rateLimiter');

// POST /api/highlights
router.post('/', generalLimiter, getHighlights);

module.exports = router;
