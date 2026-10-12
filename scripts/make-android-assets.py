"""Regenerates the Android icons, splash screens, notification icon and alarm sound.

Run from the repo root:  python3 scripts/make-android-assets.py
Needs Pillow (pip install pillow). Source artwork: icon2.png.
"""
import math
import struct
import wave
from pathlib import Path

from PIL import Image, ImageDraw

SRC = Path('icon2.png')
RES = Path('android/app/src/main/res')
BG = (0, 0, 0, 255)  # app background (black, matches the top bar)

crown = Image.open(SRC).convert('RGBA')
# icon2.png has a small grey sparkle mark in its bottom-right corner, outside the crown; clear it
ImageDraw.Draw(crown).rectangle((503, 425, crown.width, crown.height), fill=(0, 0, 0, 0))
crown = crown.crop(crown.getbbox())


def fit(img, box):
    """Scale img to fit inside a box x box square, keeping its shape."""
    s = box / max(img.size)
    return img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)


def centered(canvas, img):
    canvas.alpha_composite(img, ((canvas.width - img.width) // 2, (canvas.height - img.height) // 2))
    return canvas


# Launcher icons: legacy square, round, and adaptive foreground (108dp canvas, art inside the 66dp safe zone)
DENS = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
for d, k in DENS.items():
    n = round(48 * k)
    sq = centered(Image.new('RGBA', (n, n), BG), fit(crown, round(n * 0.78)))
    sq.save(RES / f'mipmap-{d}/ic_launcher.png')
    mask = Image.new('L', (n, n), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, n - 1, n - 1), fill=255)
    rnd = centered(Image.new('RGBA', (n, n), BG), fit(crown, round(n * 0.62)))
    rnd.putalpha(mask)
    rnd.save(RES / f'mipmap-{d}/ic_launcher_round.png')
    f = round(108 * k)
    centered(Image.new('RGBA', (f, f), (0, 0, 0, 0)), fit(crown, round(f * 0.56))).save(RES / f'mipmap-{d}/ic_launcher_foreground.png')

    # Notification status-bar icon: white on transparent, 24dp. Android only uses the alpha,
    # so keep the crown's dark line work (not the whole outline, which would be a plain blob).
    s = round(24 * k)
    small = fit(crown, round(s * 0.92))
    alpha = Image.new('L', small.size, 0)
    src, dst = small.load(), alpha.load()
    for y in range(small.height):
        for x in range(small.width):
            r, g, b, a = src[x, y]
            dst[x, y] = a if a > 40 and r + g + b < 200 else 0
    sil = Image.new('RGBA', alpha.size, (255, 255, 255, 0))
    sil.putalpha(alpha)
    out = RES / f'drawable-{d}'
    out.mkdir(exist_ok=True)
    centered(Image.new('RGBA', (s, s), (0, 0, 0, 0)), sil).save(out / 'ic_stat_dispatch.png')

# Splash screens: crown centred on black, same sizes Capacitor generated
for p in RES.glob('drawable*/splash.png'):
    w, h = Image.open(p).size
    centered(Image.new('RGBA', (w, h), BG), fit(crown, round(min(w, h) * 0.4))).convert('RGB').save(p)

# Web icon used by index.html (favicon and notification icon)
centered(Image.new('RGBA', (512, 512), (0, 0, 0, 0)), fit(crown, 460)).save('icon-512.png')

# Alarm sound: the same rising three-note chime the page plays, repeated three times (~4 s)
RATE = 44100
dur_total = 4.2
buf = [0.0] * int(RATE * dur_total)


def tone(freq, start, dur, vol):
    i0 = int(start * RATE)
    for i in range(int((dur + 0.05) * RATE)):
        t = i / RATE
        if i0 + i >= len(buf):
            break
        # triangle wave with a fast attack and exponential decay
        tri = 2 * abs(2 * ((t * freq) % 1) - 1) - 1
        env = min(1.0, t / 0.02) * math.exp(-5 * t / dur)
        buf[i0 + i] += tri * env * vol


for o in (0, 1.4, 2.8):
    tone(880, o, 0.4, 0.33)
    tone(1175, o + 0.16, 0.4, 0.33)
    tone(1568, o + 0.32, 0.6, 0.33)
raw = RES / 'raw'
raw.mkdir(exist_ok=True)
with wave.open(str(raw / 'dispatch_alarm.wav'), 'wb') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, v)) * 32000)) for v in buf))
print('Android assets regenerated')
