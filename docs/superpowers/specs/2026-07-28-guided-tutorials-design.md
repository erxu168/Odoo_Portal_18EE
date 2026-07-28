# Guided Tutorials — Task Manager (design)

**Date:** 2026-07-28 · **Status:** approved for build · **Repo:** Odoo_Portal_18EE (portal) + `odoo-modules/krawings_task_manager` (Odoo 18 EE)

Evolves the existing **setup-guide** feature into an optional, per-task **guided tutorial** (a step-by-step how-to attached to a task). Mock (signed off): https://claude.ai/code/artifact/28b5d21b-fcfb-4be4-8d97-11cac5350369

## Locked requirements (Ethan, interview 2026-07-28)
1. A task can **optionally** carry a guide. The guide is **purely instructional — it never completes the task.** Staff still tick the task themselves.
2. A guide = an **ordered sequence of steps**. Steps are **numbered and reorderable** (drag → renumber).
3. Step media types: **photo** (+ optional numbered **note-pins**, each pin carries a note) · **YouTube** (link only) · **tip/warning** (text only) · **PDF** (document).
4. One photo per step. One guide per task (not a reusable library — deferred).
5. Single language (no i18n now). No training-record tracking (self-serve help).
6. **Draft → Publish**: staff only see a **published** guide; managers edit in draft.
7. **Manager + Admin** build/edit guides (`requireRole('manager')`, not the configurable capability). Staff view only.
8. Entry point: a clear **"Show me how · N steps"** button on the normal task row (only when a published guide exists).

## Key finding driving the migration
The current setup-guide **couples the guide to completion**: pins are subtasks, checking them completes the task, and `TaskRow` hides the normal tick. This is the opposite of requirement 1. So we **decouple completion** and **migrate** the one live setup-guide (staging: 1 template line, 15 setup photos, 2 pinned subtasks, 14 daily snapshots).

## Data model (Odoo — source of truth; NOT portal SQLite)
Two new models, dual-parent (template line for editable source; list line for the daily snapshot), matching the existing `krawings.task.setup.photo` snapshot pattern.

### `krawings.task.guide.step`
- `template_line_id` / `list_line_id` (exactly one; cascade) · `source_template_step_id` (snapshot traceability)
- `sequence` (normalized 10,20,30…; unique per parent)
- `media_type` Selection: `photo` | `youtube` | `tip` | `pdf`
- `explanation` Text, required, plain text (rendered as React text, never HTML)
- `image` Binary(attachment=True) + `image_filename` — photo steps only
- `pdf_file` Binary(attachment=True) + `pdf_filename` — pdf steps only
- `youtube_url` Char — youtube steps only (canonical `https://www.youtube.com/watch?v=<id>`)
- `pin_ids` One2many → guide pin (photo steps only)
- Constraints: media-type ⇒ required/forbidden fields (photo⇒image, no url/pdf; youtube⇒valid url, no image/pdf/pins; tip⇒none; pdf⇒pdf_file, no image/url/pins); explanation nonblank.

### `krawings.task.guide.pin`
- `step_id` (required, cascade) · `sequence` (pin order within the step) · `pin_x`,`pin_y` (fractions 0..1) · `note` Text required.
- Pin numbers are **local to the step**, derived from sorted order (not stored). Reordering steps never renumbers pins.

### Task-line fields (both `krawings.task.template.line` and `krawings.task.list.line`)
- `guide_step_ids` One2many · computed `has_guide` · computed/stored `guide_step_count`
- template line: `guide_published` Boolean (default false) · `guide_revision` Integer (optimistic concurrency)
- list line: `guide_snapshot_revision` Integer (audit)
- Presence of ≥1 step = has a guide. `has_guide` for staff = published AND steps exist.

### Snapshot at spawn (`task_template.py`)
Extend the existing spawn: if the template line's guide is **published**, deep-copy every step (explanation, media bytes/url, pins) into daily-owned `guide.step`/`guide.pin` records on the new list line. Filestore checksum dedup avoids duplicating identical bytes. Later template edits affect **future** spawns only. Unpublished guide ⇒ no snapshot.

### Completion decoupling (removes the conflict)
- Delete the `is_setup_guide` branch from `mark_done`; remove `_locked_pin_status` / `_sync_setup_guide_completion` / `resync_setup_guide` after the compatibility window; stop resync from the photo route.
- Ordinary subtask toggles report only their own state.
- `TaskRow` always shows the normal completion control. A task may have ordinary subtasks **and** an optional guide button.
- Keep `is_setup_guide` + legacy `setup.photo` for one release (migration/rollback), then a later cleanup migration removes them.

### Migration `18.0.7.0.0` (idempotent)
For the legacy template guide: sort `setup_photo_ids`; create one `photo` guide step each; normalize sequences; seed `explanation` from the line name (flag "needs manager review"); convert each pinned subtask → guide pin (`note=subtask.name`, copy `pin_x/pin_y`); set `guide_published=true` (it was live). Do the same independently for daily list lines (they're historical snapshots). Mark converted daily pin-subtasks `legacy_guide_pin` (exclude from hydration, reject toggles, preserve done/toggled_at/by). Set legacy `is_setup_guide=false`; preserve `completed_at` (don't reopen completed history); a partially-complete legacy guide task becomes a normal pending task. Report photos-with-pins-but-missing-bytes for manual repair rather than silently building a broken guide.

