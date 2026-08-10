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
from faster_whisper import WhisperModel

# ===== Whisper Model =====
# 'tiny' = sangat cepat tapi sering salah dengar & halusinasi (hurut nambah,
#          kata hilang, bahasa melompat). 'base' = default (jauh lebih akurat).
# 'small' = terbaik untuk bahasa non-Inggris, tapi 3-5x lebih lambat di CPU.
# Override via env:  WHISPER_MODEL=small python3 ...
WHISPER_MODEL_NAME = os.environ.get('WHISPER_MODEL', 'base').strip().lower()

# Mode offline: model dipakai dari cache lokal saja → tidak ada percobaan
# snapshot_download ke network (gagal ketika DNS/network terbatas).
os.environ.setdefault('HF_HUB_OFFLINE', '1')
os.environ.setdefault('HF_HUB_DISABLE_TELEMETRY', '1')

_WHISPER_MODEL_CACHE = {}

def get_whisper_model():
    """Singleton model whisper — dibagi antar pemanggilan (hemat load time)."""
    if WHISPER_MODEL_NAME not in _WHISPER_MODEL_CACHE:
        _WHISPER_MODEL_CACHE[WHISPER_MODEL_NAME] = WhisperModel(
            WHISPER_MODEL_NAME, device='cpu', compute_type='int8'
        )
    return _WHISPER_MODEL_CACHE[WHISPER_MODEL_NAME]

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


def transcribe_to_json(audio_path, output_json_path, language=None):
    """Transkripsi cepat → JSON {text, keywords, language} untuk metadata konten."""
    model = get_whisper_model()
    src = detect_source_language(model, audio_path)
    segments, info = model.transcribe(
        audio_path,
        beam_size=5,
        language=src or None,
        temperature=0.0,                      # greedy → minim halusinasi
        condition_on_previous_text=False,      # matikan loop pengulangan kata
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=300)
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


def transcribe_and_generate_ass(audio_path, output_ass_path, style_name='yellow-viral', font_size_key='medium', position_key='bottom', text_case='uppercase', language=None, offset_seconds=0.0, font_family=None, play_res_x=720, play_res_y=1280):
    """Runs faster-whisper model and generates short-phrase ASS subtitles with custom typography.
    Jika language (target) diberikan dan berbeda dari bahasa asli video,
    subtitle diterjemahkan ke bahasa target.

    play_res_x/play_res_y HARUS sama dengan resolusi kanvas video ekspor
    (PlayResY = tinggi video). Fontsize diskalakan relatif terhadap baseline 720
    sehingga proporsi (`huge` → ~5.6% tinggi video) konsisten di semua resolusi.
    """
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
        beam_size=5,
        word_timestamps=True,
        language=src_lang or None,
        temperature=0.0,                      # greedy → minim halusinasi kata
        condition_on_previous_text=False,      # matikan "karena → karnesa" loop
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=400)
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

    if not output_png:
        return 0

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


def main():
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
    style_name = cfg.get('style', 'quick-brown-inv')
    font_size_key = cfg.get('fontSize', 'medium')
    position_key = cfg.get('position', 'bottom')
    text_case = cfg.get('textCase', 'uppercase')
    language = cfg.get('language', 'auto')
    font_family = cfg.get('fontFamily', 'auto')
    start_sec = cfg.get('startSeconds', 0.0)
    duration_sec = cfg.get('durationSeconds', None)
    ffmpeg_bin = cfg.get('ffmpegPath', 'ffmpeg')
    play_res_x = int(cfg.get('playResX', 720))
    play_res_y = int(cfg.get('playResY', 1280))

    if not output_ass and not output_json:
        sys.stderr.write("Error in transcriber: outputAss or outputJson required.\n")
        sys.exit(1)
    
    temp_dir = os.path.dirname(output_ass or output_json)
    temp_wav = os.path.join(temp_dir, f"transcribe_{os.getpid()}.wav")
    
    try:
        extract_audio_segment(input_media, temp_wav, start_sec, duration_sec, ffmpeg_bin)
        if output_json:
            count = transcribe_to_json(temp_wav, output_json, language)
            print(f"SUCCESS:Transcribed {count} segments to JSON.")
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
            play_res_y=play_res_y
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
