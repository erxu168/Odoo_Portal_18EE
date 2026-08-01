# Guided Tutorials → reusable Library (design)

**Date:** 2026-07-31 · **Status:** approved for build · Extends the shipped guided-tutorials feature.
Mock (signed off): https://claude.ai/code/artifact/00003d69-78d6-404f-bb98-6f62ffffea29 · Codex plan: scratchpad/codex-library-plan.md (9/10).

## Locked decisions (Ethan, 2026-07-31)
- **Everything in the library:** a guide is a STANDALONE, named, per-company item; a task **links** one (many tasks → one guide). Edit once → updates everywhere. The existing per-task "Grill Station Setup" becomes a library guide its task links to.
- **Staff Training area:** browse/search all PUBLISHED guides and open the player, no task needed.
- **#3 Attachments:** KEEP the task "Attachments" box but relabel it "Reference files · quick single files" + a hint pointing to guides for how-tos.
- Guides are **per-restaurant (company)**; editing is **shared/live**; each day's spawned task still **freezes** its snapshot (history intact).

## Data model (adopt Codex's design)
**New `krawings.task.guide`** (models/task_guide.py): `name` (Char req, index), `company_id` (req, ondelete=restrict), `published` (Bool), `revision` (Int, copy=False), `step_ids` (O2m guide.step 'guide_id', copy=True), `step_count` (stored computed), `template_line_ids` (O2m template.line 'guide_id') + `template_line_count` ("Used by N tasks"). Name NOT unique.

**`krawings.task.guide.step`**: replace editable parent `template_line_id` → `guide_id`; keep `list_line_id` (daily snapshot). Rename `source_template_step_id` → `source_guide_step_id`. Parent constraint `guide_id XOR list_line_id`; `unique(guide_id, sequence)` + keep `unique(list_line_id, sequence)`. Media/pins unchanged. (During the expand window template_line_id is kept nullable/legacy so the registry loads pre-migration; dropped in the contract migration.)

**`krawings.task.template.line`**: add `guide_id` (M2o guide, ondelete=restrict, index). Remove authoritative guide_step_ids/guide_published/guide_revision → replace with read-through relateds: `guide_name`, `guide_published`, `guide_step_count`, `has_guide = guide_id.published and guide_id.step_count>0`. Constraint: `template_id.company_id == guide_id.company_id`. Copying a line copies the LINK, not the guide.

**`krawings.task.list.line`** (daily): keep guide_step_ids/guide_snapshot_revision/guide_step_count/has_guide + add audit `guide_source_id` (M2o guide, ondelete=set null) + `guide_source_name` (Char, survives library deletion). Playback reads ONLY list-owned snapshots — never dereferences source refs.

## Publish / completeness / revision → move to the guide
`_check_published_guide_complete` + `portal_read/save/delete_guide` move from template.line to `krawings.task.guide`. `portal_save_guide` is guide-level: lock guide FOR UPDATE → revision check (409) → snapshot kept bytes by step id → rebuild+normalize → validate publish state → bump revision once. Attach/detach does NOT bump revision. Direct writes revalidate+bump.

## Spawn (task_template.py)
For a line with `guide_id` published: lock+read its revision, deep-copy its steps+pins into daily list-owned steps, set `guide_snapshot_revision=guide.revision`, `guide_source_id`/`guide_source_name`, `source_guide_step_id` per step. Unpublished/absent → no snapshot, revision 0, no button. Existing daily snapshots untouched.

## Migration (expand-migrate-contract; 18.0.8.0.0 then later 18.0.9.0.0)
Expand: keep step template_line_id nullable + loosen parent constraint so registry loads. Migrate (18.0.8.0.0 post): preflight line 41 "Grill Station Setup" (company from template, published, 1 photo step + 2 pins); **capture verification data for every daily snapshot** (ids, media, pins, revision, completed_at/by, legacy audit); create 1 library guide (name/company/published/revision from the line); **MOVE the existing source step in place** (set guide_id, clear template_line_id — preserves step id ⇒ its ir.attachment + daily source refs stay valid); set line.guide_id; backfill `source_guide_step_id = source_template_step_id` on daily steps; backfill daily `guide_source_id/name`; **write NOTHING on daily content/completion**; re-run the verification query and ABORT if any daily tuple changed; log. Contract (18.0.9.0.0, after portal cut over): drop legacy template_line_id + old line guide columns + source_template_step_id, tighten constraint.

## API reshape
- **Library (manager, requireRole('manager') + company):** `GET/POST /api/tasks/guides`, `GET/PUT/DELETE /api/tasks/guides/[guideId]`, `GET .../[guideId]/steps/[stepId]/media`. DELETE only if unused (else "Used by N tasks; detach first").
- **Attach/detach:** repurpose `/api/tasks/templates/[id]/lines/[lineId]/guide` → GET link metadata `{guide_id,name,published,revision,step_count}`; PUT/PATCH `{guide_id: number|null}` to attach/detach (no content, no shared delete).
- **Staff Training:** `GET /api/tasks/training/guides` (published, company scope), `GET .../[guideId]`, `.../[guideId]/steps/[stepId]/media`. Drafts → 404 for staff.
- **Daily (unchanged):** `/api/tasks/lines/[id]/guide` + media (list-owned only).
- Every media route now takes parent id + step id and verifies step-belongs-to-parent (closes a same-company step-id substitution gap).

## Portal components
`task-guide.ts` → LibraryGuideSummary/LibraryGuide + listLibraryGuides/read/create/save/delete + attachGuideToTemplateLine + readListGuide. Editor takes `guideId`. Player takes a source union `{kind:'daily',lineId}|{kind:'library-manager',guideId}|{kind:'training',guideId}`. New pages `/tasks/manager/training` (library CRUD) + `/tasks/training` (staff browse) + nav (ManagerTabs, BottomNav). Template-line modal → guide picker (attach/detach/open/create-then-attach). Relabel Attachments (#3).

## Security
ACLs for guide (user read; hr_manager RCUD). Record rules: guide `company_id in company_ids`; step/pin via guide-company or daily-list-company; daily readonly via list_line_id. Portal RPCs + routes verify allowed_company_ids (sudo bypasses rules → defense in depth). Fail closed on company-less.

## Edge cases
Delete used guide → reject (ondelete=restrict + app msg). Delete unused → cascade steps/pins; daily snapshots remain (source refs null). Unpublish → out of Training + no future snapshots; existing daily visible. Publish after today's spawn → not retrofit. Detach → future spawns only. Concurrent edit/spawn → guide row locks = one coherent revision. Cross-company attach / media id substitution → reject. Template delete → removes link, not the guide.

## Phases (each: build → tsc/py → Codex → staging -u + Playwright)
1. Odoo: guide model + step re-parent + line link + move publish/completeness/revision + security. 2. Migration 18.0.8.0.0 (expand+migrate, verified). 3. Spawn from linked guide + API reshape (library CRUD, attach/detach, training). 4. UI: Library page, task picker, Training page, nav, #3 relabel, editor(guideId)/player(source union). 5. Tests (Odoo + e2e) + deploy + Playwright. (Later: 18.0.9.0.0 contract cleanup.)

## Acceptance test
Two template lines link the same guide; an edit shows immediately in Training and both task configs; tomorrow's spawned tasks carry the new revision; all previously-spawned daily lines keep byte-for-byte identical guide + completion data.
