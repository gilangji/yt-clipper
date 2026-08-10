/**
 * services/ai.service.js
 * AI Assistant powered by Google Gemini API (gemini-2.5-flash / gemini-1.5-flash)
 * Optimized for lowest quota/token consumption per request.
 */

const axios = require('axios');
const config = require('../config');

/**
 * Generate viral Title, Caption, and Hashtags for video clip using Google Gemini API.
 * @param {object} params
 * @param {string} params.clipTitle - Judul klip atau topik
 * @param {string} [params.transcript] - Teks transkrip (opsional)
 * @param {string} [params.apiKey] - Google Gemini API Key (user-provided atau env)
 * @returns {Promise<{ title: string, caption: string, hashtags: string[] }>}
 */
async function generateSocialContent({ clipTitle, transcript = '', apiKey = null }) {
  const key = apiKey || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;

  if (!key) {
    throw new Error('Google Gemini API Key belum diisi. Masukkan API Key di form atau di file .env (GOOGLE_AI_API_KEY).');
  }

  // Gunakan gemini-2.5-flash (rendah kuota)
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;

  const prompt = `Kamu adalah pakar Social Media Content Creator (TikTok, YouTube Shorts, Instagram Reels).
Tugasmu adalah membuatkan Judul Viral, Caption Menarik, dan 5 Hashtag Populer berdasarkan topik klip video ini.

Topik/Judul Klip: ${clipTitle}
${transcript ? 'Transkrip Audio: ' + transcript.substring(0, 500) : ''}

Berikan respons HANYA dalam format JSON valid tanpa tanda backtick markdown seperti berikut:
{
  "title": "Judul Viral Singkat (maksimal 8 kata)",
  "caption": "Caption menarik 2-3 kalimat yang mengundang komentar dan interaksi",
  "hashtags": ["#Shorts", "#TikTok", "#Reels", "#Viral", "#Trending"]
}`;

  try {
    const response = await axios.post(endpoint, {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        maxOutputTokens: 256,
        temperature: 0.7
      }
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000
    });

    const candidate = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidate) {
      throw new Error('Response dari Google Gemini API kosong.');
    }

    // Clean markdown codeblocks if present
    const cleaned = candidate.replace(/```json/gi, '').replace(/```/g, '').trim();
    const result = JSON.parse(cleaned);

    return {
      title: result.title || clipTitle,
      caption: result.caption || '',
      hashtags: Array.isArray(result.hashtags) ? result.hashtags : ['#Shorts', '#TikTok', '#Reels']
    };
  } catch (err) {
    if (err.response?.status === 400 || err.response?.status === 403) {
      throw new Error(`Google Gemini API Key tidak valid atau tidak memiliki akses (HTTP ${err.response.status}).`);
    }
    throw new Error(`Gagal menghasilkan konten AI: ${err.message}`);
  }
}

module.exports = { generateSocialContent };
