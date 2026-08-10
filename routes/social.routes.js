/**
 * routes/social.routes.js
 */

const express = require('express');
const router = express.Router();
const { publishClip, generateCaption } = require('../controllers/social.controller');

router.post('/publish', publishClip);
router.post('/generate-caption', generateCaption);

module.exports = router;
