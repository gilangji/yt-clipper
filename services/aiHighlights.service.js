/**
 * services/aiHighlights.service.js
 * AI Transcript-Based Highlight Selection — port of auto-clipper/backend/ai_utils.py.
 *
 * Strategi auto-clipper: transkrip (SRT) dikirim ke LLM, AI memilih momen paling
 * viral berdasarkan KONTEN (bukan sekadar energi audio):
 *   - Hook kuat dalam 2 detik pertama
 *   - Pikiran LENGKAP + kalimat LENGKAP (tidak pernah potong mid-sentence)
 *   - start/end presisi di jeda bicara (silence gap)
 *   - Durasi 20-120s, prefer 60-90s; urut kronologis
 *   - Hindari intro/filler/dead air
 * Plus social kit: titles_id/en, description, hashtags, broll query, dll.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');
const aiService = require('./ai.service');

// ===========================================================================
// HIGHLIGHT_GUIDANCE — verbatim dari auto-clipper/backend/ai_utils.py
// ===========================================================================
const HIGHLIGHT_GUIDANCE = (
  "Pick the most engaging, self-contained moments for vertical short-form " +
  "video (TikTok/Reels/Shorts). Each highlight must: start on a STRONG hook that grabs attention in the first 2 seconds, " +
  "contain a complete thought AND a complete sentence (NEVER cut mid-sentence or mid-word), be genuinely " +
  "interesting/funny/surprising on its own without context, and run strictly between " +
  "20-120 seconds. Set start/end PRECISELY on natural speech pauses (silence gaps). " +
  "Prefer longer clips (60-90s) when the narrative arc is compelling, but allow shorter (20-30s) for punchy standalone moments. " +
  "Ensure that the first word is clearly spoken from the beginning and the last word finishes completely. " +
  "Return them in chronological order and avoid intros, filler, and dead air."
);

// Schema keluaran LEAN: pilih momen (inti auto-clipper). Metadata sosial
// (title/caption/hashtags/points) ditambahkan belakangan oleh
// aiService.enhanceHighlightsWithAI agar respons cepat & tidak terpotong.
const HIGHLIGHT_OUTPUT_SCHEMA = (
  "Return a JSON object with a 'highlights' key holding an array of objects. " +
  "Each object must have EXACTLY these keys:\n" +
  "- 'start_time', 'end_time' (in HH:MM:SS.mmm format)\n" +
  "- 'description_en' (in English, ONE concise sentence describing the moment)\n" +
  "- 'description_id' (in Indonesian, ONE concise sentence)\n" +
  "- 'broll_query_en' (STRICTLY 1-2 visual English words, e.g. 'coding man', 'fast car')\n" +
  "- 'reason_id' (in Indonesian, WHY this specific moment can go viral)\n"
);

// ===========================================================================
// Parsing timestamps: "HH:MM:SS.mmm" | "MM:SS" | angka detik
// ===========================================================================
function toSeconds(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const v = value.trim();
    const m = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/);
    if (m) {
      const h = m[1] ? parseInt(m[1], 10) : 0;
      const min = parseInt(m[2], 10);
      const s = parseInt(m[3], 10);
      const ms = m[4] ? parseInt(m[4].padEnd(3, '0'), 10) : 0;
      return h * 3600 + min * 60 + s + ms / 1000;
    }
    const num = parseFloat(v);
    if (!Number.isNaN(num)) return num;
  }
  return null;
}

// ===========================================================================
// Parser JSON respons AI — port _clean_json_response + _parse_highlights
// ===========================================================================
function cleanJsonResponse(content) {
  let text = String(content || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) return fence[1].trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return text;
}

function extractBalancedArray(content) {
  const idx = content.indexOf('"highlights"');
  let searchFrom = 0;
  if (idx !== -1) searchFrom = idx;
  const startIdx = content.indexOf('[', searchFrom);
  if (startIdx === -1) return null;
  let bracketCount = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < content.length; i++) {
    const char = content[i];
    if (escape) { escape = false; continue; }
    if (char === '\\') { escape = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '[') bracketCount++;
    else if (char === ']') {
      bracketCount--;
      if (bracketCount === 0) return content.slice(startIdx, i + 1);
    }
  }
  return null;
}

/**
 * Recovery untuk respons AI yang TERPOTONG (max token tercapai):
 * scan objek `{...}` satu per satu (bracket balance), parse yang valid,
 * dan pertahankan yang punya start_time/end_time. Meniru ketahanan parser
 * auto-clipper tapi lebih dalam (object-level).
 */
