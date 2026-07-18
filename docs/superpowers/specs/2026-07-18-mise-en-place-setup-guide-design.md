# Mise en Place — Station Setup Guide (Task Manager)

- **Date:** 2026-07-18
- **Status:** Design approved — D1–D4 confirmed 2026-07-18; ready for implementation plan
- **Repo:** `erxu168/Odoo_Portal_18EE` (Next.js portal + `odoo-modules/krawings_task_manager`)
- **Related mock:** https://claude.ai/code/artifact/3d4b44ac-fae5-45d2-8d84-76a7f4ab5d09
- **Cross-checked by:** OpenAI Codex (`gpt-5.6-sol`, high) — corrections folded in (see §12).

---

## 1. Problem

Staff set up prep stations inconsistently, which slows service and causes mistakes. Managers
want a visual, self-explanatory standard: a photo of the correctly-arranged workspace with each
item pinned and labelled, so anyone — including a new hire — can reproduce the setup quickly and
correctly. This should live inside the daily Task Manager staff already use, not as a separate tool.

## 2. What we are building (one sentence)

A checklist task can be marked a **setup guide**: it carries one reference photo with numbered
pins, each pin labelled from a reusable per-department item list; staff check off each pinned item
as they place it, and the task auto-completes when all pinned items are done.

## 3. Locked decisions (from brainstorming)

1. **Lives inside the daily checklist** — the guide is attached to a task; staff open it from
   inside the task, then complete it. (Not a standalone library.)
2. **Item names come from a reusable, manager-maintained per-department catalog**, with
   add-new-on-the-fly.
3. **Tags are numbered pins placed at a spot on the photo**, position stored as a fraction of the
   image (survives phone/tablet size differences).
4. **Staff check off each pinned item; the task auto-completes when all pinned items are done.**
5. **Approach A** — extend the existing task-manager models (reuse subtasks, attachments, the
   nightly spawn, the who/when audit trail). Rejected: a separate entity (duplicates check-off
   machinery) and a JSON blob (loses per-item accountability + DB constraints, not queryable).

**Invariant (v1):** on a setup-guide line, **every subtask is a pin**. We do not mix ordinary
subtasks and pinned items on the same line in v1. (Keeps completion + rendering unambiguous.)

## 4. Scope

**In scope (v1)**
- Manager flags a template task as a setup guide, uploads one reference photo, drops/labels/removes
  pins, and maintains the per-department item list.
- Nightly spawn copies the guide (flag + pins) into each day's task; the photo is inherited from
  the template.
- Staff see the annotated photo + a numbered check-off list; ticking all items auto-completes the
  task, and a completed guide can be reopened by unchecking a pin.
- Works for ad-hoc setup guides created directly on a day's list (no template).

**Out of scope (v1 — revisit later)**
- A required final "proof" photo of the *finished* station — the existing `photo_required`
  mechanism already covers this if wanted; left off by default for guides.
- Per-item staff notes/photos; more than one reference photo per guide; a company-wide catalog;
  drawing regions/boxes; drag-to-reorder pins.

## 5. Data model — Odoo addon `krawings_task_manager`

Version bump to **18.0.4.0.0**. New model + additive fields:

| Model | New field | Type | Notes |
|---|---|---|---|
| **`krawings.task.item`** *(new)* | `department_id` | M2O `hr.department` | required, indexed |
| | `name` | Char | required |
| | `name_key` | Char | normalised (trimmed, lower, collapsed ws), indexed |
| | `active` | Boolean | default True; retire without deleting history |
| | *constraint* | | `unique(department_id, name_key)` |
| `krawings.task.template.line` | `is_setup_guide` | Boolean | turns on the guide UI for this task |
| | `setup_photo` | Binary (`attachment=True`) | the one reference image the pins sit on |
| | `setup_photo_filename` | Char | for mimetype/download |
| `krawings.task.template.subtask` | `pin_x` | Float | 0.0–1.0, fraction across image (edges valid) |
| | `pin_y` | Float | 0.0–1.0, fraction down image |
| | `item_id` | M2O `krawings.task.item` | `ondelete='set null'`; `name` kept for history |
| `krawings.task.list.line` | `is_setup_guide` | Boolean | copied at spawn / set on ad-hoc |
| | `setup_photo` | Binary (`attachment=True`) | **snapshot copied from template at spawn** (also set on ad-hoc) |
| | `setup_photo_filename` | Char | snapshot at spawn / ad-hoc |
| `krawings.task.list.subtask` | `pin_x` | Float | copied at spawn (already has `done`/`toggle()`) |
| | `pin_y` | Float | copied at spawn |

