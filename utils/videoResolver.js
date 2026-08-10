/**
 * utils/videoResolver.js
 * Helper bersama: mencari video siap pakai di folder download / menunggu .part / download on-demand.
 */

const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');
const { fileExists } = require('./fileHelper');
const ytdlpService = require('../services/ytdlp.service');
const { extractVideoId } = require('./urlValidator');

/**
 * Menunggu file download yang sedang berjalan (.part) hingga selesai.
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
 * Resolve path absolut video sumber.
 * 1) Cari file siap pakai → 2) tunggu .part → 3) download on-demand.
 * @param {object} params
 * @param {string} [params.videoPath] - path relatif/absolut yang dikirim client
 * @param {string} [params.url]
 * @param {string} [params.title]
 * @param {string} [params.quality='360p']
 * @returns {Promise<string|null>}
 */
async function resolveVideoPath({ videoPath = '', url = '', title = '', quality = '360p' }) {
  const targetName = videoPath || url;
  if (!targetName) return null;

  const baseName = path.basename(targetName);
  const videoId = (url ? extractVideoId(url) : null) || baseName.split('_')[0].split('.')[0];

  const searchFolders = [
    config.folders.downloads,
    '/home/teemo/yt-clipper/downloads',
    '/home/teemo/yt-clipper-mobile/downloads',
    config.folders.temp,
  ];

  let absolutePath = null;

  // 1. Cari file siap pakai
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

  // 2. Tunggu download yang sedang berjalan
  if (!absolutePath) {
    for (const folder of searchFolders) {
      if (!fs.existsSync(folder)) continue;
      try {
        const files = fs.readdirSync(folder);
        const isPart = files.some(f => f.startsWith(`${videoId}_`) && f.includes('.part'));
        if (isPart) {
          logger.info('Menunggu download video selesai...', { videoId, folder });
          const finished = await waitForDownloadCompletion(folder, videoId, 45000);
          if (finished) {
            absolutePath = finished;
            break;
          }
        }
      } catch (e) {}
    }
  }

  // 3. Download on-demand
  if (!absolutePath && url) {
    logger.info('Mendownload video on-demand...', { url, videoId, quality });
    const targetFile = path.join(config.folders.downloads, `${videoId}_${quality}.mp4`);
    try {
      absolutePath = await ytdlpService.downloadVideo(url, targetFile, quality);
    } catch (dlErr) {
      logger.error('Gagal mendownload video', { error: dlErr.message });
    }
  }

  return absolutePath && fileExists(absolutePath) ? absolutePath : null;
}

module.exports = { resolveVideoPath, waitForDownloadCompletion };
