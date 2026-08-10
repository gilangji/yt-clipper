/**
 * controllers/highlights.controller.js
 * POST /api/highlights
 */

const path = require('path');
const fs = require('fs');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const highlightService = require('../services/highlight.service');
const aiService = require('../services/ai.service');
const ytdlpService = require('../services/ytdlp.service');
const { extractVideoId } = require('../utils/urlValidator');
const { fileExists } = require('../utils/fileHelper');
const config = require('../config');
const logger = require('../utils/logger');
const { ERROR_CODES } = require('../config/constants');

/**
 * Helper untuk menunggu file download yang sedang berjalan (.part)
 */
async function waitForDownloadCompletion(folder, videoId, maxWaitMs = 45000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const files = fs.readdirSync(folder);
      const readyFile = files.find(f => f.startsWith(`${videoId}_`) && f.endsWith('.mp4') && !f.includes('.part'));
      if (readyFile) {
        const fullPath = path.join(folder, readyFile);
        const stat = fs.statSync(fullPath);
        if (stat.size > 102400) return fullPath;
      }
    } catch (e) {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return null;
}

/**
 * Menganalisis video sumber untuk mendeteksi highlights.
 */
const getHighlights = asyncHandler(async (req, res) => {
  const { videoPath, video_path, url = '', title = '', targetDuration, maxHighlights, apiKey = null } = req.body;
  const targetName = videoPath || video_path || url;

  if (!targetName) {
    throw AppError.badRequest('Target video atau URL tidak boleh kosong.', ERROR_CODES.VALIDATION_ERROR);
  }

  const baseName = path.basename(targetName);
  const videoId = (url ? extractVideoId(url) : null) || baseName.split('_')[0].split('.')[0];

  const searchFolders = [
    config.folders.downloads,
    '/home/teemo/yt-clipper/downloads',
    '/home/teemo/yt-clipper-mobile/downloads',
    config.folders.temp,
  ];

  let absolutePath = null;

  // 1. Cari file siap pakai di folder-folder download
  for (const folder of searchFolders) {
    if (!fs.existsSync(folder)) continue;
    try {
      const files = fs.readdirSync(folder);
      const match = files.find(f => f.startsWith(`${videoId}_`) && f.endsWith('.mp4') && !f.includes('.part'));
      if (match) {
        const full = path.join(folder, match);
        const stat = fs.statSync(full);
        if (stat.size > 102400) {
          absolutePath = full;
          break;
        }
      }
    } catch (e) {}
  }

  // 2. Jika belum ada, cek apakah sedang di-download (.part file) -> tunggu hingga selesai
  if (!absolutePath) {
    for (const folder of searchFolders) {
      if (!fs.existsSync(folder)) continue;
      try {
        const files = fs.readdirSync(folder);
        const isPart = files.some(f => f.startsWith(`${videoId}_`) && f.includes('.part'));
        if (isPart) {
          logger.info('Menunggu download video selesai untuk analisis highlights...', { videoId, folder });
          const finished = await waitForDownloadCompletion(folder, videoId, 45000);
          if (finished) {
            absolutePath = finished;
            break;
          }
        }
      } catch (e) {}
    }
  }

  // 3. Jika masih belum ada dan URL tersedia -> download on-the-fly
  if (!absolutePath && url) {
    logger.info('Mendownload video on-demand untuk highlights...', { url, videoId });
    const targetFile = path.join(config.folders.downloads, `${videoId}_360p.mp4`);
    try {
      absolutePath = await ytdlpService.downloadVideo(url, targetFile, '360p');
    } catch (dlErr) {
      logger.error('Gagal mendownload video untuk highlights', { error: dlErr.message });
    }
  }

  if (!absolutePath || !fileExists(absolutePath)) {
    throw AppError.notFound(
      'Video sumber sedang diunduh di latar belakang. Silakan tunggu beberapa detik lalu klik Pindai Highlights kembali.',
      ERROR_CODES.FILE_NOT_FOUND
    );
  }

  const result = await highlightService.detectHighlights(absolutePath, title, {
    targetDuration,
    maxHighlights,
  });

  // Tingkatkan akurasi Judul, Caption, & Hashtags unik per klip via Google Gemini AI
  if (result.highlights && result.highlights.length > 0) {
    try {
      result.highlights = await aiService.enhanceHighlightsWithAI(result.highlights, title || videoId, apiKey);
    } catch (aiErr) {
      logger.warn('AI enhancement highlights gagal, menggunakan template fallback:', aiErr.message);
    }
  }

  res.json({
    success: true,
    data: {
      highlights: result.highlights,
      energies: result.energies,
    },
  });
});

module.exports = { getHighlights };
