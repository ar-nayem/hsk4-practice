#!/usr/bin/env python3
"""Draws the website's favicon / home-screen icons (the red 考 seal from the header) into server/public/.

Run:  python3 tools/make_web_icons.py      (needs Pillow and the macOS Hiragino font)
Outputs: favicon.ico (16/32/48), favicon-32.png, apple-touch-icon.png (180),
         icon-192.png, icon-512.png, icon-512-maskable.png, manifest.webmanifest
"""
import json, os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server', 'public')
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'  # index 2 = bold
RED, WHITE = (179, 48, 42, 255), (255, 255, 255, 255)
SS = 6  # supersampling for smooth edges


def seal(px, radius=0.22, glyph=0.66, bleed=False):
    """Red rounded square with a white 考. bleed=True fills the whole canvas (no transparent corners)."""
    big = px * SS
    im = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if bleed:
        d.rectangle((0, 0, big, big), fill=RED)
    else:
        d.rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * radius), fill=RED)
    font = ImageFont.truetype(FONT, int(big * glyph), index=2)
    x0, y0, x1, y1 = d.textbbox((0, 0), '考', font=font)
    d.text((big / 2 - (x0 + x1) / 2, big / 2 - (y0 + y1) / 2), '考', font=font, fill=WHITE)
    return im.resize((px, px), Image.LANCZOS)


def save(im, name):
    im.save(os.path.join(OUT, name))
    print('wrote', name, im.size)


os.makedirs(OUT, exist_ok=True)
# Tab icon: bigger glyph + tighter corners so 考 stays readable at 16 px.
tab = {s: seal(s, radius=0.2, glyph=0.72) for s in (16, 32, 48)}
tab[48].save(os.path.join(OUT, 'favicon.ico'), format='ICO', sizes=[(16, 16), (32, 32), (48, 48)], append_images=[tab[16], tab[32]])
print('wrote favicon.ico (16/32/48)')
save(tab[32], 'favicon-32.png')
save(seal(180, glyph=0.66, bleed=True).convert('RGB').convert('RGBA'), 'apple-touch-icon.png')  # iOS rounds the corners itself
save(seal(192), 'icon-192.png')
save(seal(512), 'icon-512.png')
save(seal(512, glyph=0.5, bleed=True), 'icon-512-maskable.png')  # glyph inside the maskable safe zone (centre 80%)

manifest = {
    'name': 'HSK 4 Prep', 'short_name': 'HSK 4 Prep',
    'description': 'HSK 4 exam practice: mock exams, 1,200 words, sentences, speaking and a leaderboard.',
    'start_url': '/', 'scope': '/', 'display': 'standalone',
    'background_color': '#f5f2ec', 'theme_color': '#b3302a',
    'icons': [
        {'src': '/icon-192.png', 'sizes': '192x192', 'type': 'image/png', 'purpose': 'any'},
        {'src': '/icon-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'any'},
        {'src': '/icon-512-maskable.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'},
    ],
}
with open(os.path.join(OUT, 'manifest.webmanifest'), 'w') as f:
    json.dump(manifest, f, indent=2, ensure_ascii=False)
    f.write('\n')
print('wrote manifest.webmanifest')
