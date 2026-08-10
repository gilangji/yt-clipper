#!/usr/bin/env bash
# ============================================
# Sync yt-clipper ke Termux (192.168.43.85:8022)
# Usage: bash sync-termux.sh [--restart]
# ============================================
set -e
TERMUX_USER="u0_a1587"
TERMUX_HOST="192.168.43.85"
TERMUX_PORT="8022"
TERMUX_PASS="teemo"
SRC="/home/teemo/yt-clipper"
DST="~/yt-clipper"
TARBALL="/tmp/yt-clipper-src.tar.gz"
# NOTE: /tmp tidak selalu ada di sesi Termux → tujuan di HP pakai $HOME
REMOTE_TARBALL="~/yt-clipper-src.tar.gz"

echo "==> [1/4] Membuat tarball source (tanpa node_modules/downloads/output/logs)…"
cd /home/teemo
tar czf "$TARBALL" \
  --exclude='yt-clipper/node_modules' \
  --exclude='yt-clipper/downloads' \
  --exclude='yt-clipper/output' \
  --exclude='yt-clipper/temp' \
  --exclude='yt-clipper/logs' \
  --exclude='yt-clipper/.env' \
  --exclude='yt-clipper/env' \
  --exclude='yt-clipper/.phone_pulls' \
  --exclude='yt-clipper/pull-termux-config.sh' \
  yt-clipper

echo "==> [2/4] Kirim ke Termux…"
sshpass -p "$TERMUX_PASS" scp -o StrictHostKeyChecking=no -P "$TERMUX_PORT" "$TARBALL" "$TERMUX_USER@$TERMUX_HOST:$REMOTE_TARBALL"

echo "==> [3/4] Ekstrak + npm install di Termux…"
sshpass -p "$TERMUX_PASS" ssh -o StrictHostKeyChecking=no -p "$TERMUX_PORT" "$TERMUX_USER@$TERMUX_HOST" \
  "cd $DST && tar xzf $REMOTE_TARBALL --strip-components=1 && rm $REMOTE_TARBALL && npm install --no-audit --no-fund 2>&1 | tail -2"

if [[ "$1" == "--restart" ]]; then
  echo "==> [4/4] Restart server di Termux…"
  # CATATAN: kill & start DIPISAH sesi SSH — kalau digabung, pkill/pgrep
  # bisa self-match (command line mengandung literal 'node app.js') dan
  # membunuh shell remote sebelum setsid sempat jalan.
  sshpass -p "$TERMUX_PASS" ssh -o StrictHostKeyChecking=no -p "$TERMUX_PORT" "$TERMUX_USER@$TERMUX_HOST" \
    "for p in \$(pgrep -f 'node app[.]js'); do kill \$p 2>/dev/null; done; sleep 1; echo killed"
  sshpass -p "$TERMUX_PASS" ssh -o StrictHostKeyChecking=no -p "$TERMUX_PORT" "$TERMUX_USER@$TERMUX_HOST" \
    "cd $DST && setsid -f sh -c 'node app.js > \$HOME/ytc-termux.log 2>&1' < /dev/null > /dev/null 2>&1"
  echo "==> Menunggu boot…"
  sleep 25
  sshpass -p "$TERMUX_PASS" ssh -o StrictHostKeyChecking=no -p "$TERMUX_PORT" "$TERMUX_USER@$TERMUX_HOST" \
    "curl -s -o /dev/null -w 'page: HTTP %{http_code}\n' http://localhost:3000/ ; tail -2 \$HOME/ytc-termux.log"
else
  echo "==> [4/4] Selesai (server TIDAK di-restart — pakai --restart untuk restart+verifikasi)."
fi

rm -f "$TARBALL"
echo "==> OK ✅"
