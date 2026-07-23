# 🎬 YouTube Clipper (Clipreel)

Aplikasi pemotong dan pengolah video YouTube berbasis web (Node.js & Python) yang efisien, cepat, dan presisi. Memungkinkan Anda memotong segmen video YouTube, mengonversi ke format vertikal (9:16 Shorts/TikTok/Reels), menambahkan efek visual, serta membersihkan audio tanpa perlu mengunduh keseluruhan berkas video secara manual.

---

## 🚀 Fitur Utama

- **⚡ Fast Stream Trimming**: Memotong bagian video spesifik langsung menggunakan `yt-dlp` & `FFmpeg` tanpa membuang bandwidth.
- **📱 Smooth 9:16 Vertical Crop**: Pergerakan kamera *Smoothstep* yang alami untuk fokus pada pembicara/objek (Shorts/TikTok).
- **🎮 Split-Screen Gameplay**: Format setengah layar atas pembicara dan setengah layar bawah efek audio/visual dinamis.
- **🔊 Penjernih Audio (Denoise)**: Membersihkan noise latar belakang dan menormalkan volume audio (`loudnorm`).
- **🍪 Cookie Bypass**: Penanganan video *Age-Restricted* atau pembatasan IP YouTube menggunakan berkas `cookies.txt` atau browser cookies.
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
   - Isi manual kolom **IN (start)** dan **OUT (end)** dengan format `HH:MM:SS`.
   - Atau geser garis penanda timeline ruler di bawah preview video.
   - Atau klik **"🔥 Deteksi Highlights Otomatis"** untuk memilih momen terbaik secara instan.
3. **Pilih Aspect Ratio & Efek**:
   - Pilih rasio output: *Landscape (Original)*, *9:16 Vertical*, *9:16 + Split Gameplay*, atau *1:1 Square*.
   - Centang opsi **Denoise & Penjernih Suara** jika ingin suara lebih jernih.
4. **Ekspor & Unduh**: Klik **"Potong & Ekspor Clip"**, tunggu proses selesai, lalu klik **"Download"**.

---

## 📄 Lisensi
[MIT License](LICENSE)

3. **Fallback Dynamic Zoom saat Deteksi Wajah Gagal**:
   - Skrip `clipper.py` mengandalkan kecerdasan buatan untuk face tracking saat vertical crop/dynamic zoom. Jika video tidak mendeteksi wajah sama sekali, koordinat crop terkadang langsung melompat kembali ke titik tengah (center frame).
   - **Saran**: Buat transisi smooth (interpolasi koordinat) saat wajah hilang dari kamera agar transisi crop tidak terlalu patah/melompat (jittery).

4. **Optimalisasi Penyimpanan (Temp Cleanup)**:
   - Proses pembuatan klip menghasilkan potongan video mentah (.part/.mp4) di dalam direktori `temp/` dan `downloads/` yang cukup besar.
   - **Saran**: Lakukan penghapusan instan terhadap file temporer (`temp/cfg_*.json` dan file segmentasi audio/video parsial) sesaat setelah proses gabung/render klip selesai di `ffmpeg.service.js`, bukan hanya mengandalkan scheduler pembersih per 30 menit.
