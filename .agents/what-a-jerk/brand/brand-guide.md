# Brand Guide — What a Jerk

*The canonical reference for logo, colors, type, and brand voice. Everything else (website, signage, menus, ads, social) pulls from this file.*

*Last updated: 2026-04-23*

---

## Logo

**Primary lockup:** Yellow on red. Retro 70s groovy script reading *"What a Jerk"* with *"TRUE JAMAICAN FLAVOURS"* arched above, a palm tree running through the wordmark, and two small seagulls on the upper left.

**Files (`/Users/ethan/Odoo_Portal_18EE/.agents/what-a-jerk/brand/assets/`):**

| File | Use for |
|------|---------|
| `Final Logo in Yellow and Red.svg` | Web, digital ads, social — scalable, keep as master |
| `Final Logo in Yellow and Red PDF.pdf` | Print at any size — signage, menus, flyers |
| `FIXED OUTLINES VERSION copy.pdf` | Black-and-white version — single-color print, stamps, receipts, newspaper |

*(Move the PDFs and SVG into `brand/assets/` when they land on disk — the Obsidian/share folder location is the current holding spot.)*

### Usage rules

**Always:**
- Keep a clear space equal to the height of the "W" around every side of the logo — no text, buttons, or graphics inside this zone.
- Use the yellow-on-red lockup as the default for anything public-facing.
- Use the black-outline version for stamps, receipts, newsprint, and anywhere color isn't available.

**Never:**
- Redraw, retype, or substitute the script — it's a custom mark.
- Stretch, skew, rotate, or add drop-shadows / outlines / gradients on top of it.
- Place the logo on a busy photo without a solid color underlay or a semi-transparent red/yellow wash.
- Place yellow logo on any background other than the brand red, off-white, or a dark food photo — contrast gets muddy fast.

