/**
 * controllers/metadata.controller.js
 * POST /api/metadata/generate
 * Menghasilkan judul, tags, dan deskripsi berbasis konten untuk segmen video.
 */

const path = require('path');
const fs = require('fs');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { generateContentMetadata } = require('../services/metadata.service');
const { fileExists } = require('../utils/fileHelper');
const { timeToSeconds } = require('../utils/timeParser');
const config = require('../config');
const { ERROR_CODES } = require('../config/constants');

/**
 * Resolve path video sumber (downloads/ atau temp/), konsisten dengan highlights.
 */
function resolveVideoPath(targetName) {
  const baseName = path.basename(targetName);
  let absolutePath = path.join(config.folders.downloads, baseName);

  if (!fileExists(absolutePath)) {
    const tempPath = path.join(config.folders.temp, baseName);
    if (fileExists(tempPath)) absolutePath = tempPath;
  }

  if (!fileExists(absolutePath)) {
    try {
      const tempFiles = fs.readdirSync(config.folders.temp);
      const matchTemp = tempFiles.find(f => f.includes(baseName) || f.endsWith('.mp4'));
      if (matchTemp) absolutePath = path.join(config.folders.temp, matchTemp);
    } catch (e) {}
  }

  return fileExists(absolutePath) ? absolutePath : null;
}

const generateMetadata = asyncHandler(async (req, res) => {
  const { videoPath, start = '00:00:00', end, language = 'auto', videoTitle = '' } = req.body;

  if (!videoPath) {
    throw AppError.badRequest('Nama file video tidak boleh kosong.', ERROR_CODES.VALIDATION_ERROR);
  }

  const absolutePath = resolveVideoPath(videoPath);
  if (!absolutePath) {
    throw AppError.notFound('Video sumber tidak ditemukan. Silakan muat video terlebih dahulu.', ERROR_CODES.FILE_NOT_FOUND);
  }

  const startSeconds = timeToSeconds(start) || 0;
  const endSeconds = timeToSeconds(end);
  if (!endSeconds || endSeconds <= startSeconds) {
    throw AppError.badRequest('Range waktu tidak valid.', ERROR_CODES.VALIDATION_ERROR);
  }

  const meta = await generateContentMetadata({
    videoPath: absolutePath,
    startSeconds,
    endSeconds,
    videoTitle,
    language,
  });

  res.json({ success: true, data: meta });
});

module.exports = { generateMetadata };