function extractCompleteObjects(content) {
  const items = [];
  let pos = 0;
  while (pos < content.length) {
    const start = content.indexOf('{', pos);
    if (start === -1) break;
    let depth = 0;
    let inString = false;
    let escape = false;
    let end = -1;
    for (let i = start; i < content.length; i++) {
      const char = content[i];
      if (escape) { escape = false; continue; }
      if (char === '\\') { escape = true; continue; }
      if (char === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) break; // sisanya terpotong
    const slice = content.slice(start, end + 1);
    try {
      const obj = JSON.parse(slice);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        items.push(obj);
      }
    } catch (e) {
      // objek ini korup, lanjut scan setelahnya
    }
    pos = end + 1;
  }
  // Khusus highlight: hanya objek dengan start_time/end_time
  return items.filter(o => o && (o.start_time || o.start) && (o.end_time || o.end));
}

function parseHighlights(content) {
  const cleaned = cleanJsonResponse(content);
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.highlights)) return parsed.highlights;
      for (const value of Object.values(parsed)) {
        if (Array.isArray(value)) return value;
      }
    }
  } catch (e) {
    logger.debug('AI highlights: JSON penuh gagal parse, coba bracket-balance fallback:', e.message);
  }
  const arrayStr = extractBalancedArray(cleaned);
  if (arrayStr) {
    try {
      const parsed = JSON.parse(arrayStr);
      if (Array.isArray(parsed)) return parsed;
    } catch (e2) {
      logger.debug('AI highlights: array fallback juga gagal:', e2.message);
    }
  }
  // Recovery terakhir: objek individual (respons terpotong)
  const recovered = extractCompleteObjects(cleaned);
  if (recovered.length > 0) {
    logger.warn(`AI highlights: JSON terpotong — recovery ${recovered.length} objek lengkap.`);
    return recovered;
  }
  return [];
}

// ===========================================================================
// Prompt builder — port get_highlights() (path Gemini via aiService.callGeminiAPI)
// ===========================================================================
function buildHighlightPrompt({ transcriptSrt, videoTitle, extraPrompt = '', limit = 5, targetDuration = 60 }) {
  const additional = [
    extraPrompt ? `\n\nUSER'S EXTRA INSTRUCTIONS:\n${extraPrompt}` : '',
    `\nFind up to ${limit} of the best highlights.`,
    videoTitle ? `\nVideo title (context only): ${videoTitle}` : '',
    targetDuration ? `\nPreferred clip target duration: ~${targetDuration} seconds (you may deviate within the 20-120s rule if the content warrants it).` : '',
  ].join('');

  const truncated = transcriptSrt.length > 30000
    ? transcriptSrt.slice(0, 30000) + '\n...[transcript truncated]'
    : transcriptSrt;

  return (
    'Analyze the following video transcript (SRT format). ' +
    HIGHLIGHT_GUIDANCE + additional + '\n\n' +
    HIGHLIGHT_OUTPUT_SCHEMA + '\n\n' +
    `Transcript:\n${truncated}`
  );
}

/**
 * Jalankan transkripsi → SRT via utils/transcriber.py (mode outputSrt).
 * Sama seperti transcribeSegment di metadata.service.js.
 * @returns {Promise<string|null>} path ke file SRT (null jika gagal)
 */