**Minimum sizes:**
- Digital: 120 px wide
- Print: 25 mm wide
- Below those sizes use a simplified mark (we don't have one yet — commission before printing anything tiny like stickers or name tags).

---

## Color Palette

All colors specified against the **RAL** standard (German paint / signage industry) for accurate reproduction on physical signage, vinyl wraps, and interior paint.

### Primary

| Role | Name | RAL | Hex | Pantone | Use for |
|------|------|-----|-----|---------|---------|
| **Brand Red** | Traffic Red | **RAL 3020** | `#CC0605` | 3546 C | Primary background, logo background, CTA buttons, signage base |
| **Brand Yellow** | Pastel Yellow | **RAL 1034** | `#EFA94A` | 715 C | Primary logo color, accent type on red, highlights |

### Accent

| Role | Name | RAL | Hex | Pantone | Use for |
|------|------|-----|-----|---------|---------|
| **Accent Blue** | Pastel Blue | **RAL 5024** | `#5D9B9B` | 7696 C | Secondary graphics, illustration accents, *sparingly* |
| **Off-White** | Grey White | **RAL 9002** | `#E7EBDA` | 7527 C | Menus, interior walls, body copy backgrounds (warmer than pure white) |
| **Accent Pink** | Bright Pink | **RAL 3015** | `#EA899A` | 197 C | Merch, stickers, playful social graphics — *sparingly* |

### Text

| Role | Hex | Use for |
|------|-----|---------|
| **Text Dark** | `#1A1A1A` | Body text on yellow or off-white |
| **Text Light** | `#FFFFFF` | Body text on red |

### Contrast guide (WCAG 2.1 AA)

| Combination | Ratio | Safe for |
|-------------|-------|----------|
| White on Red `#CC0605` | 5.9:1 | Body text ≥ 14px ✅ |
| Black on Yellow `#EFA94A` | 8.6:1 | Body text any size ✅ |
| Black on Off-White `#E7EBDA` | 16.1:1 | Body text any size ✅ |
| Yellow `#EFA94A` on Red `#CC0605` | 3.5:1 | Large display text only (≥ 24px bold) ⚠ |
| Blue `#5D9B9B` on Off-White | 3.6:1 | Large display text only ⚠ |

**Rule of thumb:** Body text is either white-on-red or black-on-yellow/off-white. Yellow-on-red is for the logo and display headlines only, never for paragraphs or fine print.

---

## Typography

Both fonts are free on Google Fonts.

| Role | Font | Weight options | Use for |
|------|------|----------------|---------|
| **Display / Headers** | **Mist Tropical** | Regular | Page headers, section titles, menu boards, poster copy, "big moments" |
| **Body** | **Sora** | 300 / 400 / 500 / 600 / 700 / 800 | All body text, labels, prices, buttons, fine print, Wolt/UE copy |

**Pairing rule:** Mist Tropical carries the retro tropical feel of the logo; Sora is the neutral workhorse for everything else. Never set body copy in Mist Tropical — it's a display face and becomes illegible below ~24px.

**Weight hierarchy (Sora):**
- 800 — page titles only (rarely — usually Mist Tropical handles this)
- 700 — subsection headers, CTA buttons
- 600 — product names, prices, active states
- 500 — body text (default), form labels
- 400 — meta text, subtitles, captions
- 300 — long-form editorial body only (e.g. story page)

**Numerals:** always set with `font-variant-numeric: tabular-nums` for prices and quantities so columns align.

**CSS import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Mist+Tropical&family=Sora:wght@300;400;500;600;700;800&display=swap');

:root {
  --waj-font-display: 'Mist Tropical', 'Brush Script MT', cursive;
  --waj-font-body: 'Sora', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
```

*(If Mist Tropical is unavailable on Google Fonts under that exact name when the site goes to build, the closest free alternatives are **Mistrully** or **Sacramento** — confirm with Ethan before substituting.)*

---

## Brand Voice (see also [taglines.md](../copy/taglines.md))

**Personality:** Playful · Warm · Bold · Cool · Fiery.

**Tone:** Conversational, bilingual DE/EN, confident but not cocky. Uses Jamaican phrases (*ya mon*, *one love*) sparingly — as warmth, not caricature. Direct and fun. Not corporate. Not formal German.

**Brand tagline (from the logo):** *TRUE JAMAICAN FLAVOURS* — note the British "u" spelling, matches the logo mark. Use verbatim on signage, website header, menu header, Wolt banner.

**Primary voice tagline:** *Real jerk. Real heat. Straight from the counter.* (EN) / *Echter Jerk. Echte Schärfe. Direkt vom Tresen.* (DE)

---

## Design Cues from the Logo

The logo is not minimal — it's warm, retro, disco-reggae-70s. That has to show up across the brand:

- **Surfaces:** off-white walls, red and yellow signage, warm wood or rattan furniture, palm prints OK, not overdone.
- **Illustration style:** bold outlines, flat fills, 70s-poster feeling. Avoid modern flat-vector / corporate illustration.
- **Photography:** warm golden tones, natural light, real hands in frame, steam and smoke visible. Avoid cold white studio light and food-magazine tropes (crossed cutlery, fake smoke, overhead flatlays on marble).
- **Music in-store:** roots reggae, early dancehall, 70s soul — nothing current-top-40.

---

## What Goes Where

| Surface | Primary color | Logo variant |
|---------|---------------|--------------|
| Street sign / A-frame | Red base, yellow logo + chalk copy | Yellow-on-red full lockup |
| Window decal (hero) | Red vinyl, yellow logo | Yellow-on-red full lockup |
| Window decal (small text) | Off-white vinyl | Black outline version |
| Menu board (behind counter) | Red background, yellow + white type | Yellow-on-red full lockup |
| Printed menu / table tent | Off-white stock, red + black type | Black outline, top of page |
| Receipt | White thermal paper | Black outline, header |
| Business card / punchcard | Front red with yellow logo · Back off-white with black type | Yellow-on-red front, black outline back |
| Wolt / Uber Eats hero | Red + yellow logo + food shot | Yellow-on-red lockup |
| Instagram grid | Mix: food photos, red+yellow graphics, occasional blue/pink accents | Yellow-on-red lockup for profile + templates |
| Website hero | Red band, yellow headline, white body | Yellow-on-red lockup |
| T-shirts / staff merch | Red shirt with yellow logo (primary), off-white shirt with black outline logo (alt) | Both variants |

---

## Design Tokens (for site + digital)

```scss
// Paste into site CSS / design system
:root {
  --waj-red:         #CC0605; // RAL 3020 — primary bg, CTAs
  --waj-yellow:      #EFA94A; // RAL 1034 — primary accent, highlights
  --waj-blue:        #5D9B9B; // RAL 5024 — accent, use sparingly
  --waj-offwhite:    #E7EBDA; // RAL 9002 — body backgrounds
  --waj-pink:        #EA899A; // RAL 3015 — accent, use sparingly
  --waj-text-dark:   #1A1A1A;
  --waj-text-light:  #FFFFFF;

  // Interaction states
  --waj-red-dark:    #A30504; // pressed / hover on red CTAs
  --waj-yellow-dark: #D9933A; // pressed / hover on yellow CTAs
}
```

---

## Signage Vendors (Berlin)

Keep these near the brand guide so the next print job doesn't start from scratch.

*(Populate after you pick a vendor — for now: print shops known for RAL-accurate vinyl are Vinyl-Art Berlin, Druckerei Rüss, and Pixartprinting.de for remote printing.)*

| Vendor | Address | Specializes in | Notes |
|--------|---------|----------------|-------|
| — | — | — | — |

---

## Change Log

- **2026-04-23** — Initial brand guide created. Palette and logo locked. Type family candidates not yet final.
