/**
 * services/highlight.service.js
 * Analisis audio video → segmen highlight konten dengan Viral Potential Rating.
 *
 * Skor viral dihitung dari 4 dimensi:
 *  1. Energy Score    — energi rata-rata relatif terhadap seluruh video
 *  2. Variance Score  — fluktuasi energi (banyak puncak = lebih menarik)
 *  3. Duration Score  — durasi ideal: 60-120s tertinggi (Shorts/Reels)
 *  4. Peak Density    — kepadatan momen puncak dalam segmen
 */

const { spawn } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { ERROR_CODES } = require('../config/constants');

const FFMPEG_PATH = config.binaries.ffmpeg;

// ===== Parameters =====
const MIN_SEGMENT_DURATION = 30;    // Minimum 30 detik
const EXPAND_MAX = 90;              // Ekspansi per puncak maks 90 detik
const MAX_MERGED_DURATION = 180;    // Setelah merge maks 3 menit
const WINDOW_SEC = 30;              // Sliding window scoring
const SMOOTH_WINDOW = 10;           // Moving average smoothing
const ENERGY_THRESHOLD_MULT = 0.85; // Threshold ekspansi segmen
const MIN_GAP_TO_MERGE = 12;        // Gabungkan jika jarak < 12 detik
const TOP_N = 15;                   // Ambil hingga 15 highlight

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

function findLocalPeaks(scores, minGap) {
  const peaks = [];
  for (let i = 0; i < scores.length; i++) {
    let isPeak = true;
    for (let j = Math.max(0, i - minGap); j <= Math.min(scores.length - 1, i + minGap); j++) {
      if (j !== i && scores[j] >= scores[i]) { isPeak = false; break; }
    }
    if (isPeak) peaks.push(i);
  }
  return peaks;
}

function expandPeakToSegment(peakIdx, smoothed, avgEnergy, totalSecs) {
  const threshold = avgEnergy * ENERGY_THRESHOLD_MULT;
  let left = peakIdx, right = peakIdx;

  const tryExpand = (dir) => {
    const next = dir === 'right' ? right + 1 : left - 1;
    if (next < 0 || next >= totalSecs) return false;
    if (smoothed[next] >= threshold) {
      if (dir === 'right') right++; else left--;
      return true;
    }
    // Toleransi gap kecil (≤5 detik)
    let gap = next, gapSize = 0;
    while ((dir === 'right' ? gap < totalSecs : gap >= 0) && gapSize < 5) {
      if (smoothed[gap] >= threshold) break;
      dir === 'right' ? gap++ : gap--;
      gapSize++;
    }
    if (gapSize < 5 && gap >= 0 && gap < totalSecs && smoothed[gap] >= threshold) {
      if (dir === 'right') right = gap; else left = gap;
      return true;
    }
    return false;
  };

  while ((right - left) < EXPAND_MAX) {
    const expandedRight = tryExpand('right');
    const expandedLeft = tryExpand('left');
    if (!expandedRight && !expandedLeft) break;
  }

  if ((right - left) < MIN_SEGMENT_DURATION) {
    right = Math.min(totalSecs - 1, left + MIN_SEGMENT_DURATION);
  }

  const dur = right - left + 1;
  let energySum = 0, energySqSum = 0;
  for (let i = left; i <= right; i++) {
    energySum += smoothed[i] || 0;
    energySqSum += (smoothed[i] || 0) ** 2;
  }
  const avgSeg = energySum / dur;
  const variance = energySqSum / dur - avgSeg ** 2;

  return { start: left, end: right, avgEnergy: avgSeg, variance };
}

