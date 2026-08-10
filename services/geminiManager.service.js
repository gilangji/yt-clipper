/**
 * services/geminiManager.service.js
 * Multi-Key Rotation & Failover Manager for Google Gemini API.
 * Similar to OpenCode account auto-rotation: if Key 1 hits 429/Quota Limit,
 * automatically switches to Key 2, Key 3, etc.
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const KEYS_FILE = path.join(__dirname, '../config/gemini-keys.json');

class GeminiManager {
  constructor() {
    this.keys = [];
    this.currentIndex = 0;
    this.keyStates = new Map(); // key -> { status: 'active' | 'exhausted', failCount: 0, lastUsed: timestamp }
    this.initKeys();
  }

  initKeys() {
    this.keys = [];

    // 1. Baca dari file config/gemini-keys.json jika ada
    if (fs.existsSync(KEYS_FILE)) {
      try {
        const fileContent = fs.readFileSync(KEYS_FILE, 'utf8');
        const parsed = JSON.parse(fileContent);
        if (Array.isArray(parsed.keys)) {
          parsed.keys.forEach(k => { if (k && typeof k === 'string') this.keys.push(k.trim()); });
        }
      } catch (e) {
        logger.warn('Gagal membaca config/gemini-keys.json:', e.message);
      }
    }

    // 2. Baca dari environment variable (GOOGLE_AI_API_KEY, GEMINI_API_KEYS)
    const envKeys = process.env.GEMINI_API_KEYS || process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY;
    if (envKeys) {
      envKeys.split(',').forEach(k => {
        const trimmed = k.trim();
        if (trimmed && !this.keys.includes(trimmed)) {
          this.keys.push(trimmed);
        }
      });
    }

    // Inisialisasi status tiap key
    this.keys.forEach(k => {
      if (!this.keyStates.has(k)) {
        this.keyStates.set(k, { status: 'active', failCount: 0, lastUsed: null });
      }
    });

    logger.info(`Gemini Key Manager diinisialisasi dengan ${this.keys.length} API key.`);
  }

  saveKeysToFile() {
    try {
      const configDir = path.dirname(KEYS_FILE);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      fs.writeFileSync(KEYS_FILE, JSON.stringify({ keys: this.keys }, null, 2));
    } catch (e) {
      logger.warn('Gagal menyimpan key ke config/gemini-keys.json:', e.message);
    }
  }

  addKeys(newKeysInput) {
    if (!newKeysInput) return;
    const keyList = Array.isArray(newKeysInput) ? newKeysInput : newKeysInput.split(/[\n,;\s]+/);
    
    let addedCount = 0;
    keyList.forEach(k => {
      const trimmed = k ? k.trim() : '';
      if (trimmed && trimmed.startsWith('AIza') && !this.keys.includes(trimmed)) {
        this.keys.push(trimmed);
        this.keyStates.set(trimmed, { status: 'active', failCount: 0, lastUsed: null });
        addedCount++;
      }
    });

    if (addedCount > 0) {
      this.saveKeysToFile();
      logger.info(`Berhasil menambahkan ${addedCount} Gemini API Key baru ke rotation pool.`);
    }

    return this.getKeysStatus();
  }

  removeKey(keyToRemove) {
    this.keys = this.keys.filter(k => k !== keyToRemove);
    this.keyStates.delete(keyToRemove);
    this.saveKeysToFile();
    return this.getKeysStatus();
  }

  getWorkingKey() {
    if (this.keys.length === 0) return null;

    // Cari key aktif terdekat mulai dari currentIndex
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.currentIndex + i) % this.keys.length;
      const key = this.keys[idx];
      const state = this.keyStates.get(key) || { status: 'active' };

      if (state.status === 'active') {
        this.currentIndex = idx;
        state.lastUsed = new Date().toISOString();
        return key;
      }
    }

    // Jika semua key di-mark exhausted, coba reset status ke active & gunakan key pertama (fallback)
    logger.warn('Semua Gemini API key di-mark exhausted. Melakukan soft-reset status key pool...');
    this.keys.forEach(k => {
      const st = this.keyStates.get(k);
      if (st) st.status = 'active';
    });

    this.currentIndex = 0;
    return this.keys[0] || null;
  }

  markKeyExhausted(key, reason = 'Rate limit 429 / Quota Exceeded') {
    if (!key) return;
    const state = this.keyStates.get(key);
    if (state) {
      state.status = 'exhausted';
      state.failCount = (state.failCount || 0) + 1;
      logger.warn(`Gemini API Key [...${key.slice(-6)}] di-mark EXHAUSTED (Rotasi otomatis ke key berikutnya). Alasan: ${reason}`);
    }

    // Rotasi pointer ke key berikutnya
    this.currentIndex = (this.currentIndex + 1) % Math.max(1, this.keys.length);
  }

  getKeysStatus() {
    return {
      totalKeys: this.keys.length,
      activeKeyIndex: this.currentIndex,
      keys: this.keys.map((k, idx) => {
        const st = this.keyStates.get(k) || { status: 'active' };
        return {
          index: idx + 1,
          maskedKey: `...${k.slice(-6)}`,
          status: st.status,
          isCurrent: idx === this.currentIndex,
          lastUsed: st.lastUsed
        };
      })
    };
  }
}

const instance = new GeminiManager();
module.exports = instance;
