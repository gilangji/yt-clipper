#!/usr/bin/env python3
"""
utils/transcriber.py
AI Speech-to-Text & Viral Subtitle Generator using faster-whisper.
Generates styled ASS (Advanced SubStation Alpha) subtitles with word-by-word / short-phrase timing
tailored for 9:16 Shorts, TikTok, and Reels (OpusClip / Alex Hormozi / MrBeast style).
"""

import os
import sys
import json
import subprocess

# faster_whisper diimpor lazy di get_whisper_model() — mode preview
# (render PNG/ASS) tidak butuh model, sehingga tetap jalan walau
# faster_whisper belum terinstall di environment.

# ===== Whisper Model =====
# 'tiny' = sangat cepat tapi sering salah dengar & halusinasi (hurut nambah,
#          kata hilang, bahasa melompat). 'base' = default (jauh lebih akurat).
# 'small' = terbaik untuk bahasa non-Inggris, tapi 3-5x lebih lambat di CPU.
# Override via env:  WHISPER_MODEL=small python3 ...
WHISPER_MODEL_NAME = os.environ.get('WHISPER_MODEL', 'base').strip().lower()

# Mode offline: model dipakai dari cache lokal saja → tidak ada percobaan
# snapshot_download ke network (gagal ketika DNS/network terbatas).
# Khusus Termux: biarkan ONLINE sekali untuk download model pertama kali,
# lalu otomatis offline di run berikutnya.
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')
if os.environ.get('ASTRO_HF_ONLINE') != '1':
    os.environ.setdefault('HF_HUB_OFFLINE', '1')

_WHISPER_MODEL_CACHE = {}

def _best_compute_type():
    """Pilih compute type terbaik yang didukung backend CPU.

    int8 hanya ada jika kernel SIMD tersedia (mis. x86_64 AVX/AVX2).
    Di Termux arm64 tanpa NEON-dotprod, ctranslate2 hanya menyediakan
    float32 → fallback otomatis. Override via env WHISPER_COMPUTE_TYPE.
    """
    env = os.environ.get('WHISPER_COMPUTE_TYPE', '').strip()
    if env:
        return env
    try:
        import ctranslate2
        supported = ctranslate2.get_supported_compute_types('cpu')
        for preferred in ('int8', 'int16', 'float16', 'float32'):
            if preferred in supported:
                return preferred
        return 'float32'
    except Exception:
        # Gagal query backend → asumsi paling aman: float32 SELALU tersedia.
        # (int8 di perangkat arm64 tanpa NEON-dotprod akan crash → jangan dipakai)
        return 'float32'

def _install_fallback_audio_decode():
    """Bypass PyAV bila tidak terinstall (kasus Termux: `av` tak punya wheel).

    faster_whisper/audio.py melakukan `import av` DI LEVEL MODUL, jadi kita
    injeksi stub `av` ke sys.modules dulu agar import faster_whisper sukses,
    lalu patch decode_audio dengan decoder WAV stdlib (wave + numpy).
    transcriber selalu mengekstrak audio ke WAV 16kHz mono via ffmpeg,
    sehingga decoder fallback cukup untuk format itu.
    """
    try:
        import av  # noqa: F401
        return  # PyAV tersedia → biarkan bawaan
    except Exception:
        pass

    import types
    import sys
    if 'av' not in sys.modules:
        stub = types.ModuleType('av')
        stub.audio = types.ModuleType('av.audio')
        stub.audio.resampler = types.ModuleType('av.audio.resampler')
        stub.audio.resampler.AudioResampler = lambda *a, **k: None
        stub.open = lambda *a, **k: None
        sys.modules['av'] = stub
        sys.modules['av.audio'] = stub.audio
        sys.modules['av.audio.resampler'] = stub.audio.resampler

    import wave
    import numpy as np

    def decode_audio_fallback(path, sampling_rate=16000):
        with wave.open(str(path), 'rb') as w:
            n_ch = w.getnchannels()
            sw = w.getsampwidth()
            fr = w.getframerate()
            data = w.readframes(w.getnframes())
        if sw == 2:
            samples = np.frombuffer(data, dtype=np.int16)
        elif sw == 4:
            samples = np.frombuffer(data, dtype=np.int32)
        elif sw == 1:
            samples = np.frombuffer(data, dtype=np.uint8).astype(np.int16) - 128
        else:
            raise ValueError(f"Unsupported sample width: {sw}")
        if n_ch > 1:
            samples = samples.reshape(-1, n_ch).mean(axis=1)
        samples = samples.astype(np.float32) / 32768.0
        if fr != sampling_rate:
            ratio = fr / sampling_rate
            if ratio > 1 and float(ratio).is_integer():
                samples = samples[::int(ratio)]
            elif ratio < 1 and float(1 / ratio).is_integer():
                samples = np.repeat(samples, int(1 / ratio))
            else:
                idx = np.round(np.arange(0, len(samples), ratio)).astype(int)
                samples = samples[idx[idx < len(samples)]]
        return samples

    import faster_whisper.audio as fw_audio
    fw_audio.decode_audio = decode_audio_fallback
    for mod_name in ('transcribe', 'vad'):
        try:
            mod = __import__(f'faster_whisper.{mod_name}', fromlist=['decode_audio'])
            if hasattr(mod, 'decode_audio'):
                mod.decode_audio = decode_audio_fallback
        except Exception:
            pass

_install_fallback_audio_decode()

def _transcribe_kwargs(min_silence_ms=300):
    """Kwargs transkripsi konsisten; VAD hanya jika onnxruntime tersedia.

    faster-whisper butuh onnxruntime untuk Silero VAD — di Termux paket
    python-onnxruntime bisa bentrok dengan libprotobuf, jadi auto-disable
    VAD bila tidak terinstall (hasil tetap akurat, hanya tanpa filter diam).

    beam_size bisa diperkecil via env WHISPER_BEAM_SIZE=1 → transkripsi
    jauh lebih cepat di HP (kualitas sedikit turun). Default 5 (akurat).
    """
    beam = int(os.environ.get('WHISPER_BEAM_SIZE', '5') or 5)
    if beam < 1:
        beam = 1
    kw = dict(
        beam_size=beam,
        temperature=0.0,
        condition_on_previous_text=False,
    )
    try:
        import onnxruntime  # noqa: F401
        kw['vad_filter'] = True
        kw['vad_parameters'] = dict(min_silence_duration_ms=min_silence_ms)
    except Exception:
        kw['vad_filter'] = False
    return kw

def _is_download_error(msg):
    """Deteksi error yang berkaitan dengan model belum ada / network."""
    low = (msg or '').lower()
    return any(k in low for k in (
        'could not find', 'no such file', 'snapshot_download',
        'connection', 'offline mode', 'cannot find', 'not found',
        'resolve', 'http', 'network', 'hf_hub', 'timeout',
        'cached file', 'lookup',
    ))


def get_whisper_model():
    """Singleton model whisper — dibagi antar pemanggilan (hemat load time).

    Auto-heal untuk Termux:
    - Model belum ada di cache & mode offline → coba SEKALI dengan mode
      online (download otomatis) supaya fresh install langsung jalan.
    - ctranslate2 rusak (mis. `pkg upgrade` menimpa .so kustom) →
      RuntimeError dengan instruksi perbaikan yang jelas, bukan error samar.
    """
    if WHISPER_MODEL_NAME in _WHISPER_MODEL_CACHE:
        return _WHISPER_MODEL_CACHE[WHISPER_MODEL_NAME]

    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        raise RuntimeError(
            "faster-whisper tidak terinstall / rusak. Instal ulang:\n"
            "  pip install --no-deps faster-whisper==1.2.1 && "
            "pip install --no-deps huggingface_hub==1.27.0"
        ) from e

    try:
        model = WhisperModel(WHISPER_MODEL_NAME, device='cpu', compute_type=_best_compute_type())
        _WHISPER_MODEL_CACHE[WHISPER_MODEL_NAME] = model
        return model
    except Exception as e:
        # Case 1: model belum ada & offline → retry online sekali (auto-download)
        if os.environ.get('HF_HUB_OFFLINE') == '1' and _is_download_error(str(e)):
            sys.stderr.write(
                f"[transcriber] Model '{WHISPER_MODEL_NAME}' belum ada di cache, "
                "mencoba unduh sekali (online)...\n"
            )
            os.environ['HF_HUB_OFFLINE'] = '0'
            try:
                model = WhisperModel(WHISPER_MODEL_NAME, device='cpu', compute_type=_best_compute_type())
                _WHISPER_MODEL_CACHE[WHISPER_MODEL_NAME] = model
                return model
            except Exception as e2:
                raise RuntimeError(
                    f"Gagal mengunduh model '{WHISPER_MODEL_NAME}'. "
                    f"Periksa jaringan / mirror HuggingFace.\nDetail: {e2}"
                ) from e2
        # Case 2: binding ctranslate2 rusak (sangat umum setelah pkg upgrade)
        low = str(e).lower()
        if 'ctranslate2' in low or 'undefined symbol' in low or 'cannot open shared object' in low:
            raise RuntimeError(
                "ctranslate2 rusak di perangkat ini (umum setelah `pkg upgrade` "
                "menimpa binding kustom). Rebuild ulang:\n"
                "  bash ~/yt-clipper/scripts/rebuild_ct2.sh\n"
                "atau reinstall paket: pkg reinstall python-ctranslate2"
            ) from e
        raise RuntimeError(f"Gagal memuat model whisper '{WHISPER_MODEL_NAME}': {e}") from e

