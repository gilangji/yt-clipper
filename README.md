# 🎬 YouTube Clipper (Clipreel Studio) — Self-Hosted Vizard.ai Alternative

Aplikasi pemotong dan pengolah video YouTube berbasis web (Node.js & Python) yang efisien, cepat, dan presisi. Memungkinkan Anda memotong segmen video YouTube, mengonversi ke format vertikal (9:16 Shorts/TikTok/Reels), menambahkan subtitle otomatis dengan animasi emoji, musik latar (BGM), deteksi highlights AI gaya Vizard.ai / OpusClip, serta membersihkan audio tanpa perlu mengunduh keseluruhan berkas video secara manual.

---

## 🚀 Fitur Utama & Pembaruan Terbaru (Vizard.ai Standard)

- **🔥 Vizard-Style AI Highlight Detection**: Analisis AI untuk menemukan momen viral terbaik dengan skor Virality (`10.0 VIRALITY`), Judul Clickbait otomatis, Alasan Viralitas, dan 3 Poin Kunci Pembahasan per klip.
- **🧠 AI Content-Based Highlight Selection (Auto-Clipper Engine)**: Mesin pemilih momen viral berbasis KONTEN (bukan sekadar energi audio) — transkrip dianalisis LLM untuk memilih hook kuat dalam 2 detik pertama, kalimat LENGKAP tanpa potongan di tengah kata, start/end presisi di jeda bicara, durasi 20–120s (prefer 60–90s), urut kronologis, serta social kit lengkap (title id/en, description, hashtags, b-roll query, reason viral).
- **🔑 Multi-Key Gemini Auto-Rotation Engine**: Pengelolaan pool banyak Google Gemini API Key secara otomatis (*Round-Robin & Failover*). Jika Key 1 mencapai limit (`HTTP 429`), sistem otomatis mengoperasikan Key 2, Key 3, dst.
- **🤖 Hirarki Model AI Hemat Kuota (Skripsita Engine)**:
  1. `gemini-2.5-flash-lite` (Primary Engine — 89.8% traffic, paling hemat kuota & super cepat)
  2. `gemini-2.5-flash` (Pro/Heavy Engine — 9.6% traffic)
  3. `gemini-2.0-flash` (Fallback Legacy Engine — 0.3%)
  4. `gemini-3.5-flash` (High-Reasoning Engine — 0.2%)
- **✂️ Text-Based Video Editor**: Mengedit dan memotong klip video langsung melalui pengeditan teks transkrip (secepat mengedit dokumen Word).
- **🔥 Karaoke Emoji Auto-Pop Subtitles**: Penambahan emoji otomatis (🔥, 🧠, 💰, 🚀, ⏱️, 🤫, 🎯, ⚠️, 😴) pada kata-kata kunci subtitle ASS/SRT untuk meningkatkan retensi penonton.
- **🎙️ Studio-Grade Audio Equalizer & Denoise**: Kombinasi filter audio studio (`afftdn` + `highpass=f=80` + `lowpass=f=12000` + `loudnorm=I=-16:TP=-1.5:LRA=11`) untuk vokal yang jernih dan berbobot.
- **📱 Smoothstep Hermite 9:16 Vertical Crop**: Pergerakan kamera *Smoothstep* yang alami untuk fokus pada pembicara/objek tanpa pergerakan patah (*jittery*).
- **🎮 Split-Screen Gameplay**: Format setengah layar atas pembicara dan setengah layar bawah efek audio/visual dinamis.
- **📝 Subtitle & Style Karaoke**: Pilihan 24+ preset style subtitle (MrBeast Pop, CapCut Neon, Karaoke Kuning, Montserrat, Impact, dll.).
- **🎵 Background Music (BGM)**: Pilihan musik latar bawaan (*Cinematic, Lofi, Upbeat*) dengan pengaturan volume audio dan ducking otomatis.
- **⚡ Silence Remover**: Memotong jeda diam secara otomatis (>0.35s) untuk meningkatkan retensi penonton.
- **🩺 Health Check Endpoint** (`GET /api/health`): Status kesiapan engine untuk Android/Termux — cek binary (yt-dlp/ffmpeg/ffprobe) via PATH, cek Python engine tanpa load model berat, cek cache model Whisper, dan jumlah Gemini key aktif.
- **📱 Android Media Scanner**: Hook otomatis ke MediaStore Android (`termux-media-scan`) — video hasil ekspor langsung muncul di Galeri/File Manager HP tanpa scan manual.
- **🚀 Android/Termux Management Scripts**: `start-android.sh` (pre-flight check binary + auto-heal, hold `python-ctranslate2` agar aman dari `pkg upgrade`, jalankan server via nohup) dan `stop-android.sh` (stop server bersih via PID file).
- **📱 Android Termux Ready**: Kompatibel 100% untuk dijalankan secara lokal di HP Android melalui emulator **Termux**.

---

## 🛠 Prasyarat Sistem

Sebelum menjalankan aplikasi, pastikan komputer/HP Anda memiliki:

