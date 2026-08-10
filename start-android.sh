#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# start-android.sh — Start server yt-clipper di Termux/Android
# Pre-flight check + auto-heal, lalu jalankan dengan nohup.
# Dipakai:  bash start-android.sh
# ============================================================
set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG="$ROOT/logs/server.log"
PID_FILE="$ROOT/logs/server.pid"
mkdir -p "$ROOT/logs"

echo "============================================"
echo " yt-clipper · Android Starter (ASTRO)"
echo "============================================"

# 1. Hold python-ctranslate2 → pkg upgrade TIDAK menimpa .so kustom
if command -v apt-mark >/dev/null 2>&1; then
  apt-mark hold python-ctranslate2 >/dev/null 2>&1 && \
    echo "✔ ctranslate2 di-hold (aman dari pkg upgrade)"
fi

# 2. Pre-flight binary eksternal (wajib ada)
echo "── Binary check ──"
node -v || { echo "✘ node tidak ditemukan — install: pkg install nodejs"; exit 1; }
yt-dlp --version 2>/dev/null | head -1 || { echo "✘ yt-dlp tidak ditemukan — install: pkg install yt-dlp"; exit 1; }
ffmpeg -version 2>/dev/null | head -1 || { echo "✘ ffmpeg tidak ditemukan — install: pkg install ffmpeg"; exit 1; }
ffprobe -version 2>/dev/null | head -1 || { echo "✘ ffprobe tidak ditemukan — install: pkg install ffprobe"; exit 1; }
python --version 2>&1 || { echo "✘ python tidak ditemukan — install: pkg install python"; exit 1; }

# 3. Whisper engine selftest (ctranslate2 + model)
echo "── Whisper engine ──"
SELFTEST_OUT="$(timeout 120 python "$ROOT/utils/transcriber.py" --selftest 2>&1)"
echo "  $SELFTEST_OUT"
if echo "$SELFTEST_OUT" | grep -q '"ok": true'; then
  echo "✔ Engine AI SIAP (mode AI highlight + subtitle jalan penuh)"
else
  echo "⚠ Engine AI TIDAK siap → fitur AI akan fallback ke audio."
  echo "  Kemungkinan: model belum diunduh (jalankan sekali dgn ASTRO_HF_ONLINE=1)"
  echo "  atau ctranslate2 rusak (lihat pesan di atas)."
fi

# 4. Hentikan server lama bila ada
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Menghentikan server lama (pid $(cat "$PID_FILE"))..."
  kill "$(cat "$PID_FILE")" 2>/dev/null
  sleep 1
fi

# 5. Start server (persistent, log ke file)
cd "$ROOT"
nohup node app.js > "$LOG" 2>&1 &
echo $! > "$PID_FILE"
sleep 3

if kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "============================================"
  echo "✔ Server BERJALAN → http://localhost:3000"
  echo "  PID : $(cat "$PID_FILE")"
  echo "  Log : $LOG"
  echo "  Stop: bash stop-android.sh"
  echo "============================================"
  if command -v curl >/dev/null 2>&1; then
    curl -s --max-time 5 http://localhost:3000/api/health | head -c 500; echo
  fi
else
  echo "✘ Server gagal start. Log terakhir:"
  tail -30 "$LOG"
  exit 1
fi
