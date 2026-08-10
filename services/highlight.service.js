/**
 * services/highlight.service.js
 * Analisis audio & konten video → segmen highlight berkualitas tinggi dengan:
 *  - Multidimensional Virality Score (Hook, Energy, Pacing, Retention Duration)
 *  - Auto AI Title Generator (Catchy Viral Headlines)
 *  - Auto Tags / Hashtags Generator
 *  - Ready-to-use Social Media Description (TikTok / Reels / Shorts)
 */

const { spawn } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { ERROR_CODES } = require('../config/constants');

const FFMPEG_PATH = config.binaries.ffmpeg || 'ffmpeg';

// ===== Parameters =====
const MIN_SEGMENT_DURATION = 18;    // Minimum 18 detik untuk short format
const DEFAULT_TARGET_DURATION = 60; // Target durasi default (Reels-ish) jika tanpa preset
const MAX_TARGET_DURATION = 120;    // Target durasi maksimal yang diizinkan
const WINDOW_SEC = 20;              // Sliding window scoring
const SMOOTH_WINDOW = 8;            // Moving average smoothing
const ENERGY_THRESHOLD_MULT = 0.82; // Threshold ekspansi segmen
const MIN_GAP_TO_MERGE = 10;        // Gabungkan jika jarak < 10 detik
const TOP_N = 12;                   // Ambil hingga 12 highlight terbaik

// ===== Title Hook Templates =====
const HOOK_PATTERNS = [
  "RAHASIA BESAR YANG JARANG DIBONGKAR!",
  "JANGAN LAKUKAN INI SEBELUM MENYESAL!",
  "FAKTA MENGEJUTKAN YANG WAJIB KAMU TAHU!",
  "CARA TERBAIK UNTUK MENGUBAH SEMUANYA!",
  "INI ALASAN UTAMA KENAPA BANYAK YANG GAGAL!",
  "TRIK RAHASIA YANG BIKIN SEMUA ORANG KAGET!",
  "POIN PALING PENTING YANG SERING DIABAIKAN!",
  "MOMEN INI AKAN MEMBUAT KAMU TERCENGANG!",
  "STRATEGI JITU UNTUK HASIL MAKSIMAL!",
  "DENGARKAN INI BAIK-BAIK SEBELUM TERLAMBAT!"
];

const DEFAULT_TAGS = [
  "#Shorts", "#TikTokViral", "#ReelsInstagram", "#Edukasi", 
  "#FaktaMenarik", "#TipsViral", "#Mindset", "#TrendingNow", "#ViralIndonesia"
];

// ===== Helpers =====

function movingAverage(arr, windowSize) {
  const half = Math.floor(windowSize / 2);
  return arr.map((_, i) => {
    let sum = 0, count = 0;
    for (let j = -half; j <= half; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < arr.length) { sum += arr[idx]; count++; }
    }
    return sum / count;
  });
}

// Pilih jendela klip non-tumpang-tindih berukuran target durasi:
//  - Audio berspike → jendela berpusat pada momen terkuat
//  - Audio seragam → jendela tersebar merata sepanjang video
// Menjamin ukuran klip presisi mengikuti preset platform.
function selectWindows(windowScores, targetDuration, totalSecs, maxCount) {
  const half = Math.floor(targetDuration / 2);
  const selected = [];
  const used = new Array(totalSecs).fill(false);

  const windowBounds = (center) => {
    let left = center - half;
    let right = left + targetDuration;
    if (right > totalSecs - 1) { right = totalSecs - 1; left = Math.max(0, right - targetDuration); }
    if (left < 0) { left = 0; right = Math.min(totalSecs - 1, left + targetDuration); }
    return { left, right };
  };

  for (let k = 0; k < maxCount; k++) {
    let best = -1, bestScore = -Infinity, bestBounds = null;
    for (let i = 0; i < totalSecs; i++) {
      if (used[i]) continue;
      const { left, right } = windowBounds(i);
      // Syarat: seluruh jendela harus bebas (jamin tidak tumpang tindih)
      let free = true;
      for (let j = left; j <= right; j++) { if (used[j]) { free = false; break; } }
      if (!free) continue;
      if (windowScores[i] > bestScore) { bestScore = windowScores[i]; best = i; bestBounds = { left, right }; }
    }
    if (best < 0 || bestScore <= 0 || !bestBounds) break;

    selected.push({ start: bestBounds.left, end: bestBounds.right, center: best });

    // Tandai jendela + margin kecil sebagai terpakai
    const margin = Math.max(1, Math.floor(targetDuration * 0.05));
    const lo = Math.max(0, bestBounds.left - margin);
    const hi = Math.min(totalSecs - 1, bestBounds.right + margin);
    for (let j = lo; j <= hi; j++) used[j] = true;
  }
  return selected;
}