function transcribeToSrtFile(videoPath, language = 'auto') {
  return new Promise((resolve) => {
    const runId = uuidv4();
    const configPath = path.join(config.folders.temp, `aicfg_${runId}.json`);
    const outputSrtPath = path.join(config.folders.temp, `ai_${runId}.srt`);

    if (!fs.existsSync(config.folders.temp)) {
      fs.mkdirSync(config.folders.temp, { recursive: true });
    }

    const configData = {
      inputMedia: videoPath,
      outputSrt: outputSrtPath,
      language,
      ffmpegPath: config.binaries.ffmpeg || 'ffmpeg'
    };

    fs.writeFileSync(configPath, JSON.stringify(configData));

    const pythonBin = config.binaries.python || 'python3';
    const scriptPath = path.join(__dirname, '../utils/transcriber.py');
    const child = spawn(pythonBin, [scriptPath, configPath]);

    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (fs.existsSync(configPath)) {
        try { fs.unlinkSync(configPath); } catch (e) {}
      }
      if (code === 0 && fs.existsSync(outputSrtPath)) {
        const stat = fs.statSync(outputSrtPath);
        if (stat.size > 20) {
          logger.info(`AI Highlights: SRT transkripsi OK (${stat.size} bytes, ${runId})`);
          resolve(outputSrtPath);
          return;
        }
        try { fs.unlinkSync(outputSrtPath); } catch (e) {}
      }
      logger.warn(`AI Highlights: transkripsi SRT gagal (code=${code}): ${stderr.slice(0, 300)}`);
      resolve(null);
    });

    child.on('error', () => resolve(null));
  });
}

/**
 * Panggil LLM (Gemini via aiService multi-key hierarchy) untuk memilih highlight.
 * @returns {Promise<Array|null>} array highlight mentah dari AI (null jika gagal)
 */
async function selectHighlightsWithLLM({ srtPath, videoTitle, apiKey = null, extraPrompt = '', limit = 5, targetDuration = 60 }) {
  let transcriptSrt = '';
  try {
    transcriptSrt = fs.readFileSync(srtPath, 'utf-8');
  } catch (e) {
    logger.warn('AI Highlights: tidak bisa baca SRT:', e.message);
    return null;
  }

  if (!transcriptSrt.trim()) {
    logger.warn('AI Highlights: SRT kosong (video tanpa pembicaraan?)');
    return null;
  }

  const prompt = buildHighlightPrompt({
    transcriptSrt,
    videoTitle,
    extraPrompt,
    limit,
    targetDuration,
  });

  // callGeminiAPI(prompt, apiKey, maxTokens, timeoutMs, extraConfig).
  // gemini-2.5-flash = thinking model → matikan thinking (thinkingBudget 0)
  // agar JSON keluar cepat dan tidak kena timeout; timeout 45s sebagai jaring pengaman.
  const response = await aiService.callGeminiAPI(
    prompt,
    apiKey,
    1600,
    45000,
    { thinkingConfig: { thinkingBudget: 0 } }
  );
  if (!response) {
    logger.warn('AI Highlights: Gemini tidak mengembalikan respons (key habis / model mati?)');
    return null;
  }

  const items = parseHighlights(response);
  logger.info(`AI Highlights: Gemini mengembalikan ${items.length} highlight terpilih.`);
  return items;
}

/**
 * Konversi item AI → objek highlight yt-clipper (start/end + viral grading).
 * @param {object} params
 * @param {Array} params.items - hasil mentah dari LLM
 * @param {string} [params.videoTitle]
 * @param {number} [params.targetDuration=60]
 * @param {number} [params.maxHighlights=8]
 * @param {Function} [params.viralLabelFn] - fungsi viralLabel dari highlight.service.js
 */
