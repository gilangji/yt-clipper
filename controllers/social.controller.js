/**
 * controllers/social.controller.js
 * POST /api/social/publish
 */

const path = require('path');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const replizService = require('../services/repliz.service');
const jobService = require('../services/job.service');
const config = require('../config');
const { fileExists } = require('../utils/fileHelper');
const { JOB_STATUS, ERROR_CODES } = require('../config/constants');

const publishClip = asyncHandler(async (req, res) => {
  const { jobId, caption, platforms = ['tiktok', 'instagram', 'youtube'], scheduleAt = null } = req.body;

  if (!jobId) {
    throw AppError.badRequest('jobId wajib diisi.');
  }

  const job = jobService.getJob(jobId);
  if (!job || job.status !== JOB_STATUS.DONE) {
    throw AppError.badRequest('Job klip tidak ditemukan atau belum selesai.');
  }

  const videoFilename = path.basename(job.outputPath);
  const fullVideoPath = path.join(config.folders.output, videoFilename);

  if (!fileExists(fullVideoPath)) {
    throw AppError.notFound('File video klip tidak ditemukan di server.');
  }

  // Bangun public URL video
  const baseUrl = config.server.baseUrl || `http://localhost:${config.server.port}`;
  const videoPublicUrl = `${baseUrl}/api/download/${jobId}`;

  const postCaption = caption || `${job.title}\n\n#Shorts #TikTok #Reels`;

  const result = await replizService.publishToSocialMedia({
    caption: postCaption,
    videoUrl: videoPublicUrl,
    platforms,
    scheduleAt,
  });

  res.json({
    success: true,
    message: 'Klip berhasil didaftarkan untuk publikasi ke media sosial!',
    data: result,
  });
});

module.exports = { publishClip };
