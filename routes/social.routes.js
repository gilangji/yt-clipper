/**
 * routes/social.routes.js
 */

const express = require('express');
const router = express.Router();
const { publishClip, generateCaption, manageGeminiKeys } = require('../controllers/social.controller');

router.post('/publish', publishClip);
router.post('/generate-caption', generateCaption);
router.post('/keys', manageGeminiKeys);
router.get('/keys', manageGeminiKeys);

module.exports = router;
