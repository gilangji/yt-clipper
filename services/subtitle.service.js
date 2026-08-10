/**
 * services/subtitle.service.js
 * Service untuk auto-generate subtitle berbasis AI (faster-whisper)
 * dan mengonversinya ke format ASS dengan styling dinamis untuk Shorts / TikTok / Reels.
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');
const AppError = require('../utils/AppError');
const { ERROR_CODES } = require('../config/constants');

/**
 * Generate subtitle ASS dari audio/video input secara asinkron via Python Whisper.
 * @param {object} params
 * @param {string} params.inputPath - Path file video atau audio
 * @param {string} [params.style='yellow-viral'] - 'yellow-viral' | 'neon-green' | 'cyan-blue' | 'clean-white'
 * @param {string} [params.language='auto'] - 'auto' | 'id' | 'en'
 * @param {string} [params.fontFamily='auto'] - Override jenis font ('auto' = dari template)
 * @param {number} [params.startSeconds=0]
 * @param {number} [params.durationSeconds]
 * @returns {Promise<string>} path ke file .ass yang dihasilkan
 */
function generateSubtitleAss({ inputPath, style = 'quick-brown-inv', fontSize = 'large', position = 'bottom', textCase = 'uppercase', language = 'auto', fontFamily = 'auto', startSeconds = 0, durationSeconds, width = 720, height = 1280 }) {
  return new Promise((resolve, reject) => {
    const subId = uuidv4();
    const configPath = path.join(config.folders.temp, `subcfg_${subId}.json`);
    const outputAssPath = path.join(config.folders.temp, `sub_${subId}.ass`);

    if (!fs.existsSync(config.folders.temp)) {
      fs.mkdirSync(config.folders.temp, { recursive: true });
    }

    const configData = {
      inputMedia: inputPath,
      outputAss: outputAssPath,
      style,
      fontSize,
      position,
      textCase,
      language,
      fontFamily,
      startSeconds,
      durationSeconds,
      playResX: width,
      playResY: height,
      ffmpegPath: config.binaries.ffmpeg || 'ffmpeg'
    };

    fs.writeFileSync(configPath, JSON.stringify(configData));

    const pythonBin = config.binaries.python || 'python3';
    const scriptPath = path.join(__dirname, '../utils/transcriber.py');

    const child = spawn(pythonBin, [scriptPath, configPath]);

    let stderr = '';
    let stdout = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('close', (code) => {
      if (fs.existsSync(configPath)) {
        try { fs.unlinkSync(configPath); } catch (e) {}
      }

      if (code !== 0 || !fs.existsSync(outputAssPath)) {
        logger.warn('Gagal men-generate subtitle Whisper', { error: stderr, stdout });
        reject(new AppError(`Gagal membuat subtitle AI: ${stderr || 'Unknown error'}`, 500, ERROR_CODES.FFMPEG_FAILED));
      } else {
        logger.info('Subtitle ASS berhasil dibuat', { outputAssPath });
        resolve(outputAssPath);
      }
    });
  });
}

/**
 * Render PNG preview subtitle (frame nyata via ffmpeg+libass) — identik dengan hasil ekspor.
 * @param {object} params
 * @param {string} [params.style='mrbeast-white']
 * @param {string} [params.fontSize='large']
 * @param {string} [params.fontFamily='auto']
 * @param {string} [params.textCase='uppercase']
 * @param {string} [params.text='RAHASIA SUKSES']
 * @param {number} [params.width=720]
 * @param {number} [params.height=1280]
 * @returns {Promise<string>} path ke file .png preview
 */
function renderSubtitlePreview({ style = 'quick-brown-inv', fontSize = 'large', fontFamily = 'auto', textCase = 'uppercase', text = 'RAHASIA\nSUKSES 2026', width = 720, height = 1280 } = {}) {
  return new Promise((resolve, reject) => {
    const runId = uuidv4();
    const configPath = path.join(config.folders.temp, `previewcfg_${runId}.json`);
    const outputPng = path.join(config.folders.temp, `preview_${runId}.png`);

    if (!fs.existsSync(config.folders.temp)) {
      fs.mkdirSync(config.folders.temp, { recursive: true });
    }

    fs.writeFileSync(configPath, JSON.stringify({
      outputPng,
      style,
      fontSize,
      fontFamily,
      textCase,
      text,
      width,
      height,
      bgColor: '0x101323',
      ffmpegPath: config.binaries.ffmpeg || 'ffmpeg',
    }));

    const pythonBin = config.binaries.python || 'python3';
    const scriptPath = path.join(__dirname, '../utils/transcriber.py');
    const child = spawn(pythonBin, [scriptPath, configPath]);

    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (fs.existsSync(configPath)) {
        try { fs.unlinkSync(configPath); } catch (e) {}
      }
      if (code === 0 && fs.existsSync(outputPng)) {
        resolve(outputPng);
      } else {
        reject(new Error(stderr || 'Preview render failed'));
      }
    });
  });
}

module.exports = { generateSubtitleAss, renderSubtitlePreview };