Server-side: constrain `pin_x`/`pin_y` to `[0,1]`; store the coordinate, portal converts to `%`.

### 5.1 Photo storage & resolution — per-day snapshot (D4)
`setup_photo` is `Binary(attachment=True)`, **never included in a normal `search_read`** (payload
fetched only through its own route), and kept **separate from the generic proof-photo attachment
list** so the two never mix.

**History is immutable (D4 = per-day snapshot):** the template line holds the current reference
photo; at spawn each daily list line gets its **own copy** of the photo. Editing the template photo
later affects **future** days only — past days keep the photo they ran with. Odoo's filestore is
checksum-addressed, so identical daily copies **share the same physical bytes** (only an extra
attachment row per day), keeping storage cost low. Because history lives on each daily line, the
template line/photo can be edited or archived without altering past guides.

The portal reads a guide's photo from **the line it's showing**: a daily list line serves its own
`setup_photo`; the manager editor serves the template line's `setup_photo`. Sudo helpers return raw
bytes + mimetype for the routes (§6.2). Images are compressed client-side to a 1280px long edge
before upload (reusing `compressImage`); the server validates decoded size + MIME.

### 5.2 Spawn / inheritance
In `KrawingsTaskTemplate._build_list_for_dept_date`, extend `line_vals`:
- add `'is_setup_guide': tline.is_setup_guide`;
- **snapshot the photo**: `'setup_photo': tline.setup_photo`, `'setup_photo_filename':
  tline.setup_photo_filename` (D4 — each day keeps its own copy; filestore dedupes bytes);
- the subtask copy gains pins: `{'name', 'sequence', 'pin_x': st.pin_x, 'pin_y': st.pin_y}`.

### 5.3 Completion state machine (centralised + locked)
A single method on `krawings.task.list.line`, `_sync_setup_guide_completion(employee)`:
1. **Lock the parent line first** (`SELECT … FOR UPDATE` / `self._cr` row lock) so two simultaneous
   final toggles cannot leave an all-checked guide stuck pending.
2. Complete the line (via the existing `mark_done` write path, attributed to `employee`) **only
   when** there is ≥1 pin **and** every pin is `done` **and** the photo gate is satisfied
   (`photo_required` false, or a proof photo exists).
3. **Reopen** (`mark_undone`) whenever a pin is unchecked after completion.

Called from: the subtask toggle path, the proof-photo upload path, and (if supported) proof-photo
deletion. For guide lines, `mark_done()` must **reject manual completion while any pin is
unchecked** (completion is pin-driven). Auto-complete never throws mid-toggle — if the photo gate
is unsatisfied it simply leaves the line pending.

### 5.4 Catalog behaviour
- `add_station_item(department_id, name)` — normalise (`trim`, collapse whitespace,
  case-insensitive via `name_key`; do **not** rely on `Char(trim=True)`, which is client-only).
  Idempotent: re-adding an existing active name returns it; re-adding an **inactive** name
  **reactivates** it (never violates uniqueness).
- **Rename** updates linked template-subtask `name`s so future spawns use the new label; names on
  **already-spawned** daily subtasks are left unchanged (history).
- **Deactivate/delete** a pinned item: pins keep their denormalised `name`; `item_id` is
  `set null`. Inactive items are hidden from pickers.

## 6. Portal (Next.js)

### 6.1 Data layer — `src/lib/odoo-tasks.ts` (+ new `src/lib/setup-guide.ts` helpers)
- Extend interfaces: `TaskSubtask` (+`pin_x`,`pin_y`), `TaskListLine`
  (+`is_setup_guide`,`has_setup_photo`), `TaskTemplateLine` (+ same, subtasks gain
  `pin_x`/`pin_y`/`item_id`/label), `TemplateLineInput` (carry the same on write).
