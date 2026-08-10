/**
 * routes/transcript.routes.js
 * POST /api/transcript — Transkrip full video ber-timestamp.
 */

const express = require('express');
const router = express.Router();
const { generalLimiter } = require('../middleware/rateLimiter');
const { getTranscript } = require('../controllers/transcript.controller');

router.post('/', generalLimiter, getTranscript);

module.exports = router;
