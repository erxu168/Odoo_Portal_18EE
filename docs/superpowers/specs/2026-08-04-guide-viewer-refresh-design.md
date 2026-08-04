# Guide viewer + editor refresh — design (2026-08-04)

**Status:** approved from the clickable mock (Artifact `8ac8bb7b-3051-4ab1-803b-0dd2ed789ba8`).
**North star (Ethan):** the how-to *is* the photo — use the screen so the **picture gets
most of the attention**; chrome (header, notes, buttons) gets out of its way.

**Codex cross-check:** planning + verification calls are on hold — OpenAI usage limit until
**Aug 8, 2026**. Increment C (Odoo writes) gets an in-repo **adversarial review** (review
workflow / second reasoner) before it ships, standing in for Codex until quota returns.

## The four changes (all in the guide screens; manager-authored, staff read-only)

1. **Slim viewer header** — one row `title · N/N · ✕` + a thin segmented progress bar,
   replacing the stacked overline + title + "Step X of Y" + chunky dot row (~20% of a phone).
   Tap a segment to jump. Phone/tablet only; **desktop untouched** (restore roomy at `lg:`).
2. **Tap-a-dot popover** — a dot's note appears **pinned at the dot** (flips above/below and
   clamps horizontally so it never leaves the photo), sized to its text, wraps. Tap again to
   close, tap another to switch, tap the photo to dismiss. **Replaces** the bottom-sheet and
   **removes** the amber "Tap each numbered marker…" banner.
3. **Drawing annotations (editor only)** — arrow, circle, box, freehand pen, in red/blue/
   green/white, layered over the photo like the dots (vector, never burned in). Undo, clear,
   per-mark delete. Staff see them read-only in the player.
4. **Save & stay** — "Save guide" saves and keeps you in the editor with a "Saved ✓";
   **Close** leaves. Includes a **safe post-save refresh** (see risk below).

## Photo-first layout (bakes change #1/#2 into a principle)
- Slim header, slim footer; the image area **flex-grows** to fill the space the old banner +
  bottom sheet used to eat, centered, capped by available height.
- Caption compact under the photo; notes float **on** the photo, not below it.

## Increments (each independently shippable + reversible)

### A — Viewer polish (front-end only, no data change) ← build first
Files: `src/app/tasks/_components/GuidedTutorialPlayer.tsx`, `src/components/ui/PinnableImage.tsx`.
- Compact header (responsive; desktop via `lg:` keeps current look).
- Anchored popover in `PinnableImage` **view mode** (new, self-contained; edit mode unchanged).
- Remove the amber banner; remove the bottom-sheet note; photo-first sizing.
- Low risk, delivers most of what Ethan sees. Verify on staging.

### B — Save & stay (front-end only) ← build second
File: `GuidedTutorialEditor.tsx` (`handleSave`).
- Drop the `onClose()` after save; show a "Saved ✓" notice; keep dirty=false.
- **Safe post-save refresh:** because `portal_save_guide` is an atomic aggregate rebuild
  (all step/pin ids churn), staying open with stale ids risks a second save dropping kept
  photos. After a successful save, **re-hydrate editor state from the server** (re-GET the
  guide, or hydrate from the save response if it returns the fresh read payload) before the
  user can edit again. Reuse the existing revision/stale machinery.

### C — Drawing annotations (Odoo model + migration) ← build last, adversarial review
New data (mirrors the pin model, but geometry is polymorphic → a **JSON/Text field on the
step**, not a relational child): `krawings.task.guide.step.drawings` = JSON array of shapes,
each `{type: 'arrow'|'circle'|'box'|'pen', color, points: [[x,y]...]}` in **fractions 0..1**
(survives resize; matches pins). Server validates + caps (`GUIDE_MAX_DRAWINGS`, max points/shape).
**Wiring (all required or it silently drifts — from the code map):**
- BOTH save methods: `krawings.task.guide.portal_save_guide` **and** legacy
  `krawings.task.template.line.portal_save_guide`.
- THREE read methods: `guide`, `template.line`, `list.line` `portal_read_guide`.
- BOTH snapshot/copy paths: `snapshot_to_list_line` **and** the inline copy in `task_template.py` spawn.
- Portal validator (`sanitizeSteps` in `task-guide-validate.ts`) + caps in `task_template_line.py`.
- Photo-only guard (extend the step's `_check_media`), draft-tolerant (like pins).
- Wipe drawings on photo-replace (with confirm), same as pins.
- Editor: a drawing-tools strip in `PhotoStep` (between the image and the pin control row); an
  SVG layer inside `PinnableImage`'s wrapRef (edit mode) storing fractions; own undo stack;
  honor the `disabled`/save-freeze. Player renders the same SVG read-only.
- Migration: `-u krawings_task_manager`; new nullable Text field → cheap (no new ir.attachment).

## Risks / decisions
- **Stale-id photo loss on Save & stay** → the post-save re-hydrate above (fail-closed).
- **Two save + three read + two snapshot paths** → checklist above; miss one and a surface drifts.
- **No undo exists anywhere** → drawing brings its own undo stack.
- **touch-action** → set `none` on the drawing layer only while a draw tool is active (iOS pitfall #4).
- **Colors** → portal standard (red attention / blue / green / white), not the legacy orange.

## Acceptance (Given/When/Then, abbreviated)
- Viewer: tapping a dot shows its note at the dot; tapping another switches; tapping the photo
  closes; no banner; no bottom sheet; header is one row + thin bar; photo is the dominant element.
- Editor: draw arrow/circle/box/pen in a chosen color; undo removes the last; clear (confirm)
  removes all; Save shows "Saved ✓" and stays; a second edit+save keeps photos intact.
- Staff daily + past-day snapshots show the manager's drawings read-only; past days unchanged.
- Desktop viewer header unchanged; all new touch UX works on phone + tablet.