- New functions: `listStationItems(deptId)`, `addStationItem(deptId, name)`,
  `setLineSetupPhoto(templateLineId, base64, filename)`, `getSetupPhotoBytes(lineId)`. Extend
  `upsertTemplateLine` (already round-trips subtasks) with pin coords + optional item link.

### 6.2 API routes — `src/app/api/tasks/…`
Every route enforces **capability + allowed company + department/list ownership + line↔subtask
relationship** server-side. (The portal logs into Odoo as uid 2 and uses `sudo()`, which **bypasses
Odoo ACLs/record rules** — so the Next route is the real gate; Odoo ACLs are defence-in-depth.)
- `GET/POST /api/tasks/departments/[id]/station-items` — list / add catalog items (POST:
  manager/admin, company-scoped).
- `POST /api/tasks/templates/[id]/lines/[lineId]/setup-photo` — upload reference photo (manager/
  admin; validate MIME + size).
- `GET /api/tasks/lines/[id]/setup-photo` — a daily line's **own** snapshot photo, **returned as
  raw image bytes** with `Content-Type`, marked dynamic + `no-store` (not base64 JSON). The manager
  editor reads the template line's photo the same way (via the template setup-photo GET).
- **Fix** `PATCH /api/tasks/lines/[id]/subtasks/[sid]`:
  - verify `sid` belongs to line `id`;
  - use **`resolveAttribution(user)`** (shared-tablet "Working as" employee), **not**
    `user.employee_id` — matches the `complete` route; today the toggle route uses the account
    employee, which would mis-attribute an auto-completed guide;
  - return the **resulting line state** (completed / reopened) so the screen reloads.

### 6.3 UI components
- **Shared primitive `src/components/ui/PinnableImage.tsx`** — image + absolutely-positioned
  numbered pins from `%` coords. Render with **`object-fit: contain`** and map coordinates to the
  **displayed image bounds** (never a letterboxed outer container; never `cover`, which crops and
  shifts pins). Two modes: **view** (tap pin → highlight list row) and **edit** (tap empty area →
  emit `{x,y}`). Lives in `ui/` per the shared-component rule.
- **Manager — `SetupGuideEditor.tsx`**: the `is_setup_guide` toggle, photo upload/replace,
  `PinnableImage` (edit), pick-or-add item sheet, placed-pin list with remove. **Validation:**
  cannot enable/save a guide without exactly one photo **and** ≥1 pin; replacing the photo asks for
  confirmation and **clears existing pins by default** (old coords are meaningless on a new image).
- **Staff — `SetupGuideView.tsx`** (rendered by `ChecklistCard` when `line.is_setup_guide`):
  `PinnableImage` (view) + numbered check-off list; ticking the last item shows the auto-complete
  state. **Completed guides stay reviewable** — a "Review / adjust setup" affordance lets staff
  uncheck a pin and reopen (today `ChecklistCard` renders completed tasks as static rows).
- **Design:** portal system — green `#16a34a`, dark header `#1A1F2E`; mobile-first; pins ≥ 44px
  touch target; plain language; icon+text status (no colour-only). Matches the approved mock.

## 7. Security
- `security/ir.model.access.csv` + `krawings_task_manager_security.xml`: add `krawings.task.item`
  (read for portal group, write for manager group), mirroring existing ACLs — **defence-in-depth
  only**, because portal helpers run `sudo()`.
- The enforced gate is the Next API layer: capability check, allowed-company check, and
  ownership/relationship checks on every mutating route.

## 8. Migration / versioning
- Bump `__manifest__.py` to `18.0.4.0.0`; add the new model file + `security` csv line to `data`.
- Schema is additive — Odoo creates model/fields on update; existing lines default
  `is_setup_guide = False`; **no migration script required.**
- **Verify both** a fresh install **and** `-u krawings_task_manager` from `18.0.3.1.0`.

