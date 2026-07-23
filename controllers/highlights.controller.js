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
    // Coba cari di folder temp jika video disimpan sementara
    const tempPath = path.join(config.folders.temp, baseName);
    if (fileExists(tempPath)) {
      absolutePath = tempPath;
    }
  }

  if (!fileExists(absolutePath)) {
    // Coba cari file mp4 apapun di temp/ atau downloads/ yang mengandung baseName
    try {
      const tempFiles = fs.readdirSync(config.folders.temp);
      const matchTemp = tempFiles.find(f => f.includes(baseName) || f.endsWith('.mp4'));
      if (matchTemp) absolutePath = path.join(config.folders.temp, matchTemp);
    } catch (e) {}
  }

  if (!fileExists(absolutePath)) {
    throw AppError.notFound('Video sumber tidak ditemukan. Silakan muat video terlebih dahulu.', ERROR_CODES.FILE_NOT_FOUND);
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
