# 2026-08-04 — Shelf labels: one per product, per place

Status: **awaiting Ethan's go**. No code written.
Mock: https://claude.ai/code/artifact/6bdded2f-56cb-4fd2-9f07-adb825fd709a

## What he asked for

> "I want for each product to have a section where I have a label for that product
> and that label will be printed so that I can attach them to their storage
> location. The label should have the product name, barcode for that product, the
> location. 90 × 60 millimetres. Zebra printer."
> …
> "the label should have its location stated. And remember the levels of location
> we have, such as room, shelf number and so on, including also barcode for that
> location."

## Decisions taken with him

| Question | Decision |
|---|---|
| Printer | **Zebra ZD421, 203 dpi** (confirmed off the model sticker). 90 × 60 mm = 720 × 480 dots. The ZQ310 (48 mm head) **cannot** print this size and keeps its small food labels. |
| Product code — 829 of 880 have none | **Generate one and save it to Odoo's barcode field.** Never overwrite an existing (supplier) barcode. Written through `POST /api/inventory/barcode-lookup`, which already returns 409 on a collision — NOT through the raw product PUT, which has no duplicate check. |
| A product in two places | **One label per place**, each naming its own shelf. A label listing both is confusing when you're standing at one of them. Section lists the places with tick boxes, all ticked. |
| Two codes on one label — scan collision | **Teach the counting scanner shelf codes.** Product code → count that product; shelf code → jump to that shelf. `parseLocationCode` already exists in `src/lib/location-code.ts` but is wired into `LocationLabels.tsx` ONLY, so today a stray shelf scan reaches the product lookup, finds nothing, and the scan-to-create flow offers to **create a phantom product**. This is a live defect independent of labels. |
| Emphasis | The **product name dominates** — full label width, ~13 mm per line at 203 dpi, readable across a kitchen. The shelf QR moved down beside the location to free that width. A long name steps down ONE size rather than wrapping to three lines. Barcode keeps ~12 mm, above the ~10 mm a scanner needs. |

## Still open

- 90 × 60 mm label rolls to buy, and the ZD421 calibrated to them.
- Whether to print an "as of <date>" stamp in a corner (guards against stale stickers
  after a shelf is renamed — locations live in the portal DB, so a rename silently
  invalidates every printed label).

## What already exists — reuse unchanged

- `src/lib/zpl.ts` — `dotsPerMm`, `font()`, `escapeZPL`, the `^XA/^PW/^LL/^CI28` preamble,
  and the Code 128 block **with the `^BY2 → ^BY1` narrow-head fix**. The new builder must
  live INSIDE this file to reach those private helpers.
- `LabelSizeSelector` + `/api/label-sizes` + `saved_label_sizes` / `label_size_preferences` —
  size picking and per-user/per-restaurant memory.
- `useZebraBluetooth()` (Android + browser) and `sendToZebra()` (network, server-side).
- `LocationLabels.tsx` — the full print modal shape to clone: paper AND Zebra output,
  paired-device picker, per-label skip toggles, single-record mode via `onlyId`.
- `locationPathLabel()` for "WAJ Kitchen › Countertop fridge › D4". Real hierarchy is
  3 deep (area → unit → drawer), verified on staging.
- `ProductDetail.tsx` already loads the barcode AND `homeSpots`/`spotLabels`. Nothing new
  to fetch for the product-page section.

**No new printer plumbing, no new size storage, no new database table.**

## Genuinely new

1. One size preset `90 × 60 mm` in `src/types/labeling.ts`.
2. `generateProductStorageZPL()` in `src/lib/zpl.ts`. Barcode height cap raised from 12 mm
   (a food-label cap) to ~18 mm.
3. `dpi` threaded through — today no screen passes it and both builders assume 203. Correct
   for this printer, wrong the moment a 300 dpi unit appears.
4. A **Label** section on `/products/[id]`, right below the Barcode field.
5. A print modal cloned from `LocationLabels`, taking one product or a list.
6. A "no code yet" state — `generateZPL` currently prints nothing when the barcode is empty;
   on a shelf label silence is wrong.
7. Scanner learns `KWLOC-` codes (see the decision table).

## Do in the same commit (house rule)

Extract the printer status bar + Connect + paired-device picker + the
`device.languages "zpl"` fix into a shared `ui/ZebraPrinterBar`, and register it in
`ASSETS.md`. That fix exists in exactly ONE of three current screens
(`LabelPrint.tsx:448`); without extraction this becomes the fourth copy and two existing
screens still can't recover a factory-fresh printer that prints ZPL as text.

## Risks to state before building

1. **Preview drift.** The existing preview is a hand-written copy of the print layout and
   HAS ALREADY DRIFTED. One shared layout description must feed both the preview and the
   printer — this is Design Principle 2 in CLAUDE.md, and a fourth hand-written copy would
   repeat a known mistake.
2. **Writing to ~829 Odoo product records.** Reversible, but it is master data, not a
   portal setting. Staging first, with a preview of exactly what will be written.
3. **Odoo barcode nomenclature** may reject a letter-prefixed code. Verify on staging
   BEFORE any write; if rejected the format changes, not the plan.
4. **Stale stickers.** A renamed shelf silently invalidates every printed label.
5. The ZQ310 silently prints a 90 mm label chopped at 48 mm — the size must be remembered
   per printer, not just per restaurant.

## Build order (small, independently revertible)

1. `generateProductStorageZPL` + the 90 × 60 preset + unit tests on the ZPL output.
2. Shared `ui/ZebraPrinterBar` extracted, all existing screens moved onto it.
3. The Label section on the product page (single product, its places ticked).
4. Code generation: single-product button, then the manager bulk run — staging, with a
   dry-run preview first.
5. Scanner learns `KWLOC-` codes.
6. "Print every label for this shelf" — one button feeding the same modal an array.
7. Follow-up, not in the first build: "print every label for this counting list".
