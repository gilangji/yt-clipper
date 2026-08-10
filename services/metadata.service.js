/**
 * services/metadata.service.js
 * Generator metadata konten berbasis AI (faster-whisper transcript).
 * Menganalisis segmen video (start–end), mengekstrak topik, lalu menyusun
 * judul click-worthy, hashtags relevan, dan deskripsi siap-copas.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Transkripsi segmen video (startSeconds–durationSeconds) menjadi JSON
 * { text, keywords[], language } via utils/transcriber.py (mode outputJson).
 * @param {object} params
 * @param {string} params.videoPath - path absolut video sumber
 * @param {number} [params.startSeconds=0]
 * @param {number} [params.durationSeconds]
 * @param {string} [params.language='auto']
 * @returns {Promise<{text: string, keywords: string[], language: string}>}
 */
function transcribeSegment({ videoPath, startSeconds = 0, durationSeconds, language = 'auto' }) {
  return new Promise((resolve, reject) => {
    const runId = uuidv4();
    const configPath = path.join(config.folders.temp, `metacfg_${runId}.json`);
    const outputJsonPath = path.join(config.folders.temp, `meta_${runId}.json`);

    if (!fs.existsSync(config.folders.temp)) {
      fs.mkdirSync(config.folders.temp, { recursive: true });
    }

    const configData = {
      inputMedia: videoPath,
      outputJson: outputJsonPath,
      language,
      startSeconds,
      durationSeconds,
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

      if (code !== 0 || !fs.existsSync(outputJsonPath)) {
        reject(new Error(stderr || 'Whisper transcription failed'));
        return;
      }

      try {
        const data = JSON.parse(fs.readFileSync(outputJsonPath, 'utf-8'));
        fs.unlinkSync(outputJsonPath);
        resolve({
          text: (data.text || '').trim(),
          keywords: Array.isArray(data.keywords) ? data.keywords : [],
          language: data.language || language,
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Susun judul click-worthy dari keyword utama + konteks segmen.
 */
function buildTitle({ keywords, videoTitle, durationSeconds }) {
  const base = (videoTitle || '').trim() || 'Konten Viral';
  const baseUpper = base.slice(0, 30).toUpperCase();
  const kw1 = keywords[0] || baseUpper.slice(0, 20);
  const kw2 = keywords[1] || 'TIPS';
  const dur = Math.round(durationSeconds || 30);

  const templates = [
    `RAHASIA ${kw1.toUpperCase()} YANG JARANG DISADARI!`,
    `JANGAN LEWATKAN ${kw1.toUpperCase()} INI — ${baseUpper}!`,
    `${kw2.toUpperCase()} TERBUKTI: ${kw1.toUpperCase()} (${dur}s)`,
    `FAKTA ${kw1.toUpperCase()} DARI ${baseUpper}`,
    `3 HAL ${kw1.toUpperCase()} YANG HARUS KAMU TAHU`,
    `VIRAL! ${kw1.toUpperCase()} MENGEJUTKAN SEMUA ORANG`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

/**
 * Susun hashtags dari keyword + tag dasar platform.
 */
function buildTags(keywords, videoTitle) {
  const base = (videoTitle || '').trim() || '';
  const baseTag = '#' + base.replace(/[^\w]/g, '').slice(0, 18);

  const kwTags = keywords
    .slice(0, 8)
    .map(k => '#' + k.toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(t => t.length > 3);

  const fixed = ['#Shorts', '#TikTokViral', '#ReelsIndonesia', '#FYP'];
  const merged = [...new Set([...kwTags, baseTag, ...fixed])].filter(Boolean);
  return merged.slice(0, 12).join(' ');
}

/**
 * Susun deskripsi siap-copas: hook + ringkasan konten + CTA + tags.
 */
function buildDescription({ title, keywords, transcript, durationSeconds }) {
  const excerpt = transcript
    ? (transcript.length > 340 ? transcript.slice(0, 340).trim() + '…' : transcript)
    : 'Cuplikan segmen penuh aksi dan informasi penting.';

  const hookLine = title.split('\n')[0];
  return [
    `🔥 ${hookLine}`,
    '',
    `${excerpt}`,
    '',
    `⏱️ Durasi: ${Math.round(durationSeconds || 30)} detik.`,
    '👉 Like, komen & share jika bermanfaat!',
    '',
    '🏷️ Tags:',
  ].join('\n');
}

/**
 * Generate metadata konten untuk satu segmen video.
 * Fallback template jika transkripsi gagal (mis. audio kosong).
 * @param {object} params
 * @param {string} params.videoPath
 * @param {number} [params.startSeconds=0]
 * @param {number} [params.endSeconds]
 * @param {string} [params.videoTitle='']
 * @param {string} [params.language='auto']
 * @returns {Promise<{title: string, tags: string, description: string, headline: string, keywords: string[], transcript: string}>}
 */
async function generateContentMetadata({ videoPath, startSeconds = 0, endSeconds, videoTitle = '', language = 'auto' }) {
  const durationSeconds = Math.max(1, Math.round((endSeconds || startSeconds + 30) - startSeconds));
  let transcript = '';
  let keywords = [];

  try {
    const result = await transcribeSegment({
      videoPath,
      startSeconds,
      durationSeconds,
      language,
    });
    transcript = result.text;
    keywords = result.keywords;
    logger.info('Metadata transkripsi segmen sukses', {
      startSeconds,
      durationSeconds,
      keywordCount: keywords.length,
      lang: result.language,
    });
  } catch (err) {
    logger.warn('Transkripsi untuk metadata gagal, fallback template', { error: err.message });
  }

  const title = buildTitle({ keywords, videoTitle, durationSeconds });
  const tags = buildTags(keywords, videoTitle);
  const description = buildDescription({ title, keywords, transcript, durationSeconds });
  const headline = title.split('!')[0].slice(0, 30) + '!';

  return { title, tags, description, headline, keywords, transcript };
}

module.exports = { generateContentMetadata, transcribeSegment };