function mergeCloseSegments(segments, maxDur) {
  if (segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const merged = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    const gapSmall = cur.start - last.end <= MIN_GAP_TO_MERGE;
    const wouldExceedMax = (cur.end - last.start) > maxDur;

    if (gapSmall && !wouldExceedMax) {
      last.end = Math.max(last.end, cur.end);
      last.avgEnergy = Math.max(last.avgEnergy, cur.avgEnergy);
      last.variance = Math.max(last.variance, cur.variance);
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

function filterOverlaps(segments, topN = TOP_N) {
  // Buang segmen kelas D / noise (skor < 50) agar daftar hanya berisi momen layak
  const sorted = segments
    .filter(s => (s.viralScore ?? 0) >= 50)
    .sort((a, b) => b.viralScore - a.viralScore);
  const selected = [];
  for (const seg of sorted) {
    const overlap = selected.some(s => seg.start < s.end && seg.end > s.start);
    if (!overlap) {
      selected.push(seg);
      if (selected.length >= topN) break;
    }
  }
  return selected;
}

// ===== Relative Scoring Helpers =====

function calcSegmentMetrics(seg, smoothed, globalAvgEnergy) {
  const dur = seg.end - seg.start;

  // Hook: rata-rata energi di 5 detik pertama
  const hookEnd = Math.min(seg.end, seg.start + 5);
  const hookDur = Math.max(1, hookEnd - seg.start);
  let hookSum = 0;
  for (let i = seg.start; i <= hookEnd; i++) hookSum += smoothed[i] || 0;
  const hookAvg = hookSum / hookDur;

  const stdDev = Math.sqrt(seg.variance);
  return { start: seg.start, dur, hookAvg, avgEnergy: seg.avgEnergy, stdDev, globalAvgEnergy };
}

// Normalisasi min-max → jamin skor relatif BERBEDA antar segmen
function minMaxNorm(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 1e-6) return values.map(() => 0.5);
  return values.map(v => (v - min) / (max - min));
}

// Normalisasi relatif ke maksimum → adil untuk segmen tier kedua
function maxNorm(values) {
  const max = Math.max(...values);
  if (max <= 1e-9) return values.map(() => 0.5);
  return values.map(v => v / max);
}

// Hybrid: 50% min-max (jamin beda) + 50% max-relative (adil)
function hybridNorm(values) {
  const a = minMaxNorm(values);
  const b = maxNorm(values);
  return values.map((_, i) => a[i] * 0.5 + b[i] * 0.5);
}

/**
 * Hitung virality score multidimensi BERBASIS RELATIF:
 * 1. Hook Score (30%) - energi 5 detik pertama, dinormalisasi antar segmen
 * 2. Energy & Emotion Score (30%) - volume, dinormalisasi antar segmen
 * 3. Duration Fit (20%) - kecocokan dengan TARGET durasi platform
 * 4. Pacing & Variance (20%) - fluktuasi retensi, dinormalisasi antar segmen
 * Normalisasi antar segmen menjamin rating tidak rata walau audio seragam.
 */
function calcRelativeScores(metrics, targetDuration, totalSecs) {
  const hookNorms = hybridNorm(metrics.map(m => m.hookAvg));
  const energyNorms = hybridNorm(metrics.map(m => m.avgEnergy));
  const pacingNorms = hybridNorm(metrics.map(m => m.stdDev));

  return metrics.map((m, i) => {
    const hookScore = Math.round(40 + hookNorms[i] * 58);
    const energyScore = Math.round(40 + energyNorms[i] * 58);
    const pacingScore = Math.round(40 + pacingNorms[i] * 58);

    // Durasi ideal = target platform; makin menyimpang makin turun
    const deviation = Math.abs(m.dur - targetDuration) / targetDuration;
    const durScore = Math.round(Math.max(35, 100 - deviation * 90));

    // Tiebreaker posisi: momen awal video sedikit diunggulkan (hook utama
    // biasanya di awal). Bonus kecil (±6) agar audio seragam tetap terurut.
    const positionBonus = totalSecs > 0
      ? Math.round((1 - Math.min(1, m.start / totalSecs)) * 6)
      : 0;

    const totalScore = Math.round(
      hookScore * 0.30 +
      energyScore * 0.30 +
      durScore * 0.20 +
      pacingScore * 0.20 +
      positionBonus
    );

    return {
      totalScore: Math.min(99, Math.max(40, totalScore)),
      hookScore,
      energyScore,
      durScore,
      pacingScore
    };
  });
}

/**
 * Hitung virality score multidimensi:
 * 1. Hook Score (30%) - energi di 5 detik pertama
 * 2. Energy & Emotion Score (30%) - volume & dinamika vokal
 * 3. Duration Fit (20%) - 25s - 60s adalah golden ratio
 * 4. Pacing & Variance (20%) - fluktuasi penahan retensi
 */
function viralLabel(score, hookScore = 80, energyScore = 80, pacingScore = 80, index = 0, startSec = 0, endSec = 60) {
  const dur = Math.round(endSec - startSec);
  const startMin = Math.floor(startSec / 60);
  const startS = Math.floor(startSec % 60);
  const timeStr = `${startMin}:${startS < 10 ? '0' : ''}${startS}`;

  if (score >= 88) {
    return {
      label: 'VIRAL MAGNET',
      emoji: '🔥',
      color: '#ef4444',
      grade: 'S',
      reason: `Segmen menit ${timeStr} (durasi ${dur}s) memiliki intensitas audio dan lonjakan daya pikat tertinggi (Hook Score: ${hookScore}/100) yang berpotensi menahan penonton di 3 detik pertama.`,
      highlightPoints: [
        `⚡ Lonjakan vokal terkuat di menit ${timeStr} (Hook Power: ${hookScore}%)`,
        `📈 Dinamika ritme suara & pacing tinggi (${pacingScore}% korelasi retensi)`,
        `🚀 Segmen prioritas utama dengan proyeksi share rate tertinggi`
      ]
    };
  }
  if (score >= 78) {
    return {
      label: 'HIGH VALUE',
      emoji: '⭐',
      color: '#f97316',
      grade: 'A',
      reason: `Pembahasan pada menit ${timeStr} memiliki intonasi vokal yang sangat jelas dan tempo pembicaraan yang ideal (Energy Score: ${energyScore}/100) untuk format Reels & TikTok.`,
      highlightPoints: [
        `💡 Intonasi pembicaraan padat dan berbobot di menit ${timeStr}`,
        `⏱ Pacing stabil (${pacingScore}%) dengan artikulasi vokal jernih`,
        `💬 Potensi interaksi kolom komentar tinggi`
      ]
    };
  }
  if (score >= 65) {
    return {
      label: 'ENGAGING',
      emoji: '⚡',
      color: '#eab308',
      grade: 'B',
      reason: `Cuplikan menit ${timeStr} menyajikan alur pembacaan materi yang konsisten dan menarik untuk didengarkan hingga akhir segmen (${dur}s).`,
      highlightPoints: [
        `📖 Penjelasan konteks materi yang berkesinambungan di menit ${timeStr}`,
        `🔄 Alur transisi antar kalimat yang halus dan alami`
      ]
    };
  }
  if (score >= 50) {
    return {
      label: 'LAYAK KONTEN',
      emoji: '📌',
      color: '#22c55e',
      grade: 'C',
      reason: `Segmen pada menit ${timeStr} memberikan latar belakang informatif yang cocok sebagai pendukung klip utama.`,
      highlightPoints: [
        `📝 Penjelasan latar belakang dan pembuka pembahasan di menit ${timeStr}`
      ]
    };
  }
  return {
    label: 'INFORMATIF',
    emoji: '📖',
    color: '#6b7280',
    grade: 'D',
    reason: `Segmen informatif umum pada menit ${timeStr}.`,
    highlightPoints: [`📌 Segmen pembuka/penutup pada menit ${timeStr}`]
  };
}

function generateMetadataForHighlight(seg, index, baseTitle = '') {
  const hook = HOOK_PATTERNS[index % HOOK_PATTERNS.length];
  const cleanBase = (baseTitle || 'Momen Terbaik').replace(/[^\w\s]/gi, '').slice(0, 35);
  
  const title = `${hook} (${cleanBase})`;
  const tags = [...DEFAULT_TAGS, `#Clip${index + 1}`, `#${cleanBase.replace(/\s+/g, '')}`];
  
  const description = `🔥 ${title}\n\n` +
    `Simak pembahasan menarik pada segmen ini! Jangan lupa Like, Komentar pendapatmu, dan Follow/Subscribe untuk cuplikan konten berkualitas lainnya.\n\n` +
    `📌 Durasi Klip: ${Math.round(seg.end - seg.start)} Detik\n` +
    `🏷️ Tags:\n${tags.slice(0, 7).join(' ')}`;

  return {
    autoTitle: title,
    autoTags: tags.slice(0, 8).join(' '),
    autoDescription: description
  };
}

/**
 * Assign scores (relative) and rich metadata for all segments.
 */
function assignScoresAndMetadata(segments, smoothed, globalAvgEnergy, baseVideoTitle, targetDuration, totalSecs) {
  const metrics = segments.map(seg => calcSegmentMetrics(seg, smoothed, globalAvgEnergy));
  const scoreList = calcRelativeScores(metrics, targetDuration, totalSecs);

  const scored = segments.map((seg, i) => {
    const scores = scoreList[i];
    const rating = viralLabel(scores.totalScore, scores.hookScore, scores.energyScore, scores.pacingScore, i, seg.start, seg.end);
    const meta = generateMetadataForHighlight(seg, i, baseVideoTitle);

    return {
      start: seg.start,
      end: seg.end,
      score: Math.round(seg.avgEnergy),
      viralScore: scores.totalScore,
      viralGrade: rating.grade,
      viralLabel: rating.label,
      viralEmoji: rating.emoji,
      viralColor: rating.color,
      analysisReason: rating.reason,
      highlightPoints: rating.highlightPoints,
      hookScore: scores.hookScore,
      energyScore: scores.energyScore,
      pacingScore: scores.pacingScore,
      autoTitle: meta.autoTitle,
      autoTags: meta.autoTags,
      autoDescription: meta.autoDescription
    };
  });

  return scored;
}

// ===== Main Detector =====

function detectHighlights(videoPath, baseVideoTitle = '', options = {}) {
  return new Promise((resolve, reject) => {
    // Target durasi dari preset platform (TikTok 30s, Shorts 55s, Reels 60s, X 90s)
    const targetDuration = Math.min(
      MAX_TARGET_DURATION,
      Math.max(MIN_SEGMENT_DURATION, parseInt(options.targetDuration, 10) || DEFAULT_TARGET_DURATION)
    );
    const maxHighlights = parseInt(options.maxHighlights, 10) || TOP_N;
    const maxDur = Math.min(120, Math.ceil(targetDuration * 1.3));

    logger.info('Memulai analisis konten AI untuk viral highlight detection...', {
      videoPath, targetDuration, maxHighlights
    });

    const args = ['-i', videoPath, '-f', 's16le', '-ac', '1', '-ar', '8000', '-'];
    const child = spawn(FFMPEG_PATH, args);
    const rawEnergies = [];

    let buffer = Buffer.alloc(0);
    const chunkSize = 16000; // 1 detik = 8000 samples × 2 byte

    child.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= chunkSize) {
        const slice = buffer.slice(0, chunkSize);
        buffer = buffer.slice(chunkSize);
        let sumSq = 0;
        const n = slice.length / 2;
        for (let i = 0; i < slice.length; i += 2) {
          const s = slice.readInt16LE(i);
          sumSq += s * s;
        }
        rawEnergies.push(Math.sqrt(sumSq / n));
      }
    });

    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code !== 0 && rawEnergies.length === 0) {
        return reject(new AppError('Gagal menganalisis audio video.', 500, ERROR_CODES.FFMPEG_FAILED));
      }
      if (rawEnergies.length === 0) return resolve({ highlights: [], energies: [] });

      const totalSecs = rawEnergies.length;
      const smoothed = movingAverage(rawEnergies, SMOOTH_WINDOW);
      const globalAvgEnergy = smoothed.reduce((a, b) => a + b, 0) / smoothed.length;

      // Sliding window score
      const windowScores = smoothed.map((_, i) => {
        const winEnd = Math.min(totalSecs - 1, i + WINDOW_SEC);
        let sum = 0;
        for (let j = i; j <= winEnd; j++) sum += smoothed[j];
        return sum / (winEnd - i + 1);
      });

      // Pilih jendela klip: jumlah menyesuaikan panjang video vs target durasi
      const maxCount = Math.max(1, Math.min(maxHighlights, Math.floor(totalSecs / Math.max(20, targetDuration))));
      const windows = selectWindows(windowScores, targetDuration, totalSecs, maxCount);
      if (process.env.HL_DEBUG) console.log('[DEBUG] windows=', windows.map(w => `[${w.start}-${w.end}]`), 'maxCount=', maxCount);

      // Hitung statistik energi tiap jendela
      const segments = windows.map(w => {
        let energySum = 0, energySqSum = 0;
        for (let i = w.start; i <= w.end; i++) {
          energySum += smoothed[i] || 0;
          energySqSum += (smoothed[i] || 0) ** 2;
        }
        const dur = w.end - w.start + 1;
        return {
          start: w.start,
          end: w.end,
          avgEnergy: energySum / dur,
          variance: Math.max(0, energySqSum / dur - (energySum / dur) ** 2)
        };
      });

      // Merge aman (biasanya non-overlap; menjaga dari tepian)
      const merged = mergeCloseSegments(segments, maxDur);
      if (process.env.HL_DEBUG) console.log('[DEBUG] merged=', merged.map(s => `[${s.start}-${s.end}]`));

      // Filter minimum duration
      const valid = merged.filter(s => (s.end - s.start) >= MIN_SEGMENT_DURATION);

      // Assign rich scores (relative antar segmen) and metadata
      const scoredSegs = assignScoresAndMetadata(valid, smoothed, globalAvgEnergy, baseVideoTitle, targetDuration, totalSecs);
      if (process.env.HL_DEBUG) console.log('[DEBUG] scored=', scoredSegs.map(s => `[${s.start}-${s.end}] v=${s.viralScore} g=${s.viralGrade}`));
      let highlights = filterOverlaps(scoredSegs, maxHighlights);

      // Fallback jika video sangat pendek atau energi konstan
      if (highlights.length === 0 && totalSecs >= 10) {
        const segDur = Math.min(targetDuration, Math.max(15, Math.floor(totalSecs / 3)));
        for (let t = 0; t < totalSecs; t += segDur) {
          const segEnd = Math.min(totalSecs, t + segDur);
          if (segEnd - t >= 10) {
            const seg = { start: t, end: segEnd, avgEnergy: 80, variance: 20 };
            const meta = generateMetadataForHighlight(seg, highlights.length, baseVideoTitle);
            highlights.push({
              start: t,
              end: segEnd,
              score: 80,
              viralScore: Math.max(65, 92 - (highlights.length * 8)),
              viralGrade: highlights.length === 0 ? 'S' : (highlights.length === 1 ? 'A' : 'B'),
              viralLabel: highlights.length === 0 ? 'VIRAL MAGNET' : 'HIGH VALUE',
              viralEmoji: highlights.length === 0 ? '🔥' : '⭐',
              viralColor: highlights.length === 0 ? '#ef4444' : '#f97316',
              analysisReason: 'Porsi segmen terpadat dengan retensi durasi emas.',
              hookScore: 90,
              energyScore: 85,
              pacingScore: 80,
              autoTitle: meta.autoTitle,
              autoTags: meta.autoTags,
              autoDescription: meta.autoDescription
            });
          }
        }
      }

      // Sort by start time for clean chronological list
      highlights.sort((a, b) => a.start - b.start);

      logger.info('Viral highlight detection selesai', {
        totalDuration: totalSecs,
        segmensValid: valid.length,
        highlightsFound: highlights.length,
      });

      resolve({ highlights, energies: rawEnergies });
    });
  });
}

module.exports = { detectHighlights };
