# 🎬 YouTube Clipper (Clipreel Studio)

Aplikasi pemotong dan pengolah video YouTube berbasis web (Node.js & Python) yang efisien, cepat, dan presisi. Memungkinkan Anda memotong segmen video YouTube, mengonversi ke format vertikal (9:16 Shorts/TikTok/Reels), menambahkan subtitle otomatis & style karaoke, musik latar (BGM), deteksi highlights AI, serta membersihkan audio tanpa perlu mengunduh keseluruhan berkas video secara manual.

---

## 🚀 Fitur Utama & Pembaruan Terbaru

- **🔥 Deteksi Highlights Otomatis**: Analisis AI untuk menemukan momen menarik & fluktuasi audio terbaik secara otomatis.
- **⚡ Fast Stream Trimming**: Memotong bagian video spesifik langsung menggunakan `yt-dlp` & `FFmpeg` tanpa membuang bandwidth.
- **📱 Smooth 9:16 Vertical Crop**: Pergerakan kamera *Smoothstep* yang alami untuk fokus pada pembicara/objek (Shorts/TikTok).
- **🎮 Split-Screen Gameplay**: Format setengah layar atas pembicara dan setengah layar bawah efek audio/visual dinamis.
- **📝 Subtitle & Style Karaoke**: Pilihan 24+ preset style subtitle (Karaoke Kuning, MrBeast Pop, CapCut Neon, dll.).
- **🎵 Background Music (BGM)**: Pilihan musik latar bawaan (*Cinematic, Lofi, Upbeat*) dengan pengaturan volume audio.
- **⚡ Silence Remover**: Memotong jeda diam secara otomatis (>0.35s) untuk meningkatkan retensi penonton.
- **🔊 Penjernih Audio (Denoise)**: Membersihkan noise latar belakang dan menormalkan volume audio (`loudnorm`).
- **📱 Android Termux Ready**: Kompatibel 100% untuk dijalankan secara lokal di HP Android melalui emulator **Termux**.
- **🧹 Instant Temp Cleanup**: Pembersihan berkas temporer secara proaktif begitu pemrosesan selesai.

---

## 🛠 Prasyarat Sistem

Sebelum menjalankan aplikasi, pastikan komputer/HP Anda memiliki:

1. **Node.js**: Versi `>= 18.0.0`
2. **Python 3**: Beserta paket `numpy` (dan opsional `opencv-python`, `mediapipe`).
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
*(Opsional: Anda dapat mengedit `.env` untuk menentukan port, direktori penyimpanan, atau jalur binary eksternal).*

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

---

## 📖 Cara Pemakaian Fitur Web

1. **Muat Video**: Tempelkan URL video YouTube di kolom input, lalu klik **"Muat Video"**.
2. **Tentukan Rentang Waktu**:
   - Klik **"🔥 Deteksi Highlights Otomatis"** untuk menemukan segmen terbaik secara otomatis via AI.
   - Atau isi manual kolom **IN (start)** dan **OUT (end)** dengan format `HH:MM:SS`.
   - Atau geser garis penanda timeline ruler di bawah preview video.
3. **Pilih Aspect Ratio, Subtitle & Efek**:
   - Pilih rasio output: *Landscape (Original)*, *9:16 Vertical*, *9:16 + Split Gameplay*, atau *1:1 Square*.
   - Pilih style Subtitle, Musik Latar (BGM), dan aktifkan **Silence Remover** jika diinginkan.
   - Centang opsi **Denoise & Penjernih Suara** jika ingin suara lebih jernih.
4. **Ekspor & Unduh**: Klik **"🔥 Deteksi Highlights Otomatis"** / **"Ekspor Clip"**, tunggu proses selesai, lalu klik **"Download"**.

---

## 📄 Lisensi
[MIT License](LICENSE)
