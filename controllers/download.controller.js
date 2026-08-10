/**
 * controllers/download.controller.js
 * GET /api/download/:id
 * POST /api/download
 */

const path = require('path');
const fs = require('fs');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const jobService = require('../services/job.service');
const ytdlpService = require('../services/ytdlp.service');
const cacheService = require('../services/cache.service');
const clipQueue = require('../services/queue.service');
const ffmpegService = require('../services/ffmpeg.service');
const { fileExists, safeJoin } = require('../utils/fileHelper');
const { JOB_STATUS, ERROR_CODES } = require('../config/constants');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Mengunduh file hasil clip. Memvalidasi bahwa job sudah selesai dan
 * file benar-benar berada di dalam folder output/ (anti path traversal).
 */
const downloadClip = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const job = jobService.getJob(id);

  if (!job) {
    throw AppError.notFound('Job tidak ditemukan.', ERROR_CODES.JOB_NOT_FOUND);
  }

  if (job.status !== JOB_STATUS.DONE) {
    throw AppError.badRequest('File belum siap. Proses masih berjalan atau gagal.', ERROR_CODES.FILE_NOT_FOUND);
  }

  const safePath = safeJoin(config.folders.output, path.basename(job.outputPath));

  if (!fileExists(safePath)) {
    throw AppError.notFound('File hasil sudah tidak tersedia (mungkin sudah dibersihkan otomatis).', ERROR_CODES.FILE_NOT_FOUND);
  }

  logger.info('File hasil clip diunduh', { jobId: id, file: job.outputFile });

  res.download(safePath, job.outputFile, (err) => {
    if (err) {
      logger.error('Gagal mengirim file download', { jobId: id, error: err.message });
    }
  });
});

/**
 * Mendownload video sumber (full) ke folder downloads/ secara asinkron.
 * Mengembalikan jobId agar client bisa memantau progress-nya.
 */
const startSourceDownload = asyncHandler(async (req, res) => {
  const { url, resolution = 'original' } = req.body;
  const { extractVideoId, normalizeUrl } = require('../utils/urlValidator');

  const videoId = extractVideoId(url);
  const normalized = normalizeUrl(url);

  // Dapatkan info video
  let metadata = cacheService.getMetadata(videoId);
  if (!metadata) {
    metadata = await ytdlpService.getVideoInfo(normalized);
    cacheService.setMetadata(videoId, metadata);
  }

  const job = jobService.createJob({
    url: normalized,
    videoId,
    title: metadata.title,
    resolution,
    type: 'download',
  });

  logger.info('Mulai download video sumber baru', { jobId: job.id, videoId, resolution });

  // Daftarkan ke queue
  clipQueue.add(async () => {
    const sourcePath = path.join(config.folders.downloads, `${videoId}_${resolution}.mp4`);
    try {
      // Validasi cache yang ada sebelum melakukan download
      if (fs.existsSync(sourcePath)) {
        const valid = await ffmpegService.isValidMediaFile(sourcePath);
        if (!valid) {
          logger.warn('File cache video sumber terdeteksi corrupt saat persiapan download, menghapus...', { videoId, sourcePath });
          try {
            fs.unlinkSync(sourcePath);
          } catch (e) {
            logger.error('Gagal menghapus file cache corrupt saat persiapan download', { sourcePath, error: e.message });
          }
        }
      }

      jobService.updateJob(job.id, {
        status: JOB_STATUS.DOWNLOADING,
        stage: 'Mengunduh video dari YouTube...',
        progress: 0,
      });

      const downloadedPath = await ytdlpService.downloadVideo(normalized, videoId, resolution, (percent) => {
        jobService.updateJob(job.id, {
          progress: Math.round(percent),
          stage: `Downloading source video... ${Math.round(percent)}%`,
        });
      });

      jobService.updateJob(job.id, {
        status: JOB_STATUS.DONE,
        progress: 100,
        stage: 'Selesai.',
        outputFile: path.basename(downloadedPath),
        outputPath: downloadedPath,
      });
    } catch (err) {
      logger.error('Proses download video sumber gagal', { jobId: job.id, error: err.message });
      // Bersihkan file parsial/corrupt jika ada setelah kegagalan download
      if (fs.existsSync(sourcePath)) {
        try {
          fs.unlinkSync(sourcePath);
          logger.info('File source corrupt/partial akibat download gagal telah dibersihkan', { sourcePath });
        } catch (e) {
          logger.error('Gagal menghapus file source corrupt setelah download gagal', { sourcePath, error: e.message });
        }
      }

      jobService.updateJob(job.id, {
        status: JOB_STATUS.ERROR,
        stage: 'Unduhan gagal.',
        error: {
          message: err.message,
          code: err.errorCode || 'DOWNLOAD_FAILED',
        },
      });
    }
  }, `download:${job.id}`);

  res.status(202).json({
    success: true,
    message: 'Proses download sumber berhasil didaftarkan.',
    data: { jobId: job.id, statusUrl: `/api/status/${job.id}` },
  });
});

