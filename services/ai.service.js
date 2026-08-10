const axios = require('axios');
const config = require('../config');
const geminiManager = require('./geminiManager.service');
const logger = require('../utils/logger');

/**
 * Panggil Google Gemini API dengan urutan hirarki model Skripsita Engine:
 *  1. gemini-2.5-flash      (Primary Engine — cepat, kuota stabil)
 *  2. gemini-3.5-flash      (High-Reasoning Engine — fallback)
 *  3. gemini-3.6-flash      (Latest Engine — fallback akhir)
 *
 * CATATAN PERFORMANCE (2026-08-10):
 * - gemini-2.5-flash-lite REMOVED: NOT_FOUND "no longer available to new users"
 *   → tiap key hang 12s timeout sebelum lanjut, bikin analisis highlight super lambat.
 * - gemini-2.0-flash REMOVED: RESOURCE_EXHAUSTED (kuota habis).
 * Model mati di-skip otomatis setelah satu kegagalan 4xx per sesi (deadModels cache).
 */
const MODEL_HIERARCHY = [
  'gemini-2.5-flash',
  'gemini-3.5-flash',
  'gemini-3.6-flash'
];

// Model yang sudah terbukti gagal (NOT_FOUND / RESOURCE_EXHAUSTED) → skip langsung
const deadModels = new Set();
const FAIL_STATUS_TO_SKIP = new Set([400, 404, 403, 429]);

async function callGeminiAPI(prompt, userApiKey = null, maxTokens = 256, timeoutMs = 12000, extraConfig = {}) {
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

  // Ambil hanya model yang belum terbukti mati (hemat waktu timeout)
  const liveModels = MODEL_HIERARCHY.filter(m => !deadModels.has(m));
  if (liveModels.length === 0) return null;

  let lastError = null;

  for (const key of keyPool) {
    for (const modelName of liveModels) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`;
      try {
        const response = await axios.post(endpoint, {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7, ...extraConfig }
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: timeoutMs
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

        // Model mati (NOT_FOUND/RESOURCE_EXHAUSTED/etc) → tandai & skip selamanya di sesi ini
        if (status && FAIL_STATUS_TO_SKIP.has(status)) {
          deadModels.add(modelName);
          logger.warn(`Model ${modelName} ditandai DEAD utk sesi ini (HTTP ${status}) — akan di-skip.`);
          break; // pindah model berikutnya
        }

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
 * AI Highlights Enhancement: Hasilkan Judul, Deskripsi, Tag, Analisis Topik & Poin Penting
 * alami berbasis AI untuk SETIAP klip segmen hasil deteksi highlight (Gaya Vizard AI / Opus Clip).
 */
async function enhanceHighlightsWithAI(highlights, baseVideoTitle = '', apiKey = null) {
  if (!Array.isArray(highlights) || highlights.length === 0) return highlights;

  const prompt = `Kamu adalah Senior AI Video Content Strategist ala Vizard AI & Opus Clip.
Analisis ${highlights.length} segmen klip dari video "${baseVideoTitle}".

Tugasmu:
1. Buatkan Judul Viral (autoTitle) yang mengundang rasa ingin tahu penonton (misal: "Kenapa Otak Susah 'Shutdown' Saat Mau Tidur?", "Ternyata Otak Kita Menghitung Fisika Saat Nyebrang Jalan!").
2. Buatkan Viral Reason (analysisReason) yang menjelaskan ALASAN SPESIFIK kenapa materi di segmen klip ini sangat berpotensi viral & relatable bagi audiens.
3. Buatkan 3 Poin Kunci Pembahasan (highlightPoints) yang merangkum poin penting dalam klip ini.
4. Buatkan 5 Hashtag spesifik (autoTags) & Caption Siap Copas (autoDescription).

Daftar Segmen Klip:
${highlights.map((h, i) => `Klip #${i + 1}: Detik ${Math.round(h.start)} s.d ${Math.round(h.end)} (Grade: ${h.viralGrade}, Score: ${h.viralScore}/100)`).join('\n')}

Berikan respons HANYA dalam format JSON valid array of objects tanpa backtick markdown seperti berikut:
[
  {
    "index": 0,
    "autoTitle": "Judul Klip Viral Klik-Worthy (contoh: Kenapa Otak Susah 'Shutdown' Saat Mau Tidur?)",
    "autoTags": "#Shorts #TikTok #Neuroscience #Kesehatan #Viral",
    "autoDescription": "Caption menarik 2-3 kalimat yang mengundang interaksi...",
    "analysisReason": "Penjelasan analogi otak seperti komputer yang sulit dimatikan sangat relevan dengan masalah tidur banyak orang saat ini, memancing rasa ingin tahu penonton.",
    "highlightPoints": [
      "⚡ Lonjakan vokal & pembahasan analogi komputer di menit awal",
      "🎯 Penjelasan fenomena hipervigilance dan fungsi sensorik otak",
      "📈 Potensi retensi & share rate tinggi bagi audiens umum"
    ]
  }
]`;

  const candidate = await callGeminiAPI(prompt, apiKey, 1200);

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
            if (resItem.analysisReason) highlights[idx].analysisReason = resItem.analysisReason;
            if (Array.isArray(resItem.highlightPoints) && resItem.highlightPoints.length > 0) {
              highlights[idx].highlightPoints = resItem.highlightPoints;
            }
          }
        });
        logger.info(`Berhasil melengkapi ${aiResults.length} klip highlight dengan Vizard-style AI Content Analysis dari Gemini!`);
      }
    } catch (e) {
      logger.warn('Gagal parse AI metadata per highlight dari Gemini:', e.message);
    }
  }

  return highlights;
}

module.exports = { generateSocialContent, enhanceHighlightsWithAI, callGeminiAPI };
