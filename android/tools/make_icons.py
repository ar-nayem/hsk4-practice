#!/usr/bin/env python3
"""Draws the launcher icons (red seal with 考, matching the website logo) into res/mipmap-*."""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'  # index 2 = W6 (bold)
RED, WHITE = (179, 48, 42, 255), (255, 255, 255, 255)
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
SS = 4  # supersampling for smooth edges

def glyph(draw, box, size_px):
    font = ImageFont.truetype(FONT, size_px, index=2)
    x0, y0, x1, y1 = draw.textbbox((0, 0), '考', font=font)
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    draw.text((cx - (x0 + x1) / 2, cy - (y0 + y1) / 2), '考', font=font, fill=WHITE)

def legacy(px, round_):
    big = px * SS
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pad = big * 0.04
    box = (pad, pad, big - pad, big - pad)
    if round_: d.ellipse(box, fill=RED)
    else: d.rounded_rectangle(box, radius=big * 0.2, fill=RED)
    glyph(d, box, int(big * 0.56))
    return im.resize((px, px), Image.LANCZOS)

def foreground(px):  # 108dp adaptive layer; glyph kept inside the 66dp safe circle
    big = px * SS
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    glyph(ImageDraw.Draw(im), (0, 0, big, big), int(big * 0.42))
    return im.resize((px, px), Image.LANCZOS)

for name, k in DENSITIES.items():
    out = os.path.join(ROOT, 'res', f'mipmap-{name}')
    os.makedirs(out, exist_ok=True)
    legacy(round(48 * k), False).save(os.path.join(out, 'ic_launcher.png'))
    legacy(round(48 * k), True).save(os.path.join(out, 'ic_launcher_round.png'))
    foreground(round(108 * k)).save(os.path.join(out, 'ic_launcher_fg.png'))
legacy(512, False).save(os.path.join(ROOT, 'icon-512.png'))
print('icons written')
