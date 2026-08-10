/**
 * routes/subtitle.routes.js
 * POST /api/subtitle/preview
 */

const express = require('express');
const router = express.Router();

const { renderPreview } = require('../controllers/subtitle.controller');

// POST /api/subtitle/preview — render PNG contoh subtitle
router.post('/preview', renderPreview);

module.exports = router;