/**
 * controllers/transcript.controller.js
 * POST /api/transcript — Transkrip FULL video ber-timestamp (Vizard-style transcript editor).
 */

const path = require('path');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const metadataService = require('../services/metadata.service');
const { resolveVideoPath } = require('../utils/videoResolver');
const logger = require('../utils/logger');
const { ERROR_CODES } = require('../config/constants');

const getTranscript = asyncHandler(async (req, res) => {
  const { videoPath, video_path, url = '', language = 'auto' } = req.body;
  const targetName = videoPath || video_path || url;

  if (!targetName) {
    throw AppError.badRequest('Target video atau URL tidak boleh kosong.', ERROR_CODES.VALIDATION_ERROR);
  }

  const absolutePath = await resolveVideoPath({ videoPath, url, quality: '360p' });

  if (!absolutePath) {
    throw AppError.notFound(
      'Video sumber belum siap. Tunggu unduhan selesai lalu coba lagi.',
      ERROR_CODES.FILE_NOT_FOUND
    );
  }

  logger.info('Transkripsi full video dimulai (Vizard transcript)', {
    video: path.basename(absolutePath),
    language,
  });

  const result = await metadataService.transcribeFullWithSegments({
    videoPath: absolutePath,
    language,
  });

  res.json({
    success: true,
    data: {
      text: result.text,
      segments: result.segments,
      language: result.language,
    },
  });
});

module.exports = { getTranscript };
