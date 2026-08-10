/**
 * controllers/preview.controller.js
 * Controller untuk pembuatan dan streaming video preview vertikal (9:16).
 */

const path = require('path');
const fs = require('fs');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const previewService = require('../services/preview.service');
const config = require('../config');
const { fileExists } = require('../utils/fileHelper');
const { ERROR_CODES } = require('../config/constants');

/**
 * POST /api/preview/video-916
 * Generate preview video vertikal 9:16 dengan subtitle AI.
 */
const createVideoPreview = asyncHandler(async (req, res) => {
  const {
    videoPath,
    video_path,
    start,
    end,
    maxDuration,
    aspectRatio,
  } = req.body || {};

  const targetPath = videoPath || video_path;
  if (!targetPath) {
    throw AppError.badRequest('Video path wajib diisi.', ERROR_CODES.VALIDATION_ERROR);
  }

  const result = await previewService.generateVideoPreview916({
    videoPath: targetPath,
    start,
    end,
    maxDuration,
    aspectRatio: aspectRatio || '9:16',
  });

  res.json({
    success: true,
    data: result,
  });
});

/**
 * GET /api/preview/video/:filename
 * Streaming file video preview dengan dukungan HTTP Range.
 */
const streamVideoPreview = asyncHandler(async (req, res) => {
  const { filename } = req.params;
  if (!filename || !filename.endsWith('.mp4')) {
    throw AppError.badRequest('Nama file tidak valid.', ERROR_CODES.VALIDATION_ERROR);
  }

  // Cari di temp
  const safeFilename = path.basename(filename);
  let filePath = path.join(config.folders.temp, safeFilename);

  if (!fileExists(filePath)) {
    filePath = path.join(config.folders.output, safeFilename);
  }

  if (!fileExists(filePath)) {
    throw AppError.notFound('File video preview tidak ditemukan atau telah kedaluwarsa.', ERROR_CODES.FILE_NOT_FOUND);
  }

  res.sendFile(filePath, {
    acceptRanges: true,
    headers: {
      'Content-Type': 'video/mp4',
    },
  });
});

module.exports = {
  createVideoPreview,
  streamVideoPreview,
};