## 9. Files to touch (from the cross-checked plan)
**Odoo addon — modify:** `__manifest__.py`, `models/__init__.py`, `task_template.py`,
`task_template_line.py`, `task_template_subtask.py`, `task_list.py`, `task_list_line.py`,
`task_list_subtask.py`, `security/ir.model.access.csv`, `security/krawings_task_manager_security.xml`,
`views/task_template_views.xml`, `views/task_list_views.xml`.
**Odoo addon — add:** `models/task_item.py`, `tests/__init__.py`, `tests/test_setup_guide.py`.
**Portal — modify:** `src/lib/odoo-tasks.ts`, `src/app/tasks/_components/photoUpload.ts`,
`AdHocModal.tsx`, `TaskRow.tsx`, `ChecklistCard.tsx`, `manager/templates/[id]/page.tsx`,
`manager/dept/[id]/page.tsx`, `staff/page.tsx`, `api/tasks/templates/[id]/lines/route.ts`,
`api/tasks/templates/[id]/lines/[lineId]/route.ts`, `api/tasks/list/[id]/lines/route.ts`,
`api/tasks/lines/[id]/subtasks/[sid]/route.ts`, `api/tasks/lines/[id]/photo/route.ts`,
`api/tasks/attachments/[id]/route.ts`.
**Portal — add:** `src/components/ui/PinnableImage.tsx`, `_components/SetupGuideEditor.tsx`,
`_components/SetupGuideView.tsx`, `api/tasks/departments/[id]/station-items/route.ts`,
`api/tasks/templates/[id]/lines/[lineId]/setup-photo/route.ts`,
`api/tasks/lines/[id]/setup-photo/route.ts`, `src/lib/setup-guide.ts`,
`tests/task-setup-guide.unit.spec.ts`, `tests/task-setup-guide.e2e.spec.ts`.

## 10. Testing / verification
- **Odoo tests** (`tests/test_setup_guide.py`): guide line spawns with pins + inherited photo;
  toggling all pins auto-completes with correct attribution + parent-line lock; unchecking reopens;
  manual `mark_done` rejected while pins remain; catalog normalise/reactivate/rename.
- **Portal:** unit test for coordinate handling; `npm run build` (catches TS errors) before restart.
- **Real-browser Playwright test on staging** (required before "done", per portal rule): manager
  (Marco, id 2) creates a guide, uploads a photo, drops + labels pins, saves; staff (Hana, id 1)
  opens today's task, checks off each item, task auto-completes; reopen by unchecking. Company 5 /
  What a Jerk.

## 11. Rollout
- Single branch `main`. Small commits (`[FEAT]`/`[FIX]`). Deploy staging:
  `-u krawings_task_manager` (from `/tmp`, docutils cwd) + portal `git pull && npm run build &&
  systemctl restart krawings-portal`. Verify on staging, then schedule prod separately (don't
  auto-touch prod).

## 12. Decisions — CONFIRMED 2026-07-18
- **D1 — catalog scope:** ✅ **per-department**.
- **D2 — completion:** ✅ **auto-complete** when all pins checked.
- **D3 — staff proof photo:** ✅ **independent and off by default** for guides (`photo_required`
  can still be turned on per task).
- **D4 — photo history:** ✅ **per-day snapshot** — each daily guide keeps its own copy of the
  photo; editing the template photo affects future days only (immutable history). Filestore dedupes
  identical bytes. (See §5.1/§5.2.)

## Codex cross-check summary
Codex (gpt-5.6-sol, high) confirmed Approach A over JSON/separate-model, and drove these
corrections now in the spec: centralised + **locked** completion state machine (§5.3); the
subtask-toggle **attribution bug** + ownership checks + returning line state (§6.2); **reopenable**
completed guides (§6.3); reference photo as `Binary(attachment=True)` kept out of `search_read`
and served as **raw bytes** (§5.1/§6.2); catalog **normalisation/reactivation/rename** rules
(§5.4); surfaced the **photo-history** choice (user chose per-day snapshot, D4); empty-guide +
photo-replace validation (§6.3); `object-fit: contain` coordinate mapping (§6.3); verify
fresh-install **and** `-u` upgrade (§8). **Usefulness: 8/10** — caught a real mis-attribution bug
and the completion race.
