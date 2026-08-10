/**
 * services/repliz.service.js
 * Integrasi API Repliz (https://repliz.com/) untuk auto-publish / scheduling
 * klip ke TikTok, Instagram Reels, dan YouTube Shorts.
 */

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { ERROR_CODES } = require('../config/constants');

/**
 * Publish atau jadwalkan postingan video ke media sosial via Repliz API.
 * @param {object} params
 * @param {string} params.caption - Teks caption / deskripsi + hashtags
 * @param {string} params.videoUrl - URL publik file video yang dihasilkan
 * @param {string[]} [params.platforms=['tiktok', 'instagram', 'youtube']]
 * @param {string|null} [params.scheduleAt=null] - ISO Date String untuk penjadwalan (opsional)
 * @returns {Promise<object>} response data dari Repliz API
 */
async function publishToSocialMedia({ caption, videoUrl, platforms = ['tiktok', 'instagram', 'youtube'], scheduleAt = null }) {
  const { baseUrl, accessKey, secretKey, enabled } = config.repliz;

  if (!enabled || !accessKey || !secretKey) {
    throw AppError.badRequest(
      'API Key Repliz belum dikonfigurasi. Silakan isi REPLIZ_ACCESS_KEY dan REPLIZ_SECRET_KEY di berkas .env',
      ERROR_CODES.VALIDATION_ERROR
    );
  }

  try {
    logger.info('Mengirim postingan ke Repliz API...', { platforms, videoUrl });

    const response = await axios.post(
      `${baseUrl}/v1/posts`,
      {
        caption,
        video_url: videoUrl,
        platforms,
        schedule_at: scheduleAt,
      },
      {
        headers: {
          'X-Access-Key': accessKey,
          'X-Secret-Key': secretKey,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    logger.info('Postingan berhasil dikirim ke Repliz API', { data: response.data });
    return response.data;
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.message;
    logger.error('Gagal mengirim ke Repliz API', { error: errorMsg });
    throw new AppError(`Repliz API Error: ${errorMsg}`, 502, ERROR_CODES.YTDLP_FAILED);
  }
}

module.exports = { publishToSocialMedia };
