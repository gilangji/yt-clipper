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
  const heatmapToggle = document.getElementById('heatmapToggle');
  const dynamicZoomToggle = document.getElementById('dynamicZoomToggle');
  const audioEnhanceToggle = document.getElementById('audioEnhanceToggle');
  const detectHighlightsBtn = document.getElementById('detectHighlightsBtn');
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

  const themeToggle = document.getElementById('themeToggle');
  const toastContainer = document.getElementById('toastContainer');

  let currentVideoDuration = 0;
  let currentJobId = null;
  let sourceVideoFilename = null;
  let selectedHighlights = new Set(); // Set of highlight indices selected for batch export
  let cachedHighlights = [];          // Last rendered highlights array

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

  // ===== Toast Notification =====
  function showToast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast${type === 'error' ? ' error' : ''}`;
    el.textContent = message;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  // ===== Load BlazeFace Model =====
  async function loadAIModel() {
    try {
      // Guard: tf and blazeface must be available from CDN scripts
      if (typeof tf === 'undefined' || typeof blazeface === 'undefined') {
        throw new Error('TensorFlow.js atau BlazeFace belum termuat dari CDN.');
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
    }
  }

  // Defer until all external scripts are done loading
  if (document.readyState === 'complete') {
    loadAIModel();
  } else {
    window.addEventListener('load', loadAIModel);
  }

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
  startInput.addEventListener('input', updateRuler);
  endInput.addEventListener('input', updateRuler);

  // Inject handles for sliding and resizing ruler selection
  rulerSelection.style.cursor = 'grab';
  rulerSelection.style.position = 'absolute'; // Ensure absolute

  const handleLeft = document.createElement('div');
  handleLeft.className = 'ruler-handle handle-left';
  handleLeft.style.cssText = 'position:absolute; left:-6px; top:0; bottom:0; width:12px; cursor:ew-resize; z-index: 10;';
  rulerSelection.appendChild(handleLeft);

  const handleRight = document.createElement('div');
  handleRight.className = 'ruler-handle handle-right';
  handleRight.style.cssText = 'position:absolute; right:-6px; top:0; bottom:0; width:12px; cursor:ew-resize; z-index: 10;';
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

        // Smoothing (Exponential Moving Average) untuk mencegah kamera berguncang
        const smoothBeta = 0.06;
        const deadband = 0.04; // 4% deadband threshold to prevent jitter/micro-movements
        
        let smoothedCx = lastFocusCx;
        let smoothedCy = lastFocusCy;
        
        if (Math.abs(targetCx - lastFocusCx) > deadband) {
          smoothedCx = lastFocusCx + smoothBeta * (targetCx - lastFocusCx);
        }
        if (Math.abs(targetCy - lastFocusCy) > deadband) {
          smoothedCy = lastFocusCy + smoothBeta * (targetCy - lastFocusCy);
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
    const windowRadius = 0.8; // 1.6s total window size

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
    if (!faceModel) return;

    const originalTime = videoElement.currentTime;
    const isPlaying = !videoElement.paused;
    if (isPlaying) videoElement.pause();

    const oldCursor = document.body.style.cursor;
    document.body.style.cursor = 'wait';

    const step = 0.4;
    const totalSteps = Math.ceil((endSec - startSec) / step);
    let stepCount = 0;

    showToast(`🤖 Pindai Wajah AI dimulai (${totalSteps} frame)…`, 'info');

    let lastCx = lastFocusCx || 0.5;
    let lastCy = lastFocusCy || 0.5;

    for (let t = startSec; t <= endSec; t += step) {
      videoElement.currentTime = t;
      
      await new Promise((resolve) => {
        const onSeeked = () => {
          videoElement.removeEventListener('seeked', onSeeked);
          resolve();
        };
        videoElement.addEventListener('seeked', onSeeked);
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

          const beta = 0.06;
          const deadband = 0.04; // 4% deadband threshold to prevent jitter/micro-movements
          if (Math.abs(cx - lastCx) > deadband) {
            lastCx = lastCx + beta * (cx - lastCx);
          }
          if (Math.abs(cy - lastCy) > deadband) {
            lastCy = lastCy + beta * (cy - lastCy);
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
      // Kita download resolusi paling ringan (360p atau 480p) agar cepat dan hemat bandwidth
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

    setButtonLoading(detectHighlightsBtn, true, 'Menganalisis audio...');
    try {
      const response = await apiRequest('/api/highlights', {
        method: 'POST',
        body: JSON.stringify({ videoPath: sourceVideoFilename })
      });

      const { highlights, energies } = response.data;

      if (energies && energies.length > 0) {
        drawTimelineHeatmap(energies);
      }

      if (highlights && highlights.length > 0) {
        renderSuggestedHighlightsList(highlights);
        highlightsContainer.classList.remove('hidden');

        // Pilih highlight dengan score tertinggi secara default
        const topHighlight = highlights[0];
        startInput.value = secondsToTime(topHighlight.start);
        endInput.value = secondsToTime(topHighlight.end);
        updateRuler();
        videoElement.currentTime = topHighlight.start;

        showToast('Momen menarik terdeteksi! Timeline range telah di-update.', 'success');
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

    // Seek and play
    videoElement.currentTime = hl.start;
    videoElement.play().catch((err) => {
      showToast('Gagal memutar video: ' + err.message, 'error');
    });

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
    summary.textContent = `${highlights.length} segmen terdeteksi · Centang untuk ekspor batch`;
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
      item.style.cssText = `
        display: flex;
        align-items: center;
        padding: 10px 12px;
        background: var(--bg-raised);
        border: 1px solid ${borderColor}33;
        border-left: 3px solid ${borderColor};
        border-radius: 8px;
        font-size: 13px;
        transition: border-color 0.2s, background 0.2s, transform 0.1s;
        gap: 10px;
        cursor: default;
      `;
      item.addEventListener('mouseenter', () => { item.style.transform = 'translateX(2px)'; });
      item.addEventListener('mouseleave', () => { item.style.transform = ''; });

      // ===== Rank badge =====
      const rankBadge = document.createElement('span');
      rankBadge.style.cssText = `
        font-size: 10px; font-weight: 700; color: var(--muted);
        min-width: 22px; text-align: center; flex-shrink: 0;
      `;
      rankBadge.textContent = `#${idx + 1}`;

      // ===== Viral grade badge =====
      const gradeBadge = document.createElement('span');
      gradeBadge.style.cssText = `
        display: inline-flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; border-radius: 6px; flex-shrink: 0;
        font-size: 13px; font-weight: 800; letter-spacing: 0;
        background: ${borderColor}22; color: ${borderColor};
        border: 1px solid ${borderColor}55;
      `;
      gradeBadge.textContent = grade;
      gradeBadge.title = `Grade ${grade}: ${vLabel} (${vs}/100)`;

      // ===== Info block =====
      const info = document.createElement('div');
      info.style.cssText = 'flex: 1; min-width: 0;';

      const topLine = document.createElement('div');
      topLine.style.cssText = 'display: flex; align-items: center; gap: 4px; flex-wrap: wrap;';

      const startInp = document.createElement('input');
      startInp.type = 'text';
      startInp.value = secondsToTime(hl.start);
      startInp.title = 'Ubah waktu mulai';
      startInp.style.cssText = `
        width: 66px; text-align: center; font-family: var(--font-mono);
        background: var(--bg-alt); border: 1px solid var(--border);
        color: var(--text); border-radius: 4px; padding: 2px 4px; font-size: 11px;
      `;

      const separator = document.createElement('span');
      separator.textContent = '—';
      separator.style.cssText = 'color: var(--muted); font-size: 11px; font-weight: 600; padding: 0 2px;';

      const endInp = document.createElement('input');
      endInp.type = 'text';
      endInp.value = secondsToTime(hl.end);
      endInp.title = 'Ubah waktu selesai';
      endInp.style.cssText = `
        width: 66px; text-align: center; font-family: var(--font-mono);
        background: var(--bg-alt); border: 1px solid var(--border);
        color: var(--text); border-radius: 4px; padding: 2px 4px; font-size: 11px;
      `;

      const durationLabel = document.createElement('span');
      durationLabel.style.cssText = 'font-size: 10px; color: var(--muted); margin-left: 4px; font-weight: 500;';
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
      barWrap.style.cssText = `
        flex: 1; max-width: 80px; height: 4px; background: var(--border);
        border-radius: 2px; overflow: hidden;
      `;
      const barFill = document.createElement('div');
      barFill.style.cssText = `
        height: 100%; width: ${vs}%; background: ${borderColor};
        border-radius: 2px; transition: width 0.5s ease;
      `;
      barWrap.appendChild(barFill);

      const viralText = document.createElement('span');
      viralText.style.cssText = `font-size: 10px; color: ${borderColor}; font-weight: 600;`;
      viralText.textContent = `${vEmoji} ${vLabel}`;

      const scoreText = document.createElement('span');
      scoreText.style.cssText = 'font-size: 10px; color: var(--muted); margin-left: auto;';
      scoreText.textContent = `${vs}/100`;

      bottomLine.appendChild(barWrap);
      bottomLine.appendChild(viralText);
      bottomLine.appendChild(scoreText);

      info.appendChild(topLine);
      info.appendChild(bottomLine);

      // ===== ▶ Tonton button =====
      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'btn play-hl-btn';
      playBtn.innerHTML = '▶';
      playBtn.title = 'Tonton segmen ini';
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
      useBtn.addEventListener('click', () => {
        startInput.value = secondsToTime(hl.start);
        endInput.value = secondsToTime(hl.end);
        updateRuler();
        if (videoElement.src) videoElement.currentTime = hl.start;
        showToast(`${vEmoji} Momen #${idx + 1} (${vLabel}) dipilih.`);
        itemEls.forEach((el, i) => {
          el.style.borderLeft = i === idx ? `3px solid ${borderColor}` : `3px solid ${gradeColors[highlights[i]?.viralGrade] || '#6b7280'}`;
          el.style.background = i === idx ? `${borderColor}0d` : 'var(--bg-raised)';
        });
      });

      // ===== Checkbox for batch selection =====
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.style.cssText = `
        width: 16px; height: 16px; flex-shrink: 0;
        accent-color: ${borderColor}; cursor: pointer;
        margin-right: 2px;
      `;
      checkbox.title = `Pilih untuk ekspor batch`;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedHighlights.add(idx);
          item.style.background = `${borderColor}10`;
        } else {
          selectedHighlights.delete(idx);
          item.style.background = 'var(--bg-raised)';
        }
        updateExportBar();
      });

      item.appendChild(checkbox);
      item.appendChild(rankBadge);
      item.appendChild(gradeBadge);

      item.appendChild(info);
      item.appendChild(playBtn);
      item.appendChild(useBtn);
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
  async function exportSelectedClips() {
    const indices = [...selectedHighlights].sort((a, b) => a - b);
    if (indices.length === 0) return;

    const url = urlInput.value.trim();
    const resolution = resolutionSelect.value;
    const aspect = aspectRatioSelect.value;
    const heatmap = heatmapToggle.checked;
    const dynamicZoom = dynamicZoomToggle.checked;
    const audioEnhance = audioEnhanceToggle.checked;
    const headline = headlineInput.value.trim();

    exportSelectedBtn.disabled = true;
    exportSelectedBtn.innerHTML = `⏳ Mengekspor 0/${indices.length}…`;

    const results = [];
    for (let i = 0; i < indices.length; i++) {
      const hl = cachedHighlights[indices[i]];
      if (!hl) continue;

      const start = secondsToTime(hl.start);
      const end   = secondsToTime(hl.end);

      exportSelectedBtn.innerHTML = `⏳ Mengekspor ${i + 1}/${indices.length}…`;
      showToast(`Memproses Clip ${i + 1}/${indices.length}: ${start} — ${end}`);

      if (aspect.startsWith('9:16') || aspect === '1:1') {
        const pointsInRange = cropPoints.filter(pt => pt.time >= hl.start && pt.time <= hl.end);
        if (pointsInRange.length === 0) {
          showToast(`Koordinat tracking wajah kosong untuk Clip ${i + 1}. Memindai wajah otomatis…`, 'info');
          await scanFacesInRange(hl.start, hl.end);
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
            headlineText: headline,
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
        showToast(`Clip ${i + 1} gagal: ${err.message}`, 'error');
      }
    }

    // Show batch result panel
    exportSelectedBtn.disabled = false;
    exportSelectedBtn.innerHTML = `✅ Selesai (${results.length}/${indices.length})`;

    if (results.length > 0) {
      renderBatchResultPanel(results);
    }
  }

  function renderBatchResultPanel(results) {
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
    title.style.cssText = 'font-size:13px; font-weight:700; color:var(--accent); margin-bottom:12px;';
    title.textContent = `✅ ${results.length} Clip Siap Diunduh`;
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

    const aspect = aspectRatioSelect.value;
    const heatmap = heatmapToggle.checked;
    const dynamicZoom = dynamicZoomToggle.checked;
    const audioEnhance = audioEnhanceToggle.checked;
    const headline = headlineInput.value.trim();

    // Validasi & Auto-scan tracking jika vertical crop dipilih
    if (aspect.startsWith('9:16') || aspect === '1:1') {
      const pointsInRange = cropPoints.filter(pt => pt.time >= startSec && pt.time <= endSec);
      if (pointsInRange.length === 0) {
        showToast('Koordinat tracking wajah kosong. Menjalankan Pindai Wajah AI secara otomatis…', 'info');
        await scanFacesInRange(startSec, endSec);
      }
    }

    setButtonLoading(clipBtn, true, 'Mendaftarkan job…');
    resultSection.hidden = true;

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
          headlineText: headline
        }),
      });

      currentJobId = data.jobId;
      progressSection.hidden = false;
      progressSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      listenToProgress(currentJobId);
    } catch (err) {
      clipError.textContent = err.message;
      clipError.hidden = false;
      showToast(err.message, 'error');
      setButtonLoading(clipBtn, false);
    }
  });

  // ===== STEP 3: Listen Progress via SSE =====
  function listenToProgress(jobId) {
    connectJobStatus(
      jobId,
      (data) => {
        progressBar.style.width = `${data.progress}%`;
        progressPercent.textContent = `${data.progress}%`;
        progressStage.textContent = data.stage;

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
