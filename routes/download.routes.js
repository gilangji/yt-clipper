const express = require('express');
const router = express.Router();

const { downloadClip, startSourceDownload, downloadBatchZip } = require('../controllers/download.controller');
const { validateJobIdParam } = require('../middleware/validator');
const { generalLimiter } = require('../middleware/rateLimiter');

// GET /api/download/:id
router.get('/:id', generalLimiter, validateJobIdParam, downloadClip);

// POST /api/download
router.post('/', generalLimiter, startSourceDownload);

// POST /api/download/zip (Batch ZIP download)
router.post('/zip', generalLimiter, downloadBatchZip);

module.exports = router;
