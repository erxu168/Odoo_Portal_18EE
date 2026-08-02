# Container-level counting — design (signed off 2026-08-02)

Mock: https://claude.ai/code/artifact/511e4aee-1910-4e97-b15f-f10b8e26a7d8
(4 revisions to match Ethan's real containers; final "ok lets build it" 2026-08-02)

## The problem

Products stored in containers — sauces in 10 L / 20 L / 30 L buckets and drums,
spirits in bottles — cannot be weighed on the floor. The count sheet therefore
counts measure-base products in WHOLE packs only (its own comment says so), and
the open container is guessed or ignored: up to a full container of invisible
stock per product, which then reads as consumption.

## The idea (Ethan's)

Staff look into the open container, judge the level by eye, and TAP that level
on a drawing of the container. The system converts the level to litres/kg —
it already knows what a full one holds from the counting words
("1 bucket = 10 L").

## Decisions (interview 2026-08-02 — do not re-litigate)

1. **Quarter steps** — Empty · ¼ · ½ · ¾ · Full. What eyes can honestly judge.
2. **Level ≈ fraction of contents everywhere** — bottles' necks and the drum's
   bulge introduce centilitre-level error; today's error is whole containers.
3. **Inside the existing CrateCountSheet** — one new row: "And the open one?"
4. **Manager opt-in per product** (Ethan's explicit choice over automatic):
   a "Level diagram" setting per product — Off / Round bucket / Rect. bucket /
   Barrel / Bottle. The shape picks the drawing staff see.
5. **One open container per product per spot.** A second open one is counted
   as full or consolidated first.
6. **Shared with the Waste Tracker** — same picker on the bin screen's crate
   sheet (without the Empty zone; you can't bin nothing).
7. **Review shows words + a mini glyph** — "2 buckets + ¾ open ≈ 27.5 L" plus
   a small container drawing at the marked level.

## Container drawings (match the real shelf)

| Shape key | Real container | Drawing notes |
|---|---|---|
| `round` | White 10 L bucket, 263 ⌀ × 262 mm — almost square silhouette | White plastic, ribbed collar, front-hanging handle |
| `rect` | White 20 L tub, 394 × 294 × 247 mm — wider than tall | Chunky lid band, wire handle with red grip |
| `barrel` | Blue 30 L HDPE drum, 312 ⌀ × 512 mm | Blue bulged body, open neck, black side drop-handle |
| `bottle` | Spirits bottle | Glass, dark fill, label, black cap |

SVGs live in the shared picker component; the mock's drawings are the source.

## Architecture — the level is an INPUT METHOD, not new data

The marked fraction feeds the **existing loose quantity**:
`loose = fraction × units_per_crate` (via the shared `roundQty` rounding).
Total stays `crateTotal(crates, loose, size)`. Nothing downstream changes:
review, approval, Odoo write-back, usage report all already read this number.
The glyph is DERIVED: `fraction ≈ loose / units_per_crate` rounded to the
nearest quarter (shown only when it round-trips to a quarter; otherwise words
only).

### Storage
- `product_flags.level_shape TEXT NULL` — `'round' | 'rect' | 'barrel' |
  'bottle'`, NULL = off. ALTER-if-missing migration (existing pattern).
- Served by the existing product-flags GET; written by the product-settings
  save path.

### New shared component
`src/components/ui/ContainerLevelPicker.tsx` (registered in ASSETS.md):
props `{ shape, unitsPerCrate, unitWord, value: fraction|null, onChange,
allowEmpty }`. Renders the container SVG at the marked level + the five
44px zone buttons; tapping the drawing itself also sets the level (zone by
vertical position). Quarter fractions only: 0, 0.25, 0.5, 0.75, 1.

### Wiring
- **CrateCountSheet** (measure mode): under the whole-packs stepper, when the
  product's `level_shape` is set, render the picker + a live readout
  ("¾ of a bucket ≈ 7.5 L") and include the level in the total and in
  `onSave(crates, loose)`. Prefill: nearest quarter from initial loose.
  The recent `commitOnDismiss` behaviour must treat a level change as a
  number change. Callers pass a new optional `levelShape` prop; count-mode
  (bottles counted per piece) is untouched.
- **QuickCount / CountingSession / WasteTracker**: pass `level_shape` from the
  flags they already fetch. No other changes — the sheet does the work.
  Waste passes `allowEmpty=false`.
- **ReviewSubmissions**: beside the existing split words, a mini glyph
  (small variant of the same SVG) when the product has a shape and the loose
  amount is a clean quarter of the pack size.
- **Product settings** (products module): "Level diagram" selector
  Off / four shapes, saved to product_flags, gated by the existing
  `inventory.productsettings.manage`.

## Edge cases
- Measure-mode loose was hardcoded 0 in the sheet — the change removes that
  assumption ONLY when a shape is configured; unconfigured products behave
  exactly as today.
- A loose amount that is not a clean quarter (e.g. typed via numpad elsewhere,
  or pack size changed later): picker opens unset, review shows words only.
- `roundQty` (6-decimal) is the single rounding authority — the fraction math
  must round-trip: fractionToLoose(quarterFromLoose(x)) === x for clean values.
- Odoo/desktop untouched; mobile-first 44px targets.

## Out of scope (stated in the mock)
Finer than quarters · bottle-shape maths · multiple open containers per spot ·
photos of the level (existing per-line photo rules unchanged) · applying the
picker to count-base products.

## Test plan
- Unit (TDD): fraction↔loose helpers round-trip + quarter detection;
  flag column migration read/write.
- Browser: count a level-enabled product on a local seeded stack (staging
  manager fixture still lacks WAJ access); staging smoke of the screens.