function buildHighlightObjects(items, { videoTitle = '', targetDuration = 60, maxHighlights = 8, viralLabelFn = null } = {}) {
  const gradeFn = viralLabelFn || viralLabelDefault;
  const highlights = [];
  const seen = new Set();

  for (const item of items || []) {
    if (!item || typeof item !== 'object') continue;
    const start = toSeconds(item.start_time ?? item.start);
    const end = toSeconds(item.end_time ?? item.end);
    if (start === null || end === null) continue;
    if (end <= start) continue;
    // Jaga batas auto-clipper: 20-120s (toleransi kecil 15s agar tidak buang momen bagus)
    let s = start;
    let e = end;
    if (e - s < 15) {
      // perluas hingga minimal 15s? auto-clipper minta 20s; jaga ketat:
      e = Math.min(s + 20, e + 20);
    }
    if (e - s > 180) e = s + 180;
    if (e - s < 15) continue;

    const key = `${s.toFixed(2)}-${e.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const dur = e - s;
    // Skor proksi: kedekatan durasi dengan target + hook/energi default tinggi
    const fit = Math.max(0, 1 - Math.abs(dur - targetDuration) / targetDuration);
    const viralScore = Math.max(55, Math.min(97, Math.round(72 + fit * 22)));
    const rating = gradeFn(viralScore, 85, 82, 84, highlights.length, s, e);

    const social = item.social || {};
    const titlesId = Array.isArray(social.titles_id) ? social.titles_id : [];
    const titlesEn = Array.isArray(social.titles_en) ? social.titles_en : [];
    const hashtagsId = Array.isArray(social.hashtags_id) ? social.hashtags_id : [];
    const descriptionId = typeof social.description_id === 'string' ? social.description_id : '';
    const descriptionEn = typeof social.description_en === 'string' ? social.description_en : '';

    const autoTitle = (titlesId[0] || titlesEn[0] || (item.description_id || item.description_en || '').slice(0, 60) || `Momen Viral #${highlights.length + 1}`).slice(0, 80);
    const autoTags = (hashtagsId.length ? hashtagsId : ['#Viral', '#FYP', '#TikTok', '#Shorts', '#Reels']).slice(0, 8).join(' ');
    const autoDescription = (descriptionId || descriptionEn || `🔥 ${autoTitle}\n\nSimak momen terbaik ini! Jangan lupa Like, Komentar, dan Follow untuk konten viral lainnya.`).slice(0, 500);

    highlights.push({
      start: Math.round(s * 100) / 100,
      end: Math.round(e * 100) / 100,
      score: Math.round(82 + fit * 12), // dummy energy (untuk UI compat)
      viralScore,
      viralGrade: rating.grade,
      viralLabel: rating.label,
      viralEmoji: rating.emoji,
      viralColor: rating.color,
      analysisReason: (item.reason_id || rating.reason || '').slice(0, 400),
      highlightPoints: rating.highlightPoints,
      hookScore: 85,
      energyScore: 82,
      pacingScore: 84,
      autoTitle,
      autoTags,
      autoDescription,
      descriptionId: item.description_id || descriptionId || '',
      descriptionEn: item.description_en || descriptionEn || '',
      brollQuery: item.broll_query_en || '',
      socialKit: {
        titlesEn,
        titlesId,
        thumbnailLayout: social.thumbnail_layout || '',
        descriptionEn,
        descriptionId,
        hashtagsEn: Array.isArray(social.hashtags_en) ? social.hashtags_en : [],
        hashtagsId,
        bestTimeToPostEn: social.best_time_to_post_en || '',
        bestTimeToPostId: social.best_time_to_post_id || '',
        backsoundEn: social.backsound_en || '',
        backsoundId: social.backsound_id || '',
      },
      aiSelected: true,
    });

    if (highlights.length >= (maxHighlights || 8)) break;
  }

  // Urut kronologis (aturan auto-clipper), dedupe overlap ringan
  highlights.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const h of highlights) {
    const prev = merged[merged.length - 1];
    if (prev && h.start < prev.end - 2) {
      if (h.end > prev.end) prev.end = h.end;
      continue;
    }
    merged.push(h);
  }

  return merged;
}

// Fallback grading bila viralLabelFn tidak diberikan
function viralLabelDefault(...args) {
  return {
    label: 'AI SELECTED',
    emoji: '✨',
    color: '#8b5cf6',
    grade: 'A',
    reason: 'Dipilih langsung oleh AI berdasarkan analisis konten transkrip.',
    highlightPoints: [
      '✨ Momen dipilih AI dari transkrip (bukan sekadar energi audio)',
      '🎯 Hook kuat di 2 detik pertama & kalimat lengkap',
      '📈 Potensi retensi tinggi untuk format vertikal'
    ]
  };
}

module.exports = {
  HIGHLIGHT_GUIDANCE,
  buildHighlightPrompt,
  cleanJsonResponse,
  parseHighlights,
  toSeconds,
  transcribeToSrtFile,
  selectHighlightsWithLLM,
  buildHighlightObjects,
};
