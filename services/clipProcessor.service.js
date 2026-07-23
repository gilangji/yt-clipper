/**
 * services/clipProcessor.service.js
 * Orchestrator yang menggabungkan ytdlpService + ffmpegService + jobService
 * menjadi satu pipeline utuh: download (jika perlu) -> clip -> selesai.
 * Inilah "otak" yang dijalankan oleh queue worker untuk setiap job.
 */

const path = require('path');
const fs = require('fs');
const config = require('../config');
const logger = require('../utils/logger');
const jobService = require('./job.service');
const ytdlpService = require('./ytdlp.service');
const ffmpegService = require('./ffmpeg.service');
const { JOB_STATUS } = require('../config/constants');
const { buildOutputFilename } = require('../utils/filenameSanitizer');
const { fileExists } = require('../utils/fileHelper');

/**
 * Menjalankan seluruh pipeline untuk satu job clip.
 * Semua error ditangkap di sini dan disimpan ke job.error agar SSE bisa melaporkannya
 * ke client tanpa membuat proses worker/queue crash.
 *
 * @param {string} jobId
 */
async function processClipJob(jobId) {
  const job = jobService.getJob(jobId);
  if (!job) {
    logger.warn('processClipJob dipanggil untuk job yang tidak ada', { jobId });
    return;
  }

  const { url, videoId, title, startSeconds, endSeconds, resolution } = job;
  const durationSeconds = endSeconds - startSeconds;
  
  const tempPath = path.join(config.folders.temp, `src_${jobId}.mp4`);
  let isSection = false;

  try {
    // ===== TAHAP 1: DOWNLOAD (skip jika source sudah ada di downloads/) =====
    let sourcePath = path.join(config.folders.downloads, `${videoId}_${resolution}.mp4`);
    let finalSourcePath = sourcePath;
    let useCache = false;

    if (!fileExists(sourcePath)) {
      // Jika resolusi spesifik tidak ada, coba cari file dengan videoId yang sama tapi beda resolusi (misal fallback 360p)
      try {
        const files = fs.readdirSync(config.folders.downloads);
        const fallbackFile = files.find(f => f.startsWith(`${videoId}_`) && f.endsWith('.mp4'));
        if (fallbackFile) {
          sourcePath = path.join(config.folders.downloads, fallbackFile);
          finalSourcePath = sourcePath;
        }
      } catch (err) {}
    }

    if (fileExists(sourcePath)) {
      if (await ffmpegService.isValidMediaFile(sourcePath)) {
        useCache = true;
      } else {
        logger.warn('Video sumber di cache tidak valid (corrupt), menghapus untuk didownload ulang...', { jobId, videoId });
        try {
          fs.unlinkSync(sourcePath);
        } catch (e) {
          logger.error('Gagal menghapus file cache video sumber yang corrupt', { jobId, videoId, error: e.message });
        }
      }
    }

    if (useCache) {
      logger.info('Source video sudah ada di cache dan valid, skip download', { jobId, videoId });
      jobService.updateJob(jobId, {
        status: JOB_STATUS.DOWNLOADING,
        stage: 'Menggunakan video sumber dari cache...',
        progress: 50,
      });
    } else {
      jobService.updateJob(jobId, {
        status: JOB_STATUS.DOWNLOADING,
        stage: 'Mengunduh potongan video dari YouTube...',
        progress: 0,
      });

      // Pastikan folder temp tersedia
      if (!fs.existsSync(config.folders.temp)) {
        fs.mkdirSync(config.folders.temp, { recursive: true });
      }

      finalSourcePath = await ytdlpService.downloadVideoSection(
        url,
        tempPath,
        resolution,
        startSeconds,
        endSeconds,
        (percent) => {
          // Download dianggap porsi 0-50% dari keseluruhan progress job
          jobService.updateJob(jobId, {
            progress: Math.round(percent * 0.5),
            stage: `Downloading segment... ${Math.round(percent)}%`,
          });
        }
      );
      isSection = true;
    }

    // ===== TAHAP 2: CLIPPING =====
    jobService.updateJob(jobId, {
      status: JOB_STATUS.CLIPPING,
      stage: 'Memotong video sesuai rentang waktu...',
      progress: 55,
    });

    const outputFilename = buildOutputFilename(title, startSeconds);
    const outputPath = path.join(config.folders.output, `${jobId}_${outputFilename}`);

    // Siapkan timeRanges dan crops yang disesuaikan jika menggunakan segmen download
    let clipStart = startSeconds;
    let finalCrops = job.crops;
    let finalTimeRanges = job.timeRanges;

    if (isSection) {
      clipStart = 0;
      if (job.crops && job.crops.length > 0) {
        finalCrops = job.crops.map(c => ({
          ...c,
          time: Math.max(0, c.time - startSeconds)
        }));
      }
      finalTimeRanges = [{ start: 0, end: durationSeconds }];
    }

    await ffmpegService.clipVideo({
      inputPath: finalSourcePath,
      outputPath,
      startSeconds: clipStart,
      durationSeconds,
      resolution,
      crops: finalCrops,
      aspectRatio: job.aspectRatio,
      timeRanges: finalTimeRanges,
      heatmapOverlay: job.heatmapOverlay,
      dynamicZoom: job.dynamicZoom,
      audioEnhance: job.audioEnhance,
      headlineText: job.headlineText,
      onProgress: (percent) => {
        // Clipping/encoding porsi 55-100%
        const overall = 55 + Math.round(percent * 0.45);
        jobService.updateJob(jobId, {
          status: JOB_STATUS.ENCODING,
          progress: Math.min(99, overall),
          stage: `Encoding... ${Math.round(percent)}%`,
        });
      },
    });

    // ===== SELESAI =====
    jobService.updateJob(jobId, {
      status: JOB_STATUS.DONE,
      progress: 100,
      stage: 'Finished.',
      outputFile: outputFilename,
      outputPath,
    });

    logger.info('Job clip selesai', { jobId, outputFilename, durationSeconds });
  } catch (err) {
    logger.error('Job clip gagal', { jobId, error: err.message });
    jobService.updateJob(jobId, {
      status: JOB_STATUS.ERROR,
      stage: 'Terjadi kesalahan.',
      error: {
        message: err.message,
        code: err.errorCode || 'INTERNAL_ERROR',
      },
    });
  } finally {
    // Proaktif hapus file temp section dan sisa file part/temp terkait jobId
    try {
      if (fs.existsSync(config.folders.temp)) {
        const tempFiles = fs.readdirSync(config.folders.temp);
        const jobTempFiles = tempFiles.filter(f => f.startsWith(`src_${jobId}`));
        for (const file of jobTempFiles) {
          const fullPath = path.join(config.folders.temp, file);
          try {
            fs.unlinkSync(fullPath);
          } catch (e) {}
        }
        if (jobTempFiles.length > 0) {
          logger.info('File temp section dibersihkan', { jobId, count: jobTempFiles.length });
        }
      }
    } catch (e) {
      logger.warn('Gagal membersihkan file temp section', { jobId, error: e.message });
    }
  }
}

module.exports = { processClipJob };