function mergeCloseSegments(segments) {
  if (segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const merged = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const cur = sorted[i];
    const gapSmall = cur.start - last.end <= MIN_GAP_TO_MERGE;
    const wouldExceedMax = (cur.end - last.start) > MAX_MERGED_DURATION;

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

function filterOverlaps(segments) {
  const sorted = [...segments].sort((a, b) => b.viralScore - a.viralScore);
  const selected = [];
  for (const seg of sorted) {
    const overlap = selected.some(s => seg.start < s.end && seg.end > s.start);
    if (!overlap) {
      selected.push(seg);
      if (selected.length >= TOP_N) break;
    }
  }
  return selected;
}

/**
 * Hitung raw score per segmen (untuk ranking relatif).
 * Nilai absolut tidak penting — yang penting bisa diurutkan.
 */
function calcRawScore(seg, globalAvgEnergy, globalMaxEnergy) {
  const dur = seg.end - seg.start;

  // Energy above average (higher = more active)
  const energyRatio = seg.avgEnergy / Math.max(1, globalAvgEnergy);

  // Variance (excitement / emotional range)
  const stdDev = Math.sqrt(seg.variance);
  const normStd = stdDev / Math.max(1, globalAvgEnergy);

  // Duration bonus: 60-120s ideal for Shorts/Reels
  let durBonus;
  if (dur >= 60 && dur <= 120) durBonus = 1.3;
  else if (dur > 120 && dur <= 240) durBonus = 1.15;
  else if (dur > 240 && dur <= 360) durBonus = 1.0;
  else if (dur >= 45 && dur < 60) durBonus = 1.1;
  else if (dur >= 30 && dur < 45) durBonus = 1.05;
  else durBonus = 0.85; // >6min or very short

  return (energyRatio * 0.6 + normStd * 0.4) * durBonus;
}

/**
 * Konversi skor viral ke label dan warna.
 */
function viralLabel(score) {
  if (score >= 85) return { label: 'VIRAL TINGGI',     emoji: '🚀', color: '#ef4444', grade: 'S' };
  if (score >= 70) return { label: 'Sangat Potensial', emoji: '🔥', color: '#f97316', grade: 'A' };
  if (score >= 55) return { label: 'Berpotensi',       emoji: '⚡', color: '#eab308', grade: 'B' };
  if (score >= 38) return { label: 'Layak Konten',     emoji: '📌', color: '#22c55e', grade: 'C' };
  return              { label: 'Informatif',           emoji: '📖', color: '#6b7280', grade: 'D' };
}

/**
 * Assign percentile-based viral scores across all segments.
 * Top 10% → 85-100 (S), Next 20% → 70-84 (A), Next 25% → 55-69 (B),
 * Next 30% → 38-54 (C), Bottom 15% → 0-37 (D)
 */
function assignPercentileScores(segments, globalAvgEnergy, globalMaxEnergy) {
  const rawScores = segments.map(seg => calcRawScore(seg, globalAvgEnergy, globalMaxEnergy));
  const sorted = [...rawScores].sort((a, b) => a - b);
  const n = sorted.length;

  return segments.map((seg, i) => {
    const raw = rawScores[i];
    // Percentile rank 0-1
    const rank = sorted.findIndex(v => v >= raw) / Math.max(1, n - 1);
    // Map rank to 0-100 score with deliberate curve to spread grades
    const viralScore = Math.round(rank * 100);
    const rating = viralLabel(viralScore);
    return {
      start: seg.start,
      end: seg.end,
      score: Math.round(seg.avgEnergy),
      viralScore,
      viralGrade: rating.grade,
      viralLabel: rating.label,
      viralEmoji: rating.emoji,
      viralColor: rating.color,
    };
  });
}


// ===== Main Detector =====

function detectHighlights(videoPath) {
  return new Promise((resolve, reject) => {
    logger.info('Memulai analisis audio untuk viral highlight detection...', { videoPath });

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
      const globalMaxEnergy = Math.max(...smoothed);

      // Sliding window score
      const windowScores = smoothed.map((_, i) => {
        const winEnd = Math.min(totalSecs - 1, i + WINDOW_SEC);
        let sum = 0;
        for (let j = i; j <= winEnd; j++) sum += smoothed[j];
        return sum / (winEnd - i + 1);
      });

      // Local peaks (min 45s gap)
      const peakIndices = findLocalPeaks(windowScores, MIN_SEGMENT_DURATION);

      // Expand each peak
      const segments = peakIndices.map(p => expandPeakToSegment(p, smoothed, globalAvgEnergy, totalSecs));

      // Merge close segments
      const merged = mergeCloseSegments(segments);

      // Filter minimum duration
      const valid = merged.filter(s => (s.end - s.start) >= MIN_SEGMENT_DURATION);

      // Assign percentile-based viral scores (ensures spread of S/A/B/C/D grades)
      const scored = assignPercentileScores(valid, globalAvgEnergy, globalMaxEnergy);

      // Remove overlaps, sort by viral score, take top N
      const highlights = filterOverlaps(scored);

      // Final sort: by start time for clean display
      highlights.sort((a, b) => a.start - b.start);

      logger.info('Viral highlight detection selesai', {
        totalDuration: totalSecs,
        segmensValid: valid.length,
        highlightsFound: highlights.length,
        grades: highlights.map(h => h.viralGrade + ':' + Math.round((h.end - h.start)) + 's'),
      });

      resolve({ highlights, energies: rawEnergies });
    });
  });
}

module.exports = { detectHighlights };
