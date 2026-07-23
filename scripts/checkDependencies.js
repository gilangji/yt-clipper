/**
 * scripts/checkDependencies.js
 *
 * Memverifikasi bahwa binary eksternal yang dibutuhkan (yt-dlp, ffmpeg)
 * tersedia di PATH sistem sebelum aplikasi dijalankan.
 *
 * Dipanggil secara otomatis saat startup (app.js) dan juga bisa
 * dijalankan manual via: npm run check:deps
 */

const { spawnSync } = require('child_process');

/**
 * Menjalankan command versi untuk mengecek ketersediaan binary.
 * @param {string} command - Nama binary (mis. 'yt-dlp', 'ffmpeg')
 * @param {string[]} args - Argumen untuk cek versi
 * @returns {{ available: boolean, version: string|null }}
 */
function checkBinary(command, args) {
  try {
    const result = spawnSync(command, args, { encoding: 'utf-8', timeout: 15000 });

    if (result.error || result.status !== 0) {
      return { available: false, version: null };
    }

    const output = (result.stdout || result.stderr || '').trim().split('\n')[0];
    return { available: true, version: output };
  } catch (err) {
    return { available: false, version: null };
  }
}

const fs = require('fs');
const config = require('../config');

/**
 * Menjalankan seluruh pengecekan dependency eksternal.
 * @returns {{ ok: boolean, results: object }}
 */
function checkAllDependencies() {
  const ytdlp = checkBinary(config.binaries.ytdlp || 'yt-dlp', ['--version']);

  const ffmpegPath = config.binaries.ffmpeg || 'ffmpeg';
  const ffmpeg = checkBinary(ffmpegPath, ['-version']);

  const ffprobePath = config.binaries.ffprobe || 'ffprobe';
  const ffprobe = checkBinary(ffprobePath, ['-version']);

  const pythonBin = config.binaries.python || 'python3';
  const pythonScript = "import sys, numpy; mods=['numpy']; " +
    "try:\n import cv2; mods.append('opencv')\nexcept:\n pass\n" +
    "try:\n import mediapipe; mods.append('mediapipe')\nexcept:\n pass\n" +
    "print(f'Python {sys.version.split()[0]} ({\", \".join(mods)})')";
  const python = checkBinary(pythonBin, ['-c', pythonScript]);

  const results = { ytdlp, ffmpeg, ffprobe, python };
  const ok = ytdlp.available && ffmpeg.available && ffprobe.available && python.available;

  return { ok, results };
}

/**
 * Mencetak hasil pengecekan dengan format yang mudah dibaca di terminal.
 */
function printReport() {
  const { ok, results } = checkAllDependencies();

  console.log('\n========================================');
  console.log(' YouTube Clipper - Dependency Check');
  console.log('========================================');

  Object.entries(results).forEach(([name, info]) => {
    const status = info.available ? '✔ OK' : '✘ MISSING';
    const version = info.available ? info.version : 'tidak ditemukan di PATH';
    console.log(` ${name.padEnd(10)} : ${status.padEnd(10)} (${version})`);
  });

  console.log('========================================');

  if (!ok) {
    console.log('\n⚠ Beberapa dependency eksternal belum terpasang.');
    console.log('  Silakan cek README.md bagian "Instalasi FFmpeg & yt-dlp".\n');
  } else {
    console.log('\n✔ Semua dependency eksternal siap digunakan.\n');
  }

  return ok;
}

// Jika dijalankan langsung via `node scripts/checkDependencies.js`
if (require.main === module) {
  const ok = printReport();
  process.exit(ok ? 0 : 1);
}

module.exports = { checkAllDependencies, printReport, checkBinary };
