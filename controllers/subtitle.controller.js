/**
 * controllers/subtitle.controller.js
 * POST /api/subtitle/preview
 */

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const subtitleService = require('../services/subtitle.service');
const { ERROR_CODES } = require('../config/constants');

/**
 * Render PNG preview subtitle sesuai konfigurasi (template, ukuran, font, posisi).
 */
const renderPreview = asyncHandler(async (req, res) => {
  const {
    style = 'quick-brown-inv',
    fontSize = 'large',
    fontFamily = 'auto',
    textCase = 'uppercase',
    text = 'RAHASIA\nSUKSES 2026',
    width = 720,
    height = 1280,
  } = req.body || {};

  if (typeof style !== 'string' || !style.trim()) {
    throw AppError.badRequest('Style wajib diisi.', ERROR_CODES.VALIDATION_ERROR);
  }

  const pngPath = await subtitleService.renderSubtitlePreview({
    style,
    fontSize,
    fontFamily,
    textCase,
    text,
    width,
    height,
  });

  res.type('image/png');
  res.sendFile(pngPath, (err) => {
    if (err) {
      // File preview di temp akan dibersihkan scheduler; abaikan error sendFile
    }
  });
});

module.exports = { renderPreview };