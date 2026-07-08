#!/usr/bin/env python3
"""
Generates the Krawings Time Clock app-icon source images into ./assets/:
  icon-foreground.png  (transparent bg, clock — the adaptive-icon foreground)
  icon-background.png  (solid brand green — the adaptive-icon background)
  icon-only.png        (green + clock composited — legacy launchers)
  splash.png / splash-dark.png (green with centered clock)

Then run:  npx @capacitor/assets generate --android
to expand these into every Android density + adaptive icon.

Requires Pillow:  pip install pillow
To use a different look, tweak the colours or swap in your own logo as
icon-foreground.png (transparent PNG, subject centered in the middle ~66%).
"""
from PIL import Image, ImageDraw
import math, os

GREEN = (22, 163, 74, 255)   # #16a34a brand green
NAVY = (26, 31, 46, 255)     # #1A1F2E header navy
WHITE = (255, 255, 255, 255)
S = 1024
C = S // 2

os.makedirs("assets", exist_ok=True)


def draw_clock(img, face_r=300):
    d = ImageDraw.Draw(img)
    d.ellipse([C - face_r, C - face_r, C + face_r, C + face_r], fill=WHITE)
    for i in range(12):
        ang = math.radians(i * 30)
        vx, vy = math.sin(ang), -math.cos(ang)
        major = (i % 3 == 0)
        r_in = face_r - (60 if major else 38)
        w = 22 if major else 12
        x1, y1 = C + vx * r_in, C + vy * r_in
        x2, y2 = C + vx * (face_r - 16), C + vy * (face_r - 16)
        d.line([x1, y1, x2, y2], fill=NAVY, width=w)
        for (px, py) in [(x1, y1), (x2, y2)]:
            d.ellipse([px - w / 2, py - w / 2, px + w / 2, py + w / 2], fill=NAVY)

    def hand(length, width, dial_pos):
        ang = math.radians(dial_pos / 12 * 360)
        ex, ey = C + math.sin(ang) * length, C - math.cos(ang) * length
        d.line([C, C, ex, ey], fill=NAVY, width=width)
        d.ellipse([ex - width / 2, ey - width / 2, ex + width / 2, ey + width / 2], fill=NAVY)

    hand(165, 30, 10)   # hour hand -> ~10
    hand(238, 22, 2)    # minute hand -> 2  (classic 10:10)
    d.ellipse([C - 30, C - 30, C + 30, C + 30], fill=NAVY)
    d.ellipse([C - 10, C - 10, C + 10, C + 10], fill=WHITE)


fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
draw_clock(fg, face_r=300)
fg.save("assets/icon-foreground.png")

Image.new("RGBA", (S, S), GREEN).save("assets/icon-background.png")

only = Image.new("RGBA", (S, S), GREEN)
only.alpha_composite(fg)
only.save("assets/icon-only.png")

SP = 2732
sp = Image.new("RGBA", (SP, SP), GREEN)
clock = Image.new("RGBA", (S, S), (0, 0, 0, 0))
draw_clock(clock, face_r=330)
clock = clock.resize((820, 820))
sp.alpha_composite(clock, ((SP - 820) // 2, (SP - 820) // 2))
sp.convert("RGB").save("assets/splash.png")
sp.convert("RGB").save("assets/splash-dark.png")

print("Wrote:", ", ".join(sorted(os.listdir("assets"))))
