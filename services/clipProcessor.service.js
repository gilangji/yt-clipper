/**
 * services/clipProcessor.service.js
 * Orchestrator yang menggabungkan ytdlpService + ffmpegService + jobService
 * menjadi satu pipeline utuh: download (jika perlu) -> clip -> selesai.
 * Inilah "otak" yang dijalankan oleh queue worker untuk setiap job.
 */

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');
const jobService = require('./job.service');
const ytdlpService = require('./ytdlp.service');
const ffmpegService = require('./ffmpeg.service');
const subtitleService = require('./subtitle.service');
const silenceService = require('./silence.service');
const { JOB_STATUS } = require('../config/constants');
const { buildOutputFilename } = require('../utils/filenameSanitizer');
const { fileExists } = require('../utils/fileHelper');
const { scanMedia } = require('../utils/mediaScanner');

/**
 * Hitung dimensi kanvas output (W_out/H_out) — mirror utils/clipper.py.
 * Dipakai sebagai PlayResX/PlayResY saat generate ASS agar ukuran subtitle
 * proporsional terhadap resolusi ekspor (bukan statis 720x1280).
 */
function computePlayCanvas(resolution, aspectRatio, srcW, srcH) {
  const resMap = { '1080p': 1080, '720p': 720, '480p': 480, '360p': 360 };
  const targetHeight = resMap[resolution];
  let W_out, H_out;
  if (targetHeight) {
    H_out = targetHeight;
    if (aspectRatio === 'original') W_out = targetHeight * (srcW / srcH);
    else if (aspectRatio === '9:16' || aspectRatio === '9:16-split') W_out = targetHeight * (9 / 16);
    else if (aspectRatio === '1:1') W_out = targetHeight;
    else W_out = targetHeight * (srcW / srcH);
  } else {
    // auto/original → pakai dimensi sumber
    if (aspectRatio === '9:16-split') {
      if (srcW / srcH > 9 / 16) { H_out = srcH; W_out = srcH * (9 / 16); }
      else { W_out = srcW; H_out = srcW / (9 / 16); }
    } else {
      const tr = aspectRatio === 'original' ? srcW / srcH : (aspectRatio === '9:16' ? 9 / 16 : 1);
      if (srcW / srcH > tr) { H_out = srcH; W_out = srcH * tr; }
      else { W_out = srcW; H_out = srcW / tr; }
    }
  }
  return {
    width: Math.floor(W_out / 2) * 2,
    height: Math.floor(H_out / 2) * 2,
  };
}

/** Probe dimensi video via ffprobe (untuk resolusi 'original'/auto). */
function probeVideoSize(filePath) {
  return new Promise((resolve) => {
    const ffprobeBin = config.binaries.ffprobe || 'ffprobe';
    execFile(ffprobeBin, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'json',
      filePath,
    ], (err, stdout) => {
      if (err) return resolve({ width: 1920, height: 1080 });
      try {
        const s = JSON.parse(stdout).streams?.[0];
        resolve({ width: s?.width || 1920, height: s?.height || 1080 });
      } catch {
        resolve({ width: 1920, height: 1080 });
      }
    });
  });
}

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

    // Definisi hirarki kualitas resolusi
    const resRank = { '360p': 1, '480p': 2, '720p': 3, '1080p': 4, 'original': 5 };
    const reqRank = resRank[resolution] || 5;

    if (!fileExists(sourcePath)) {
      // Hanya izinkan fallback cache jika resolusi file cache SAMA ATAU LEBIH TINGGI dari yang diminta
      try {
        const files = fs.readdirSync(config.folders.downloads);
        const candidateFiles = files.filter(f => f.startsWith(`${videoId}_`) && f.endsWith('.mp4'));
        for (const file of candidateFiles) {
          const matchRes = file.replace(`${videoId}_`, '').replace('.mp4', '');
          const fileRank = resRank[matchRes] || 5;
          if (fileRank >= reqRank) {
            sourcePath = path.join(config.folders.downloads, file);
            finalSourcePath = sourcePath;
            break;
          }
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

    // ===== TAHAP 1.5: AUTO-SUBTITLE (jika diaktifkan) =====
    // clipStart: offset transkripsi & pemotongan di dalam source file
    //  - source full (useCache): mulai dari startSeconds (asli)
    //  - source section (isSection): file sudah dipotong, mulai dari 0
    let clipStart = startSeconds;
    if (isSection) clipStart = 0;

    let generatedAssPath = null;
    if (job.autoSubtitle) {
      jobService.updateJob(jobId, {
        status: JOB_STATUS.ENCODING,
        stage: 'Men-generate Subtitle AI (Whisper)...',
        progress: 52,
      });
      try {
        // PlayRes = ukuran kanvas output → font subtitle proporsional di semua resolusi
        const resMapCheck = { '1080p': 1080, '720p': 720, '480p': 480, '360p': 360 };
        let srcDims = null;
        if (!resMapCheck[job.resolution]) {
          // resolusi 'original'/auto → probe dimensi sumber
          const probe = await probeVideoSize(finalSourcePath);
          srcDims = { width: probe.width, height: probe.height };
        }
        const dims = computePlayCanvas(job.resolution, job.aspectRatio, srcDims?.width || 1920, srcDims?.height || 1080);

        generatedAssPath = await subtitleService.generateSubtitleAss({
          inputPath: finalSourcePath,
          style: job.subtitleStyle || 'quick-brown-inv',
          fontSize: job.subtitleSize || 'large',
          position: job.subtitlePosition || 'bottom',
          textCase: job.subtitleCase || 'uppercase',
          language: job.subtitleLanguage || 'auto',
          fontFamily: job.subtitleFont || 'auto',
          subtitleConfig: job.subtitleConfig || null,
          startSeconds: clipStart,
          durationSeconds: durationSeconds,
          width: dims.width,
          height: dims.height
        });
      } catch (subErr) {
        logger.warn('Gagal men-generate subtitle, melanjutkan clip tanpa subtitle...', { jobId, error: subErr.message });
      }
    }

    // ===== TAHAP 1.8: SILENCE REMOVER (jika diaktifkan) =====
    if (job.silenceRemover) {
      jobService.updateJob(jobId, {
        status: JOB_STATUS.ENCODING,
        stage: 'Mendeteksi & memotong jeda diam (Silence Remover)...',
        progress: 54,
      });
      try {
        const speechRanges = await silenceService.detectNonSilentIntervals({
          inputPath: finalSourcePath,
          startSeconds: clipStart,
          endSeconds: isSection ? durationSeconds : endSeconds,
          minSilenceDuration: 0.35,
        });
        if (speechRanges && speechRanges.length > 0) {
          finalTimeRanges = speechRanges;
        }
      } catch (silErr) {
        logger.warn('Silence Remover gagal, menggunakan rentang waktu standar', { error: silErr.message });
      }
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
      subtitlePath: generatedAssPath,
      bgmTrack: job.bgmTrack || 'none',
      bgmVolume: job.bgmVolume || 0.10,
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

    // ===== HOOK: Media scan Android/Termux (biar video langsung muncul di Galeri) =====
    // Best-effort: kalau bukan Android / termux-api tidak terpasang → di-skip diam-diam.
    try {
      await scanMedia(outputPath);
    } catch (scanErr) {
      logger.warn('Media scan hook error (non-fatal)', { jobId, error: scanErr.message });
    }
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
