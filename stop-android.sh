#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
# stop-android.sh — Hentikan server yt-clipper di Termux/Android
# Dipakai:  bash stop-android.sh
# ============================================================

ROOT="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$ROOT/logs/server.pid"

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  kill "$(cat "$PID_FILE")" 2>/dev/null
  rm -f "$PID_FILE"
  echo "✔ Server dihentikan."
else
  # Fallback: matikan semua proses node app.js
  if pkill -f "node app.js" 2>/dev/null; then
    echo "✔ node app.js dihentikan."
  else
    echo "Tidak ada server yang berjalan."
  fi
  rm -f "$PID_FILE"
fi
