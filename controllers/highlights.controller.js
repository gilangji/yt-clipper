/**
 * controllers/highlights.controller.js
 * POST /api/highlights
 */

const path = require('path');
const fs = require('fs');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const highlightService = require('../services/highlight.service');
const { fileExists } = require('../utils/fileHelper');
const config = require('../config');
const { ERROR_CODES } = require('../config/constants');

/**
 * Menganalisis video sumber untuk mendeteksi highlights.
 */
const getHighlights = asyncHandler(async (req, res) => {
  const { videoPath, video_path } = req.body;
  const targetName = videoPath || video_path;

  if (!targetName) {
    throw AppError.badRequest('Nama file video tidak boleh kosong.', ERROR_CODES.VALIDATION_ERROR);
  }

  // Resolve path ke folder downloads
  const baseName = path.basename(targetName);
  let absolutePath = path.join(config.folders.downloads, baseName);

  if (!fileExists(absolutePath)) {
    // Jika tidak ditemukan, coba cari file dengan videoId yang sama tapi beda resolusi (misal fallback 360p)
    const match = baseName.match(/^([a-zA-Z0-9_-]{11})_/);
    if (match) {
      const videoId = match[1];
      try {
        const files = fs.readdirSync(config.folders.downloads);
        const fallbackFile = files.find(f => f.startsWith(`${videoId}_`) && f.endsWith('.mp4'));
        if (fallbackFile) {
          absolutePath = path.join(config.folders.downloads, fallbackFile);
        }
      } catch (err) {}
    }
  }

  if (!fileExists(absolutePath)) {
    throw AppError.notFound('Video sumber tidak ditemukan.', ERROR_CODES.FILE_NOT_FOUND);
  }

  const result = await highlightService.detectHighlights(absolutePath);

  res.json({
    success: true,
    data: {
      highlights: result.highlights,
      energies: result.energies,
    },
  });
});

module.exports = { getHighlights };
