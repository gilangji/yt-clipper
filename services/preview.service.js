/**
 * services/preview.service.js
 * Service untuk men-generate video preview vertikal (9:16) cepat
 * dengan subtitle terpasang (burned ASS) untuk setiap highlight / rentang klip.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const subtitleService = require('./subtitle.service');
const { fileExists } = require('../utils/fileHelper');
const { ERROR_CODES } = require('../config/constants');

/**
 * Escape path file ASS untuk filter ass FFmpeg
 */
function escapeAssFilterPath(filePath) {
  // FFmpeg filter parser membutuhkan escape khusus untuk single-quote, colon, dan backslash
  return filePath
    .replace(/\\/g, '/')
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:');
}

/**
 * Generate video preview 9:16 dengan subtitle AI terpasang.
 * @param {object} params
 * @param {string} params.videoPath - Nama file / path video sumber
 * @param {number} params.start - Waktu mulai (detik)
 * @param {number} params.end - Waktu selesai (detik)
 * @param {number} [params.maxDuration=30] - Batas durasi preview (detik)
 * @param {string} [params.subtitleStyle='quick-brown']
 * @param {string} [params.subtitleSize='large']
 * @param {string} [params.subtitleFont='auto']
 * @param {string} [params.subtitlePosition='bottom']
 * @param {string} [params.subtitleCase='uppercase']
 * @param {string} [params.subtitleLanguage='auto']
 * @param {boolean} [params.withSubtitle=true]
 * @param {string} [params.aspectRatio='9:16']
 * @returns {Promise<{success: boolean, filename: string, previewUrl: string, start: number, end: number, duration: number, cached: boolean}>}
 */
async function generateVideoPreview916({
  videoPath,
  start = 0,
  end = 15,
  maxDuration = 30,
  subtitleStyle = 'quick-brown-inv',
  subtitleSize = 'large',
  subtitleFont = 'auto',
  subtitlePosition = 'bottom',
  subtitleCase = 'uppercase',
  subtitleLanguage = 'auto',
  withSubtitle = true,
  aspectRatio = '9:16',
}) {
  if (!videoPath) {
    throw AppError.badRequest('Path video sumber wajib diisi.', ERROR_CODES.VALIDATION_ERROR);
  }

  const baseName = path.basename(videoPath);
  let absoluteSourcePath = path.join(config.folders.downloads, baseName);

  if (!fileExists(absoluteSourcePath)) {
    const tempPath = path.join(config.folders.temp, baseName);
    if (fileExists(tempPath)) absoluteSourcePath = tempPath;
  }

  if (!fileExists(absoluteSourcePath)) {
    try {
      const tempFiles = fs.readdirSync(config.folders.temp);
      const match = tempFiles.find(f => f.includes(baseName) || f.endsWith('.mp4'));
      if (match) absoluteSourcePath = path.join(config.folders.temp, match);
    } catch (e) {}
  }

  if (!fileExists(absoluteSourcePath)) {
    throw AppError.notFound('Video sumber tidak ditemukan. Silakan muat video terlebih dahulu.', ERROR_CODES.FILE_NOT_FOUND);
  }

  const startSec = Math.max(0, parseFloat(start) || 0);
  const rawEndSec = Math.max(startSec + 1, parseFloat(end) || (startSec + 15));
  const fullDuration = rawEndSec - startSec;
  const previewDuration = Math.min(maxDuration, fullDuration);

  // Pastikan folder temp tersedia
  if (!fs.existsSync(config.folders.temp)) {
    fs.mkdirSync(config.folders.temp, { recursive: true });
  }

  // Buat hash cache unik
  const hashPayload = [
    baseName,
    startSec.toFixed(2),
    previewDuration.toFixed(2),
    withSubtitle ? subtitleStyle : 'nosub',
    withSubtitle ? subtitleSize : '',
    withSubtitle ? subtitleFont : '',
    withSubtitle ? subtitlePosition : '',
    withSubtitle ? subtitleCase : '',
    withSubtitle ? subtitleLanguage : '',
    aspectRatio
  ].join('|');

  const hash = crypto.createHash('md5').update(hashPayload).digest('hex').slice(0, 16);
  const previewFilename = `prev916_${hash}.mp4`;
  const outputPreviewPath = path.join(config.folders.temp, previewFilename);

  // Jika cache sudah ada & valid (>10KB), kembalikan langsung
  if (fileExists(outputPreviewPath)) {
    try {
      const stats = fs.statSync(outputPreviewPath);
      if (stats.size > 10240) {
        logger.debug('Menggunakan video preview 9:16 dari cache', { previewFilename });
        return {
          success: true,
          filename: previewFilename,
          previewUrl: `/api/preview/video/${previewFilename}`,
          start: startSec,
          end: startSec + previewDuration,
          duration: previewDuration,
          cached: true
        };
      }
    } catch (e) {}
  }

  let assPath = null;
  if (withSubtitle) {
    try {
      // Generate ASS subtitle pada resolusi preview vertikal 480x854
      assPath = await subtitleService.generateSubtitleAss({
        inputPath: absoluteSourcePath,
        style: subtitleStyle,
        fontSize: subtitleSize,
        position: subtitlePosition,
        textCase: subtitleCase,
        language: subtitleLanguage,
        fontFamily: subtitleFont,
        startSeconds: startSec,
        durationSeconds: previewDuration,
        width: 480,
        height: 854
      });
    } catch (subErr) {
      logger.warn('Subtitle preview gagal dibuat, render video tanpa subtitle', { error: subErr.message });
      assPath = null;
    }
  }

  // Bangun filter video FFmpeg untuk 9:16 vertical crop + ASS subtitle
  let vfFilter = 'crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=480:854:flags=lanczos';
  if (assPath && fileExists(assPath)) {
    const escapedAss = escapeAssFilterPath(assPath);
    vfFilter += `,ass='${escapedAss}'`;
  }

  const ffmpegBin = config.binaries.ffmpeg || 'ffmpeg';
  const ffmpegArgs = [
    '-y',
    '-ss', String(startSec),
    '-i', absoluteSourcePath,
    '-t', String(previewDuration),
    '-vf', vfFilter,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '26',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-movflags', '+faststart',
    outputPreviewPath
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, ffmpegArgs);
    let stderr = '';

    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code !== 0 || !fileExists(outputPreviewPath)) {
        logger.error('FFmpeg render preview 9:16 gagal', { code, error: stderr });
        reject(new AppError(`Gagal membuat video preview 9:16: ${stderr || 'FFmpeg exit code ' + code}`, 500, ERROR_CODES.FFMPEG_FAILED));
      } else {
        resolve();
      }
    });
  });

  return {
    success: true,
    filename: previewFilename,
    previewUrl: `/api/preview/video/${previewFilename}`,
    start: startSec,
    end: startSec + previewDuration,
    duration: previewDuration,
    cached: false
  };
}

module.exports = {
  generateVideoPreview916,
};
