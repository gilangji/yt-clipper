const axios = require('axios');
const config = require('../config');
const geminiManager = require('./geminiManager.service');
const logger = require('../utils/logger');

/**
 * Panggil Google Gemini API dengan urutan hirarki model Skripsita Engine:
 *  1. gemini-2.5-flash-lite (Primary Engine — 89.8% traffic, paling hemat kuota)
 *  2. gemini-2.5-flash      (Pro/Heavy Engine — 9.6% traffic)
 *  3. gemini-2.0-flash      (Fallback Legacy Engine — 0.3%)
 *  4. gemini-3.5-flash      (High-Reasoning Engine — 0.2%)
 *
 * Menggunakan Auto-Rotation & Failover key pool.
 * Jika key 1 limit (HTTP 429/403), otomatis beralih ke key 2, key 3, dst.
 */
async function callGeminiAPI(prompt, userApiKey = null, maxTokens = 256) {
  let keyPool = [];
  if (userApiKey && userApiKey.trim()) {
    keyPool.push(userApiKey.trim());
  }

  const managerKey = geminiManager.getWorkingKey();
  if (managerKey && !keyPool.includes(managerKey)) {
    keyPool.push(managerKey);
  }

  geminiManager.keys.forEach(k => {
    if (!keyPool.includes(k)) keyPool.push(k);
  });

  if (keyPool.length === 0) {
    return null; // Graceful fallback jika tanpa API key
  }

  // Hirarki Model Skripsita Engine (Prioritas Hemat Kuota & Kecepatan)
  const MODEL_HIERARCHY = [
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-3.5-flash'
  ];

  let lastError = null;

  for (const key of keyPool) {
    for (const modelName of MODEL_HIERARCHY) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`;
      try {
        const response = await axios.post(endpoint, {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 12000
        });

        const candidate = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidate) {
          logger.debug(`Gemini API call sukses [Model: ${modelName}, Key: ...${key.slice(-6)}]`);
          return candidate;
        }
      } catch (err) {
        lastError = err;
        const status = err.response?.status;
        logger.warn(`Gemini API call gagal [Model: ${modelName}, Key: ...${key.slice(-6)}]: HTTP ${status || 'ERR'} - ${err.message}`);

        if (status === 429 || status === 403) {
          geminiManager.markKeyExhausted(key, `HTTP ${status} on ${modelName}`);
          break; // Pindah ke key berikutnya jika key ini limit
        }
      }
    }
  }

  if (lastError && userApiKey) {
    throw new Error(`Google Gemini API Error: ${lastError.message}`);
  }

  return null;
}

/**
 * Generate viral Title, Caption, and Hashtags for video clip using Google Gemini API.
 * @param {object} params
 * @param {string} params.clipTitle - Judul klip atau topik
 * @param {string} [params.transcript] - Teks transkrip (opsional)
 * @param {string} [params.apiKey] - Google Gemini API Key (user-provided atau env)
 * @returns {Promise<{ title: string, caption: string, hashtags: string[] }>}
 */
async function generateSocialContent({ clipTitle, transcript = '', apiKey = null }) {
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

  const candidate = await callGeminiAPI(prompt, apiKey, 256);

  if (candidate) {
    try {
      const cleaned = candidate.replace(/```json/gi, '').replace(/```/g, '').trim();
      const result = JSON.parse(cleaned);
      return {
        title: result.title || clipTitle,
        caption: result.caption || '',
        hashtags: Array.isArray(result.hashtags) ? result.hashtags : ['#Shorts', '#TikTok', '#Reels']
      };
    } catch (e) {
      logger.warn('Gagal parse JSON dari Gemini response:', e.message);
    }
  }

  // Fallback jika tanpa API key atau jika key habis/gagal
  return {
    title: `🔥 RAHASIA BESAR ${clipTitle.slice(0, 30).toUpperCase()}!`,
    caption: `Simak cuplikan segmen terbaik dari ${clipTitle}!\nJangan lupa Like & Share jika bermanfaat, dan ikuti kami untuk konten viral berikutnya.`,
    hashtags: ['#Shorts', '#TikTokViral', '#ReelsIndonesia', '#Trending', '#TipsViral']
  };
}

/**
 * AI Highlights Enhancement: Hasilkan Judul, Deskripsi & Tag unik berbasis AI
 * untuk SETIAP klip segmen hasil deteksi highlight.
 */
async function enhanceHighlightsWithAI(highlights, baseVideoTitle = '', apiKey = null) {
  if (!Array.isArray(highlights) || highlights.length === 0) return highlights;

  const prompt = `Kamu adalah AI Video Content Strategist.
Analisis ${highlights.length} segmen klip dari video "${baseVideoTitle}".
Buatkan Judul Viral Unik, Deskripsi/Caption Singkat, dan 5 Hashtag spesifik yang BERBEDA untuk MASING-MASING klip.

Daftar Klip:
${highlights.map((h, i) => `Klip ${i + 1}: Detik ${Math.round(h.start)} - ${Math.round(h.end)} (Grade: ${h.viralGrade}, Viral Score: ${h.viralScore})`).join('\n')}

Berikan respons HANYA dalam format JSON valid array of objects tanpa backtick markdown:
[
  {
    "index": 0,
    "autoTitle": "Judul Klip 1 Viral (maksimal 7 kata)",
    "autoTags": "#Shorts #TikTok #TopikKlip1 #Viral #Fakta",
    "autoDescription": "Deskripsi singkat dan menarik untuk klip 1..."
  }
]`;

  const candidate = await callGeminiAPI(prompt, apiKey, 768);

  if (candidate) {
    try {
      const cleaned = candidate.replace(/```json/gi, '').replace(/```/g, '').trim();
      const aiResults = JSON.parse(cleaned);

      if (Array.isArray(aiResults)) {
        aiResults.forEach((resItem, idx) => {
          if (highlights[idx]) {
            if (resItem.autoTitle) highlights[idx].autoTitle = resItem.autoTitle;
            if (resItem.autoTags) highlights[idx].autoTags = resItem.autoTags;
            if (resItem.autoDescription) highlights[idx].autoDescription = resItem.autoDescription;
          }
        });
        logger.info(`Berhasil melengkapi ${aiResults.length} klip highlight dengan AI Metadata dari Gemini!`);
      }
    } catch (e) {
      logger.warn('Gagal parse AI metadata per highlight dari Gemini:', e.message);
    }
  }

  return highlights;
}

module.exports = { generateSocialContent, enhanceHighlightsWithAI, callGeminiAPI };