1. **Node.js**: Versi `>= 18.0.0`
2. **Python 3**: Beserta paket `numpy` (dan opsional `opencv-python`, `mediapipe`, `faster-whisper`).
3. **yt-dlp**: Pembaca & pengunduh stream video YouTube.
4. **FFmpeg & FFprobe**: Pemroses multimedia utama.

---

## ⚙️ Panduan Instalasi & Penggunaan (Desktop: macOS / Linux / Windows)

### 1. Kloning Repository & Install Dependensi
```bash
# Kloning repository
git clone https://github.com/gilangji/yt-clipper.git
cd yt-clipper

# Install dependensi Node.js
npm install
```

### 2. Konfigurasi Environment (`.env`)
Salin file `.env.example` menjadi `.env`:
```bash
cp .env.example .env
```
*(Opsional: Anda dapat mengedit `.env` atau menambahkan file `config/gemini-keys.json` untuk menentukan port, direktori penyimpanan, atau daftar Google Gemini API Key).*

### 3. Cek Ketersediaan Dependensi
Jalankan perintah ini untuk memastikan `yt-dlp`, `ffmpeg`, `ffprobe`, dan `python` terdeteksi dengan baik:
```bash
npm run check:deps
```

### 4. Jalankan Aplikasi
```bash
# Mode Development (Auto-Reload)
npm run dev

# Mode Produksi
npm start
```
Buka browser dan akses **`http://localhost:3000`**.

---

## 📱 Panduan Pemasangan & Penggunaan di HP Android (via Termux)

Anda dapat menjalankan aplikasi ini 100% secara lokal langsung di dalam HP Android menggunakan emulator **Termux**.

### Langkah 1: Install Termux & Paket Utama
Unduh **Termux** dari [F-Droid](https://f-droid.org/) (jangan dari Play Store), lalu jalankan perintah berikut di Termux:
```bash
pkg update && pkg upgrade -y
pkg install nodejs python ffmpeg git -y
pkg install python-pip -y
pip install yt-dlp numpy
```

### Langkah 2: Salin Proyek & Install Dependensi Node.js
```bash
# Berikan izin penyimpanan pada Termux
termux-setup-storage

# Masuk ke direktori proyek
cd yt-clipper

# Install dependensi
npm install
```

### Langkah 3: Jalankan Aplikasi di Android
```bash
node app.js
```
Buka Google Chrome / Firefox di HP Android Anda, lalu akses **`http://localhost:3000`**.

> 💡 **Manajemen server Android** tersedia: `bash start-android.sh` (pre-flight check binary + auto-heal + hold `python-ctranslate2`) dan `bash stop-android.sh` (stop bersih via PID file). Health check: `curl http://localhost:3000/api/health`.

---

## 🔒 Keamanan (Baca Sebelum Terhubung ke Jaringan)

> ⚠️ **PENTING**: Secara default server bind ke `0.0.0.0` (semua interface) dan **TIDAK ada autentikasi**. Siapa pun di jaringan yang sama (WiFi/hotspot) bisa mengakses UI, memakai resource CPU/bandwidth, serta **mengunduh semua video di folder `downloads/` dan `output/`** (diserve statis).

Jika hanya dipakai di satu perangkat, kunci akses dengan **bind ke localhost**:
```bash
# Hanya bisa diakses dari mesin yang sama (paling aman)
HOST=127.0.0.1 node app.js
```

Jika tetap ingin diakses dari LAN/HP lain, minimal lakukan:
1. **Batasi origin CORS**: set `CORS_ORIGIN=http://localhost:3000,http://192.168.x.x:3000` (bukan `*`).
2. **Ganti port default**: `PORT=32123 node app.js` (hindari port umum).
3. **Jangan expose ke internet** tanpa reverse-proxy berauth (mis. `nginx` + `htpasswd`) di depan.

Konfigurasi lain yang aman untuk dibiarkan: `helmet` (CSP), `express-rate-limit` (anti brute), body limit `1mb`.

---

## 📖 Cara Pemakaian Fitur Web

1. **Muat Video**: Tempelkan URL video YouTube di kolom input, lalu klik **"Muat Video"**.
2. **Tentukan Rentang Waktu**:
   - Klik **"🔥 Deteksi Highlights Otomatis"** untuk menemukan segmen terbaik secara otomatis via AI (Vizard.ai style).
   - Setiap segmen klip otomatis memiliki **Judul Clickbait AI**, **Virality Score**, **Alasan Viral**, dan **3 Poin Kunci**.
   - Atau edit teks transkrip di **Text-Based Video Editor** untuk memotong video secara langsung.
3. **Pilih Aspect Ratio, Subtitle, Font & Branding**:
   - Pilih rasio output: *Landscape (Original)*, *9:16 Vertical*, *9:16 + Split Gameplay*, atau *1:1 Square*.
   - Pilih style Subtitle (MrBeast, CapCut, Montserrat, Impact), Musik Latar (BGM), dan Watermark Brand.
   - Centang opsi **Studio Audio Enhancer** untuk menjernihkan vokal.
4. **Ekspor & Unduh**: Klik **"🔥 Deteksi Highlights Otomatis"** / **"Ekspor Clip"**, tunggu proses selesai, lalu klik **"Download"**.

---

## 📄 Lisensi
[MIT License](LICENSE)
