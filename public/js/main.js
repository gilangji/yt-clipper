/**
 * public/js/main.js
 * Logic utama frontend Clipreel: face tracking, active speaker detection,
 * highlight visualization, dan rendering asinkron via SSE.
 */

(function () {
  'use strict';

  // ===== AI Model & Tracking State =====
  let faceModel = null;
  let modelReady = false;
  let trackingInterval = null;
  let cropPoints = []; // Array of {time, cx, cy, landmarks, manual}
  let trackedFaces = []; // Array of {id, cx, cy, w, h, lastSeen, speechHistory, speechActivity, isSpeaking}
  let faceIdCounter = 0;
  let activeSpeaker = null;
  let lastFocusCx = 0.5;
  let lastFocusCy = 0.5;
  // State untuk velocity prediction (kamkera antisipasi gerak karakter, tidak tertinggal)
  let lastFaceCx = null;
  let lastFaceCy = null;
  let velCx = 0;
  let velCy = 0;
  let heatmapHistory = [];
  const HEATMAP_MAX_HISTORY = 20;

  // Dragging crop override coordinates
  let isDraggingCropBox = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartCx = 0.5;
  let dragStartCy = 0.5;

  // ===== UI Elements =====
  const urlForm = document.getElementById('urlForm');
  const urlInput = document.getElementById('urlInput');
  const urlError = document.getElementById('urlError');
  const dropzone = document.getElementById('dropzone');
  const loadBtn = document.getElementById('loadBtn');

  const previewSection = document.getElementById('previewSection');
  const thumbImg = document.getElementById('thumbImg');
  const videoElement = document.getElementById('videoElement');
  const trackerCanvas = document.getElementById('trackerCanvas');
  const cropPreviewBox = document.getElementById('cropPreviewBox');
  const durationBadge = document.getElementById('durationBadge');
  
  const videoTitle = document.getElementById('videoTitle');
  const videoChannel = document.getElementById('videoChannel');
  const aiStatus = document.getElementById('aiStatus');
  const metaDuration = document.getElementById('metaDuration');
  const metaSize = document.getElementById('metaSize');
  const metaSubtitle = document.getElementById('metaSubtitle');
  const metaResolutions = document.getElementById('metaResolutions');
  
  const ruler = document.getElementById('ruler');
  const rulerSelection = document.getElementById('rulerSelection');
  const timelinePlayhead = document.getElementById('timelinePlayhead');
  const timelineHeatmap = document.getElementById('timelineHeatmap');
  const highlightsContainer = document.getElementById('highlightsContainer');
  const highlightsList = document.getElementById('highlightsList');

  const clipForm = document.getElementById('clipForm');
  const startInput = document.getElementById('startInput');
  const endInput = document.getElementById('endInput');
  const resolutionSelect = document.getElementById('resolutionSelect');
  const aspectRatioSelect = document.getElementById('aspectRatioSelect');
  const headlineInput = document.getElementById('headlineInput');
  const autoSubtitleToggle = document.getElementById('autoSubtitleToggle');
  const subtitleStyleSelect = document.getElementById('subtitleStyleSelect');
  const subtitleSizeSelect = document.getElementById('subtitleSizeSelect');
  const subtitlePosSelect = document.getElementById('subtitlePosSelect');
  const subtitleCaseSelect = document.getElementById('subtitleCaseSelect');
  const subtitleOptionsRow = document.getElementById('subtitleOptionsRow');
  const subtitleLangSelect = document.getElementById('subtitleLangSelect');
  const subtitleFontSelect = document.getElementById('subtitleFontSelect');
  const previewSubtitleBtn = document.getElementById('previewSubtitleBtn');
  const previewRangeVideoBtn = document.getElementById('previewRangeVideoBtn');
  const subtitlePreviewWrap = document.getElementById('subtitlePreviewWrap');
  const subtitlePreviewImg = document.getElementById('subtitlePreviewImg');
  const previewBadge = document.getElementById('previewBadge');

  // Auto-Clipper subtitle config (ported from auto-clipper SubtitleConfigControls)
  const acModeKaraoke = document.getElementById('acModeKaraoke');
  const acModeStandard = document.getElementById('acModeStandard');
  const acModeBadge = document.getElementById('acModeBadge');
  const acLivePreviewText = document.getElementById('acLivePreviewText');
  const acFontFamilyBtns = document.querySelectorAll('#acFontFamilyGrid .ac-opt-btn');
  const acFontSizeBtns = document.querySelectorAll('#acFontSizeGrid .ac-opt-btn');
  const acFontWeightBtns = document.querySelectorAll('#acFontWeightGrid .ac-opt-btn');
  const acUppercaseToggle = document.getElementById('acUppercaseToggle');
  const acItalicToggle = document.getElementById('acItalicToggle');
  const acColorSwatches = document.querySelectorAll('#acColorRow .ac-color-swatch');
  const acColorInput = document.getElementById('acColorInput');
  const acColorText = document.getElementById('acColorText');
  const acHighlightLabel = document.getElementById('acHighlightLabel');

  // Modal 9:16 Video Preview
  const videoPreviewModal = document.getElementById('videoPreviewModal');
  const previewVideo916 = document.getElementById('previewVideo916');
  const previewVideoLoading = document.getElementById('previewVideoLoading');
  const previewVideoLoadingText = document.getElementById('previewVideoLoadingText');
  const closePreviewModalBtn = document.getElementById('closePreviewModalBtn');
  const applyPreviewToFormBtn = document.getElementById('applyPreviewToFormBtn');
  const queueFromPreviewBtn = document.getElementById('queueFromPreviewBtn');
  const modalGradeBadge = document.getElementById('modalGradeBadge');
  const modalTimeRange = document.getElementById('modalTimeRange');
  const modalSubStyleName = document.getElementById('modalSubStyleName');
  const metaClipTitle = document.getElementById('metaClipTitle');
  const metaClipTags = document.getElementById('metaClipTags');
  const metaClipDesc = document.getElementById('metaClipDesc');
  const generateMetaBtn = document.getElementById('generateMetaBtn');
  const platformPresetBtns = document.querySelectorAll('.platform-preset-btn');
  const customDurationInput = document.getElementById('customDurationInput');

  // Modal Buku Panduan
  const guideBtn = document.getElementById('guideBtn');
  const guideModal = document.getElementById('guideModal');
  const closeGuideModalBtn = document.getElementById('closeGuideModalBtn');
  const startUsingBtn = document.getElementById('startUsingBtn');
  const bgmTrackSelect = document.getElementById('bgmTrackSelect');
  const bgmVolumeSelect = document.getElementById('bgmVolumeSelect');
  const publishSocialBtn = document.getElementById('publishSocialBtn');
  const heatmapToggle = document.getElementById('heatmapToggle');
  const dynamicZoomToggle = document.getElementById('dynamicZoomToggle');
  const audioEnhanceToggle = document.getElementById('audioEnhanceToggle');
  const silenceRemoverToggle = document.getElementById('silenceRemoverToggle');
  const detectHighlightsBtn = document.getElementById('detectHighlightsBtn') || document.getElementById('clipBtn');
  const clipError = document.getElementById('clipError');
  const clipBtn = document.getElementById('clipBtn');

  const progressSection = document.getElementById('progressSection');
  const progressStage = document.getElementById('progressStage');
  const progressPercent = document.getElementById('progressPercent');
  const progressBar = document.getElementById('progressBar');
  const vuMeter = document.getElementById('vuMeter');

  const resultSection = document.getElementById('resultSection');
  const resultFilename = document.getElementById('resultFilename');
  const downloadBtn = document.getElementById('downloadBtn');
  const deleteBtn = document.getElementById('deleteBtn');
  const exportSelectedBtn = document.getElementById('exportSelectedBtn');
  const exportSelectedCount = document.getElementById('exportSelectedCount');

  const exportQueueBtn = document.getElementById('exportQueueBtn');
  const exportQueueCount = document.getElementById('exportQueueCount');
  const queuePanel = document.getElementById('queuePanel');
  const queueList = document.getElementById('queueList');
  const saveToQueueBtn = document.getElementById('saveToQueueBtn');

  const themeToggle = document.getElementById('themeToggle');
  const toastContainer = document.getElementById('toastContainer');

  let currentVideoDuration = 0;
  let currentJobId = null;
  let sourceVideoFilename = null;
  let selectedHighlights = new Set(); // Set of highlight indices selected for batch export
  let cachedHighlights = [];          // Last rendered highlights array
  let lastHighlightEngine = 'audio';  // 'ai' | 'audio' — engine terakhir dari server

  // ===== VU Meter (dekoratif) =====
  for (let i = 0; i < 24; i++) {
    const bar = document.createElement('span');
    bar.style.animationDelay = `${(i * 0.05).toFixed(2)}s`;
    vuMeter.appendChild(bar);
  }

  // ===== Theme Toggle =====
  const savedTheme = localStorage.getItem('clipreel-theme');
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

  themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    if (next === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem('clipreel-theme', next);
  });

  // ===== Engine Status Pill (Android readiness) =====
  const enginePill = document.getElementById('enginePill');
  async function refreshEngineStatus() {
    if (!enginePill) return;
    try {
      const r = await fetch('/api/health');
      if (!r.ok) throw new Error('health failed');
      const h = await r.json();
      const depsOk = h.deps.ytdlp.available && h.deps.ffmpeg.available && h.deps.ffprobe.available;
      if (!depsOk) {
        enginePill.textContent = '⚠️ ffmpeg/yt-dlp?';
        enginePill.className = 'engine-pill warn';
        enginePill.title = 'Binary penting hilang — cek start-android.sh';
        return;
      }
      if (h.whisper.installed && h.whisper.modelCached) {
        const gem = h.gemini.keyCount > 0 ? ` · ${h.gemini.keyCount}🔑` : ' · tanpa 🔑';
        enginePill.textContent = `✅ ${h.whisper.model}·${h.whisper.compute}${gem}`;
        enginePill.className = 'engine-pill ok';
        enginePill.title = 'Engine AI siap: transkrip + AI highlight berfungsi penuh';
      } else {
        const why = h.whisper.error ? ` — ${h.whisper.error}` : '';
        enginePill.textContent = '⚠️ AI turun (audio saja)';
        enginePill.className = 'engine-pill warn';
        enginePill.title = 'Whisper tidak siap. Jalankan: bash start-android.sh' + why;
      }
    } catch (e) {
      enginePill.textContent = '⚠️ API?';
      enginePill.className = 'engine-pill warn';
      enginePill.title = 'Gagal hubungi /api/health';
    }
  }
  refreshEngineStatus();
  setInterval(refreshEngineStatus, 30000); // refresh tiap 30 detik

  // ===== Toast Notification =====
  function showToast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast${type === 'error' ? ' error' : ''}`;
    el.textContent = message;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  // ===== Lazy-load script (tf.js/blazeface dimuat on-demand, bukan saat page load) =====
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Gagal memuat ' + src));
      document.head.appendChild(s);
    });
  }

  // ===== Load BlazeFace Model (LAZY + idempotent) =====
  // Dipicu dari 3 titik: video dimuat, video diputar, & saat scan wajah dibutuhkan.
  // Semua pemicu berbagi satu promise → tidak pernah download tf.js dua kali.
  let aiLoadPromise = null;
  function loadAIModel() {
    if (!aiLoadPromise) {
      aiLoadPromise = (async () => {
        try {
          // TensorFlow.js + BlazeFace di-inject on-demand → halaman awal tetap ringan
          if (typeof tf === 'undefined') {
            await loadScript('/js/tf.min.js');
          }
          if (typeof blazeface === 'undefined') {
            await loadScript('/js/blazeface.min.js');
          }
          if (typeof tf === 'undefined' || typeof blazeface === 'undefined') {
            throw new Error('TensorFlow.js atau BlazeFace belum termuat.');
          }
          aiStatus.textContent = 'AI LOADING...';
          await tf.ready();
          faceModel = await blazeface.load({ modelUrl: '/model/blazeface/model.json' });
          modelReady = true;
          aiStatus.textContent = 'AI ONLINE';
          aiStatus.style.borderColor = 'var(--accent)';
          aiStatus.style.color = 'var(--accent)';
          showToast('Model deteksi wajah BlazeFace berhasil dimuat.', 'success');
        } catch (err) {
          console.error(err);
          aiStatus.textContent = 'AI ERROR';
          aiStatus.style.borderColor = 'var(--amber, #f59e0b)';
          aiStatus.style.color = 'var(--amber, #f59e0b)';
          showToast('AI Error: ' + err.message, 'error');
          // Reset agar bisa dicoba ulang di pemicu berikutnya
          aiLoadPromise = null;
        }
      })();
    }
    return aiLoadPromise;
  }

  // Jamin model AI siap — await sampai tf.js + BlazeFace + model.json termuat.
  // Dipakai scanFacesInRange supaya ekspor TIDAK PERNAH batal diam-diam.
  async function ensureAIModel() {
    await loadAIModel();
    return { ready: modelReady, faceModel };
  }

  // TIDAK auto-load di window load lagi — model AI dipanaskan saat video dimuat
  // (setupLoadedVideo) & saat video diputar. Halaman awal tetap ringan.

  // ===== Drag & Drop URL =====
  ['dragenter', 'dragover'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    const text = e.dataTransfer.getData('text/plain');
    if (text) {
      urlInput.value = text.trim();
      urlForm.requestSubmit();
    }
  });

  // ===== Fetch API Helper =====
  async function apiRequest(url, options = {}) {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const json = await res.json();
    if (!res.ok || json.success === false) {
      const message = json?.error?.message || 'Terjadi kesalahan.';
      throw new Error(message);
    }
    return json;
  }

  function setButtonLoading(btn, loading, loadingText = 'Memproses…') {
    btn.disabled = loading;
    const label = btn.querySelector('.btn-label') || btn;
    if (!btn.dataset.originalLabel) btn.dataset.originalLabel = label.textContent || btn.innerText;
    
    if (label.textContent) {
      label.textContent = loading ? loadingText : btn.dataset.originalLabel;
    } else {
      btn.innerText = loading ? loadingText : btn.dataset.originalLabel;
    }
  }

  // ===== Time Format Helpers =====
  function secondsToTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
  }

  function timeToSeconds(value) {
    const parts = value.split(':').map(Number);
    if (parts.some(isNaN)) return NaN;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return NaN;
  }

  // ===== Update Ruler Selection =====
  function updateRuler() {
    if (!currentVideoDuration) return;
    const start = timeToSeconds(startInput.value);
    const end = timeToSeconds(endInput.value);
    if (isNaN(start) || isNaN(end)) return;

    const leftPct = Math.max(0, (start / currentVideoDuration) * 100);
    const rightPct = Math.max(0, 100 - (end / currentVideoDuration) * 100);
    rulerSelection.style.left = `${leftPct}%`;
    rulerSelection.style.right = `${rightPct}%`;
  }

  // ===== Vizard-style Transcript Editor (klik kalimat → potong) =====
  const transcriptContainer = document.getElementById('transcriptContainer');
  const loadTranscriptBtn = document.getElementById('loadTranscriptBtn');
  const copyTranscriptBtn = document.getElementById('copyTranscriptBtn');
  const transcriptStatus = document.getElementById('transcriptStatus');
  const transcriptList = document.getElementById('transcriptList');
  let transcriptSegments = [];
  let lastActiveTranscriptIdx = -1;

  async function loadTranscript() {
    if (!sourceVideoFilename) {
      showToast('Video preview belum siap. Tunggu unduhan selesai.', 'error');
      return;
    }
    try {
      loadTranscriptBtn.disabled = true;
      loadTranscriptBtn.innerHTML = '⏳ Mentranskripsi…';
      transcriptStatus.classList.remove('hidden');
      transcriptList.classList.add('hidden');
      transcriptStatus.textContent = 'Mentranskripsi audio dengan Whisper… (bisa 1–3 menit)';

      const resp = await fetch('/api/transcript', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: urlInput.value.trim(),
          videoPath: sourceVideoFilename,
          language: subtitleLangSelect ? subtitleLangSelect.value : 'auto',
        }),
      });
      const json = await resp.json();
      if (!json.success) throw new Error(json.message || 'Transkripsi gagal');

      transcriptSegments = json.data.segments || [];
      renderTranscript();
      transcriptContainer.classList.remove('hidden');
      showToast(`Transkrip siap: ${transcriptSegments.length} kalimat. Klik untuk potong!`, 'success');
    } catch (err) {
      transcriptStatus.textContent = 'Gagal memuat transkrip: ' + err.message;
      showToast('Gagal memuat transkrip: ' + err.message, 'error');
    } finally {
      loadTranscriptBtn.disabled = false;
      loadTranscriptBtn.innerHTML = '🔄 Muat Transkrip';
    }
  }

  function renderTranscript() {
    transcriptList.innerHTML = '';
    transcriptStatus.classList.add('hidden');
    transcriptList.classList.remove('hidden');
    lastActiveTranscriptIdx = -1;

    transcriptSegments.forEach((seg, i) => {
      const row = document.createElement('div');
      row.className = 't-row';
      row.dataset.idx = i;

      const time = document.createElement('span');
      time.className = 't-time';
      time.textContent = secondsToTime(seg.start);

      const text = document.createElement('span');
      text.className = 't-text';
      text.textContent = seg.text;

      row.appendChild(time);
      row.appendChild(text);

      row.addEventListener('click', () => {
        startInput.value = secondsToTime(seg.start);
        endInput.value = secondsToTime(Math.min(seg.end, currentVideoDuration || seg.end));
        updateRuler();
        if (videoElement && sourceVideoFilename) {
          videoElement.currentTime = seg.start;
        }
        transcriptList.querySelectorAll('.t-row').forEach(r => r.classList.remove('active'));
        row.classList.add('active');
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        showToast(`Rentang di-set: ${secondsToTime(seg.start)} — ${secondsToTime(seg.end)}`, 'info');
      });

      transcriptList.appendChild(row);
    });

    if (videoElement) videoElement.addEventListener('timeupdate', syncTranscriptHighlight);
  }

  function syncTranscriptHighlight() {
    if (!transcriptSegments.length || !videoElement) return;
    const t = videoElement.currentTime;
    let idx = transcriptSegments.findIndex(s => t >= s.start && t < s.end);
    if (idx === -1) {
      for (let i = transcriptSegments.length - 1; i >= 0; i--) {
        if (transcriptSegments[i].start <= t) { idx = i; break; }
      }
    }
    if (idx !== -1 && idx !== lastActiveTranscriptIdx) {
      lastActiveTranscriptIdx = idx;
      const rows = transcriptList.querySelectorAll('.t-row');
      rows.forEach((r, i) => r.classList.toggle('active', i === idx));
      if (rows[idx]) rows[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  if (loadTranscriptBtn) loadTranscriptBtn.addEventListener('click', loadTranscript);
  if (copyTranscriptBtn) {
    copyTranscriptBtn.addEventListener('click', async () => {
      const full = transcriptSegments.map(s => `${secondsToTime(s.start)} ${s.text}`).join('\n');
      try {
        await navigator.clipboard.writeText(full || '');
        showToast('Transkrip disalin ke clipboard!', 'success');
      } catch (e) {
        showToast('Gagal menyalin: ' + e.message, 'error');
      }
    });
  }

  // ===== Platform Preset Buttons & Durasi Kustom =====
  platformPresetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      platformPresetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const dur = parseInt(btn.dataset.duration, 10) || 30;
      if (customDurationInput) customDurationInput.value = dur;

      const startSec = timeToSeconds(startInput.value) || 0;
      let newEnd = startSec + dur;
      if (currentVideoDuration && newEnd > currentVideoDuration) {
        newEnd = currentVideoDuration;
      }
      endInput.value = secondsToTime(newEnd);
      
      const platform = btn.dataset.platform;
      if (platform === 'tiktok' || platform === 'shorts' || platform === 'reels') {
        aspectRatioSelect.value = '9:16';
      } else if (platform === 'twitter') {
        aspectRatioSelect.value = '1:1';
      }
      
      updateRuler();
      showToast(`Preset ${btn.textContent.trim()} diterapkan (${dur}s).`, 'info');
    });
  });

  if (customDurationInput) {
    customDurationInput.addEventListener('input', () => {
      const dur = parseInt(customDurationInput.value, 10);
      if (isNaN(dur) || dur < 1) return;

      platformPresetBtns.forEach(b => b.classList.remove('active'));

      const startSec = timeToSeconds(startInput.value) || 0;
      let newEnd = startSec + dur;
      if (currentVideoDuration && newEnd > currentVideoDuration) {
        newEnd = currentVideoDuration;
      }
      endInput.value = secondsToTime(newEnd);
      updateRuler();
    });
  }

  // Durasi preset platform yang sedang aktif (fleksibel: kustom atau preset)
  function getActivePlatformDuration() {
    if (customDurationInput && customDurationInput.value) {
      const val = parseInt(customDurationInput.value, 10);
      if (!isNaN(val) && val >= 3) return val;
    }
    const active = document.querySelector('.platform-preset-btn.active');
    return parseInt(active ? active.dataset.duration : '30', 10) || 30;
  }

  // ===== Custom Ratio Selector & Editor =====
  const customRatioBox = document.getElementById('customRatioBox');
  const customRatioW = document.getElementById('customRatioW');
  const customRatioH = document.getElementById('customRatioH');
  const applyCustomRatioBtn = document.getElementById('applyCustomRatioBtn');

  if (aspectRatioSelect) {
    aspectRatioSelect.addEventListener('change', () => {
      if (customRatioBox) {
        if (aspectRatioSelect.value === 'custom') {
          customRatioBox.classList.remove('hidden');
        } else {
          customRatioBox.classList.add('hidden');
        }
      }
    });
  }

  if (applyCustomRatioBtn) {
    applyCustomRatioBtn.addEventListener('click', () => {
      const w = parseInt(customRatioW.value, 10) || 9;
      const h = parseInt(customRatioH.value, 10) || 16;
      showToast(`Rasio kustom ${w}:${h} aktif untuk ekspor!`, 'success');
    });
  }

  function getEffectiveAspectRatio() {
    if (aspectRatioSelect && aspectRatioSelect.value === 'custom') {
      const w = parseInt(customRatioW?.value, 10) || 9;
      const h = parseInt(customRatioH?.value, 10) || 16;
      return `${w}:${h}`;
    }
    return aspectRatioSelect ? aspectRatioSelect.value : '9:16';
  }

  // ===== Multi-Clip Queue (Draft Antrian) =====
  const QUEUE_STORAGE_KEY = 'clipreel_queue_v1';
  let clipQueue = [];
  try {
    clipQueue = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) || '[]');
    if (!Array.isArray(clipQueue)) clipQueue = [];
  } catch (e) {
    clipQueue = [];
  }

  function persistQueue() {
    try { localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(clipQueue)); } catch (e) {}
  }

  function queueItemByRange(startSec, endSec) {
    return clipQueue.findIndex(q => Math.abs(q.start - startSec) < 1 && Math.abs(q.end - endSec) < 1);
  }

  function renderQueue() {
    if (!queueList || !queuePanel) return;
    queueList.innerHTML = '';
    const n = clipQueue.length;

    if (exportQueueBtn) {
      exportQueueBtn.style.display = n > 0 ? 'inline-flex' : 'none';
      exportQueueCount.textContent = n;
      exportQueueBtn.innerHTML = `📦 Ekspor Antrian (<span id="exportQueueCount">${n}</span>)`;
    }

    if (n === 0) {
      queuePanel.classList.add('hidden');
      return;
    }
    queuePanel.classList.remove('hidden');

    clipQueue.forEach((q, i) => {
      const row = document.createElement('div');
      row.className = 'queue-item';

      const idx = document.createElement('span');
      idx.className = 'q-idx';
      idx.textContent = `#${i + 1}`;

      const main = document.createElement('div');
      main.className = 'q-main';

      const range = document.createElement('div');
      range.className = 'q-range';
      const dur = Math.round(q.end - q.start);
      range.textContent = `${secondsToTime(q.start)} — ${secondsToTime(q.end)} · ${dur}s`;

      const title = document.createElement('div');
      title.className = 'q-title';
      title.textContent = q.title || '(tanpa judul)';
      title.title = q.title || '';

      main.appendChild(range);
      main.appendChild(title);

      if (q.tags) {
        const tags = document.createElement('div');
        tags.className = 'q-tags';
        tags.textContent = q.tags;
        tags.title = q.tags;
        main.appendChild(tags);
      }

      const actions = document.createElement('div');
      actions.className = 'q-actions';

      const editBtn = document.createElement('button');
      editBtn.textContent = '✏️ Edit';
      editBtn.title = 'Muat kembali ke form untuk diedit';
      editBtn.addEventListener('click', () => loadQueueItem(q.uid));

      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.className = 'q-del';
      delBtn.title = 'Hapus dari antrian';
      delBtn.addEventListener('click', () => {
        clipQueue = clipQueue.filter(x => x.uid !== q.uid);
        persistQueue();
        renderQueue();
        showToast('Klip dihapus dari antrian.', 'info');
      });

      actions.appendChild(editBtn);
      actions.appendChild(delBtn);

      row.appendChild(idx);
      row.appendChild(main);
      row.appendChild(actions);
      queueList.appendChild(row);
    });
  }

  function saveToQueue() {
    const startSec = timeToSeconds(startInput.value);
    const endSec = timeToSeconds(endInput.value);
    if (isNaN(startSec) || isNaN(endSec) || endSec <= startSec) {
      showToast('Range waktu tidak valid. Periksa IN/OUT.', 'error');
      return;
    }

    const item = {
      uid: 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      start: startSec,
      end: endSec,
      title: metaClipTitle ? metaClipTitle.value.trim() : '',
      tags: metaClipTags ? metaClipTags.value.trim() : '',
      description: metaClipDesc ? metaClipDesc.value.trim() : '',
      headline: headlineInput ? headlineInput.value.trim() : '',
    };

    const dupIdx = queueItemByRange(startSec, endSec);
    if (dupIdx >= 0) {
      clipQueue[dupIdx] = item; // overwrite jika range sama
      showToast('Antrian diperbarui untuk range yang sama.', 'info');
    } else {
      clipQueue.push(item);
      showToast('🗂️ Klip disimpan ke antrian sementara.', 'success');
    }
    persistQueue();
    renderQueue();
  }

  function loadQueueItem(uid) {
    const q = clipQueue.find(x => x.uid === uid);
    if (!q) return;
    startInput.value = secondsToTime(q.start);
    endInput.value = secondsToTime(q.end);
    updateRuler();
    if (videoElement.src) videoElement.currentTime = q.start;
    // Auto-uncheck heatmap: klip yang sudah diklip/diedit ulang TIDAK perlu
    // overlay kuning wajah (hasil terakhir terbakar di video sebelumnya).
    if (heatmapToggle) heatmapToggle.checked = false;
    if (metaClipTitle) metaClipTitle.value = q.title || '';
    if (metaClipTags) metaClipTags.value = q.tags || '';
    if (metaClipDesc) metaClipDesc.value = q.description || '';
    if (headlineInput) headlineInput.value = q.headline || '';
    showToast('Klip dimuat kembali untuk diedit. Heatmap nonaktif otomatis.', 'info');
    const metaPanel = document.getElementById('contentMetadataPanel');
    if (metaPanel) metaPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (saveToQueueBtn) {
    saveToQueueBtn.addEventListener('click', saveToQueue);
  }

  // Tampilkan antrian yang tersimpan (localStorage) saat halaman dimuat
  renderQueue();

  // ===== Content-Aware Metadata (backend: transkrip segmen → title/tags/desc) =====
  async function fetchContentMetadata(startSec, endSec) {
    if (!sourceVideoFilename) return null;
    try {
      const { data } = await apiRequest('/api/metadata/generate', {
        method: 'POST',
        body: JSON.stringify({
          videoPath: sourceVideoFilename,
          start: secondsToTime(startSec),
          end: secondsToTime(endSec),
          language: subtitleLangSelect ? subtitleLangSelect.value : 'auto',
          videoTitle: videoTitle.textContent.trim() || '',
        }),
      });
      return data;
    } catch (err) {
      showToast('Gagal generate metadata konten: ' + err.message, 'error');
      return null;
    }
  }

  function fillMetadataFields(meta) {
    if (!meta) return;
    if (metaClipTitle && meta.title) metaClipTitle.value = meta.title;
    if (metaClipTags && meta.tags) metaClipTags.value = meta.tags;
    if (metaClipDesc && meta.description) metaClipDesc.value = meta.description;
    // NOTE: headline tidak auto-fill — itu banner teks yang TERBAKAR permanen di video.
    // Biarkan kosong kecuali user mengisinya manual.
  }

  // ===== Preview Subtitle (render nyata PNG) =====
  function getActiveSubtitleTypography() {
    return {
      style: subtitleStyleSelect ? subtitleStyleSelect.value : 'quick-brown-inv',
      fontSize: subtitleSizeSelect ? subtitleSizeSelect.value : 'large',
      fontFamily: subtitleFontSelect ? subtitleFontSelect.value : 'auto',
      textCase: subtitleCaseSelect ? subtitleCaseSelect.value : 'uppercase',
      position: subtitlePosSelect ? subtitlePosSelect.value : 'bottom',
    };
  }

  // ===== Auto-Clipper Custom Subtitle Config (ported from auto-clipper) =====
  function getSubtitleConfig() {
    const style = acModeKaraoke && acModeKaraoke.classList.contains('active') ? 'karaoke' : 'standard';
    const activeFont = document.querySelector('#acFontFamilyGrid .ac-opt-btn.active');
    const activeSize = document.querySelector('#acFontSizeGrid .ac-opt-btn.active');
    const activeWeight = document.querySelector('#acFontWeightGrid .ac-opt-btn.active');
    const isUpper = acUppercaseToggle ? acUppercaseToggle.classList.contains('active') : true;
    const isItalic = acItalicToggle ? acItalicToggle.classList.contains('active') : false;
    let highlight = '#FFE600';
    if (acColorText && acColorText.value) {
      const v = acColorText.value.trim().replace(/^#/, '');
      if (/^[0-9a-fA-F]{6}$/.test(v)) highlight = '#' + v.toUpperCase();
    }
    return {
      style,
      highlight_color: highlight,
      font_family: activeFont ? activeFont.dataset.font : 'Arial',
      font_size_scale: activeSize ? parseFloat(activeSize.dataset.scale) : 1.0,
      font_weight: activeWeight ? activeWeight.dataset.weight : 'bold',
      italic: isItalic,
      uppercase: isUpper,
    };
  }

  function isAutoClipperMode() {
    return subtitleStyleSelect && subtitleStyleSelect.value === 'auto-clipper';
  }

  function getSubtitleConfigIfAuto() {
    return isAutoClipperMode() ? getSubtitleConfig() : undefined;
  }

  function renderAcLivePreview() {
    if (!acLivePreviewText) return;
    const cfg = getSubtitleConfig();
    const baseSize = 18 * cfg.font_size_scale;
    const fontStyle = [
      `font-family:${cfg.font_family}`,
      `font-weight:${cfg.font_weight === 'bold' ? 700 : 400}`,
      `font-style:${cfg.italic ? 'italic' : 'normal'}`,
      `text-transform:${cfg.uppercase ? 'uppercase' : 'none'}`,
      `font-size:${Math.round(baseSize)}px`,
    ].join(';');
    if (cfg.style === 'karaoke') {
      acLivePreviewText.innerHTML =
        `<span style="${fontStyle};color:#ffffff">BUAT KONTEN JADI LEBIH </span>` +
        `<span class="ac-preview-word" style="${fontStyle};color:${cfg.highlight_color};text-shadow:0 0 10px ${cfg.highlight_color}66, 0 2px 4px rgba(0,0,0,.9), -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;padding:2px 6px">VIRAL</span>` +
        `<span style="${fontStyle};color:#ffffff"> SEKARANG</span>`;
    } else {
      acLivePreviewText.innerHTML =
        `<span style="${fontStyle};color:#ffffff">Buat konten video Anda menjadi lebih menarik dan viral!</span>`;
    }
  }

  function wireAcSubtitleControls() {
    if (acModeKaraoke) acModeKaraoke.addEventListener('click', () => {
      acModeKaraoke.classList.add('active');
      if (acModeStandard) acModeStandard.classList.remove('active');
      if (acModeBadge) acModeBadge.textContent = 'KARAOKE';
      if (acHighlightLabel) acHighlightLabel.style.opacity = '1';
      renderAcLivePreview();
    });
    if (acModeStandard) acModeStandard.addEventListener('click', () => {
      acModeStandard.classList.add('active');
      if (acModeKaraoke) acModeKaraoke.classList.remove('active');
      if (acModeBadge) acModeBadge.textContent = 'STANDARD';
      if (acHighlightLabel) acHighlightLabel.style.opacity = '0.45';
      renderAcLivePreview();
    });
    acFontFamilyBtns.forEach(btn => btn.addEventListener('click', () => {
      acFontFamilyBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAcLivePreview();
    }));
    acFontSizeBtns.forEach(btn => btn.addEventListener('click', () => {
      acFontSizeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAcLivePreview();
    }));
    acFontWeightBtns.forEach(btn => btn.addEventListener('click', () => {
      acFontWeightBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAcLivePreview();
    }));
    if (acUppercaseToggle) acUppercaseToggle.addEventListener('click', () => {
      acUppercaseToggle.classList.toggle('active');
      renderAcLivePreview();
    });
    if (acItalicToggle) acItalicToggle.addEventListener('click', () => {
      acItalicToggle.classList.toggle('active');
      renderAcLivePreview();
    });
    function setHighlightColor(color) {
      const c = String(color || '#FFE600').toUpperCase();
      acColorSwatches.forEach(s => {
        s.classList.toggle('active', s.dataset.color.toUpperCase() === c);
      });
      if (acColorInput) acColorInput.value = /^#[0-9A-F]{6}$/i.test(c) ? c : '#FFE600';
      if (acColorText) acColorText.value = c;
      renderAcLivePreview();
    }
    acColorSwatches.forEach(s => s.addEventListener('click', () => setHighlightColor(s.dataset.color)));
    if (acColorInput) acColorInput.addEventListener('input', (e) => setHighlightColor(e.target.value));
    if (acColorText) acColorText.addEventListener('input', (e) => {
      let v = e.target.value.trim();
      if (/^[0-9a-fA-F]{6}$/.test(v)) v = '#' + v;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        setHighlightColor(v);
      } else {
        acColorSwatches.forEach(s => s.classList.remove('active'));
        renderAcLivePreview();
      }
    });
    renderAcLivePreview();
  }
  wireAcSubtitleControls();

  if (previewSubtitleBtn) {
    previewSubtitleBtn.addEventListener('click', async () => {
      const t = getActiveSubtitleTypography();
      const sampleText = 'RAHASIA\nSUKSES TANPA BATAS';
      setButtonLoading(previewSubtitleBtn, true, 'Merender preview…');
      try {
        const res = await fetch('/api/subtitle/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...t, text: sampleText, subtitleConfig: getSubtitleConfigIfAuto() }),
        });
        if (!res.ok) throw new Error('Gagal render preview.');
        const blob = await res.blob();
        // Konversi blob → base64 data URL: CSP lama hanya izinkan img-src data:,
        // blob: diblokir (kecuali setelah middleware/security.js di-restart).
        const buf = await blob.arrayBuffer();
        let bin = '';
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        const dataUrl = 'data:image/png;base64,' + btoa(bin);
        subtitlePreviewImg.src = dataUrl;
        subtitlePreviewWrap.classList.remove('hidden');
        const styleLabel = subtitleStyleSelect ? subtitleStyleSelect.options[subtitleStyleSelect.selectedIndex]?.textContent.trim() : t.style;
        let badgeText =
          `TEMPLATE: ${styleLabel}\nFONT: ${t.fontFamily === 'auto' ? '(dari template)' : t.fontFamily}\nSIZE: ${t.fontSize} · POS: ${t.position}`;
        if (isAutoClipperMode()) {
          const sc = getSubtitleConfig();
          badgeText += `\nMODE: ${sc.style.toUpperCase()} · HIGHLIGHT: ${sc.highlight_color} · ${sc.font_family} ${sc.font_size_scale}x ${sc.font_weight}${sc.italic ? ' italic' : ''}${sc.uppercase ? ' · UPPER' : ''}`;
        }
        previewBadge.textContent = badgeText;
        showToast('Preview subtitle siap!', 'success');
      } catch (err) {
        showToast('Preview gagal: ' + err.message, 'error');
      } finally {
        setButtonLoading(previewSubtitleBtn, false);
      }
    });
  }

  // ===== 9:16 Video Preview Controller =====
  let currentPreviewHlData = null;

  function closeVideoPreviewModal() {
    if (videoPreviewModal) {
      videoPreviewModal.classList.add('hidden');
      videoPreviewModal.setAttribute('aria-hidden', 'true');
    }
    if (previewVideo916) {
      try {
        previewVideo916.pause();
        previewVideo916.removeAttribute('src');
        previewVideo916.load();
      } catch (e) {}
    }
    currentPreviewHlData = null;
  }

  async function openVideoPreview916(hl = {}) {
    if (!sourceVideoFilename) {
      showToast('Video sumber belum siap dimuat.', 'error');
      return;
    }

    currentPreviewHlData = hl;
    const sVal = typeof hl.start === 'number' ? hl.start : timeToSeconds(startInput.value);
    const eVal = typeof hl.end === 'number' ? hl.end : timeToSeconds(endInput.value);
    const startSec = Math.max(0, sVal || 0);
    const endSec = Math.max(startSec + 1, eVal || (startSec + 15));

    if (videoPreviewModal) {
      videoPreviewModal.classList.remove('hidden');
      videoPreviewModal.setAttribute('aria-hidden', 'false');
    }
    if (previewVideoLoading) {
      previewVideoLoading.classList.remove('hidden');
    }
    if (previewVideoLoadingText) {
      previewVideoLoadingText.textContent = 'Merender preview 9:16 + Subtitle AI...';
    }

    if (modalTimeRange) {
      modalTimeRange.textContent = `${secondsToTime(startSec)} — ${secondsToTime(endSec)}`;
    }
    if (modalGradeBadge) {
      const g = hl.viralGrade || 'S';
      modalGradeBadge.textContent = `GRADE ${g}`;
      modalGradeBadge.style.color = hl.viralColor || 'var(--amber)';
    }
    const styleLabel = subtitleStyleSelect ? subtitleStyleSelect.options[subtitleStyleSelect.selectedIndex]?.textContent.trim() : 'The Quick Brown Fox INVERSE';
    if (modalSubStyleName) {
      modalSubStyleName.textContent = styleLabel;
    }

    try {
      const t = getActiveSubtitleTypography();
      const res = await apiRequest('/api/preview/video-916', {
        method: 'POST',
        body: JSON.stringify({
          videoPath: sourceVideoFilename,
          start: startSec,
          end: endSec,
          subtitleStyle: t.style,
          subtitleSize: t.fontSize,
          subtitleFont: t.fontFamily,
          subtitlePosition: t.position,
          subtitleCase: t.textCase,
          subtitleLanguage: t.language,
          subtitleConfig: getSubtitleConfigIfAuto(),
          withSubtitle: autoSubtitleToggle ? autoSubtitleToggle.checked : true,
          aspectRatio: '9:16'
        })
      });

      const { previewUrl, cached } = res.data;
      if (previewVideoLoading) previewVideoLoading.classList.add('hidden');
      if (previewVideo916) {
        previewVideo916.src = previewUrl;
        previewVideo916.currentTime = 0;
        previewVideo916.play().catch(() => {});
      }
      showToast(cached ? '⚡ Memutar preview 9:16 (dari cache)' : '🎬 Preview video 9:16 siap!', 'success');
    } catch (err) {
      if (previewVideoLoading) previewVideoLoading.classList.add('hidden');
      showToast('Gagal memuat preview 9:16: ' + err.message, 'error');
      closeVideoPreviewModal();
    }
  }

  if (closePreviewModalBtn) {
    closePreviewModalBtn.addEventListener('click', closeVideoPreviewModal);
  }

  // ===== Guide Modal Handlers =====
  function openGuideModal() {
    if (guideModal) {
      guideModal.classList.remove('hidden');
      guideModal.setAttribute('aria-hidden', 'false');
    }
  }

  function closeGuideModal() {
    if (guideModal) {
      guideModal.classList.add('hidden');
      guideModal.setAttribute('aria-hidden', 'true');
    }
  }

  if (guideBtn) guideBtn.addEventListener('click', openGuideModal);
  if (closeGuideModalBtn) closeGuideModalBtn.addEventListener('click', closeGuideModal);
  if (startUsingBtn) startUsingBtn.addEventListener('click', closeGuideModal);

  if (guideModal) {
    guideModal.addEventListener('click', (e) => {
      if (e.target === guideModal) closeGuideModal();
    });
  }

  if (videoPreviewModal) {
    videoPreviewModal.addEventListener('click', (e) => {
      if (e.target === videoPreviewModal) closeVideoPreviewModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (videoPreviewModal && !videoPreviewModal.classList.contains('hidden')) {
        closeVideoPreviewModal();
      }
      if (guideModal && !guideModal.classList.contains('hidden')) {
        closeGuideModal();
      }
    }
  });

  if (previewRangeVideoBtn) {
    previewRangeVideoBtn.addEventListener('click', () => {
      const s = timeToSeconds(startInput.value) || 0;
      const e = timeToSeconds(endInput.value) || (s + 15);
      openVideoPreview916({ start: s, end: e, viralGrade: 'PREVIEW' });
    });
  }

  if (applyPreviewToFormBtn) {
    applyPreviewToFormBtn.addEventListener('click', () => {
      if (currentPreviewHlData) {
        const s = currentPreviewHlData.start;
        const e = currentPreviewHlData.end;
        if (typeof s === 'number' && typeof e === 'number') {
          startInput.value = secondsToTime(s);
          endInput.value = secondsToTime(e);
          updateRuler();
          if (videoElement && videoElement.src) videoElement.currentTime = s;
        }
        if (metaClipTitle && currentPreviewHlData.autoTitle) metaClipTitle.value = currentPreviewHlData.autoTitle;
        if (metaClipTags && currentPreviewHlData.autoTags) metaClipTags.value = currentPreviewHlData.autoTags;
        if (metaClipDesc && currentPreviewHlData.autoDescription) metaClipDesc.value = currentPreviewHlData.autoDescription;
      }
      closeVideoPreviewModal();
      showToast('Rentang klip & metadata dari preview diterapkan!', 'success');
    });
  }

  if (queueFromPreviewBtn) {
    queueFromPreviewBtn.addEventListener('click', async () => {
      if (currentPreviewHlData) {
        const s = typeof currentPreviewHlData.start === 'number' ? currentPreviewHlData.start : (timeToSeconds(startInput.value) || 0);
        const e = typeof currentPreviewHlData.end === 'number' ? currentPreviewHlData.end : (timeToSeconds(endInput.value) || (s + 30));
        
        let title = currentPreviewHlData.autoTitle || (metaClipTitle ? metaClipTitle.value.trim() : '') || `Klip ${secondsToTime(s)} - ${secondsToTime(e)}`;
        let tags = currentPreviewHlData.autoTags || (metaClipTags ? metaClipTags.value.trim() : '#Shorts #Viral');
        let desc = currentPreviewHlData.autoDescription || (metaClipDesc ? metaClipDesc.value.trim() : '');

        clipQueue.push({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          startSeconds: s,
          endSeconds: e,
          title,
          tags,
          description: desc,
          aspectRatio: aspectRatioSelect ? aspectRatioSelect.value : '9:16',
          resolution: resolutionSelect ? resolutionSelect.value : 'original',
          autoSubtitle: autoSubtitleToggle ? autoSubtitleToggle.checked : true,
          subtitleStyle: subtitleStyleSelect ? subtitleStyleSelect.value : 'quick-brown-inv',
          subtitleSize: subtitleSizeSelect ? subtitleSizeSelect.value : 'large',
          subtitleFont: subtitleFontSelect ? subtitleFontSelect.value : 'auto',
          subtitlePosition: subtitlePosSelect ? subtitlePosSelect.value : 'bottom',
          subtitleCase: subtitleCaseSelect ? subtitleCaseSelect.value : 'uppercase',
          subtitleLanguage: subtitleLangSelect ? subtitleLangSelect.value : 'auto',
          subtitleConfig: getSubtitleConfigIfAuto(),
          bgmTrack: bgmTrackSelect ? bgmTrackSelect.value : 'none',
          bgmVolume: bgmVolumeSelect ? parseFloat(bgmVolumeSelect.value) : 0.10,
          crops: currentCrops ? [...currentCrops] : []
        });
        renderQueueList();
        showToast('Klip berhasil ditambahkan ke antrian dari preview!', 'success');
      }
      closeVideoPreviewModal();
    });
  }

  // ===== Generate AI Metadata Button (konten-aware dengan fallback template) =====
  const aiGenerateCaptionBtn = document.getElementById('aiGenerateCaptionBtn');
  const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');

  if (aiGenerateCaptionBtn) {
    aiGenerateCaptionBtn.addEventListener('click', async () => {
      const topic = (metaClipTitle ? metaClipTitle.value.trim() : '') || videoTitle.textContent.trim() || 'Klip Viral';
      const userApiKey = geminiApiKeyInput ? geminiApiKeyInput.value.trim() : '';

      const originalHTML = aiGenerateCaptionBtn.innerHTML;
      aiGenerateCaptionBtn.disabled = true;
      aiGenerateCaptionBtn.innerHTML = '🤖 Menghasilkan (Gemini 2.5 Flash)…';

      try {
        const { data } = await apiRequest('/api/social/generate-caption', {
          method: 'POST',
          body: JSON.stringify({
            clipTitle: topic,
            apiKey: userApiKey
          })
        });

        if (data.title && metaClipTitle) metaClipTitle.value = data.title;
        if (data.hashtags && metaClipTags) metaClipTags.value = Array.isArray(data.hashtags) ? data.hashtags.join(' ') : data.hashtags;
        if (data.caption && metaClipDesc) metaClipDesc.value = `${data.caption}\n\n${Array.isArray(data.hashtags) ? data.hashtags.join(' ') : ''}`;

        showToast('Caption, Judul & Hashtag hemat kuota (Gemini 2.5 Flash) berhasil dibuat!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        aiGenerateCaptionBtn.disabled = false;
        aiGenerateCaptionBtn.innerHTML = originalHTML;
      }
    });
  }

  if (generateMetaBtn) {
    generateMetaBtn.addEventListener('click', async () => {
      const startSec = timeToSeconds(startInput.value) || 0;
      const endSec = timeToSeconds(endInput.value) || startSec + 30;
      const vTitle = videoTitle.textContent.trim() || 'Konten Viral';

      const originalHTML = generateMetaBtn.innerHTML;
      generateMetaBtn.disabled = true;
      generateMetaBtn.innerHTML = '⏳ Menganalisis konten…';
      try {
        const meta = await fetchContentMetadata(startSec, endSec);
        if (meta && meta.title) {
          fillMetadataFields(meta);
          showToast('Metadata AI berbasis konten berhasil di-generate!', 'success');
        } else {
          throw new Error('empty');
        }
      } catch (err) {
        // Fallback template lama (random hook) jika transkripsi gagal
        const dur = Math.round(endSec - startSec);
        const hookTitles = [
          `RAHASIA BESAR ${vTitle.slice(0, 25).toUpperCase()}!`,
          `JANGAN LAKUKAN INI DI ${vTitle.slice(0, 25).toUpperCase()}!`,
          `FAKTA TERSEMBUNYI TENTANG ${vTitle.slice(0, 25).toUpperCase()}`,
          `3 TRICK JITU DARI ${vTitle.slice(0, 25).toUpperCase()}`
        ];
        const randomTitle = hookTitles[Math.floor(Math.random() * hookTitles.length)];
        const tags = `#Shorts #TikTokViral #ReelsIndonesia #${vTitle.replace(/[^\w]/g, '').slice(0, 15)} #TipsViral`;
        const desc = `🔥 ${randomTitle}\n\nSimak cuplikan segmen durasi ${dur} detik dari video ${vTitle}!\nLike & Share jika bermanfaat, dan ikuti kami untuk update konten viral berikutnya.\n\n🏷️ Tags:\n${tags}`;
        if (metaClipTitle) metaClipTitle.value = randomTitle;
        if (metaClipTags) metaClipTags.value = tags;
        if (metaClipDesc) metaClipDesc.value = desc;
        // headline tidak diisi otomatis — teks akan terbakar di video jika diisi
        showToast('Metadata template di-generate (transkripsi gagal).', 'info');
      } finally {
        generateMetaBtn.disabled = false;
        generateMetaBtn.innerHTML = originalHTML;
      }
    });
  }

  // Inject handles for sliding and resizing ruler selection
  rulerSelection.style.cursor = 'grab';
  rulerSelection.style.position = 'absolute'; // Ensure absolute

  const handleLeft = document.createElement('div');
  handleLeft.className = 'ruler-handle handle-left';
  handleLeft.style.cssText = 'position:absolute; left:-10px; top:0; bottom:0; width:20px; cursor:ew-resize; z-index: 10; touch-action:none;';
  rulerSelection.appendChild(handleLeft);

  const handleRight = document.createElement('div');
  handleRight.className = 'ruler-handle handle-right';
  handleRight.style.cssText = 'position:absolute; right:-10px; top:0; bottom:0; width:20px; cursor:ew-resize; z-index: 10; touch-action:none;';
  rulerSelection.appendChild(handleRight);

  let rulerDragType = null; // 'start', 'end', 'move'
  let rulerDragStartLeftPct = 0;
  let rulerDragStartRightPct = 0;
  let rulerDragStartX = 0;

  const startDrag = (type, clientX) => {
    if (!currentVideoDuration) return;
    rulerDragType = type;
    rulerDragStartX = clientX;
    
    const leftVal = rulerSelection.style.left || '10%';
    const rightVal = rulerSelection.style.right || '70%';
    rulerDragStartLeftPct = parseFloat(leftVal) || 0;
    rulerDragStartRightPct = parseFloat(rightVal) || 0;

    rulerSelection.style.transition = 'none';
    if (rulerDragType === 'move') {
      rulerSelection.style.cursor = 'grabbing';
    }

    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchmove', onDragTouch);
    document.addEventListener('touchend', endDrag);
  };

  const onDrag = (e) => {
    if (!rulerDragType) return;
    const rect = ruler.getBoundingClientRect();
    const deltaX = e.clientX - rulerDragStartX;
    const deltaPct = (deltaX / rect.width) * 100;

    let newLeftPct = rulerDragStartLeftPct;
    let newRightPct = rulerDragStartRightPct;

    if (rulerDragType === 'start') {
      newLeftPct = rulerDragStartLeftPct + deltaPct;
      if (newLeftPct < 0) newLeftPct = 0;
      if (newLeftPct > 100 - newRightPct - 0.5) {
        newLeftPct = 100 - newRightPct - 0.5;
      }
    } else if (rulerDragType === 'end') {
      newRightPct = rulerDragStartRightPct - deltaPct;
      if (newRightPct < 0) newRightPct = 0;
      if (newRightPct > 100 - newLeftPct - 0.5) {
        newRightPct = 100 - newLeftPct - 0.5;
      }
    } else if (rulerDragType === 'move') {
      const widthPct = 100 - (rulerDragStartLeftPct + rulerDragStartRightPct);
      newLeftPct = rulerDragStartLeftPct + deltaPct;
      if (newLeftPct < 0) newLeftPct = 0;
      if (newLeftPct > 100 - widthPct) newLeftPct = 100 - widthPct;
      newRightPct = 100 - newLeftPct - widthPct;
    }

    rulerSelection.style.left = `${newLeftPct}%`;
    rulerSelection.style.right = `${newRightPct}%`;

    const startSec = (newLeftPct / 100) * currentVideoDuration;
    const endSec = ((100 - newRightPct) / 100) * currentVideoDuration;

    startInput.value = secondsToTime(startSec);
    endInput.value = secondsToTime(endSec);
  };

  const onDragTouch = (e) => {
    if (e.touches && e.touches[0]) {
      onDrag(e.touches[0]);
    }
  };

  const endDrag = (e) => {
    if (rulerDragType && e) {
      let clientX = e.clientX;
      if (clientX === undefined && e.changedTouches && e.changedTouches[0]) {
        clientX = e.changedTouches[0].clientX;
      }
      if (clientX !== undefined) {
        const dist = Math.abs(clientX - rulerDragStartX);
        if (dist < 4) {
          const rect = ruler.getBoundingClientRect();
          const pct = (clientX - rect.left) / rect.width;
          videoElement.currentTime = pct * currentVideoDuration;
        }
      }
    }
    rulerDragType = null;
    rulerSelection.style.transition = '';
    rulerSelection.style.cursor = 'grab';
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', endDrag);
    document.removeEventListener('touchmove', onDragTouch);
    document.removeEventListener('touchend', endDrag);
  };

  handleLeft.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    startDrag('start', e.clientX);
  });
  handleLeft.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    if (e.touches && e.touches[0]) {
      startDrag('start', e.touches[0].clientX);
    }
  });

  handleRight.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    e.preventDefault();
    startDrag('end', e.clientX);
  });
  handleRight.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    if (e.touches && e.touches[0]) {
      startDrag('end', e.touches[0].clientX);
    }
  });

  rulerSelection.addEventListener('mousedown', (e) => {
    if (e.target === rulerSelection) {
      e.stopPropagation();
      e.preventDefault();
      startDrag('move', e.clientX);
    }
  });
  rulerSelection.addEventListener('touchstart', (e) => {
    if (e.target === rulerSelection && e.touches && e.touches[0]) {
      e.stopPropagation();
      startDrag('move', e.touches[0].clientX);
    }
  });

  // Seek video by clicking ruler (outside selection)
  ruler.addEventListener('click', (e) => {
    if (!currentVideoDuration) return;
    const rect = ruler.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    videoElement.currentTime = pct * currentVideoDuration;
  });

  // ===== Real-time Face Tracking Loop =====
  async function trackLoop() {
    if (videoElement.paused || videoElement.ended) {
      cancelAnimationFrame(trackingInterval);
      return;
    }

    if (modelReady && faceModel) {
      try {
        const predictions = await faceModel.estimateFaces(videoElement, false);
        const t = videoElement.currentTime;

        // Process tracked faces
        let currentFrameFaces = [];

        predictions.forEach((pred) => {
          const [x1, y1] = pred.topLeft;
          const [x2, y2] = pred.bottomRight;
          const w = x2 - x1;
          const h = y2 - y1;
          const cx = (x1 + w / 2) / videoElement.videoWidth;
          const cy = (y1 + h / 2) / videoElement.videoHeight;

          let landmarks = null;
          let normMouthDist = 0;
          if (pred.landmarks && pred.landmarks.length >= 4) {
            landmarks = {
              rightEye: [pred.landmarks[0][0] / videoElement.videoWidth, pred.landmarks[0][1] / videoElement.videoHeight],
              leftEye: [pred.landmarks[1][0] / videoElement.videoWidth, pred.landmarks[1][1] / videoElement.videoHeight],
              nose: [pred.landmarks[2][0] / videoElement.videoWidth, pred.landmarks[2][1] / videoElement.videoHeight],
              mouth: [pred.landmarks[3][0] / videoElement.videoWidth, pred.landmarks[3][1] / videoElement.videoHeight],
            };

            // Hitung jarak hidung-mulut yang dinormalisasi dengan tinggi wajah
            // Gunakan hanya jarak vertikal (Y-axis) agar sensitif terhadap gerakan mulut di profil samping (side-profile/podcast)
            const dy = landmarks.mouth[1] - landmarks.nose[1];
            const dist = Math.abs(dy);
            const faceH = h / videoElement.videoHeight;
            normMouthDist = faceH > 0 ? dist / faceH : 0;
          }

          // Cari wajah yang sudah di-track terdekat
          let bestFace = null;
          let minDist = 0.15; // Ambang batas jarak spatial

          trackedFaces.forEach((tf) => {
            const dx = tf.cx - cx;
            const dy = tf.cy - cy;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < minDist) {
              minDist = d;
              bestFace = tf;
            }
          });

          if (bestFace) {
            bestFace.cx = cx;
            bestFace.cy = cy;
            bestFace.w = w / videoElement.videoWidth;
            bestFace.h = h / videoElement.videoHeight;
            bestFace.landmarks = landmarks;
            bestFace.lastSeen = t;
            if (normMouthDist > 0) {
              bestFace.speechHistory.push(normMouthDist);
              if (bestFace.speechHistory.length > 20) {
                bestFace.speechHistory.shift();
              }
            }
          } else {
            faceIdCounter++;
            bestFace = {
              id: faceIdCounter,
              cx: cx,
              cy: cy,
              w: w / videoElement.videoWidth,
              h: h / videoElement.videoHeight,
              landmarks: landmarks,
              lastSeen: t,
              speechHistory: normMouthDist > 0 ? [normMouthDist] : [],
              speechActivity: 0,
              isSpeaking: false,
            };
            trackedFaces.push(bestFace);
          }
          currentFrameFaces.push(bestFace);
        });

        // Hapus wajah yang tidak terlihat lebih dari 1 detik
        trackedFaces = trackedFaces.filter((tf) => (t - tf.lastSeen) < 1.0);

        // Hitung tingkat keaktifan berbicara (speech activity)
        trackedFaces.forEach((tf) => {
          if (tf.speechHistory.length >= 5) {
            const mean = tf.speechHistory.reduce((a, b) => a + b, 0) / tf.speechHistory.length;
            const variance = tf.speechHistory.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / tf.speechHistory.length;
            tf.speechActivity = variance;
            tf.isSpeaking = variance > 0.00012; // Threshold mulut bergerak/berbicara (lebih sensitif untuk side-profile)
          } else {
            tf.speechActivity = 0;
            tf.isSpeaking = false;
          }
        });

        // Tentukan Active Speaker (paling aktif bicara)
        let maxActivity = 0;
        let speakerCandidates = trackedFaces.filter(f => f.speechActivity > 0.00008);
        if (speakerCandidates.length > 0) {
          speakerCandidates.forEach((tf) => {
            if (tf.speechActivity > maxActivity) {
              maxActivity = tf.speechActivity;
              activeSpeaker = tf;
            }
          });
        }

        // Fallback: gunakan wajah terdekat dari fokus sebelumnya
        if ((!activeSpeaker || (t - activeSpeaker.lastSeen) > 0.5) && trackedFaces.length > 0) {
          let closestFace = trackedFaces[0];
          let minFocalDist = 999;
          trackedFaces.forEach((tf) => {
            const d = Math.sqrt(Math.pow(tf.cx - lastFocusCx, 2) + Math.pow(tf.cy - lastFocusCy, 2));
            if (d < minFocalDist) {
              minFocalDist = d;
              closestFace = tf;
            }
          });
          activeSpeaker = closestFace;
        }

        // Target pusat pemotongan (crop focus)
        let targetCx = 0.5;
        let targetCy = 0.5;
        let targetLandmarks = null;

        if (activeSpeaker) {
          targetCx = activeSpeaker.cx;
          targetCy = activeSpeaker.cy;
          targetLandmarks = activeSpeaker.landmarks;
        }

        // ===== Adaptive Smoothing + Velocity Prediction =====
        // Kamera tidak boleh "malas" mengejar: kalau karakter jauh dari fokus,
        // beta naik (kejar agresif); kalau sudah dekat, beta turun (stabil).
        const dist = Math.hypot(targetCx - lastFocusCx, targetCy - lastFocusCy);
        let beta;
        if (dist > 0.15) beta = 0.40;       // karakter jauh → kejar cepat
        else if (dist > 0.07) beta = 0.25;  // sedang → responsif
        else beta = 0.12;                   // dekat → halus anti-guncang

        const deadband = 0.015; // 1.5% — mulai bergerak lebih cepat (sebelumnya 4%)

        // Estimasi kecepatan gerak wajah (EMA) untuk prediksi posisi ~2 frame ke depan
        if (lastFaceCx !== null) {
          velCx = 0.6 * velCx + 0.4 * (targetCx - lastFaceCx);
          velCy = 0.6 * velCy + 0.4 * (targetCy - lastFaceCy);
        }
        lastFaceCx = targetCx;
        lastFaceCy = targetCy;

        const predCx = targetCx + velCx * 2.0;
        const predCy = targetCy + velCy * 2.0;

        let smoothedCx = lastFocusCx;
        let smoothedCy = lastFocusCy;

        if (Math.abs(predCx - lastFocusCx) > deadband) {
          smoothedCx = lastFocusCx + beta * (predCx - lastFocusCx);
        }
        if (Math.abs(predCy - lastFocusCy) > deadband) {
          smoothedCy = lastFocusCy + beta * (predCy - lastFocusCy);
        }

        lastFocusCx = smoothedCx;
        lastFocusCy = smoothedCy;

        // Simpan titik koordinat crop
        addCropPoint(t, smoothedCx, smoothedCy, targetLandmarks);

        // Update heatmap trail historis
        if (targetLandmarks) {
          heatmapHistory.push({
            time: t,
            landmarks: targetLandmarks,
            cx: smoothedCx,
            cy: smoothedCy,
          });
          if (heatmapHistory.length > HEATMAP_MAX_HISTORY) {
            heatmapHistory.shift();
          }
        }

        // Gambar feedback visual
        drawTrackerFeedback(smoothedCx, smoothedCy);
      } catch (err) {
        console.error("AI inference error:", err);
      }
    }

    trackingInterval = requestAnimationFrame(trackLoop);
  }

  function addCropPoint(t, cx, cy, landmarks) {
    const idx = cropPoints.findIndex((pt) => Math.abs(pt.time - t) < 0.1);
    const newPt = { time: t, cx, cy, landmarks };
    if (idx !== -1) {
      // Jangan timpa manual override jika ada
      if (!cropPoints[idx].manual) {
        cropPoints[idx] = newPt;
      }
    } else {
      cropPoints.push(newPt);
    }
  }

  function smoothCropPoints() {
    if (cropPoints.length < 3) return;
    const sorted = [...cropPoints].sort((a, b) => a.time - b.time);
    const smoothed = [];
    const windowRadius = 0.15; // 0.3s window presisi & cepat (responsif tanpa delay)

    for (let i = 0; i < sorted.length; i++) {
      const pt = sorted[i];
      if (pt.manual) {
        smoothed.push(pt);
        continue;
      }

      let sumCx = 0;
      let sumCy = 0;
      let count = 0;

      for (let j = 0; j < sorted.length; j++) {
        const other = sorted[j];
        if (Math.abs(other.time - pt.time) <= windowRadius) {
          sumCx += other.cx;
          sumCy += other.cy;
          count++;
        }
      }

      smoothed.push({
        time: pt.time,
        cx: sumCx / count,
        cy: sumCy / count,
        landmarks: pt.landmarks,
        manual: pt.manual
      });
    }

    cropPoints = smoothed;
  }

  async function scanFacesInRange(startSec, endSec) {
    // JAMINAN: jangan pernah batal diam-diam. Kalau model belum siap, muat dulu.
    if (!faceModel) {
      showToast('🤖 Memuat model AI deteksi wajah…', 'info');
      await ensureAIModel();
    }
    if (!faceModel) {
      showToast('❌ Model AI gagal dimuat — scan wajah dibatalkan. Muat ulang video & coba lagi.', 'error');
      return;
    }

    const originalTime = videoElement.currentTime;
    const isPlaying = !videoElement.paused;
    if (isPlaying) videoElement.pause();

    // Guard: video belum punya frame (belum siap di-seek) → jangan hang
    if (!videoElement.videoWidth || !videoElement.videoHeight) {
      showToast('❌ Video belum siap dipindai. Muat ulang video & coba lagi.', 'error');
      return;
    }

    const oldCursor = document.body.style.cursor;
    document.body.style.cursor = 'wait';

    const step = 0.2; // Sampel 5 fps (0.2s) untuk responsivitas pelacakan tinggi
    const totalSteps = Math.ceil((endSec - startSec) / step);
    let stepCount = 0;

    showToast(`🤖 Pindai Wajah AI dimulai (${totalSteps} frame)…`, 'info');

    let lastCx = lastFocusCx || 0.5;
    let lastCy = lastFocusCy || 0.5;

    for (let t = startSec; t <= endSec; t += step) {
      videoElement.currentTime = t;
      
      // Tunggu frame siap, tapi dengan timeout — kalau seek ke posisi yang sama
      // (event 'seeked' tidak fire), jangan sampai scan hang selamanya.
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          videoElement.removeEventListener('seeked', onSeeked);
          resolve();
        };
        const onSeeked = () => finish();
        videoElement.addEventListener('seeked', onSeeked);
        const timer = setTimeout(finish, 500);
      });

      try {
        const predictions = await faceModel.estimateFaces(videoElement, false);
        if (predictions.length > 0) {
          let bestPred = predictions[0];
          let maxArea = 0;
          predictions.forEach(pred => {
            const w = pred.bottomRight[0] - pred.topLeft[0];
            const h = pred.bottomRight[1] - pred.topLeft[1];
            const area = w * h;
            if (area > maxArea) {
              maxArea = area;
              bestPred = pred;
            }
          });

          const [x1, y1] = bestPred.topLeft;
          const [x2, y2] = bestPred.bottomRight;
          const w = x2 - x1;
          const h = y2 - y1;
          const cx = (x1 + w / 2) / videoElement.videoWidth;
          const cy = (y1 + h / 2) / videoElement.videoHeight;

          // Adaptive smoothing + velocity prediction (sama seperti live tracking)
          const distS = Math.hypot(cx - lastCx, cy - lastCy);
          let betaS;
          if (distS > 0.15) betaS = 0.50;       // karakter jauh → kejar cepat
          else if (distS > 0.07) betaS = 0.32;  // sedang → responsif
          else betaS = 0.16;                    // dekat → stabil

          const deadbandS = 0.015; // 1.5% — mulai bergerak cepat

          // Velocity prediction: kurangi lag path ekspor saat karakter gerak cepat
          if (lastFaceCx !== null) {
            velCx = 0.6 * velCx + 0.4 * (cx - lastFaceCx);
            velCy = 0.6 * velCy + 0.4 * (cy - lastFaceCy);
          }
          lastFaceCx = cx;
          lastFaceCy = cy;

          const predCxS = cx + velCx * 1.5;
          const predCyS = cy + velCy * 1.5;

          if (Math.abs(predCxS - lastCx) > deadbandS) {
            lastCx = lastCx + betaS * (predCxS - lastCx);
          }
          if (Math.abs(predCyS - lastCy) > deadbandS) {
            lastCy = lastCy + betaS * (predCyS - lastCy);
          }

          let landmarks = null;
          if (bestPred.landmarks && bestPred.landmarks.length >= 4) {
            landmarks = {
              rightEye: [bestPred.landmarks[0][0] / videoElement.videoWidth, bestPred.landmarks[0][1] / videoElement.videoHeight],
              leftEye: [bestPred.landmarks[1][0] / videoElement.videoWidth, bestPred.landmarks[1][1] / videoElement.videoHeight],
              nose: [bestPred.landmarks[2][0] / videoElement.videoWidth, bestPred.landmarks[2][1] / videoElement.videoHeight],
              mouth: [bestPred.landmarks[3][0] / videoElement.videoWidth, bestPred.landmarks[3][1] / videoElement.videoHeight],
            };
          }

          addCropPoint(t, lastCx, lastCy, landmarks);
          drawScanIndicator(lastCx, lastCy);
        }
      } catch (err) {
        console.error('Scan error at', t, err);
      }

      stepCount++;
      if (stepCount % 10 === 0) {
        const pct = Math.round((stepCount / totalSteps) * 100);
        showToast(`🤖 Pindai Wajah AI: ${pct}%…`, 'info');
      }
    }

    const ctx = trackerCanvas.getContext('2d');
    ctx.clearRect(0, 0, trackerCanvas.width, trackerCanvas.height);

    videoElement.currentTime = originalTime;
    if (isPlaying) videoElement.play();

    smoothCropPoints();

    document.body.style.cursor = oldCursor;
    showToast('🤖 Wajah AI berhasil dipindai! Klip siap diekspor.', 'success');
  }

  function drawScanIndicator(cx, cy) {
    const ctx = trackerCanvas.getContext('2d');
    ctx.clearRect(0, 0, trackerCanvas.width, trackerCanvas.height);
    const vW = trackerCanvas.width;
    const vH = trackerCanvas.height;
    const px = cx * vW;
    const py = cy * vH;

    ctx.strokeStyle = '#5eead4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(px, py, 40, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(px - 15, py); ctx.lineTo(px + 15, py);
    ctx.moveTo(px, py - 15); ctx.lineTo(px, py + 15);
    ctx.stroke();
  }


  // Linear Interpolator
  function getInterpolatedPoint(t) {
    if (cropPoints.length === 0) return { cx: 0.5, cy: 0.5 };
    const sorted = [...cropPoints].sort((a, b) => a.time - b.time);
    
    if (t <= sorted[0].time) return { cx: sorted[0].cx, cy: sorted[0].cy };
    if (t >= sorted[sorted.length - 1].time) return { cx: sorted[sorted.length - 1].cx, cy: sorted[sorted.length - 1].cy };
    
    for (let i = 0; i < sorted.length - 1; i++) {
      const pt0 = sorted[i];
      const pt1 = sorted[i + 1];
      if (t >= pt0.time && t <= pt1.time) {
        const alpha = (t - pt0.time) / (pt1.time - pt0.time);
        return {
          cx: pt0.cx + alpha * (pt1.cx - pt0.cx),
          cy: pt0.cy + alpha * (pt1.cy - pt0.cy),
        };
      }
    }
    return { cx: 0.5, cy: 0.5 };
  }

  // Draw heatmap & status overlays on Canvas
  function drawTrackerFeedback(cx, cy) {
    const ctx = trackerCanvas.getContext('2d');
    ctx.clearRect(0, 0, trackerCanvas.width, trackerCanvas.height);

    const vW = trackerCanvas.width;
    const vH = trackerCanvas.height;

    // 1. Gambar Landmark Heatmap
    heatmapHistory.forEach((pt, idx) => {
      const opacity = ((idx + 1) / heatmapHistory.length) * 0.45;
      const lm = pt.landmarks;
      if (lm) {
        drawGlowPoint(ctx, lm.leftEye[0] * vW, lm.leftEye[1] * vH, 8, `rgba(6, 182, 212, ${opacity})`);
        drawGlowPoint(ctx, lm.rightEye[0] * vW, lm.rightEye[1] * vH, 8, `rgba(6, 182, 212, ${opacity})`);
        drawGlowPoint(ctx, lm.nose[0] * vW, lm.nose[1] * vH, 6, `rgba(244, 63, 94, ${opacity})`);
        drawGlowPoint(ctx, lm.mouth[0] * vW, lm.mouth[1] * vH, 12, `rgba(239, 68, 68, ${opacity})`);
      }
      drawGlowPoint(ctx, pt.cx * vW, pt.cy * vH, 20, `rgba(94, 234, 212, ${opacity * 0.3})`);
    });

    // 2. Gambar Bounding Box semua wajah yang terdeteksi
    trackedFaces.forEach((tf) => {
      const bx = tf.cx * vW - (tf.w * vW) / 2;
      const by = tf.cy * vH - (tf.h * vH) / 2;
      const bw = tf.w * vW;
      const bh = tf.h * vH;

      if (tf === activeSpeaker) {
        ctx.strokeStyle = '#ef4444'; // Merah untuk Active Speaker
        ctx.shadowColor = 'rgba(239, 68, 68, 0.5)';
        ctx.shadowBlur = 10;
      } else if (tf.isSpeaking) {
        ctx.strokeStyle = 'var(--accent)'; // Teal jika berbicara
        ctx.shadowColor = 'rgba(94, 234, 212, 0.4)';
        ctx.shadowBlur = 8;
      } else {
        ctx.strokeStyle = 'rgba(139, 147, 167, 0.5)'; // Muted grey jika diam
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
      }

      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.shadowBlur = 0; // reset

      // Label & Indikator berbicara
      ctx.fillStyle = tf === activeSpeaker ? '#ef4444' : (tf.isSpeaking ? 'var(--accent)' : '#8b93a7');
      ctx.font = '600 10px monospace';
      const labelText = tf === activeSpeaker ? 'ACTIVE SPEAKER' : (tf.isSpeaking ? 'TALKING' : 'SILENT');
      ctx.fillText(labelText, bx, by - 6);

      // Speech activity progress bar kecil di bawah wajah
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.fillRect(bx, by + bh + 4, bw, 3);
      ctx.fillStyle = tf.isSpeaking ? 'var(--accent)' : 'rgba(94, 234, 212, 0.3)';
      const actWidth = Math.min(1, tf.speechActivity * 1200) * bw;
      ctx.fillRect(bx, by + bh + 4, actWidth, 3);
    });

    // 3. Update Bounding Box Preview Crop
    updateCropPreviewPosition(cx, cy);
  }

  function drawGlowPoint(ctx, x, y, radius, colorStr) {
    ctx.beginPath();
    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, colorStr);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fill();
  }

  function updateCropPreviewPosition(cx, cy) {
    if (cx === undefined || cy === undefined) {
      const pt = getInterpolatedPoint(videoElement.currentTime);
      cx = pt.cx;
      cy = pt.cy;
    }

    const vW = videoElement.clientWidth;
    const vH = videoElement.clientHeight;
    const ratioVal = aspectRatioSelect.value;
    
    if (ratioVal === 'original') {
      cropPreviewBox.classList.add('hidden');
      return;
    }

    const ratio = ratioVal === '9:16' ? 9 / 16 : 1.0;

    let boxW, boxH;
    if (vW / vH > ratio) {
      boxH = vH;
      boxW = vH * ratio;
    } else {
      boxW = vW;
      boxH = vW / ratio;
    }

    let posX = cx * vW - boxW / 2;
    let posY = cy * vH - boxH / 2;

    posX = Math.max(0, Math.min(vW - boxW, posX));
    posY = Math.max(0, Math.min(vH - boxH, posY));

    cropPreviewBox.style.width = `${boxW}px`;
    cropPreviewBox.style.height = `${boxH}px`;
    cropPreviewBox.style.left = `${posX}px`;
    cropPreviewBox.style.top = `${posY}px`;
    cropPreviewBox.classList.remove('hidden');
  }

  // Handle Aspect Ratio Select Change
  aspectRatioSelect.addEventListener('change', () => {
    updateCropPreviewPosition();
  });

  // resize canvas on resize
  window.addEventListener('resize', () => {
    if (videoElement.style.display !== 'none') {
      trackerCanvas.width = videoElement.clientWidth;
      trackerCanvas.height = videoElement.clientHeight;
      updateCropPreviewPosition();
    }
  });

  // ===== Draggable Crop Preview Box Manual Override =====
  cropPreviewBox.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (!sourceVideoFilename) return;

    isDraggingCropBox = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;

    const pt = getInterpolatedPoint(videoElement.currentTime);
    dragStartCx = pt.cx;
    dragStartCy = pt.cy;

    videoElement.pause();
    cancelAnimationFrame(trackingInterval);
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDraggingCropBox) return;

    const rect = videoElement.getBoundingClientRect();
    const vW = rect.width;
    const vH = rect.height;

    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    let newCx = dragStartCx + dx / vW;
    let newCy = dragStartCy + dy / vH;

    newCx = Math.max(0.05, Math.min(0.95, newCx));
    newCy = Math.max(0.05, Math.min(0.95, newCy));

    addCropPoint(videoElement.currentTime, newCx, newCy, null);
    // tandai titik ini sebagai manual override
    const idx = cropPoints.findIndex(pt => Math.abs(pt.time - videoElement.currentTime) < 0.1);
    if (idx !== -1) cropPoints[idx].manual = true;

    updateCropPreviewPosition(newCx, newCy);
  });

  window.addEventListener('mouseup', () => {
    if (isDraggingCropBox) {
      isDraggingCropBox = false;
      showToast(`Titik fokus disematkan manual pada ${secondsToTime(videoElement.currentTime)}`, "success");
      
      // Lanjutkan video
      if (!videoElement.paused) {
        trackLoop();
      }
    }
  });

  // Video playback events
  videoElement.addEventListener('play', () => {
    // Lazy-init AI: tf.js + BlazeFace baru dimuat saat video benar-benar diputar
    if (!modelReady && typeof loadAIModel === 'function') {
      loadAIModel();
    }
    trackLoop();
  });
  videoElement.addEventListener('pause', () => {
    cancelAnimationFrame(trackingInterval);
  });
  videoElement.addEventListener('timeupdate', () => {
    if (currentVideoDuration) {
      const pct = (videoElement.currentTime / currentVideoDuration) * 100;
      timelinePlayhead.style.left = `${pct}%`;
      timelinePlayhead.style.display = 'block';
    }
    updateCropPreviewPosition();
  });

  // ===== STEP 1: Load Video Info & Download Preview Video =====
  urlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    urlError.hidden = true;
    resultSection.hidden = true;
    progressSection.hidden = true;
    previewSection.hidden = true;
    highlightsContainer.classList.add('hidden');
    timelineHeatmap.classList.add('hidden');
    cropPoints = [];
    trackedFaces = [];

    setButtonLoading(loadBtn, true, 'Memuat Info…');

    try {
      const { data } = await apiRequest('/api/info', {
        method: 'POST',
        body: JSON.stringify({ url: urlInput.value.trim() }),
      });

      currentVideoDuration = data.duration || 0;
      videoTitle.textContent = data.title;
      videoChannel.textContent = data.channel || '—';
      metaDuration.textContent = data.durationLabel;
      metaSize.textContent = data.estimatedSizeLabel || 'Tidak diketahui';
      metaSubtitle.textContent = data.hasSubtitles
        ? `Tersedia (${data.subtitleLanguages.slice(0, 3).join(', ')})`
        : 'Tidak tersedia';
      metaResolutions.textContent = data.availableResolutions?.length
        ? data.availableResolutions.slice(0, 5).join(', ')
        : '—';

      durationBadge.textContent = data.durationLabel;
      thumbImg.src = data.thumbnail;
      thumbImg.style.display = 'block';
      videoElement.style.display = 'none';
      cropPreviewBox.classList.add('hidden');

      endInput.value = secondsToTime(Math.min(currentVideoDuration, 60));
      startInput.value = '00:00:00';
      updateRuler();

      previewSection.hidden = false;
      previewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Jalankan download video di backend untuk preview & face tracking
      showToast('Mengunduh video preview untuk face tracking...');
      startBackgroundPreviewDownload();
    } catch (err) {
      urlError.textContent = err.message;
      urlError.hidden = false;
      showToast(err.message, 'error');
      setButtonLoading(loadBtn, false);
    }
  });

  async function startBackgroundPreviewDownload() {
    try {
      // Mengunduh preview 360p agar super cepat dan hemat kuota/bandwidth
      const resolution = '360p'; 
      const response = await apiRequest('/api/download', {
        method: 'POST',
        body: JSON.stringify({
          url: urlInput.value.trim(),
          resolution: resolution
        })
      });

      const jobId = response.data.jobId;
      pollSourceDownload(jobId);
    } catch (err) {
      showToast('Gagal memulai unduhan video preview: ' + err.message, 'error');
      setButtonLoading(loadBtn, false);
    }
  }

  function pollSourceDownload(jobId) {
    // Use a ref wrapper to avoid closure timing bug where 'sse' isn't yet assigned
    // when the first SSE message fires synchronously.
    const sseRef = { source: null };

    sseRef.source = connectJobStatus(
      jobId,
      (data) => {
        if (data.progress !== undefined) {
          setButtonLoading(loadBtn, true, `Downloading Preview: ${Math.round(data.progress)}%`);
        }
        if (data.status === 'done') {
          if (sseRef.source) sseRef.source.close();
          setButtonLoading(loadBtn, false);
          sourceVideoFilename = data.outputFile;
          setupLoadedVideo(data.outputFile);
        } else if (data.status === 'error') {
          if (sseRef.source) sseRef.source.close();
          showToast('Unduhan video preview gagal: ' + (data.error?.message || ''), 'error');
          setButtonLoading(loadBtn, false);
        }
      },
      () => {
        showToast('Koneksi status download terputus.', 'error');
        setButtonLoading(loadBtn, false);
      }
    );
  }

  function setupLoadedVideo(filename) {
    thumbImg.style.display = 'none';
    videoElement.src = `/downloads/${filename}`;
    videoElement.style.display = 'block';
    videoElement.load();
    
    // Panaskan model AI di background begitu video tersedia —
    // supaya pas ekspor butuh scan wajah, model SUDAH siap.
    loadAIModel();

    videoElement.onloadedmetadata = () => {
      trackerCanvas.width = videoElement.clientWidth;
      trackerCanvas.height = videoElement.clientHeight;
      updateCropPreviewPosition();
      showToast('Video berhasil dimuat. Mainkan video untuk memulai tracking.', 'success');
    };
  }

  // ===== Audio Highlights Energy Heatmap Drawer =====
  function drawTimelineHeatmap(energies) {
    timelineHeatmap.innerHTML = '';
    timelineHeatmap.classList.remove('hidden');

    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    timelineHeatmap.appendChild(canvas);

    canvas.width = timelineHeatmap.clientWidth;
    canvas.height = timelineHeatmap.clientHeight || 8;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    const maxEnergy = Math.max(...energies, 1);
    const step = W / energies.length;

    // Draw background
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.fillRect(0, 0, W, H);

    // Draw energy blocks with color ramp (teal to amber to red)
    const grad = ctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, 'rgba(94, 234, 212, 0.15)'); // teal
    grad.addColorStop(0.6, 'rgba(251, 191, 36, 0.5)'); // amber
    grad.addColorStop(1, 'rgba(248, 113, 113, 0.95)'); // red (high volume/screaming)

    ctx.fillStyle = grad;
    for (let i = 0; i < energies.length; i++) {
      const val = energies[i] / maxEnergy;
      const barH = val * H;
      const x = i * step;
      ctx.fillRect(x, H - barH, Math.max(1, step), barH);
    }
  }

  // ===== Auto-Detect Highlights Button Click =====
  detectHighlightsBtn.addEventListener('click', async () => {
    if (!sourceVideoFilename) {
      showToast('Video preview belum siap.', 'warning');
      return;
    }

    const userApiKey = geminiApiKeyInput ? geminiApiKeyInput.value.trim() : '';
    const aiViralMode = document.getElementById('aiViralModeCheck');
    const mode = aiViralMode && !aiViralMode.checked ? 'audio' : 'auto';

    setButtonLoading(detectHighlightsBtn, true, mode === 'auto' ? '✨ Analisis AI + transkrip...' : 'Menganalisis audio & AI...');
    try {
      const response = await apiRequest('/api/highlights', {
        method: 'POST',
        body: JSON.stringify({
          url: urlInput.value.trim(),
          videoPath: sourceVideoFilename,
          targetDuration: getActivePlatformDuration(),
          apiKey: userApiKey,
          mode
        })
      });

      const { highlights, energies, engine } = response.data;
      lastHighlightEngine = engine || 'audio';

      if (energies && energies.length > 0) {
        drawTimelineHeatmap(energies);
      }

      if (highlights && highlights.length > 0) {
        renderSuggestedHighlightsList(highlights);
        highlightsContainer.classList.remove('hidden');
        const railCount = document.getElementById('railCount');
        if (railCount) railCount.textContent = highlights.length;
        const railEmpty = document.getElementById('railEmpty');
        if (railEmpty) railEmpty.classList.add('hidden');

        // Pilih highlight dengan score tertinggi secara default
        const topHighlight = [...highlights].sort((a, b) => (b.viralScore ?? 0) - (a.viralScore ?? 0))[0] || highlights[0];
        startInput.value = secondsToTime(topHighlight.start);
        endInput.value = secondsToTime(topHighlight.end);
        updateRuler();
        videoElement.currentTime = topHighlight.start;

        showToast(
          engine === 'ai'
            ? '✨ AI memilih momen viral dari transkrip! Timeline range di-update.'
            : 'Momen menarik terdeteksi! Timeline range telah di-update.',
          'success'
        );
      } else {
        showToast('Tidak ada fluktuasi suara yang signifikan terdeteksi.', 'info');
      }
    } catch (err) {
      showToast('Deteksi highlight gagal: ' + err.message, 'error');
    } finally {
      setButtonLoading(detectHighlightsBtn, false);
    }
  });

  // Track the active highlight playback watcher
  let highlightEndWatcher = null;
  let activeHighlightIdx = -1;

  function clearHighlightWatcher() {
    if (highlightEndWatcher) {
      videoElement.removeEventListener('timeupdate', highlightEndWatcher);
      highlightEndWatcher = null;
    }
  }

  function playHighlightSegment(hl, idx, allItems) {
    // Guard: video must be loaded
    if (!sourceVideoFilename) {
      showToast('Video preview belum siap. Tunggu hingga unduhan selesai.', 'error');
      return;
    }

    const isCurrentlyPlaying = activeHighlightIdx === idx && !videoElement.paused;

    // Stop any previous watcher
    clearHighlightWatcher();

    if (isCurrentlyPlaying) {
      videoElement.pause();
      activeHighlightIdx = -1;

      // Reset button states for this item
      allItems.forEach((el, i) => {
        const playBtn = el.querySelector('.play-hl-btn');
        if (playBtn) {
          playBtn.innerHTML = '▶';
          playBtn.style.background = 'rgba(94, 234, 212, 0.08)';
          playBtn.style.color = 'var(--accent)';
        }
      });
      return;
    }

    // Stop any other active playback
    videoElement.pause();

    // Highlight active row & toggle icons
    allItems.forEach((el, i) => {
      const playBtn = el.querySelector('.play-hl-btn');
      if (playBtn) {
        if (i === idx) {
          playBtn.innerHTML = '⏸';
          playBtn.style.background = 'rgba(239, 68, 68, 0.15)';
          playBtn.style.color = '#ef4444';
        } else {
          playBtn.innerHTML = '▶';
          playBtn.style.background = 'rgba(94, 234, 212, 0.08)';
          playBtn.style.color = 'var(--accent)';
        }
      }
    });

    activeHighlightIdx = idx;

    // Pastikan video element siap & terlihat
    if (thumbImg) thumbImg.style.display = 'none';
    if (videoElement) {
      videoElement.style.display = 'block';
      if (!videoElement.src || videoElement.src === window.location.href) {
        videoElement.src = `/downloads/${sourceVideoFilename}`;
        videoElement.load();
      }
      videoElement.currentTime = hl.start;
      videoElement.play().catch((err) => {
        showToast('Memutar video: ' + err.message, 'info');
      });
      // Scroll player ke layar jika perlu
      const canvasPanel = document.getElementById('canvasPanel');
      if (canvasPanel && window.innerWidth < 1000) {
        canvasPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    // Set ruler to this range
    startInput.value = secondsToTime(hl.start);
    endInput.value = secondsToTime(hl.end);
    updateRuler();

    // Register end-of-segment watcher
    highlightEndWatcher = () => {
      if (videoElement.currentTime >= hl.end) {
        videoElement.pause();
        clearHighlightWatcher();
        activeHighlightIdx = -1;

        // Reset button states
        allItems.forEach((el) => {
          const playBtn = el.querySelector('.play-hl-btn');
          if (playBtn) {
            playBtn.innerHTML = '▶';
            playBtn.style.background = 'rgba(94, 234, 212, 0.08)';
            playBtn.style.color = 'var(--accent)';
          }
        });
        showToast(`Selesai memutar Momen #${idx + 1}.`);
      }
    };
    videoElement.addEventListener('timeupdate', highlightEndWatcher);
  }

  function renderSuggestedHighlightsList(highlights) {
    highlightsList.innerHTML = '';
    clearHighlightWatcher();
    activeHighlightIdx = -1;
    selectedHighlights.clear();
    cachedHighlights = highlights;
    updateExportBar();

    const itemEls = [];

    // ===== Summary header =====
    const summary = document.createElement('div');
    summary.style.cssText = `
      font-size: 11px; color: var(--muted); padding: 0 2px 10px;
      border-bottom: 1px solid var(--border); margin-bottom: 8px;
    `;
    summary.innerHTML = `${highlights.length} segmen terdeteksi · ` +
      (lastHighlightEngine === 'ai'
        ? '<b style="color:#8b5cf6">✨ AI Transcript</b> · Centang untuk ekspor batch'
        : 'Analisis audio-energy · Centang untuk ekspor batch');
    highlightsList.appendChild(summary);


    highlights.forEach((hl, idx) => {
      const dur = hl.end - hl.start;
      const durLabel = dur < 60
        ? `${Math.round(dur)}s`
        : `${Math.floor(dur / 60)}m ${Math.round(dur % 60)}s`;

      // Viral rating data (fallback jika server belum return field baru)
      const vs = hl.viralScore ?? 50;
      const grade = hl.viralGrade ?? 'C';
      const vLabel = hl.viralLabel ?? 'Layak Konten';
      const vEmoji = hl.viralEmoji ?? '📌';
      const vColor = hl.viralColor ?? '#22c55e';

      // Grade → border color
      const gradeColors = { S: '#ef4444', A: '#f97316', B: '#eab308', C: '#22c55e', D: '#6b7280' };
      const borderColor = gradeColors[grade] || '#6b7280';

      const item = document.createElement('div');
      item.className = 'hl-card';
      item.style.borderLeft = `4px solid ${borderColor}`;
      item.style.borderColor = `${borderColor}40`;

      // ===== Rank badge =====
      const rankBadge = document.createElement('span');
      rankBadge.className = 'hl-rank';
      rankBadge.innerHTML = `<strong>#${idx + 1}</strong> KLIP`;

      // ===== Viral grade badge =====
      const gradeBadge = document.createElement('span');
      gradeBadge.className = 'hl-grade-badge';
      gradeBadge.style.background = `${borderColor}22`;
      gradeBadge.style.color = borderColor;
      gradeBadge.style.border = `1px solid ${borderColor}55`;
      gradeBadge.innerHTML = `${vEmoji} ${grade}`;
      gradeBadge.title = `Grade ${grade}: ${vLabel} (${vs}/100)`;

      // ===== Checkbox for batch selection =====
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.style.cssText = `
        width: 17px; height: 17px; flex-shrink: 0;
        accent-color: ${borderColor}; cursor: pointer;
      `;
      checkbox.title = `Pilih untuk ekspor batch`;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedHighlights.add(idx);
          item.style.background = `${borderColor}10`;
        } else {
          selectedHighlights.delete(idx);
          item.style.background = '';
        }
        updateExportBar();
      });

      // ===== Header row =====
      const headRow = document.createElement('div');
      headRow.className = 'hl-card-head';
      headRow.appendChild(checkbox);
      headRow.appendChild(rankBadge);
      headRow.appendChild(gradeBadge);

      // ===== Vizard-style thumbnail placeholder =====
      const thumb = document.createElement('div');
      thumb.className = 'hl-thumb';
      thumb.style.setProperty('--hl-glow-1', `${borderColor}59`);
      thumb.style.setProperty('--hl-glow-2', `${borderColor}14`);
      const thumbEmoji = document.createElement('span');
      thumbEmoji.className = 'hl-thumb-emoji';
      thumbEmoji.textContent = vEmoji;
      thumb.appendChild(thumbEmoji);
      const durChip = document.createElement('span');
      durChip.className = 'hl-thumb-dur';
      durChip.textContent = durLabel;
      thumb.appendChild(durChip);
      const thumbPlay = document.createElement('button');
      thumbPlay.type = 'button';
      thumbPlay.className = 'hl-thumb-play';
      thumbPlay.innerHTML = '▶';
      thumbPlay.title = 'Tonton segmen ini di player';
      thumbPlay.addEventListener('click', () => playHighlightSegment(hl, idx, itemEls));
      thumb.appendChild(thumbPlay);

      // ===== Info block =====
      const info = document.createElement('div');
      info.style.cssText = 'flex: 1; min-width: 0;';

      // ===== Vizard-style Title Banner =====
      if (hl.autoTitle) {
        const titleEl = document.createElement('div');
        titleEl.className = 'hl-title';
        titleEl.textContent = hl.autoTitle;
        info.appendChild(titleEl);
      }

      const topLine = document.createElement('div');
      topLine.className = 'hl-time-row';

      const startInp = document.createElement('input');
      startInp.type = 'text';
      startInp.value = secondsToTime(hl.start);
      startInp.title = 'Ubah waktu mulai';
      startInp.className = 'hl-time-inp';

      const separator = document.createElement('span');
      separator.textContent = '—';
      separator.style.cssText = 'color: var(--muted); font-size: 11px; font-weight: 600; padding: 0 2px;';

      const endInp = document.createElement('input');
      endInp.type = 'text';
      endInp.value = secondsToTime(hl.end);
      endInp.title = 'Ubah waktu selesai';
      endInp.className = 'hl-time-inp';

      const durationLabel = document.createElement('span');
      durationLabel.className = 'hl-dur';
      durationLabel.textContent = durLabel;

      topLine.appendChild(startInp);
      topLine.appendChild(separator);
      topLine.appendChild(endInp);
      topLine.appendChild(durationLabel);

      const updateHlTime = () => {
        const newStart = timeToSeconds(startInp.value);
        const newEnd = timeToSeconds(endInp.value);
        if (!isNaN(newStart) && !isNaN(newEnd) && newEnd > newStart) {
          hl.start = newStart;
          hl.end = newEnd;
          const newDur = newEnd - newStart;
          durationLabel.textContent = newDur < 60
            ? `${Math.round(newDur)}s`
            : `${Math.floor(newDur / 60)}m ${Math.round(newDur % 60)}s`;
          startInp.style.borderColor = 'var(--border)';
          endInp.style.borderColor = 'var(--border)';
        } else {
          if (isNaN(newStart)) startInp.style.borderColor = '#ef4444';
          else startInp.style.borderColor = 'var(--border)';
          if (isNaN(newEnd) || newEnd <= newStart) endInp.style.borderColor = '#ef4444';
          else endInp.style.borderColor = 'var(--border)';
        }
      };
      startInp.addEventListener('input', updateHlTime);
      endInp.addEventListener('input', updateHlTime);

      const bottomLine = document.createElement('div');
      bottomLine.style.cssText = 'display: flex; align-items: center; gap: 6px; margin-top: 4px;';

      // Viral score bar
      const barWrap = document.createElement('div');
      barWrap.className = 'hl-scorebar';
      const barFill = document.createElement('div');
      barFill.className = 'hl-scorebar-fill';
      barFill.style.width = `${vs}%`;
      barFill.style.background = borderColor;
      barWrap.appendChild(barFill);

      const viralText = document.createElement('span');
      viralText.className = 'hl-viral-label';
      viralText.style.color = borderColor;
      viralText.textContent = `${vEmoji} ${vLabel}`;

      const scoreText = document.createElement('span');
      scoreText.className = 'hl-score';
      scoreText.style.color = borderColor;
      scoreText.textContent = `${(vs / 10).toFixed(1)} VIRALITY`;

      bottomLine.appendChild(barWrap);
      bottomLine.appendChild(viralText);
      bottomLine.appendChild(scoreText);

      // ===== Viral Analysis Box (Alasan Kenapa Klip Ini Populer & Point Menarik) =====
      const reasonBox = document.createElement('div');
      reasonBox.className = 'hl-reason';
      reasonBox.style.borderLeftColor = borderColor;
      const reasonHeader = document.createElement('div');
      reasonHeader.className = 'hl-reason-head';
      reasonHeader.style.color = borderColor;
      reasonHeader.innerHTML = `💡 <strong>Viral reason (Grade ${grade}):</strong>`;
      reasonBox.appendChild(reasonHeader);

      const reasonText = document.createElement('div');
      reasonText.textContent = hl.analysisReason || 'Hook pembuka kuat & dinamika vokal menahan retensi penonton.';
      reasonBox.appendChild(reasonText);

      if (Array.isArray(hl.highlightPoints) && hl.highlightPoints.length > 0) {
        const pointsList = document.createElement('ul');
        pointsList.className = 'hl-reason-list';
        hl.highlightPoints.forEach(pt => {
          const li = document.createElement('li');
          li.textContent = pt;
          pointsList.appendChild(li);
        });
        reasonBox.appendChild(pointsList);
      }

      info.appendChild(topLine);
      info.appendChild(bottomLine);
      info.appendChild(reasonBox);

      // ===== ▶ Tonton button =====
      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'btn play-hl-btn';
      playBtn.innerHTML = '▶';
      playBtn.title = 'Tonton segmen ini di player';
      playBtn.style.cssText = `
        padding: 6px 10px; font-size: 13px; font-weight: 700;
        background: rgba(94, 234, 212, 0.08); color: var(--accent);
        border: 1px solid rgba(94, 234, 212, 0.25); border-radius: 6px;
        cursor: pointer; flex-shrink: 0; transition: background 0.15s;
        line-height: 1;
      `;
      playBtn.addEventListener('click', () => {
        playHighlightSegment(hl, idx, itemEls);
      });

      // ===== 📱 Preview 9:16 + Subtitle button =====
      const preview916Btn = document.createElement('button');
      preview916Btn.type = 'button';
      preview916Btn.className = 'btn btn-preview-916';
      preview916Btn.innerHTML = '📱 9:16';
      preview916Btn.title = 'Preview video vertikal 9:16 nyata dengan subtitle yang dipilih';
      preview916Btn.style.cssText = `
        padding: 5px 8px; font-size: 11px; font-weight: 700;
        border-radius: 6px; cursor: pointer; flex-shrink: 0; white-space: nowrap;
      `;
      preview916Btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openVideoPreview916(hl);
      });

      // ===== Pilih button =====
      const useBtn = document.createElement('button');
      useBtn.type = 'button';
      useBtn.className = 'btn';
      useBtn.innerHTML = 'Pilih';
      useBtn.style.cssText = `
        padding: 5px 10px; font-size: 11px; font-weight: 600;
        background: ${borderColor}18; color: ${borderColor};
        border: 1px solid ${borderColor}44; border-radius: 6px;
        cursor: pointer; flex-shrink: 0; white-space: nowrap;
        transition: background 0.15s;
      `;
      useBtn.addEventListener('click', async () => {
        startInput.value = secondsToTime(hl.start);
        endInput.value = secondsToTime(hl.end);
        updateRuler();
        if (videoElement.src) videoElement.currentTime = hl.start;
        
        if (metaClipTitle && hl.autoTitle) metaClipTitle.value = hl.autoTitle;
        if (metaClipTags && hl.autoTags) metaClipTags.value = hl.autoTags;
        if (metaClipDesc && hl.autoDescription) metaClipDesc.value = hl.autoDescription;
        // headline TIDAK auto-fill (banner teks terbakar permanen di video)

        // Generate metadata berbasis konten untuk segmen ini (transkripsi AI)
        if (generateMetaBtn) {
          const originalHTML = generateMetaBtn.innerHTML;
          generateMetaBtn.disabled = true;
          generateMetaBtn.innerHTML = '⏳ Menganalisis konten…';
          try {
            const meta = await fetchContentMetadata(hl.start, hl.end);
            if (meta && meta.title) fillMetadataFields(meta);
          } finally {
            generateMetaBtn.disabled = false;
            generateMetaBtn.innerHTML = originalHTML;
          }
        }

        const reasonMsg = hl.analysisReason ? `\n💡 Analisis: ${hl.analysisReason}` : '';
        showToast(`${vEmoji} Momen #${idx + 1} (${vLabel}) dipilih. Metadata konten disiapkan.${reasonMsg}`);
        itemEls.forEach((el, i) => {
          el.style.borderLeft = i === idx ? `4px solid ${borderColor}` : `4px solid ${gradeColors[highlights[i]?.viralGrade] || '#6b7280'}`;
          el.style.background = i === idx ? `${borderColor}0d` : '';
        });
      });

      // ===== Actions row =====
      useBtn.classList.add('btn-use');
      const actions = document.createElement('div');
      actions.className = 'hl-actions';
      actions.appendChild(useBtn);
      actions.appendChild(playBtn);
      actions.appendChild(preview916Btn);

      item.appendChild(headRow);
      item.appendChild(thumb);
      item.appendChild(info);
      item.appendChild(actions);
      highlightsList.appendChild(item);
      itemEls.push(item);
    });
  }



  // ===== Export Selected Bar =====
  function updateExportBar() {
    const count = selectedHighlights.size;
    exportSelectedCount.textContent = count;
    exportSelectedBtn.style.display = count > 0 ? 'inline-flex' : 'none';
  }

  // ===== Batch Export Engine =====
  // Matikan heatmap SELALU saat ekspor: overlay kuning tracking wajah tidak
  // boleh masuk ke hasil video. Uncheck otomatis + toast sekali jika tadi ON.
  function forceHeatmapOff() {
    if (heatmapToggle && heatmapToggle.checked) {
      heatmapToggle.checked = false;
      showToast('Overlay heatmap dinonaktifkan otomatis untuk ekspor ini.', 'info');
    }
    return false;
  }

  async function exportSelectedClips() {
    const indices = [...selectedHighlights].sort((a, b) => a - b);
    if (indices.length === 0) return;

    const url = urlInput.value.trim();
    const resolution = resolutionSelect.value;
    const aspect = getEffectiveAspectRatio();
    const heatmap = forceHeatmapOff();
    const dynamicZoom = dynamicZoomToggle.checked;
    const audioEnhance = audioEnhanceToggle.checked;
    const silenceRemover = silenceRemoverToggle ? silenceRemoverToggle.checked : false;
    const headline = headlineInput.value.trim();

    exportSelectedBtn.disabled = true;
    exportSelectedBtn.innerHTML = `⏳ Mengekspor 0/${indices.length}…`;
    startActiveProgressUI(`📦 Menyiapkan ekspor ${indices.length} klip terpilih…`, 4);

    const results = [];
    for (let i = 0; i < indices.length; i++) {
      const hl = cachedHighlights[indices[i]];
      if (!hl) continue;

      const start = secondsToTime(hl.start);
      const end   = secondsToTime(hl.end);

      exportSelectedBtn.innerHTML = `⏳ Mengekspor ${i + 1}/${indices.length}…`;
      updateActiveProgressUI(`✂️ Klip ${i + 1}/${indices.length}: ${start} — ${end}`, Math.round((i / indices.length) * 100));
      showToast(`Memproses Clip ${i + 1}/${indices.length}: ${start} — ${end}`);

      if (aspect.startsWith('9:16') || aspect === '1:1') {
        const pointsInRange = cropPoints.filter(pt => pt.time >= hl.start && pt.time <= hl.end);
        if (pointsInRange.length === 0) {
          showToast(`Koordinat tracking wajah kosong untuk Clip ${i + 1}. Memindai wajah otomatis…`, 'info');
          await scanFacesInRange(hl.start, hl.end);
        }
      }

      const autoSubtitle = autoSubtitleToggle ? autoSubtitleToggle.checked : false;
      const subtitleStyle = subtitleStyleSelect ? subtitleStyleSelect.value : 'quick-brown-inv';
      const subtitleLanguage = subtitleLangSelect ? subtitleLangSelect.value : 'auto';
      const subtitleFont = subtitleFontSelect ? subtitleFontSelect.value : 'auto';
      const subtitleConfig = getSubtitleConfigIfAuto();

      try {
        const { data } = await apiRequest('/api/clip', {
          method: 'POST',
          body: JSON.stringify({
            url,
            start,
            end,
            resolution,
            crops: cropPoints,
            aspectRatio: aspect,
            heatmapOverlay: heatmap,
          dynamicZoom,
          audioEnhance,
          silenceRemover,
          autoSubtitle,
            subtitleStyle,
            subtitleLanguage,
            subtitleFont,
            subtitleConfig,
          }),
        });

        // Wait for job completion
        await new Promise((resolve, reject) => {
          const sseRef = { source: null };
          sseRef.source = connectJobStatus(
            data.jobId,
            (status) => {
              if (status.progress !== undefined) {
                exportSelectedBtn.innerHTML = `⏳ Mengekspor ${i + 1}/${indices.length} (${status.progress}%)…`;
              }
              // Drive progress bar batch (0-100% keseluruhan)
              updateBatchProgressUI(i, indices.length, status);
              if (status.status === 'done') {
                if (sseRef.source) sseRef.source.close();
                results.push({ jobId: data.jobId, outputFile: status.outputFile, downloadUrl: `/api/download/${data.jobId}` });
                resolve();
              } else if (status.status === 'error') {
                if (sseRef.source) sseRef.source.close();
                reject(new Error(status.error?.message || 'Clip gagal'));
              }
            },
            (err) => { reject(new Error('SSE error')); }
          );
        });
      } catch (err) {
        updateActiveProgressUI(`❌ Klip ${i + 1}/${indices.length} gagal: ${err.message}`, Math.round(((i + 1) / indices.length) * 100));
        showToast(`Clip ${i + 1} gagal: ${err.message}`, 'error');
      }
    }

    // Show batch result panel
    exportSelectedBtn.disabled = false;
    exportSelectedBtn.innerHTML = `✅ Selesai (${results.length}/${indices.length})`;

    if (results.length > 0) {
      updateActiveProgressUI(`✅ Selesai — ${results.length} klip siap diunduh. Klik ⬇ Download di bawah.`, 100);
      renderBatchResultPanel(results);
    } else {
      updateActiveProgressUI('❌ Tidak ada klip yang berhasil diekspor.', 100);
    }
  }

  // ===== Export Antrian (multi-klip dengan metadata per klip) =====
  async function exportQueueClips() {
    if (clipQueue.length === 0) {
      showToast('Antrian kosong. Pilih segmen lalu "Simpan ke Antrian".', 'warning');
      return;
    }

    const url = urlInput.value.trim();
    const resolution = resolutionSelect.value;
    const aspect = getEffectiveAspectRatio();
    const heatmap = forceHeatmapOff();
    const dynamicZoom = dynamicZoomToggle.checked;
    const audioEnhance = audioEnhanceToggle.checked;
    const silenceRemover = silenceRemoverToggle ? silenceRemoverToggle.checked : false;
    const autoSubtitle = autoSubtitleToggle ? autoSubtitleToggle.checked : false;
    const subtitleStyle = subtitleStyleSelect ? subtitleStyleSelect.value : 'quick-brown-inv';
    const subtitleSize = subtitleSizeSelect ? subtitleSizeSelect.value : 'large';
    const subtitlePosition = subtitlePosSelect ? subtitlePosSelect.value : 'bottom';
    const subtitleCase = subtitleCaseSelect ? subtitleCaseSelect.value : 'uppercase';
    const subtitleLanguage = subtitleLangSelect ? subtitleLangSelect.value : 'auto';
    const subtitleFont = subtitleFontSelect ? subtitleFontSelect.value : 'auto';
    const subtitleConfig = getSubtitleConfigIfAuto();
    const bgmTrack = bgmTrackSelect ? bgmTrackSelect.value : 'none';
    const bgmVolume = bgmVolumeSelect ? parseFloat(bgmVolumeSelect.value) : 0.10;

    exportQueueBtn.disabled = true;
    exportQueueBtn.innerHTML = `⏳ Mengekspor 0/${clipQueue.length}…`;

    const results = [];
    for (let i = 0; i < clipQueue.length; i++) {
      const q = clipQueue[i];
      const start = secondsToTime(q.start);
      const end = secondsToTime(q.end);
      exportQueueBtn.innerHTML = `⏳ Mengekspor ${i + 1}/${clipQueue.length}…`;
      showToast(`Memproses Klip ${i + 1}/${clipQueue.length}: ${start} — ${end}`);

      if (aspect.startsWith('9:16') || aspect === '1:1') {
        const pointsInRange = cropPoints.filter(pt => pt.time >= q.start && pt.time <= q.end);
        if (pointsInRange.length === 0) {
          showToast(`Koordinat tracking wajah kosong untuk Klip ${i + 1}. Memindai wajah otomatis…`, 'info');
          await scanFacesInRange(q.start, q.end);
        }
      }

      try {
        const { data } = await apiRequest('/api/clip', {
          method: 'POST',
          body: JSON.stringify({
            url,
            start,
            end,
            resolution,
            crops: cropPoints,
            aspectRatio: aspect,
            heatmapOverlay: heatmap,
            dynamicZoom,
            audioEnhance,
            headlineText: q.headline || '',
            autoSubtitle,
            subtitleStyle,
            subtitleSize,
            subtitlePosition,
            subtitleCase,
            subtitleLanguage,
            subtitleFont,
            subtitleConfig,
            clipTitle: q.title || '',
            clipTags: q.tags || '',
            clipDescription: q.description || '',
            bgmTrack,
            bgmVolume,
          }),
        });

        await new Promise((resolve, reject) => {
          const sseRef = { source: null };
          sseRef.source = connectJobStatus(
            data.jobId,
            (status) => {
              if (status.progress !== undefined) {
                exportQueueBtn.innerHTML = `⏳ Mengekspor ${i + 1}/${clipQueue.length} (${status.progress}%)…`;
              }
              if (status.status === 'done') {
                if (sseRef.source) sseRef.source.close();
                results.push({
                  jobId: data.jobId,
                  outputFile: status.outputFile,
                  downloadUrl: `/api/download/${data.jobId}`,
                  title: q.title || '',
                  tags: q.tags || '',
                  description: q.description || '',
                });
                resolve();
              } else if (status.status === 'error') {
                if (sseRef.source) sseRef.source.close();
                reject(new Error(status.error?.message || 'Clip gagal'));
              }
            },
            (err) => { reject(new Error('SSE error')); }
          );
        });
      } catch (err) {
        showToast(`Klip ${i + 1} gagal: ${err.message}`, 'error');
      }
    }

    exportQueueBtn.disabled = false;
    exportQueueBtn.innerHTML = `✅ Selesai (${results.length}/${clipQueue.length})`;

    if (results.length > 0) {
      renderBatchResultPanel(results);
    }
  }

  function renderBatchResultPanel(results) {
    // Auto-uncheck heatmap: setelah batch export selesai, ekspor ulang klip
    // yang sama tidak boleh membawa lagi overlay kuning wajah.
    if (heatmapToggle) heatmapToggle.checked = false;

    // Remove existing panel if any
    const existingPanel = document.getElementById('batchResultPanel');
    if (existingPanel) existingPanel.remove();

    const panel = document.createElement('div');
    panel.id = 'batchResultPanel';
    panel.style.cssText = `
      margin-top: 16px; padding: 16px;
      background: var(--bg-alt); border-radius: 10px;
      border: 1px solid var(--accent);
    `;

    const title = document.createElement('div');
    title.style.cssText = 'font-size:13px; font-weight:700; color:var(--accent); margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;';
    title.innerHTML = `<span>✅ ${results.length} Clip Siap Diunduh</span>`;

    const zipBtn = document.createElement('button');
    zipBtn.className = 'btn btn-primary';
    zipBtn.style.cssText = 'padding:4px 12px; font-size:11px; font-weight:600; cursor:pointer;';
    zipBtn.innerHTML = '📦 Download Semua (ZIP)';
    zipBtn.addEventListener('click', async () => {
      setButtonLoading(zipBtn, true, 'Mengompres ZIP…');
      try {
        const res = await fetch('/api/download/zip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jobIds: results.map(r => ({ jobId: r.jobId, title: r.title || '', tags: r.tags || '', description: r.description || '' })) })
        });
        if (!res.ok) throw new Error('Gagal mengunduh ZIP.');
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `yt_clips_batch_${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast('File ZIP berhasil diunduh!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        setButtonLoading(zipBtn, false);
      }
    });
    title.appendChild(zipBtn);
    panel.appendChild(title);

    results.forEach((r, i) => {
      const row = document.createElement('div');
      row.style.cssText = `
        display: flex; justify-content: space-between; align-items: center;
        padding: 8px 10px; margin-bottom: 6px;
        background: var(--bg-raised); border-radius: 6px;
        border: 1px solid var(--border); gap: 10px;
      `;

      const name = document.createElement('span');
      name.style.cssText = 'font-family:var(--font-mono); font-size:11px; color:var(--muted); flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
      name.textContent = r.outputFile;
      name.title = r.outputFile;

      const dlBtn = document.createElement('a');
      dlBtn.href = r.downloadUrl;
      dlBtn.download = r.outputFile;
      dlBtn.className = 'btn btn-primary';
      dlBtn.style.cssText = 'padding:5px 14px; font-size:11px; font-weight:600; white-space:nowrap;';
      dlBtn.textContent = '⬇ Download';

      row.appendChild(name);
      row.appendChild(dlBtn);
      panel.appendChild(row);
    });

    // Insert after highlightsContainer
    const highlightsContainer = document.getElementById('highlightsContainer');
    highlightsContainer.insertAdjacentElement('afterend', panel);
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  exportSelectedBtn.addEventListener('click', exportSelectedClips);
  if (exportQueueBtn) exportQueueBtn.addEventListener('click', exportQueueClips);

  // ===== STEP 2: Submit Clip Job =====
  clipForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clipError.hidden = true;

    const start = startInput.value.trim();
    const end = endInput.value.trim();
    const startSec = timeToSeconds(start);
    const endSec = timeToSeconds(end);

    if (isNaN(startSec) || isNaN(endSec)) {
      clipError.textContent = 'Format waktu tidak valid. Gunakan HH:MM:SS.';
      clipError.hidden = false;
      return;
    }
    if (startSec >= endSec) {
      clipError.textContent = 'Waktu mulai harus lebih kecil dari waktu selesai.';
      clipError.hidden = false;
      return;
    }

    const aspect = getEffectiveAspectRatio();
    const heatmap = forceHeatmapOff();
    const dynamicZoom = dynamicZoomToggle.checked;
    const audioEnhance = audioEnhanceToggle.checked;
    const silenceRemover = silenceRemoverToggle ? silenceRemoverToggle.checked : false;
    const autoSubtitle = autoSubtitleToggle ? autoSubtitleToggle.checked : false;
    const subtitleStyle = subtitleStyleSelect ? subtitleStyleSelect.value : 'quick-brown-inv';
    const subtitleSize = subtitleSizeSelect ? subtitleSizeSelect.value : 'large';
    const subtitlePosition = subtitlePosSelect ? subtitlePosSelect.value : 'bottom';
    const subtitleCase = subtitleCaseSelect ? subtitleCaseSelect.value : 'uppercase';
    const subtitleLanguage = subtitleLangSelect ? subtitleLangSelect.value : 'auto';
    const subtitleFont = subtitleFontSelect ? subtitleFontSelect.value : 'auto';
    const subtitleConfig = getSubtitleConfigIfAuto();
    const headline = headlineInput.value.trim();
    const clipTitle = metaClipTitle ? metaClipTitle.value.trim() : '';
    const clipTags = metaClipTags ? metaClipTags.value.trim() : '';
    const clipDescription = metaClipDesc ? metaClipDesc.value.trim() : '';
    const bgmTrack = bgmTrackSelect ? bgmTrackSelect.value : 'none';
    const bgmVolume = bgmVolumeSelect ? parseFloat(bgmVolumeSelect.value) : 0.10;
    const watermarkText = document.getElementById('watermarkTextInput') ? document.getElementById('watermarkTextInput').value.trim() : '';
    const watermarkPosition = document.getElementById('watermarkPosSelect') ? document.getElementById('watermarkPosSelect').value : 'bottomright';

    // Aktifkan indikator progress LIVE secara langsung
    startActiveProgressUI('⏱ Step 1/4: Menyiapkan parameter klip...', 12);

    // Validasi & Auto-scan tracking jika vertical crop dipilih
    if (aspect.startsWith('9:16') || aspect === '1:1') {
      const pointsInRange = cropPoints.filter(pt => pt.time >= startSec && pt.time <= endSec);
      if (pointsInRange.length === 0) {
        updateActiveProgressUI('🤖 Step 2/4: Memindai posisi wajah AI (Auto-Center Crop)...', 25);
        showToast('Koordinat tracking wajah kosong. Menjalankan Pindai Wajah AI secara otomatis…', 'info');
        await scanFacesInRange(startSec, endSec);
      }
    }

    updateActiveProgressUI('⚡ Step 3/4: Mendaftarkan job klip ke server...', 40);
    setButtonLoading(clipBtn, true, 'Mendaftarkan job…');

    try {
      const { data } = await apiRequest('/api/clip', {
        method: 'POST',
        body: JSON.stringify({
          url: urlInput.value.trim(),
          start,
          end,
          resolution: resolutionSelect.value,
          crops: cropPoints,
          aspectRatio: aspect,
          heatmapOverlay: heatmap,
          dynamicZoom,
          audioEnhance,
          silenceRemover,
          headlineText: headline,
          autoSubtitle,
          subtitleStyle,
          subtitleSize,
          subtitlePosition,
          subtitleCase,
          subtitleLanguage,
          subtitleFont,
          subtitleConfig,
          clipTitle,
          clipTags,
          clipDescription,
          bgmTrack,
          bgmVolume,
          watermarkText,
          watermarkPosition
        }),
      });

      currentJobId = data.jobId;
      listenToProgress(currentJobId);
    } catch (err) {
      clipError.textContent = err.message;
      clipError.hidden = false;
      showToast(err.message, 'error');
      setButtonLoading(clipBtn, false);
    }
  });

  // ===== Live Progress UI Controller =====
  function startActiveProgressUI(stageText = 'Memulai klip...', initialPercent = 10) {
    if (progressSection) {
      progressSection.hidden = false;
      progressSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (resultSection) resultSection.hidden = true;
    if (progressBar) progressBar.style.width = `${initialPercent}%`;
    if (progressPercent) progressPercent.textContent = `${initialPercent}%`;
    if (progressStage) progressStage.textContent = stageText;
  }

  function updateActiveProgressUI(stageText, percent) {
    if (progressBar && percent !== undefined) progressBar.style.width = `${percent}%`;
    if (progressPercent && percent !== undefined) progressPercent.textContent = `${percent}%`;
    if (progressStage && stageText) progressStage.textContent = stageText;
  }

  // ===== Progress UI khusus Batch Export (klip terpilih / antrian) =====
  // Peta progress per-klip (SSE 0-100%) → progress keseluruhan batch (0-100%)
  function updateBatchProgressUI(clipIndex, clipTotal, status) {
    const rawPct = Math.round(status.progress || 0);
    const clipStart = (clipIndex / clipTotal) * 100;
    const clipEnd = ((clipIndex + 1) / clipTotal) * 100;
    const overall = Math.round(clipStart + (clipEnd - clipStart) * (rawPct / 100));

    let stage;
    if (status.status === 'done') {
      stage = `✅ Klip ${clipIndex + 1}/${clipTotal} selesai`;
    } else if (status.status === 'error') {
      stage = `❌ Klip ${clipIndex + 1}/${clipTotal} gagal`;
    } else {
      stage = `🎬 Klip ${clipIndex + 1}/${clipTotal}: ${status.stage || 'Memproses…'} (${rawPct}%)`;
    }
    updateActiveProgressUI(stage, overall);
    return overall;
  }

  // ===== STEP 3: Listen Progress via SSE =====
  function listenToProgress(jobId) {
    connectJobStatus(
      jobId,
      (data) => {
        const rawPct = Math.round(data.progress || 0);
        const mappedPct = Math.max(45, rawPct);
        updateActiveProgressUI(`🎬 Step 4/4: ${data.stage || 'Memproses…'} (${rawPct}%)`, mappedPct);

        if (data.status === 'done') {
          onClipDone(data);
        } else if (data.status === 'error') {
          onClipError(data);
        }
      },
      () => {
        showToast('Koneksi progress terputus.', 'error');
        setButtonLoading(clipBtn, false);
      }
    );
  }

  function onClipDone(data) {
    setButtonLoading(clipBtn, false);
    resultFilename.textContent = data.outputFile;
    downloadBtn.href = `/api/download/${data.id}`;
    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('Clip berhasil dibuat! Siap diunduh.');
  }

  function onClipError(data) {
    setButtonLoading(clipBtn, false);
    const message = data.error?.message || 'Proses clipping gagal.';
    clipError.textContent = message;
    clipError.hidden = false;
    showToast(message, 'error');
  }

  // ===== Direct Social Media Publishing via Repliz =====
  if (publishSocialBtn) {
    publishSocialBtn.addEventListener('click', async () => {
      if (!currentJobId) {
        showToast('Klip belum selesai diproses.', 'warning');
        return;
      }
      const caption = metaClipDesc ? metaClipDesc.value.trim() : (metaClipTitle ? metaClipTitle.value : 'Video Clip');
      setButtonLoading(publishSocialBtn, true, 'Mengirim ke Sosmed…');
      try {
        await apiRequest('/api/social/publish', {
          method: 'POST',
          body: JSON.stringify({
            jobId: currentJobId,
            caption: caption,
            platforms: ['tiktok', 'instagram', 'youtube']
          })
        });
        showToast('🚀 Klip berhasil dikirim/dijadwalkan ke media sosial!', 'success');
      } catch (err) {
        showToast('Gagal posting ke sosmed: ' + err.message, 'error');
      } finally {
        setButtonLoading(publishSocialBtn, false);
      }
    });
  }

  // ===== STEP 4: Delete Result =====
  deleteBtn.addEventListener('click', async () => {
    if (!currentJobId) return;
    try {
      await apiRequest(`/api/delete/${currentJobId}`, { method: 'DELETE' });
      resultSection.hidden = true;
      progressSection.hidden = true;
      showToast('File berhasil dihapus.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
})();
