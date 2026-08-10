/**
 * controllers/health.controller.js
 * GET /api/health — status kesiapan engine untuk Android/Termux.
 * Ringan: cek binary via PATH, cek python engine (tanpa load model berat),
 * cek model whisper di cache, cek jumlah Gemini key.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const config = require('../config');
const asyncHandler = require('../utils/asyncHandler');

function checkBinary(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf-8', timeout: 10000 });
    if (r.error || r.status !== 0) return { available: false };
    return { available: true, version: (r.stdout || r.stderr || '').trim().split('\n')[0] };
  } catch (e) {
    return { available: false };
  }
}

function checkWhisperEngine() {
  // Reuse transcriber.py --selftest --fast (stub av + import ctranslate2/faster_whisper,
  // cek cache model — TANPA load model agar endpoint tetap cepat).
  const py = config.binaries.python || 'python3';
  const scriptPath = path.join(config.rootDir, 'utils', 'transcriber.py');
  try {
    const r = spawnSync(py, [scriptPath, '--selftest', '--fast'], {
      encoding: 'utf-8', timeout: 20000, cwd: config.rootDir,
    });
    if (r.status === 0 && r.stdout) {
      try { return JSON.parse(r.stdout.trim()); } catch (e) {}
    }
    return { ok: false, error: (r.stderr || '').trim().split('\n')[0] || 'engine check failed' };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

function checkWhisperModelCached() {
  const cacheDir = path.join(os.homedir(), '.cache', 'huggingface', 'hub');
  try {
    const entries = fs.readdirSync(cacheDir);
    const models = entries
      .filter((e) => e.startsWith('models--Systran--faster-whisper-'))
      .map((e) => e.replace('models--Systran--faster-whisper-', '').replace(/--/g, '/'))
      .filter((name) => fs.existsSync(path.join(cacheDir, `models--Systran--faster-whisper-${name}`, 'snapshots')))
      .sort();
    return models;
  } catch (e) {
    return [];
  }
}

function checkGeminiKeys() {
  try {
    const raw = fs.readFileSync(path.join(config.rootDir, 'config', 'gemini-keys.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.keys)) return parsed.keys.length;
  } catch (e) {}
  const envKeys = process.env.GEMINI_API_KEYS || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (envKeys) return envKeys.split(',').filter(Boolean).length;
  return 0;
}

function checkDisk() {
  try {
    const s = fs.statfsSync(config.folders.output);
    const freeGb = (s.bavail * s.bsize) / (1024 ** 3);
    return { freeGb: Math.round(freeGb * 10) / 10 };
  } catch (e) {
    return { freeGb: null };
  }
}

const getHealth = asyncHandler(async (req, res) => {
  const ytdlp = checkBinary(config.binaries.ytdlp || 'yt-dlp', ['--version']);
  const ffmpeg = checkBinary(config.binaries.ffmpeg || 'ffmpeg', ['-version']);
  const ffprobe = checkBinary(config.binaries.ffprobe || 'ffprobe', ['-version']);
  const whisper = checkWhisperEngine();
  const model = process.env.WHISPER_MODEL || 'base';

  const payload = {
    success: true,
    timestamp: new Date().toISOString(),
    platform: { node: process.version, arch: process.arch, platform: process.platform },
    deps: { ytdlp, ffmpeg, ffprobe },
    whisper: {
      installed: whisper.ok,
      compute: Array.isArray(whisper.compute) ? whisper.compute[0] : (whisper.compute || null),
      error: whisper.error || null,
      model,
      modelCached: whisper.cached === true,
      cachedModels: checkWhisperModelCached(),
    },
    gemini: { keyCount: checkGeminiKeys() },
    disk: checkDisk(),
    aiReady: whisper.ok && whisper.cached === true && checkGeminiKeys() > 0,
  };

  res.json(payload);
});

module.exports = { getHealth };
