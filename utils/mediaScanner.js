/**
 * utils/mediaScanner.js
 * Hook best-effort untuk memberi tahu Android MediaStore bahwa ada file baru
 * (video hasil ekspor) sehingga langsung muncul di Galeri/File Manager.
 *
 * Berjalan di Termux: memanggil binary `termux-media-scan` (dari paket termux-api).
 * Jika tidak ada / bukan Android / gagal → silent (tidak pernah melempar error).
 */

const { execFile } = require('child_process');
const fs = require('fs');
const logger = require('./logger');

/**
 * Deteksi apakah kita berjalan di Android/Termux.
 * Node.js di Termux melaporkan process.platform === 'android'.
 */
function isAndroid() {
  return process.platform === 'android';
}

/**
 * Cek apakah binary termux-media-scan tersedia di PATH.
 */
function hasTermuxMediaScan() {
  if (!isAndroid()) return false;
  const { PATH } = process.env;
  if (!PATH) return false;
  const candidates = PATH.split(':').filter(Boolean);
  return candidates.some((dir) => {
    try {
      return fs.existsSync(`${dir}/termux-media-scan`);
    } catch {
      return false;
    }
  });
}

/**
 * Pindai satu file/direktori ke Android MediaStore.
 * Best-effort: error apa pun ditelan (log warn saja), tidak pernah mengganggu pipeline.
 *
 * @param {string} filePath - path absolut file atau direktori yang mau dipindai
 */
function scanMedia(filePath) {
  return new Promise((resolve) => {
    if (!isAndroid()) return resolve(false);
    if (!hasTermuxMediaScan()) {
      logger.info('termux-media-scan tidak tersedia — skip media scan (install: pkg install termux-api)');
      return resolve(false);
    }
    if (!filePath || !fs.existsSync(filePath)) {
      logger.warn('scanMedia: path tidak ditemukan, skip', { filePath });
      return resolve(false);
    }

    execFile('termux-media-scan', [filePath], { timeout: 30000 }, (err) => {
      if (err) {
        logger.warn('termux-media-scan gagal (non-fatal)', { filePath, error: err.message });
        return resolve(false);
      }
      logger.info('Media scan sukses — video terdaftar di MediaStore', { filePath });
      resolve(true);
    });
  });
}

module.exports = { scanMedia, isAndroid, hasTermuxMediaScan };
