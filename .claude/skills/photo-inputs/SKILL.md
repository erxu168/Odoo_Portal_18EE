---
name: photo-inputs
description: Use whenever building, changing, or reviewing ANY photo or file input in this portal — enforces Ethan's binding four-way rule (camera + gallery + file + drag) and the real-device lesson that a bare accept="image/*" input is NOT conformant.
---

# Photo inputs — the four-way rule (BINDING)

Every photo field in this portal must offer ALL FOUR ways in, visibly:

1. **Take a photo** — rear camera (`capture="environment"`) for shelves,
   deliveries, proof shots; front (`capture="user"`) only for profile photos.
   On desktop, the in-browser webcam modal.
2. **Photo gallery** — `accept="image/*"` without `capture`.
3. **Choose a file** — plain file input.
4. **Drag-and-drop** — via `ui/DropZone`, in EVERY state of the field
   (empty AND replace).

**Paste is a fifth, OPT-IN way** — `FilePicker`'s `paste` prop, `BatchPhotos` —
for desktop-first fields where one file at a time is the point. Not required
(a kitchen tablet cannot paste), and never a substitute for the four.

## The lesson that created this skill (2026-08-03)

A bare `<input type="file" accept="image/*">` LOOKS conformant — the OS is
supposed to offer camera/gallery/files. **On the kitchen Android tablets it
opens the gallery only; the camera never appears.** Staff facing a
photo-required count could not take a photo. The 2026-07-30 audit passed 24
fields because it accepted bare inputs as conformant. Do not repeat that:
**a photo field must present its sources itself.**

## Use these, never hand-roll

- `ui/PhotoSourceButtons` — the three explicit source buttons + drag.
  Takes `facing: 'user' | 'environment'` (default 'user'; pass
  `'environment'` for anything that isn't a face).
- `components/inventory/PhotoCaptureStrip` — the compact multi-photo strip;
  its **[+] opens a chooser sheet** built on PhotoSourceButtons. Use for
  count lines, waste entries, and similar in-row photo proof.
- `ui/FilePicker` — single-input picker with drag + optional paste.
  **Only acceptable where documents (PDFs) are the point**, because it
  relies on the OS chooser. For photo-first fields prefer the two above.
- Never set `capture` on a lone input — it kills gallery and file access
  (the original defect this rule was written about).

## Checklist before shipping a photo field

- [ ] Camera visibly offered (correct facing)?
- [ ] Gallery visibly offered?
- [ ] File upload visibly offered?
- [ ] Drag works in every state of the field?
- [ ] Verified on a real/emulated MOBILE viewport, not just desktop?
- [ ] Registered/updated in `ASSETS.md`?
