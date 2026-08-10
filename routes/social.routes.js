/**
 * routes/social.routes.js
 */

const express = require('express');
const router = express.Router();
const { publishClip } = require('../controllers/social.controller');

router.post('/publish', publishClip);

module.exports = router;