## API (all under `/api/tasks`)
**Manager (template guide), `requireRole('manager')` + `assertTemplateCompany` + line-belongs-to-template + step-belongs-to-line:**
- `GET  …/templates/[id]/lines/[lineId]/guide` — steps, pins, published state, revision
- `PUT  …/templates/[id]/lines/[lineId]/guide` — **atomic aggregate** replace/upsert of the whole ordered guide + `published`; row-lock + `revision` compare → `409` on stale; array order authoritative → normalized sequences; existing photos `{action:"keep"}` vs base64 replacement (validate signature JPEG/PNG/WEBP; PDF `%PDF` magic); omitted steps/pins deleted; caps on step/pin/text/size.
- `DELETE …/guide` — remove all steps
- `GET  …/guide/steps/[stepId]/photo` and `…/[stepId]/pdf` — serve template step media (scoped; `no-store`, `nosniff`)

**Staff (daily snapshot), `requireAuth()` + company + dept/current-list authorization (resolved PIN actor on shared tablets) + step-belongs-to-line; no mutations:**
- `GET …/lines/[lineId]/guide` — daily snapshot steps/pins/urls/media URLs (only if published-at-spawn)
- `GET …/lines/[lineId]/guide/steps/[stepId]/photo|pdf` — raw snapshot bytes
- `GET /today` + list hydration return only `has_guide` + `guide_step_count` (+ published for manager preview); full guide loaded lazily on open.

## YouTube security
`src/lib/youtube-url.ts` (shared): accept only https youtube.com/watch, youtu.be, m./www., /shorts/, /embed/; validate the 11-char video-ID charset; reject credentials/ports/lookalike hosts/redirects/playlist-only. Store canonical `watch?v=<id>`. At render build `https://www.youtube-nocookie.com/embed/<id>?rel=0`, `loading="lazy"`, minimal `allow`, no autoplay, `referrerPolicy="strict-origin-when-cross-origin"`, fullscreen, + "Open in YouTube" fallback (`rel="noopener noreferrer"`). Mount the iframe only for the open step.
**CSP** (new — repo has none): add response headers in `next.config.mjs`: `frame-src 'self' https://www.youtube-nocookie.com; frame-ancestors 'self'; object-src 'none';` (start report-friendly; no wildcards).

## Components
- **`PinnableImage`** (reuse) — add `alt` prop, stable pin key/id; keep fractional coords + pointer-drag guards; player never sets `done`.
- **`GuidedTutorialEditor`** (replaces `SetupGuideEditor`) — line modal shows ordinary subtasks, then an optional "Guided tutorial" section: add photo/YouTube/tip/PDF step; required explanation per step; photo upload via existing `compressImage`; add/drag/delete note-pins via `PinnableImage` (replacing a photo with pins requires confirm + clears pins); reorder steps via installed `@dnd-kit` (pointer + keyboard); step numbers from array order; freeze during save; Draft/Publish toggle. Pins are free-text notes (no station-item catalog).
- **`GuidedTutorialPlayer`** (replaces `SetupGuideView`) — full-screen; opened from the task row "Show me how · N steps"; step counter + title; Prev/Next + close; media = photo (pins → tap opens note popover/bottom sheet) / YouTube (nocookie iframe, active step only) / tip (warning panel) / PDF (open/download); explanation under media; **no checkbox/done/progress/subtask calls**; focus trap, Esc close, focus restore, a11y labels; local-only "visited" markers allowed (never persisted). Manager preview uses the same player against the template GET.
- `TaskRow` / `ChecklistCard` — show the normal completion control always + a "Show me how" button when `has_guide`.

## Edge cases
Reorder = atomic, sequences normalized server-side, pin numbering step-local. Concurrent managers → `409` (no silent last-write-wins). Empty guide / DELETE → no guide button. Draft → hidden from staff, no snapshot. Photo replaced → confirm + clear pins. YouTube invalid/blocked/offline → show explanation + media-unavailable, task still completable. Broken image → explanation + placeholder, never blocks completion. Old daily instances keep their snapshot + completion state. Caps on counts/sizes to keep JSON-RPC sane. Explanations/notes rendered as text, not HTML. Guide image/pdf attachments excluded from generic attachment lists + proof-photo counts.

## Build phases (each: build → local typecheck/build → Codex review → staging deploy + `-u` + Playwright)
1. **Odoo data model** — new models, task-line fields, security/access, views; snapshot in spawn; **decouple completion**. `-u`, verify no regression to existing tasks.
2. **Migration `18.0.7.0.0`** — convert the legacy guide (template + daily), decouple, legacy flags. Verify the 1 staging guide migrates cleanly.
3. **Portal data layer** — `task-guide.ts`, `youtube-url.ts`, `next.config.mjs` CSP; manager aggregate + staff read API routes.
4. **Manager editor** — `GuidedTutorialEditor` + template page wiring; Draft/Publish.
5. **Staff player** — `GuidedTutorialPlayer` + `TaskRow`/`ChecklistCard`; remove old completion coupling in UI.
6. **Tests** — Odoo (snapshot, migration, validation, security, **viewing/pinning never sets `completed_at`**) + portal e2e (`tasks-guided-tutorials.e2e.spec.ts`).

## Testing must prove
Viewing every step / tapping every pin does **not** change `completed_at`; staff complete only via the normal control; drafts are invisible to staff; YouTube only ever embeds nocookie with a validated id; migrated guide matches the original photos/pins.