def detect_source_language(model, audio_path):
    """Deteksi bahasa asli sekali (stabil) → dipakai sebagai `language` saat
    transkripsi agar whisper tidak berpindah bahasa di tengah audio."""
    try:
        res = model.detect_language(audio_path)
        if isinstance(res, dict):
            return max(res, key=res.get) if res else None
        if isinstance(res, (tuple, list)) and res:
            return res[0]
        return None
    except Exception:
        return None

STYLES = {
    'yellow-viral': {
        'name': 'YellowViral',
        'font': 'Arial',
        'fontsize': 24,
        'primary_color': '&H0000FFFF',   # Yellow (AABBGGRR in ASS)
        'secondary_color': '&H00FFFFFF', # White
        'outline_color': '&H00000000',   # Black outline
        'back_color': '&H80000000',      # Semi-transparent shadow
        'bold': 1,
        'outline': 3.8,
        'shadow': 1.8,
        'alignment': 2,                 # Bottom-center
        'margin_v': 75
    },
    'vizard-classic': {
        'name': 'VizardClassic',
        'font': 'Montserrat',
        'fontsize': 25,
        'primary_color': '&H00FFFFFF',   # Putih bersih
        'secondary_color': '&H00FFFFFF',
        'outline_color': '&H00000000',   # Outline hitam tegas
        'back_color': '&H64000000',
        'bold': 1,
        'outline': 3.5,
        'shadow': 0.5,
        'alignment': 2,
        'margin_v': 75
    },
    'vizard-pop': {
        'name': 'VizardPop',
        'font': 'Anton',
        'fontsize': 30,
        'primary_color': '&H00FFFFFF',   # Putih dasar
        'secondary_color': '&H0000D4FF', # Kuning aktif — kata menyala
        'outline_color': '&H00000000',
        'back_color': '&H64000000',
        'bold': 1,
        'outline': 4.0,
        'shadow': 0.0,
        'alignment': 2,
        'margin_v': 70,
        'caption_mode': 'word',
        'word_style': 'alternate'        # pop per kata putih/kuning ala Hormozi
    },
    'vizard-neon': {
        'name': 'VizardNeon',
        'font': 'Oswald',
        'fontsize': 28,
        'primary_color': '&H00FFFFFF',
        'secondary_color': '&H00FFE500', # Cyan #00E5FF
        'outline_color': '&H00FFE500',   # Outline cyan = inti glow
        'back_color': '&H8AFFE500',      # Shadow cyan = halo glow
        'bold': 1,
        'outline': 5.0,
        'shadow': 0.0,
        'alignment': 2,
        'margin_v': 75
    },
    'vizard-gradient': {
        'name': 'VizardGradient',
        'font': 'Poppins',
        'fontsize': 26,
        'primary_color': '&H00FFFFFF',
        'secondary_color': '&H00FFFFFF',
        'outline_color': '&H00000000',
        'back_color': '&H64000000',
        'bold': 1,
        'outline': 2.5,
        'shadow': 1.0,
        'alignment': 2,
        'margin_v': 75,
        'caption_mode': 'word',
        'word_style': 'rainbow',          # sweep gradasi hangat per kata
        'rainbow_colors': [
            '&H00FFFFFF',  # putih
            '&H0000D4FF',  # kuning #FFD400
            '&H00008AFF',  # oranye #FF8A00
            '&H003333FF',  # merah #FF3333
        ]
    },
    'vizard-outline': {
        'name': 'VizardOutline',
        'font': 'Archivo Black',
        'fontsize': 28,
        'primary_color': '&H00FFFFFF',
        'secondary_color': '&H00FFFFFF',
        'outline_color': '&H00000000',
        'back_color': '&H64000000',
        'bold': 1,
        'outline': 6.5,                  # big block — outline sangat tebal
        'shadow': 1.5,
        'alignment': 2,
        'margin_v': 75
    },
    # ===== MODERN TEMPLATES (Anton / Bebas / Archivo / Poppins) =====
    'mrbeast-white': {
        'name': 'MrBeastPop',
        'font': 'Anton',
        'fontsize': 30,
        'primary_color': '&H00FFFFFF',   # White core
        'secondary_color': '&H00FFFFFF',
        'outline_color': '&H00000000',   # Thick black outline
        'back_color': '&H64000000',
        'bold': 1,
        'outline': 4.5,
        'shadow': 0.0,
        'alignment': 2,
        'margin_v': 70,
        'caption_mode': 'word'           # kata-per-kata ala MrBeast
    },
    'word-pop': {
        'name': 'WordPopKaraoke',
        'font': 'Anton',
        'fontsize': 30,
        'primary_color': '&H00FFFFFF',   # White default
        'secondary_color': '&H0000D4FF',   # Kuning #FFD400
        'outline_color': '&H00000000',
        'back_color': '&H64000000',
        'bold': 1,
        'outline': 4.0,
        'shadow': 0.0,
        'alignment': 2,
        'margin_v': 70,
        'caption_mode': 'word',
        'word_style': 'alternate'       # saling-silang putih/kuning per kata
    },
    'archivo-black': {
        'name': 'ArchivoBlack',
        'font': 'Archivo Black',
        'fontsize': 26,
        'primary_color': '&H00FFFFFF',
        'secondary_color': '&H00FFFFFF',
        'outline_color': '&H00000000',
        'back_color': '&H64000000',
        'bold': 1,
        'outline': 3.6,
        'shadow': 0.0,
        'alignment': 2,
        'margin_v': 75
    },
    'bebas-amber': {
        'name': 'BebasAmber',
        'font': 'Bebas Neue',
        'fontsize': 32,
        'primary_color': '&H0000D4FF',   # Amber/Kuning Neon #FFD400
        'secondary_color': '&H00FFFFFF',
        'outline_color': '&H00000000',
        'back_color': '&H64000000',
        'bold': 1,
        'outline': 3.2,
        'shadow': 1.2,
        'alignment': 2,
        'margin_v': 70
    },
    'neon-pink': {
        'name': 'NeonPinkGlow',
        'font': 'Poppins',
        'fontsize': 24,
        'primary_color': '&H009B2FD6',   # Pink #D62F9B
        'secondary_color': '&H00FFFFFF',
        'outline_color': '&H00000000',
        'back_color': '&H8AFF00FF',      # Glow magenta
        'bold': 1,
        'outline': 3.2,
        'shadow': 2.5,
        'alignment': 2,
        'margin_v': 75
    },
    'glitch-green': {
        'name': 'GlitchGreen',
        'font': 'JetBrainsMono Nerd Font',
        'fontsize': 22,
        'primary_color': '&H009DFF00',   # Green #00FF9D → BBGGRR: 00 FF 9D → 9D FF 00
        'secondary_color': '&H00FFFFFF',
        'outline_color': '&H00111101',
        'back_color': '&HF8000000',       # Black solid band
        'bold': 1,
        'outline': 1.2,
        'shadow': 0.0,
        'alignment': 2,
        'margin_v': 80
    },
    'gold-bold': {
        'name': 'GoldBold',
        'font': 'Poppins',
        'fontsize': 24,
        'primary_color': '&H0033CCFF',   # Gold #FFCC33
        'secondary_color': '&H00FFFFFF',
        'outline_color': '&H00000000',
        'back_color': '&H64000000',
        'bold': 1,
        'outline': 3.0,
        'shadow': 1.6,
        'alignment': 2,
        'margin_v': 75
    },
    'purple-holo': {
        'name': 'PurpleHolo',
        'font': 'Poppins',
        'fontsize': 25,
        'primary_color': '&H00FFFFFF',
        'secondary_color': '&H00FFFFFF',
        'outline_color': '&H00FF4C9D',   # Purple #9D4CFF outline — BBGGRR: B FF? no wait: #9D4CFF → B=FF? B=9D? hold: 9D 4C FF → R=FF G=4C B=9D → BBGGRR= 9D4CFF? 
        'back_color': '&HA00060B8',   # holographic hint
        'bold': 1,
        'outline': 4.0,
        'shadow': 1.5,
        'alignment': 2,
        'margin_v': 75
    },
    'minimal-white': {
        'name': 'MinimalWhite',
        'font': 'Poppins',
        'fontsize': 20,
        'primary_color': '&H00FFFFFF',
        'secondary_color': '&H0000FFFF',
        'outline_color': '&H00111111',
        'back_color': '&H00000000',
        'bold': 1,
        'outline': 1.8,
        'shadow': 0.0,
        'alignment': 2,
        'margin_v': 80
    },
    'shadow-pop': {
        'name': 'ShadowPop',
        'font': 'Poppins',
        'fontsize': 26,
        'primary_color': '&H00FFFFFF',
        'secondary_color': '&H00FFFFFF',
        'outline_color': '&H00000000',
        'back_color': '&H50FF00F0',
        'bold': 1,
        'outline': 2.0,
        'shadow': 4.0,
        'alignment': 2,
        'margin_v': 75
    },
    # ===== CapCut / TikTok 2026 Trending Styles =====
    'capcut-karaoke': {
        'name': 'CapCutKaraoke',
        'font': 'Montserrat',
        'fontsize': 24,
        'primary_color': '&H00FFFFFF',      # putih dasar
        'secondary_color': '&H0000D4FF',   # kuning → kata aktif karaoke
        'outline_color': '&H00000000',
        'back_color': '&H64000000',
        'bold': 1,
        'outline': 3.0,
        'shadow': 1.0,
        'alignment': 2,
        'margin_v': 75,
        'caption_mode': 'word',
        'word_style': 'alternate'
    },
    'capcut-box': {
        'name': 'CapCutBox',
        'font': 'Montserrat',
        'fontsize': 22,
        'primary_color': '&H00FFFFFF',
        'secondary_color': '&H00FFFFFF',
        'outline_color': '&H00000000',
        'back_color': '&HBE000000',      # kotak hitam 75% (BorderStyle 3)
        'bold': 1,
        'outline': 0.0,
        'shadow': 0.0,
        'alignment': 2,
        'margin_v': 75,
        'border_style': 3
    },
    'capcut-neon': {
        'name': 'CapCutNeon',
        'font': 'Oswald',
        'fontsize': 28,
        'primary_color': '&H00FFFFFF',
        'secondary_color': '&H00FFE500',   # cyan #00E5FF
        'outline_color': '&H00FFE500',     # outline cyan → efek neon menyala
        'back_color': '&H8AFFE500',
        'bold': 1,
        'outline': 5.0,
        'shadow': 0.0,
        'alignment': 2,
        'margin_v': 75
    },
    'capcut-rainbow': {
        'name': 'CapCutRainbow',
        'font': 'Poppins',
        'fontsize': 26,
        'primary_color': '&H00FFFFFF',
        'secondary_color': '&H0000D4FF',
        'outline_color': '&H00000000',
        'back_color': '&H64000000',
        'bold': 1,
        'outline': 2.5,
        'shadow': 1.0,
        'alignment': 2,
        'margin_v': 75,
        'caption_mode': 'word',
        'word_style': 'rainbow',
        'rainbow_colors': [
            '&H005533FF',  # merah #FF3355
            '&H00008AFF',  # oranye #FF8A00
            '&H0000D4FF',  # kuning #FFD400
            '&H006AE500',  # hijau #00E56A
            '&H00FFA800',  # biru #00A8FF
            '&H00FF4CB1',  # ungu #B14CFF
            '&H009D4CFF',  # pink #FF4C9D
        ]
    },
    'capcut-ugc': {
        'name': 'CapCutUGC',
        'font': 'Fredoka',
        'fontsize': 24,
        'primary_color': '&H00FFFFFF',
        'secondary_color': '&H00FFFFFF',
        'outline_color': '&H00111111',
        'back_color': '&H00000000',
        'bold': 1,
        'outline': 2.2,
        'shadow': 0.0,
        'alignment': 2,
        'margin_v': 80,
        'default_case': 'lowercase'      # gaya lowercase aesthetic
    },
    'capcut-glow': {
        'name': 'CapCutGlow',
        'font': 'Montserrat',
        'fontsize': 24,
        'primary_color': '&H00FFFFFF',
        'secondary_color': '&H00FFFFFF',
        'outline_color': '&H00000000',
        'back_color': '&H80FFE500',      # shadow warna cyan = glow
        'bold': 1,
        'outline': 2.0,
        'shadow': 3.0,
        'alignment': 2,
        'margin_v': 75
    },
    'quick-brown': {
        'name': 'QuickBrownKaraoke',
        'font': 'Montserrat',
        'fontsize': 26,
        'primary_color': '&H00FFFFFF',      # putih — seluruh frasa
        'secondary_color': '&H0000D4FF',   # kuning #FFD400 — kata yang diucapkan
        'outline_color': '&H00000000',      # border hitam di teks
        'back_color': '&H64000000',
        'bold': 1,
        'outline': 3.5,
        'shadow': 1.0,
        'alignment': 2,
        'margin_v': 75,
        'caption_mode': 'karaoke'           # frasa utuh + sorot kata kuning
    },
    'quick-brown-inv': {
        'name': 'QuickBrownInv',
        'font': 'Montserrat',
        'fontsize': 26,
        'primary_color': '&H0000D4FF',   # KUNING #FFD400 — dasar frasa
        'secondary_color': '&H00FFFFFF', # PUTIH — sweep karaoke yang berjalan
        'outline_color': '&H00000000',      # border hitam tetap
        'back_color': '&H64000000',
        'bold': 1,
        'outline': 3.5,
        'shadow': 1.0,
        'alignment': 2,
        'margin_v': 75,
        'caption_mode': 'karaoke'           # kebalikan: kuning dasar, putih berjalan
    },
    # ===== AUTO-CLIPPER CUSTOM (Karaoke / Standard + Typografi penuh) =====
    # Rendering diarahkan ke engine custom (words_to_karaoke_ass /
    # words_to_standard_ass) ketika subtitleConfig dikirim dari frontend.
    'auto-clipper': {
        'name': 'AutoClipperCustom',
        'font': 'Arial',
        'fontsize': 26,
        'primary_color': '&H0000E6FF',   # default highlight #FFE600
        'secondary_color': '&H00FFFFFF',
        'outline_color': '&H00000000',
        'back_color': '&H64000000',
        'bold': 1,
        'outline': 3.5,
        'shadow': 1.0,
        'alignment': 2,
        'margin_v': 75,
        'caption_mode': 'custom'          # dispatch ke engine auto-clipper
    }
}

