/**
 * services/silence.service.js
 * Deteksi jeda diam (dead air) dalam audio/video menggunakan FFmpeg silencedetect.
 * Mengembalikan daftar rentang waktu ucapan aktif (non-silent speech intervals)
 * untuk fitur Silence Remover & Fast Jump-Cut.
 */

const { spawn } = require('child_process');
const re = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { fileExists } = require('../utils/fileHelper');

/**
 * Mendeteksi interval ucapan aktif (non-silent) dalam rentang waktu video.
 * @param {object} params
 * @param {string} params.inputPath - Path file video sumber
 * @param {number} params.startSeconds - Waktu mulai (detik)
 * @param {number} params.endSeconds - Waktu selesai (detik)
 * @param {string} [params.noiseThreshold='-30dB'] - Ambang batas kebisingan
 * @param {number} [params.minSilenceDuration=0.35] - Durasi diam minimal (detik)
 * @returns {Promise<Array<{start: number, end: number}>>}
 */
function detectNonSilentIntervals({
  inputPath,
  startSeconds = 0,
  endSeconds = 30,
  noiseThreshold = '-30dB',
  minSilenceDuration = 0.35,
}) {
  return new Promise((resolve) => {
    if (!inputPath || !fileExists(inputPath)) {
      return resolve([{ start: startSeconds, end: endSeconds }]);
    }

    const startSec = Math.max(0, parseFloat(startSeconds) || 0);
    const endSec = Math.max(startSec + 0.5, parseFloat(endSeconds) || (startSec + 30));
    const durSec = endSec - startSec;

    const ffmpegBin = config.binaries.ffmpeg || 'ffmpeg';
    const args = [
      '-y',
      '-ss', String(startSec),
      '-t', String(durSec),
      '-i', inputPath,
      '-af', `silencedetect=noise=${noiseThreshold}:d=${minSilenceDuration}`,
      '-f', 'null',
      '-'
    ];

    const child = spawn(ffmpegBin, args);
    let stderr = '';

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', () => {
      try {
        const starts = [];
        const ends = [];

        const startMatches = stderr.matchAll(/silence_start:\s*([\d\.]+)/g);
        for (const m of startMatches) {
          starts.push(parseFloat(m[1]));
        }

        const endMatches = stderr.matchAll(/silence_end:\s*([\d\.]+)/g);
        for (const m of endMatches) {
          ends.push(parseFloat(m[1]));
        }

        if (starts.length === 0 && ends.length === 0) {
          return resolve([{ start: startSec, end: endSec }]);
        }

        const silences = [];
        for (let i = 0; i < Math.min(starts.length, ends.length); i++) {
          silences.append ? silences.push({ s: starts[i], e: ends[i] }) : silences.push({ s: starts[i], e: ends[i] });
        }
        if (starts.length > ends.length) {
          silences.push({ s: starts[starts.length - 1], e: durSec });
        }

        const speech = [];
        let cur = 0.0;
        for (const sil of silences) {
          if (sil.s - cur >= 0.15) {
            const sStart = Math.max(0, cur - 0.04) + startSec;
            const sEnd = Math.min(durSec, sil.s + 0.04) + startSec;
            speech.push({
              start: parseFloat(sStart.toFixed(3)),
              end: parseFloat(sEnd.toFixed(3)),
            });
          }
          cur = sil.e;
        }

        if (durSec - cur >= 0.15) {
          const sStart = Math.max(0, cur - 0.04) + startSec;
          const sEnd = durSec + startSec;
          speech.push({
            start: parseFloat(sStart.toFixed(3)),
            end: parseFloat(sEnd.toFixed(3)),
          });
        }

        if (speech.length > 0) {
          const savedSec = durSec - speech.reduce((sum, r) => sum + (r.end - r.start), 0);
          logger.info('Silence Remover aktif', {
            originalDuration: durSec.toFixed(2),
            speechIntervalsCount: speech.length,
            deadAirRemovedSeconds: savedSec.toFixed(2),
          });
          return resolve(speech);
        }
      } catch (err) {
        logger.warn('Error parsing silence detect output', { error: err.message });
      }

      resolve([{ start: startSec, end: endSec }]);
    });
  });
}

module.exports = {
  detectNonSilentIntervals,
};