const { execSync } = require('child_process');

/**
 * Mengompres beberapa klip sekaligus menjadi satu file .zip untuk download batch.
 * jobIds bisa berupa:
 *   - Array<string>: jobId saja (kompatibel lama)
 *   - Array<{jobId, title, tags, description}>: + metadata → sidecar .txt per klip
 */
const downloadBatchZip = asyncHandler(async (req, res) => {
  const { jobIds } = req.body;
  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    throw AppError.badRequest('Daftar jobIds wajib diisi.');
  }

  const entries = jobIds.map((x) => (typeof x === 'string' ? { jobId: x } : x));
  const validFiles = [];
  for (const entry of entries) {
    const job = jobService.getJob(entry.jobId);
    if (job && job.status === JOB_STATUS.DONE && fileExists(job.outputPath)) {
      validFiles.push({
        outputPath: job.outputPath,
        baseName: path.basename(job.outputPath, path.extname(job.outputPath)),
        title: entry.title,
        tags: entry.tags,
        description: entry.description,
      });
    }
  }

  if (validFiles.length === 0) {
    throw AppError.notFound('Tidak ada file hasil klip yang siap dikompres.');
  }

  const zipFilename = `yt_clips_${Date.now()}.zip`;
  const zipPath = path.join(config.folders.temp, zipFilename);

  // Staging dir: salin file + tulis sidecar metadata, lalu zip rata (flatten)
  const stagingDir = fs.mkdtempSync(path.join(config.folders.temp, 'zipstage_'));

  try {
    const stagedFiles = [];
    validFiles.forEach((vf, i) => {
      const safeName = `clip_${String(i + 1).padStart(2, '0')}_${vf.baseName.replace(/[^\w.-]+/g, '_')}${path.extname(vf.outputPath)}`;
      const stagedPath = path.join(stagingDir, safeName);
      fs.copyFileSync(vf.outputPath, stagedPath);
      stagedFiles.push(stagedPath);

      // Sidecar metadata jika tersedia
      if (vf.title || vf.tags || vf.description) {
        const metaLines = [
          `TITLE:\n${vf.title || ''}`,
          '',
          `TAGS:\n${vf.tags || ''}`,
          '',
          `DESCRIPTION:\n${vf.description || ''}`,
          '',
          `SOURCE FILE:\n${path.basename(vf.outputPath)}`,
        ];
        fs.writeFileSync(path.join(stagingDir, safeName.replace(/\.[^.]+$/, '') + '.txt'), metaLines.join('\n\n'), 'utf-8');
      }
    });

    // Zip seluruh isi staging dir (media + sidecar .txt), flatten via -j
    const allStaged = fs.readdirSync(stagingDir).map(f => `"${path.join(stagingDir, f)}"`).join(' ');
    execSync(`zip -j "${zipPath}" ${allStaged}`);

    res.download(zipPath, zipFilename, (err) => {
      if (fs.existsSync(zipPath)) {
        try { fs.unlinkSync(zipPath); } catch (e) {}
      }
      try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (e) {}
    });
  } catch (zipErr) {
    logger.error('Gagal membuat file zip', { error: zipErr.message });
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (e) {}
    throw new AppError('Gagal membuat file zip batch.', 500, ERROR_CODES.FFMPEG_FAILED);
  }
});

module.exports = { downloadClip, startSourceDownload, downloadBatchZip };