FONT_SIZE_MAP = {
    'tiny': 22,
    'small': 30,
    'medium': 40,
    'large': 52,
    'xlarge': 68,
    'huge': 86,
    'xxlarge': 108,
    'colossal': 135
}

POSITION_MAP = {
    'bottom': {'margin_v': 75, 'alignment': 2},
    'middle': {'margin_v': 480, 'alignment': 2},
    'top': {'margin_v': 850, 'alignment': 2}
}

def format_ass_time(seconds):
    """Converts seconds float to ASS timestamp format H:MM:SS.cs"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    cs = int(round((seconds - int(seconds)) * 100))
    if cs >= 100:
        cs = 99
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


# ===========================================================================
# AUTO-CLIPPER SUBTITLE ENGINE (ported from auto-clipper backend/crop_utils.py)
# Mode Karaoke (word-by-word pop) & Standard (full sentence static)
# dengan typography: font family, size scale, weight, italic, uppercase,
# dan highlight color — identik dengan UI SubtitleConfigControls auto-clipper.
# ===========================================================================

DEFAULT_SUBTITLE_CONFIG = {
    "style": "karaoke",              # 'karaoke' | 'standard'
    "highlight_color": "#FFE600",    # warna sorotan kata (karaoke)
    "font_family": "Arial",          # Arial/Montserrat/Impact/Roboto/Oswald/Bebas Neue/Courier New
    "font_size_scale": 1.0,          # 0.8 | 1.0 | 1.2 | 1.5
    "font_weight": "bold",           # 'normal' | 'bold'
    "italic": False,
    "uppercase": True,               # default True untuk karaoke, False untuk standard
}

FONT_PRESETS = [
    "Arial", "Montserrat", "Impact", "Roboto",
    "Oswald", "Bebas Neue", "Courier New",
]

COLOR_PRESETS = [
    "#FFE600", "#00FFFF", "#00FF66", "#FF3366",
    "#FFFFFF", "#FF9900",
]


def hex_to_ass_style_color(hex_str, default="&H0000E6FF"):
    """Konversi '#RRGGBB' ke format PrimaryColour ASS: '&H00BBGGRR'."""
    if not hex_str or not isinstance(hex_str, str):
        return default
    clean = hex_str.strip().lstrip('#')
    if len(clean) == 6:
        try:
            int(clean, 16)
            r, g, b = clean[0:2], clean[2:4], clean[4:6]
            return f"&H00{b.upper()}{g.upper()}{r.upper()}"
        except ValueError:
            return default
    return default


def normalize_subtitle_config(raw_config=None, legacy_style="karaoke"):
    """Menjamin konfigurasi subtitle selalu lengkap dengan fallback yang aman."""
    default_style = legacy_style if legacy_style in ("standard", "karaoke") else "karaoke"
    if not isinstance(raw_config, dict):
        raw_config = {}
    style = raw_config.get("style", default_style)
    if style not in ("standard", "karaoke"):
        style = default_style
    return {
        "style": style,
        "highlight_color": str(raw_config.get("highlight_color", "#FFE600")),
        "font_family": str(raw_config.get("font_family", "Arial")),
        "font_size_scale": float(raw_config.get("font_size_scale", 1.0)),
        "font_weight": str(raw_config.get("font_weight", "bold")),
        "italic": bool(raw_config.get("italic", False)),
        "uppercase": bool(raw_config.get("uppercase", (style == "karaoke"))),
    }


def calculate_ass_styles(width, height, custom_margin_v=None, subtitle_config=None):
    """Calculates proportional font sizes based on video dimensions and custom scale."""
    cfg = normalize_subtitle_config(subtitle_config)
    scale = max(0.5, min(2.0, cfg.get("font_size_scale", 1.0)))

    is_vertical = height > width
    if is_vertical:
        # Untuk video vertikal (9:16), font size relatif terhadap width, tapi dibatasi
        font_size = max(14, round(width * 0.055 * scale))
        margin_v = max(20, round(height * 0.15))
    else:
        # Untuk landscape (16:9), width besar → font size relatif terhadap height
        font_size = max(14, round(height * 0.065 * scale))
        margin_v = max(20, round(height * 0.08))

    if custom_margin_v is not None and custom_margin_v > 0:
        margin_v = custom_margin_v

    outline = max(1, round(font_size * 0.08))
    shadow = outline
    margin_h = max(20, round(width * 0.05))
    return font_size, outline, shadow, margin_h, margin_v


def build_custom_ass_header(width, height, cfg, primary_color="&H00FFFFFF"):
    """ASS header untuk mode custom (auto-clipper)."""
    font_size, outline, shadow, margin_h, margin_v = calculate_ass_styles(width, height, subtitle_config=cfg)
    outline = max(2, outline)
    shadow = max(2, shadow)
    font_name = cfg.get("font_family", "Arial")
    bold_val = -1 if cfg.get("font_weight") == "bold" else 0
    italic_val = -1 if cfg.get("italic") else 0
    return (
        "[Script Info]\n"
        "ScriptType: v4.00+\n"
        "WrapStyle: 1\n"
        f"PlayResX: {width}\n"
        f"PlayResY: {height}\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, "
        "Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{font_name},{font_size},{primary_color},&H00000000,&H80000000,"
        f"{bold_val},{italic_val},0,0,100,100,0,0,1,{outline},{shadow},2,{margin_h},{margin_h},{margin_v},1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )


def words_to_karaoke_ass(words, width, height, clip_start, clip_end, subtitle_config=None):
    """Single-word pop ASS: setiap kata menyala dengan highlight color (mode karaoke)."""
    cfg = normalize_subtitle_config(subtitle_config, legacy_style="karaoke")
    ass_primary_color = hex_to_ass_style_color(cfg.get("highlight_color", "#FFE600"))
    header = build_custom_ass_header(width, height, cfg, primary_color=ass_primary_color)
    is_uppercase = cfg.get("uppercase", True)

    clip_words = []
    for w in words:
        w_start = float(w.get("start", 0))
        w_end = float(w.get("end", 0))
        if w_start < clip_end and w_end > clip_start:
            s = max(0.0, w_start - clip_start)
            e = min(clip_end - clip_start, w_end - clip_start)
            if e > s:
                raw_w = str(w.get("word", "")).strip()
                if raw_w:
                    clip_words.append({"word": raw_w, "start": s, "end": e})

    if not clip_words:
        return header

    events = []
    num_words = len(clip_words)
    clip_total = clip_end - clip_start

    for i in range(num_words):
        curr_word = clip_words[i]
        w_start = curr_word["start"]
        raw_end = curr_word["end"]

        if i < num_words - 1:
            next_start = clip_words[i + 1]["start"]
            gap = next_start - raw_end
            if 0 <= gap < 0.2:
                w_end = next_start
            else:
                w_end = raw_end
            w_end = min(w_end, next_start)
        else:
            w_end = min(clip_total, raw_end + 0.35)

        if i < num_words - 1:
            w_end = min(max(w_end, w_start + 0.08), clip_words[i + 1]["start"])
        else:
            w_end = max(w_end, w_start + 0.08)

        if w_end <= w_start:
            continue

        text = curr_word["word"].upper() if is_uppercase else curr_word["word"]
        events.append(
            f"Dialogue: 0,{format_ass_time(w_start)},{format_ass_time(w_end)},Default,,0,0,0,,{text}"
        )

    return header + "\n".join(events) + ("\n" if events else "")


def words_to_standard_ass(words, width, height, clip_start, clip_end, subtitle_config=None):
    """Sentence-level static ASS: kalimat penuh per baris (mode standard)."""
    cfg = normalize_subtitle_config(subtitle_config, legacy_style="standard")
    header = build_custom_ass_header(width, height, cfg, primary_color="&H00FFFFFF")
    is_uppercase = cfg.get("uppercase", False)

    clip_words = []
    for w in words:
        w_start = float(w.get("start", 0))
        w_end = float(w.get("end", 0))
        if w_start < clip_end and w_end > clip_start:
            s = max(0.0, w_start - clip_start)
            e = min(clip_end - clip_start, w_end - clip_start)
            if e > s:
                raw_w = str(w.get("word", "")).strip()
                if raw_w:
                    clip_words.append({"word": raw_w, "start": s, "end": e})

    if not clip_words:
        return header

    chunks = []
    current_chunk = [clip_words[0]]
    for w in clip_words[1:]:
        prev_w = current_chunk[-1]
        gap = w["start"] - prev_w["end"]
        if gap > 0.4 or len(current_chunk) >= 7 or prev_w["word"].endswith(('.', '!', '?')):
            chunks.append(current_chunk)
            current_chunk = [w]
        else:
            current_chunk.append(w)
    if current_chunk:
        chunks.append(current_chunk)

    events = []
    for chunk in chunks:
        c_start = chunk[0]["start"]
        c_end = chunk[-1]["end"]
        sentence = " ".join(w["word"] for w in chunk)
        text = sentence.upper() if is_uppercase else sentence
        events.append(
            f"Dialogue: 0,{format_ass_time(c_start)},{format_ass_time(c_end)},Default,,0,0,0,,{text}"
        )

    return header + "\n".join(events) + ("\n" if events else "")


def extract_audio_segment(input_video, output_audio, start_sec=None, duration_sec=None, ffmpeg_bin='ffmpeg'):
    """Extracts lightweight WAV audio for Whisper transcription"""
    cmd = [ffmpeg_bin or 'ffmpeg', '-y']
    if start_sec is not None and start_sec > 0:
        cmd += ['-ss', str(start_sec)]
    cmd += ['-i', input_video]
    if duration_sec is not None and duration_sec > 0:
        cmd += ['-t', str(duration_sec)]
    cmd += ['-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', output_audio]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

def generate_ass_header(style_config, play_res_x=720, play_res_y=1280):
    """Generates the ASS script header with given style"""
    st = style_config
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {play_res_x}
PlayResY: {play_res_y}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: {st['name']},{st['font']},{st['fontsize']},{st['primary_color']},{st['secondary_color']},{st['outline_color']},{st['back_color']},{st['bold']},0,0,0,100,100,0,0,{st.get('border_style', 1)},{st['outline']},{st['shadow']},{st['alignment']},20,20,{st['margin_v']},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    return header

EMOJI_RULES = {
    'uang': '💵 UANG', 'money': '💵 MONEY', 'kaya': '💰 KAYA', 'rich': '💰 RICH', 'dolar': '💵 DOLAR', 'harga': '🏷️ HARGA', 'bisnis': '💼 BISNIS', 'investasi': '📈 INVESTASI', 'untung': '💹 UNTUNG', 'profit': '💹 PROFIT',
    'sukses': '🚀 SUKSES', 'success': '🚀 SUCCESS', 'menang': '🏆 MENANG', 'juara': '🏆 JUARA', 'hebat': '⭐ HEBAT', 'bisa': '💪 BISA', 'kuat': '💪 KUAT',
    'semangat': '🔥 SEMANGAT', 'fire': '🔥 FIRE', 'viral': '🔥 VIRAL', 'hot': '🔥 HOT', 'api': '🔥 API', 'gila': '🤪 GILA', 'booming': '💥 BOOMING',
    'otak': '🧠 OTAK', 'brain': '🧠 BRAIN', 'pikir': '🧠 PIKIR', 'mindset': '🧠 MINDSET', 'fakta': '💡 FAKTA', 'ide': '💡 IDE', 'tahu': '💡 TAHU', 'trik': '💡 TRIK', 'solusi': '💡 SOLUSI', 'ilmu': '📚 ILMU', 'belajar': '📚 BELAJAR',
    'waktu': '⏱️ WAKTU', 'time': '⏱️ TIME', 'jam': '⏱️ JAM', 'cepat': '⚡ CEPAT', 'fast': '⚡ FAST', 'sekarang': '⚡ SEKARANG',
    'rahasia': '🤫 RAHASIA', 'secret': '🤫 SECRET', 'diam': '🤫 DIAM', 'kunci': '🔑 KUNCI', 'privasi': '🔒 PRIVASI',
    'salah': '❌ SALAH', 'gagal': '❌ GAGAL', 'stop': '❌ STOP', 'jangan': '❌ JANGAN', 'rugi': '📉 RUGI',
    'target': '🎯 TARGET', 'fokus': '🎯 FOKUS', 'goal': '🎯 GOAL', 'tujuan': '🎯 TUJUAN',
    'bahaya': '⚠️ BAHAYA', 'warning': '⚠️ WARNING', 'rusak': '⚠️ RUSAK', 'error': '⚠️ ERROR', 'peringatan': '⚠️ PERINGATAN',
    'cinta': '❤️ CINTA', 'love': '❤️ LOVE', 'suka': '❤️ SUKA', 'hati': '❤️ HATI',
    'tidur': '😴 TIDUR', 'sleep': '😴 SLEEP', 'kaget': '😱 KAGET', 'takut': '😱 TAKUT', 'raja': '👑 RAJA', 'king': '👑 KING',
    'hp': '📱 HP', 'telepon': '📱 TELEPON', 'video': '📹 VIDEO', 'ai': '🤖 AI', 'robot': '🤖 ROBOT', 'dunia': '🌍 DUNIA', 'dosa': '☠️ DOSA'
}

def inject_emojis_to_text(text):
    words = text.split()
    res = []
    for w in words:
        clean = w.lower().strip(".,!?\"'")
        if clean in EMOJI_RULES:
            res.append(EMOJI_RULES[clean])
        else:
            res.append(w)
    return " ".join(res)

# Stopwords untuk ekstraksi keyword (id + en + umum)
STOPWORDS = set("""yang dan di ke dari ini itu untuk dengan pada adalah akan tidak ada telah saya kamu kita mereka kami dia anda juga atau tapi tetapi karena jika maka saat bisa harus sangat lebih sudah belum hanya masih sebagai oleh dari pada ke di yang dengan untuk tidak ini itu ada akan menjadi seperti tentang antara dalam atas bawah setelah sebelum ketika sampai sejak selama tanpa agar supaya bagi kepada dari dengan untuk ini itu ada akan the a an of to in on for and or is are was were be been being i you he she it we they them my your our his her its this that these those with from by at as not but if then than so do does did have has had can could will would should may might must shall into about between under over again further then once here there when where why how all any both each few more most other some such no nor only own same too very just don now s t d m ll re ve y know like get go make think people good great time life work way day man woman world school home family love want need see come want think know say use look find give tell ask seem feel try leave call""".split())

def extract_keywords(text, limit=12, min_len=3):
    """Ekstrak kata kunci top dari transkrip (frekuensi + panjang)."""
    import re
    from collections import Counter
    words = re.findall(r"[A-Za-z\u00C0-\u024F']{2,}", text.lower())
    words = [w.strip("'") for w in words]
    words = [w for w in words if w not in STOPWORDS and len(w) >= min_len]
    freq = Counter(words)
    # Skor: frekuensi * (1 + min(len(w)/8, 1)) — prefer kata agak panjang
    scored = sorted(freq.items(), key=lambda kv: (kv[1] * (1 + min(len(kv[0]) / 8, 1)), kv[1]), reverse=True)
    seen, out = set(), []
    for w, _ in scored:
        if w not in seen:
            seen.add(w)
            out.append(w)
        if len(out) >= limit:
            break
    return out


def _format_srt_ts(seconds):
    """Format float detik → HH:MM:SS,mmm (SRT)."""
    ms = int(round((seconds % 1) * 1000))
    if ms >= 1000:
        ms = 0
        seconds += 1
    s = int(seconds) % 60
    m = (int(seconds) // 60) % 60
    h = int(seconds) // 3600
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def transcribe_to_srt(audio_path, output_srt_path, language=None):
    """Transkripsi cepat → file SRT (untuk AI highlight selection ala auto-clipper).

    Memakai parameter whisper yang sama dengan transcribe_to_json agar akurat:
    greedy, VAD on, no previous-text loop. Setiap segmen = 1 cue SRT dengan
    timestamp presisi yang bisa langsung dikirim ke LLM sebagai transcript.
    """
    model = get_whisper_model()
    src = detect_source_language(model, audio_path)
    segments, info = model.transcribe(
        audio_path,
        language=src or None,
        **_transcribe_kwargs(300)
    )
    cues = []
    for i, segment in enumerate(segments, 1):
        t = (segment.text or '').strip()
        if t:
            start = float(segment.start)
            end = float(segment.end)
            cues.append(
                f"{i}\n{_format_srt_ts(start)} --> {_format_srt_ts(end)}\n{t}\n"
            )
    srt_text = "\n".join(cues)
    with open(output_srt_path, 'w', encoding='utf-8') as f:
        f.write(srt_text)
    return len(cues)


def transcribe_to_json(audio_path, output_json_path, language=None):
    """Transkripsi cepat → JSON {text, keywords, language} untuk metadata konten."""
    model = get_whisper_model()
    src = detect_source_language(model, audio_path)
    segments, info = model.transcribe(
        audio_path,
        language=src or None,
        **_transcribe_kwargs(300)
    )
    texts = []
    seg_list = []
    for segment in segments:
        t = (segment.text or '').strip()
        if t:
            texts.append(t)
            seg_list.append({
                'start': round(float(segment.start), 2),
                'end': round(float(segment.end), 2),
                'text': t,
            })
    full_text = " ".join(texts)
    detected = getattr(info, 'language', language or 'auto')
    translated_text = full_text

    # Terjemahan target jika diminta dan berbeda dari bahasa asli
    if language and language != 'auto' and language != detected:
        tr = translate_text(full_text, detected, language)
        if tr:
            translated_text = tr

    result = {
        'text': translated_text,
        'originalText': full_text,
        'keywords': extract_keywords(full_text),
        'language': detected,
        'targetLanguage': language if (language and language != 'auto') else None,
        'segments': seg_list,
    }
    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    return len(texts)


# ---------------------------------------------------------------------------
# Terjemahan subtitle (deep-translator / GoogleTranslate endpoint)
# ---------------------------------------------------------------------------
_TRANSLATOR_CACHE = {}

def _normalize_lang(code):
    """Normalisasi kode bahasa untuk deep-translator/Google."""
    if not code:
        return code
    if code == 'zh':
        return 'zh-CN'  # Google tidak menerima 'zh' polos
    return code


def get_translator(from_code, to_code):
    """Kembalikan translator (cache per pasangan bahasa). None jika dari==ke."""
    if not to_code or to_code == 'auto' or from_code == to_code:
        return None
    f = _normalize_lang(from_code)
    t = _normalize_lang(to_code)
    key = f"{f}|{t}"
    if key not in _TRANSLATOR_CACHE:
        try:
            from deep_translator import GoogleTranslator
            _TRANSLATOR_CACHE[key] = GoogleTranslator(source=f, target=t)
        except Exception:
            _TRANSLATOR_CACHE[key] = None
    return _TRANSLATOR_CACHE[key]


def translate_text(text, from_code, to_code):
    """Terjemahkan teks; return None bila gagal (network/limit)."""
    if not text or not text.strip():
        return text
    try:
        tr = get_translator(from_code, to_code)
        if tr is None:
            return None
        return tr.translate(text)
    except Exception:
        return None


def apply_text_casing(text, case):
    """Terapkan gaya kapitalisasi pada teks subtitle."""
    if case == 'uppercase':
        return str(text).upper()
    if case == 'lowercase':
        return str(text).lower()
    if case == 'titlecase':
        return str(text).title()
    return str(text)


def transcribe_and_generate_custom_ass(audio_path, output_ass_path, subtitle_config=None, language=None, offset_seconds=0.0, play_res_x=720, play_res_y=1280):
    """Engine auto-clipper: whisper word-timestamps → ASS karaoke (word-by-word pop)
    atau standard (kalimat penuh), dengan typography custom:
    font_family, font_size_scale, font_weight, italic, uppercase, highlight_color."""
    cfg = normalize_subtitle_config(subtitle_config)

    model = get_whisper_model()
    src_lang = detect_source_language(model, audio_path)

    segments, info = model.transcribe(
        audio_path,
        word_timestamps=True,
        language=src_lang or None,
        **_transcribe_kwargs(400)
    )

    words = []
    for segment in segments:
        for w in (segment.words or []):
            wtext = (w.word or '').strip()
            if not wtext:
                continue
            ws = max(0.0, float(w.start) - offset_seconds)
            we = max(ws + 0.08, float(w.end) - offset_seconds)
            words.append({"word": wtext, "start": ws, "end": we})

    if not words:
        header = build_custom_ass_header(play_res_x, play_res_y, cfg,
                                         primary_color=hex_to_ass_style_color(cfg.get("highlight_color", "#FFE600")))
        with open(output_ass_path, 'w', encoding='utf-8') as f:
            f.write(header)
        return 0

    clip_start = 0.0
    clip_end = max(w["end"] for w in words) + 0.2

    if cfg.get("style") == "standard":
        ass = words_to_standard_ass(words, play_res_x, play_res_y, clip_start, clip_end, subtitle_config=cfg)
    else:
        ass = words_to_karaoke_ass(words, play_res_x, play_res_y, clip_start, clip_end, subtitle_config=cfg)

    with open(output_ass_path, 'w', encoding='utf-8') as f:
        f.write(ass)
    return ass.count("Dialogue:")


def transcribe_and_generate_ass(audio_path, output_ass_path, style_name='yellow-viral', font_size_key='medium', position_key='bottom', text_case='uppercase', language=None, offset_seconds=0.0, font_family=None, play_res_x=720, play_res_y=1280, subtitle_config=None):
    """Runs faster-whisper model and generates short-phrase ASS subtitles with custom typography.
    Jika language (target) diberikan dan berbeda dari bahasa asli video,
    subtitle diterjemahkan ke bahasa target.

    play_res_x/play_res_y HARUS sama dengan resolusi kanvas video ekspor
    (PlayResY = tinggi video). Fontsize diskalakan relatif terhadap baseline 720
    sehingga proporsi (`huge` → ~5.6% tinggi video) konsisten di semua resolusi.
    """
    # Dispatch: mode auto-clipper → engine custom (karaoke/standard + typografi)
    if style_name == 'auto-clipper' or subtitle_config is not None:
        return transcribe_and_generate_custom_ass(
            audio_path,
            output_ass_path,
            subtitle_config=subtitle_config or {},
            language=language,
            offset_seconds=offset_seconds,
            play_res_x=play_res_x,
            play_res_y=play_res_y,
        )

    base_style = STYLES.get(style_name, STYLES['quick-brown-inv']).copy()

    # Override jenis font jika user memilih font khusus
    if font_family and font_family != 'auto':
        base_style['font'] = font_family
    
    # Custom font size — diskalakan proporsional terhadap tinggi kanvas ekspor
    if font_size_key in FONT_SIZE_MAP:
        base_size = FONT_SIZE_MAP[font_size_key]
        base_style['fontsize'] = max(16, int(round(base_size * play_res_y / 720.0)))
        # Skala outline & shadow agar border teks tetap tebal, kontras & tajam pada font besar
        scale_f = max(0.8, (base_style['fontsize'] / 40.0) ** 0.5)
        if 'outline' in base_style and base_style.get('border_style', 1) != 3:
            base_style['outline'] = round(base_style['outline'] * scale_f, 1)
        if 'shadow' in base_style:
            base_style['shadow'] = round(base_style['shadow'] * scale_f, 1)
        
    # Custom position
    if position_key in POSITION_MAP:
        base_style['margin_v'] = POSITION_MAP[position_key]['margin_v']
        base_style['alignment'] = POSITION_MAP[position_key]['alignment']
        if position_key == 'bottom':
            base_style['margin_v'] = max(75, int(round(play_res_y * 0.08)))

    # Style dapat memaksa kapitalisasi (mis. capcut-ugc → lowercase)
    effective_case = base_style.get('default_case', text_case)
        
    # Model whisper: 'base' default (≥ 'tiny' dalam akurasi, anti-halusinasi)
    model = get_whisper_model()

    # Deteksi bahasa asli sekali → kunci transkripsi di bahasa itu
    # (mencegah bahasa melompat di tengah klip / hasil "bahasa aneh")
    src_lang = detect_source_language(model, audio_path)

    segments, info = model.transcribe(
        audio_path,
        word_timestamps=True,
        language=src_lang or None,
        **_transcribe_kwargs(400)
    )
    detected_lang = getattr(info, 'language', 'en')
    
    need_translate = bool(language) and language != 'auto' and language != detected_lang
    
    translator = None
    if need_translate:
        translator = get_translator(detected_lang, language)
    
    ass_lines = []
    
    if need_translate and translator is not None:
        # ===== Mode terjemahan: 1 baris per segmen, teks diterjemahkan utuh =====
        # (chunking kata asli tidak cocok untuk hasil terjemahan)
        for segment in segments:
            raw = (segment.text or '').strip()
            if not raw:
                continue
            translated = translator.translate(raw)
            if not translated:
                translated = raw
            emoji_text = inject_emojis_to_text(translated)
            line_text = apply_text_casing(emoji_text, effective_case)
            start_t = max(0.0, segment.start - offset_seconds)
            end_t = max(start_t + 0.5, segment.end - offset_seconds)
            line = f"Dialogue: 0,{format_ass_time(start_t)},{format_ass_time(end_t)},{base_style['name']},,0,0,0,,{line_text}"
            ass_lines.append(line)
    else:
        caption_mode = base_style.get('caption_mode', 'phrase')  # 'phrase' | 'word'
        word_style = base_style.get('word_style', 'plain')       # 'plain' | 'alternate'
        accent6 = base_style.get('secondary_color', '&H0000D4FF').replace('&H', '').replace('&', '')  # AABBGGRR → ambil BBGGRR (6 digit)
        if len(accent6) == 8:
            accent6 = accent6[2:]

        for segment in segments:
            words = list(segment.words)
            if not words:
                # Fallback to segment-level
                text = apply_text_casing(segment.text, effective_case)
                start_t = max(0.0, segment.start - offset_seconds)
                end_t = max(start_t + 0.5, segment.end - offset_seconds)
                line = f"Dialogue: 0,{format_ass_time(start_t)},{format_ass_time(end_t)},{base_style['name']},,0,0,0,,{text}"
                ass_lines.append(line)
                continue

            if caption_mode == 'word':
                # ===== Mode kata-per-kata (MrBeast / OpusClip style) =====
                for wi, w in enumerate(words):
                    wtext = w.word.strip()
                    if not wtext:
                        continue
                    emoji_text = inject_emojis_to_text(wtext)
                    word_text = apply_text_casing(emoji_text, effective_case)

                    # Alternasi warna putih/kuning untuk kesan dinamis (word-pop)
                    if word_style == 'alternate':
                        if wi % 2 == 1:
                            word_text = f"{{\\c&H{accent6}&}}{word_text}{{\\c}}"
                    elif word_style == 'accent-all':
                        word_text = f"{{\\c&H{accent6}&}}{word_text}{{\\c}}"
                    elif word_style == 'rainbow':
                        # Warna berselang per kata (CapCut rainbow / gradient text)
                        pal = [c.replace('&H', '').replace('&', '')[2:] if len(c.replace('&H', '').replace('&', '')) == 8 else c.replace('&H', '').replace('&', '')
                               for c in base_style.get('rainbow_colors', [])]
                        if pal:
                            word_text = f"{{\\c&H{pal[wi % len(pal)]}&}}{word_text}{{\\c}}"

                    ws = max(0.0, w.start - offset_seconds)
                    we = max(ws + 0.28, w.end - offset_seconds)
                    wline = f"Dialogue: 0,{format_ass_time(ws)},{format_ass_time(we)},{base_style['name']},,0,0,0,,{word_text}"
                    ass_lines.append(wline)
            elif caption_mode == 'karaoke':
                # ===== Mode karaoke (CapCut "The Quick Brown Fox") =====
                # Chunk size adaptif: font raksasa/monster memakai 2-3 kata agar teks
                # tampil besar, jelas, dan fokus seperti video Alex Hormozi & MrBeast
                if font_size_key in ('colossal', 'xxlarge'):
                    chunk_size = 2
                elif font_size_key in ('huge', 'xlarge'):
                    chunk_size = 3
                elif font_size_key == 'large':
                    chunk_size = 4
                else:
                    chunk_size = 5

                for i in range(0, len(words), chunk_size):
                    chunk = words[i:i + chunk_size]
                    chunk_start = max(0.0, chunk[0].start - offset_seconds)
                    chunk_end = max(chunk_start + 0.4, chunk[-1].end - offset_seconds)

                    parts = []
                    for w in chunk:
                        wtext = w.word.strip()
                        if not wtext:
                            continue
                        dur_cs = max(5, int(round((w.end - w.start) * 100)))
                        wtext_c = apply_text_casing(inject_emojis_to_text(wtext), effective_case)
                        parts.append(f"{{\\k{dur_cs}}}{wtext_c}")
                    if not parts:
                        continue
                    line_text = " ".join(parts)
                    line = (f"Dialogue: 0,{format_ass_time(chunk_start)},{format_ass_time(chunk_end)},"
                            f"{base_style['name']},,0,0,0,,{line_text}")
                    ass_lines.append(line)
            else:
                # Group words into short punchy phrases (adaptif terhadap ukuran font)
                if font_size_key in ('colossal', 'xxlarge'):
                    chunk_size = 2
                elif font_size_key in ('huge', 'xlarge'):
                    chunk_size = 2
                else:
                    chunk_size = 3
                for i in range(0, len(words), chunk_size):
                    chunk = words[i:i + chunk_size]
                    phrase_start = max(0.0, chunk[0].start - offset_seconds)
                    phrase_end = max(phrase_start + 0.3, chunk[-1].end - offset_seconds)

                    raw_text = " ".join(w.word.strip() for w in chunk)
                    emoji_text = inject_emojis_to_text(raw_text)
                    phrase_text = apply_text_casing(emoji_text, effective_case)

                    line = f"Dialogue: 0,{format_ass_time(phrase_start)},{format_ass_time(phrase_end)},{base_style['name']},,0,0,0,,{phrase_text}"
                    ass_lines.append(line)

    header = generate_ass_header(base_style, play_res_x=play_res_x, play_res_y=play_res_y)
    with open(output_ass_path, 'w', encoding='utf-8') as f:
        f.write(header)
        f.write("\n".join(ass_lines) + "\n")
        
    return len(ass_lines)

def render_preview(cfg):
    """Render PNG preview subtitle (frame nyata) — hasil identik dengan ekspor:
    background solid + subtitle via libass (ffmpeg), ukuran 9:16 default."""
    style_name = cfg.get('style', 'mrbeast-white')
    font_family = cfg.get('fontFamily', 'auto')
    font_size_key = cfg.get('fontSize', 'large')
    text = cfg.get('text', 'RAHASIA SUKSES')
    text_case = cfg.get('textCase', 'uppercase')
    width = int(cfg.get('width', 720))
    height = int(cfg.get('height', 1280))
    output_png = cfg.get('outputPng', '')
    ffmpeg_bin = cfg.get('ffmpegPath', 'ffmpeg')
    bg_arg = cfg.get('bgColor', '0x101323')
    duration_s = float(cfg.get('duration', 3))
    subtitle_config = cfg.get('subtitleConfig')

    if not output_png:
        return 0

    # ===== Mode auto-clipper custom (Karaoke / Standard + typografi penuh) =====
    if style_name == 'auto-clipper' or subtitle_config is not None:
        import subprocess as _sp
        scfg = normalize_subtitle_config(subtitle_config)
        is_karaoke = scfg.get("style") == "karaoke"
        primary = hex_to_ass_style_color(scfg.get("highlight_color", "#FFE600")) if is_karaoke else "&H00FFFFFF"
        header = build_custom_ass_header(width, height, scfg, primary_color=primary)
        is_upper = scfg.get("uppercase", is_karaoke)

        lines = []
        if is_karaoke:
            # Satu baris kata per kata; setiap kata menyala (highlight color) satu per satu.
            sample_words = [w.strip() for w in str(text).split() if w.strip()]
            if not sample_words:
                sample_words = ["VIRAL"]
            per = max(0.32, duration_s / max(len(sample_words), 1))
            for i, w in enumerate(sample_words):
                wt = w.upper() if is_upper else w
                t0 = i * per
                t1 = min(t0 + per, duration_s)
                lines.append(f"Dialogue: 0,{format_ass_time(t0)},{format_ass_time(t1)},Default,,0,0,0,,{wt}")
            # Tangkap frame saat kata terakhir (sorotan) tampil
            frame_at = max(0.0, (len(sample_words) - 1) * per + per * 0.45)
            if frame_at >= duration_s:
                frame_at = max(0.0, duration_s - 0.3)
        else:
            ln = str(text).replace('\n', ' ')
            st = ln.upper() if is_upper else ln
            lines.append(f"Dialogue: 0,0:00:00.00,{format_ass_time(duration_s)},Default,,0,0,0,,{st}")
            frame_at = 0.0

        ass_path = output_png.rsplit('.', 1)[0] + '.ass'
        with open(ass_path, 'w', encoding='utf-8') as f:
            f.write(header)
            f.write("\n".join(lines) + "\n")

        cmd = [
            ffmpeg_bin, '-y',
            '-f', 'lavfi', '-i', f'color=c={bg_arg}:s={width}x{height}:d={duration_s}',
            '-vf', f"ass='{ass_path.replace(chr(39), chr(39) + chr(92) + chr(39))}'",
            '-ss', str(frame_at),
            '-frames:v', '1', output_png
        ]
        _sp.run(cmd, stdout=_sp.DEVNULL, stderr=_sp.DEVNULL, timeout=30)
        return os.path.exists(output_png)

    base = STYLES.get(style_name, STYLES['quick-brown-inv']).copy()
    if font_family and font_family != 'auto':
        base['font'] = font_family
    if font_size_key in FONT_SIZE_MAP:
        base_size = FONT_SIZE_MAP[font_size_key]
        base['fontsize'] = max(16, int(round(base_size * height / 720.0)))
        scale_f = max(0.8, (base['fontsize'] / 40.0) ** 0.5)
        if 'outline' in base and base.get('border_style', 1) != 3:
            base['outline'] = round(base['outline'] * scale_f, 1)
        if 'shadow' in base:
            base['shadow'] = round(base['shadow'] * scale_f, 1)
        base['margin_v'] = max(75, int(round(height * 0.08)))

    header = generate_ass_header(base, play_res_x=width, play_res_y=height)

    lines = []
    caption_lines = [ln.strip() for ln in str(text).split('\n') if ln.strip()][:5]
    effective_case = base.get('default_case', text_case)
    karaoke = base.get('caption_mode') == 'karaoke'
    frame_at = 0.45 if karaoke else 0.0
    for i, ln in enumerate(caption_lines):
        ln = apply_text_casing(ln, effective_case)
        # Gaya karaoke: SATU baris dgn {\k} → warna kuning berjalan (libass sweep)
        if karaoke:
            words = ln.split(' ')
            parts = []
            for w in words:
                if not w.strip():
                    continue
                parts.append(f"{{\\k40}}{w.strip()}")
            t0 = i * (duration_s / max(len(caption_lines), 1))
            t1 = t0 + 0.9
            lines.append(f"Dialogue: 0,{format_ass_time(t0)},{format_ass_time(t1)},{base['name']},,0,0,0,,{' '.join(parts)}")
            frame_at = 0.45  # tangkap frame saat sweep sudah berjalan
            continue
        # Gaya CapCut: alt warna antar baris / pelangi per baris
        if base.get('word_style') == 'alternate' and i % 2 == 1:
            sec = base.get('secondary_color', '&H0000D4FF').replace('&H', '').replace('&', '')
            if len(sec) == 8:
                sec = sec[2:]
            ln = f"{{\\c&H{sec}&}}{ln}{{\\c}}"
        elif base.get('word_style') == 'rainbow':
            pal = [c.replace('&H', '').replace('&', '') for c in base.get('rainbow_colors', [])]
            pal = [c[2:] if len(c) == 8 else c for c in pal]
            if pal:
                ln = f"{{\\c&H{pal[i % len(pal)]}&}}{ln}{{\\c}}"
        t0 = i * (duration_s / max(len(caption_lines), 1))
        t1 = t0 + 0.9
        lines.append(
            f"Dialogue: 0,{format_ass_time(t0)},{format_ass_time(t1)},{base['name']},,0,0,0,,{ln}"
        )

    ass_path = output_png.rsplit('.', 1)[0] + '.ass'
    with open(ass_path, 'w', encoding='utf-8') as f:
        f.write(header)
        f.write("\n".join(lines) + "\n")

    # render frame (kolaborasi warna solid + subtitle)
    cmd = [
        ffmpeg_bin, '-y',
        '-f', 'lavfi', '-i', f'color=c={bg_arg}:s={width}x{height}:d={duration_s}',
        '-vf', f"ass='{ass_path.replace(chr(39), chr(39) + chr(92) + chr(39))}'",
    ]
    if karaoke:
        # tangkap frame saat sweep karaoke sudah berjalan
        cmd += ['-ss', str(frame_at)]
    cmd += ['-frames:v', '1', output_png]
    import subprocess
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
    return os.path.exists(output_png)


def _model_cached(name=None):
    """Cek apakah model whisper sudah ada di HF cache (tanpa load model)."""
    import pathlib
    name = name or WHISPER_MODEL_NAME
    hub_root = os.environ.get(
        'HF_HOME',
        os.path.join(os.path.expanduser('~'), '.cache', 'huggingface'),
    )
    d = pathlib.Path(hub_root) / 'hub' / f"models--Systran--faster-whisper-{name}"
    return d.exists() and (d / 'snapshots').exists()


def selftest():
    """Verifikasi engine AI (ctranslate2 + faster-whisper + model siap).
    `--selftest --fast` → tanpa load model (dipakai /api/health, cepat).
    Print JSON satu baris. Exit 0 bila siap, 1 bila gagal."""
    fast = '--fast' in sys.argv[1:]
    result = {'ok': False, 'model': WHISPER_MODEL_NAME, 'compute': None, 'cached': False, 'error': None}
    try:
        import ctranslate2  # noqa: F401
        result['compute'] = _best_compute_type()
        result['cached'] = _model_cached()
        if fast:
            # Cukup import faster_whisper + cek cache — tanpa load model (cepat)
            import faster_whisper  # noqa: F401
            result['ok'] = result['cached']
        else:
            get_whisper_model()  # raise bila model / binding rusak
            result['ok'] = True
    except Exception as e:
        result['error'] = str(e)
    print(json.dumps(result), flush=True)
    return 0 if result['ok'] else 1


def main():
    # Mode selftest: verifikasi engine tanpa config file
    if len(sys.argv) >= 2 and sys.argv[1] == '--selftest':
        sys.exit(selftest())

    if len(sys.argv) < 2:
        print("Usage: python transcriber.py <config_json_path>")
        sys.exit(1)
        
    config_path = sys.argv[1]
    with open(config_path, 'r', encoding='utf-8') as f:
        cfg = json.load(f)

    # Mode preview: render PNG subtitle contoh (tanpa input media / transkripsi)
    output_png = cfg.get('outputPng')
    if output_png:
        if render_preview(cfg):
            print(f"SUCCESS:Preview PNG rendered to {output_png}")
            sys.exit(0)
        sys.stderr.write("Error in transcriber: preview render failed.\n")
        sys.exit(1)

    input_media = cfg['inputMedia']
    output_ass = cfg.get('outputAss')
    output_json = cfg.get('outputJson')
    output_srt = cfg.get('outputSrt')
    style_name = cfg.get('style', 'quick-brown-inv')
    font_size_key = cfg.get('fontSize', 'medium')
    position_key = cfg.get('position', 'bottom')
    text_case = cfg.get('textCase', 'uppercase')
    language = cfg.get('language', 'auto')
    font_family = cfg.get('fontFamily', 'auto')
    subtitle_config = cfg.get('subtitleConfig')
    start_sec = cfg.get('startSeconds', 0.0)
    duration_sec = cfg.get('durationSeconds', None)
    ffmpeg_bin = cfg.get('ffmpegPath', 'ffmpeg')
    play_res_x = int(cfg.get('playResX', 720))
    play_res_y = int(cfg.get('playResY', 1280))

    if not output_ass and not output_json and not output_srt:
        sys.stderr.write("Error in transcriber: outputAss, outputJson, or outputSrt required.\n")
        sys.exit(1)
    
    temp_dir = os.path.dirname(output_ass or output_json or output_srt)
    temp_wav = os.path.join(temp_dir, f"transcribe_{os.getpid()}.wav")
    
    try:
        extract_audio_segment(input_media, temp_wav, start_sec, duration_sec, ffmpeg_bin)
        if output_json:
            count = transcribe_to_json(temp_wav, output_json, language)
            print(f"SUCCESS:Transcribed {count} segments to JSON.")
        elif output_srt:
            count = transcribe_to_srt(temp_wav, output_srt, language)
            print(f"SUCCESS:Transcribed {count} cues to SRT.")
        else:
            count = transcribe_and_generate_ass(
            temp_wav,
            output_ass,
            style_name=style_name,
            font_size_key=font_size_key,
            position_key=position_key,
            text_case=text_case,
            language=language,
            offset_seconds=0.0,
            font_family=font_family,
            play_res_x=play_res_x,
            play_res_y=play_res_y,
            subtitle_config=subtitle_config
        )
        print(f"SUCCESS:Generated {count} subtitle cues.")
    except Exception as e:
        sys.stderr.write(f"Error in transcriber: {str(e)}\n")
        sys.exit(1)
    finally:
        if os.path.exists(temp_wav):
            try:
                os.remove(temp_wav)
            except Exception:
                pass
        if os.path.exists(config_path):
            try:
                os.remove(config_path)
            except Exception:
                pass

if __name__ == '__main__':
    main()
