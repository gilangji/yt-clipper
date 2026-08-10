/**
 * routes/preview.routes.js
 * Routing untuk API Preview Video 9:16.
 */

const express = require('express');
const router = express.Router();
const { createVideoPreview, streamVideoPreview } = require('../controllers/preview.controller');
const { generalLimiter } = require('../middleware/rateLimiter');

// POST /api/preview/video-916 — generate / get cached preview 9:16
router.post('/video-916', generalLimiter, createVideoPreview);

// GET /api/preview/video/:filename — stream video preview MP4
router.get('/video/:filename', streamVideoPreview);

module.exports = router;
