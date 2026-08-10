/**
 * routes/health.routes.js
 * GET /api/health — status kesiapan engine.
 */

const express = require('express');
const router = express.Router();
const { getHealth } = require('../controllers/health.controller');

router.get('/', getHealth);

module.exports = router;
