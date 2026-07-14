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
To use a different look, tweak the colours below, or swap in your own logo as
icon-foreground.png (transparent PNG, subject centred in the middle ~66%).
"""
from PIL import Image, ImageDraw
import math, os

GREEN = (22, 163, 74, 255)   # #16a34a brand green
NAVY = (26, 31, 46, 255)     # #1A1F2E header navy
WHITE = (255, 255, 255, 255)
S = 1024

os.makedirs("assets", exist_ok=True)


def draw_clock(img, cx, cy, R):
    """Draw a clean clock (white face, navy ticks + 10:10 hands) sized by radius R."""
    d = ImageDraw.Draw(img)
    d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=WHITE)
    for i in range(12):
        ang = math.radians(i * 30)
        vx, vy = math.sin(ang), -math.cos(ang)
        major = (i % 3 == 0)
        r_out = R * 0.92
        r_in = R * (0.78 if major else 0.84)
        w = R * (0.075 if major else 0.042)
        x1, y1 = cx + vx * r_in, cy + vy * r_in
        x2, y2 = cx + vx * r_out, cy + vy * r_out
        d.line([x1, y1, x2, y2], fill=NAVY, width=max(2, int(w)))
        for (px, py) in [(x1, y1), (x2, y2)]:
            d.ellipse([px - w / 2, py - w / 2, px + w / 2, py + w / 2], fill=NAVY)

    def hand(length_f, width_f, dial_pos):
        L, W = R * length_f, R * width_f
        ang = math.radians(dial_pos / 12 * 360)
        ex, ey = cx + math.sin(ang) * L, cy - math.cos(ang) * L
        d.line([cx, cy, ex, ey], fill=NAVY, width=max(2, int(W)))
        d.ellipse([ex - W / 2, ey - W / 2, ex + W / 2, ey + W / 2], fill=NAVY)

    hand(0.52, 0.100, 10)   # hour hand -> ~10
    hand(0.80, 0.072, 2)    # minute hand -> 2  (classic 10:10)
    cd = R * 0.10
    d.ellipse([cx - cd, cy - cd, cx + cd, cy + cd], fill=NAVY)
    wd = R * 0.033
    d.ellipse([cx - wd, cy - wd, cx + wd, cy + wd], fill=WHITE)


# Foreground: large clock so it fills the adaptive safe-zone after @capacitor/assets'
# 16.7% inset (transparent background — the green comes from icon-background).
fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
draw_clock(fg, S // 2, S // 2, R=430)
fg.save("assets/icon-foreground.png")

# Background: solid brand green.
Image.new("RGBA", (S, S), GREEN).save("assets/icon-background.png")

# Legacy (non-adaptive) launchers: green tile + clock, a touch smaller for the mask.
only = Image.new("RGBA", (S, S), GREEN)
draw_clock(only, S // 2, S // 2, R=360)
only.save("assets/icon-only.png")

# Launch (splash) screen: green with a centred clock.
SP = 2732
sp = Image.new("RGBA", (SP, SP), GREEN)
draw_clock(sp, SP // 2, SP // 2, R=430)
sp.convert("RGB").save("assets/splash.png")
sp.convert("RGB").save("assets/splash-dark.png")

print("Wrote:", ", ".join(sorted(os.listdir("assets"))))
