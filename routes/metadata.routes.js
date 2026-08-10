/**
 * routes/metadata.routes.js
 * POST /api/metadata/generate
 */

const express = require('express');
const router = express.Router();

const { generateMetadata } = require('../controllers/metadata.controller');

// POST /api/metadata/generate
router.post('/generate', generateMetadata);

module.exports = router;
