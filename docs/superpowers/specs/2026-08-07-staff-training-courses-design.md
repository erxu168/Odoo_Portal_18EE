# Staff Training — courses, chapters, questions, certificates

**Date:** 2026-08-07
**Status:** design approved from mock; not built
**Mock:** https://claude.ai/code/artifact/2a8e4cd3-7698-44cd-ad0d-2b43a19a1df1
**Owner decisions captured in interview:** see §2

---

## 1. What this is

Grow the existing guide library into a training tool whose first job is **getting new hires
productive faster**, and whose second job is **holding the §43 food-hygiene certification** the
business is legally required to give and document.

A **course** arranges guides that already exist into **chapters**. A guide can carry a few
**questions**; answering them is what marks it done. Progress is tracked per person, and a
manager screen shows who has gone quiet. Hygiene is the same machinery with three extra
settings — a pass mark, a validity period, and a certificate.

### What already exists (verified 2026-08-07)

| | |
|---|---|
| `krawings.task.guide` | reusable library: name, company, published, revision, ordered steps |
| `krawings.task.guide.step` | photo / PDF / YouTube / tip + explanation, note-pins, drawings |
| `GuidedTutorialPlayer` | full-screen viewer, 3 source kinds, **no route, no progress** |
| `/tasks/training` | flat searchable list of published guides, read-only playback |
| Guide → task link | `krawings.task.template.line.guide_id`, snapshotted onto each day at spawn |
| Staging data | 12 guides (3 published), 36 steps |

### What exists but is unused (verified 2026-08-07)

- **HR joining checklist** (`staffing_templates` / `staffing_instances`): 0 active templates,
  0 template tasks, 3 joining instances all cancelled.
- **Odoo eLearning hygiene course** (`erxu168/krawings`, module `krawings_food_hygiene_course`,
  deployed 2026-06-29): 3 course variants (bilingual / EN / DE), 10 article slides + 1
  certification each; certification survey is 20 questions, `scoring_with_answers`, **80% pass**,
  unlimited attempts. Enrolled partners: **Administrator and OdooBot only. Zero certifications.**
- Its refresher cron (`ir.cron` 79, daily, active) schedules a To-Do for the course
  *Responsible*, which was never set and therefore **defaults to OdooBot — nobody has ever
  received one.** Validity 24 months (`§43 IfSG Folgebelehrung`), reminder lead 30 days, both
  `ir.config_parameter`.

**Consequence:** moving hygiene into the portal is a content re-type, not a data migration.

---

## 2. Decisions taken (owner, 2026-08-07)

| Question | Decision |
|---|---|
| What problem | Get new hires working faster |
| Where chapters sit | **Course → Chapter → Guides.** Guides unchanged and still task-linkable |
| Proof of learning | A short quiz |
| Who writes questions | Claude drafts from guide content; owner edits |
| Enrolment | **Automatic on joining, plus a browsable library** |
| Quiz level | **On the guide** (so the same questions serve a course and a task) |
| Failing / stalling | Unlimited retries, no notifications; a manager board shows who is behind |
| "Behind" means | **No activity for N days** (N is a setting), not a deadline |
| Hygiene course | **Move it into the portal**, with certificates |

### Decisions taken by Claude, flagged to the owner and not objected to

1. **Training becomes its own module** with a dashboard tile and drawer entry — not a tab inside
   Task Manager. Today `/tasks/training` is reachable only from a link inside the task list.
2. **Courses and chapters get canonical, linkable URLs** (binding Canonical Record Page Rule).
3. **Progress lives in Odoo**, not portal SQLite — a record of who passed what is the thing here
   most likely to outlive the portal and be shown to an authority.
4. **Order lives on the course↔guide link**, so one guide can be chapter 2 of course A and
   chapter 5 of course B.
5. **Passed stays passed.** Editing a guide does not reopen it for people who already passed; the
   record stores which revision they passed.
6. **Guides are not locked in order.** The screen shows what is next; nothing blocks jumping.
7. **A guide with no questions completes on reaching its last step**, so writing a new guide is
   never blocked on writing questions.
8. **Reading a guide from a daily task does not count toward course progress** (the daily copy is
   frozen and does not carry its source guide id). Revisit later.
9. **A lapsed hygiene certificate does not block rostering.** Stopping someone working has
   employment consequences and must not be a side effect of a training screen.

---

## 3. Roles and permissions

| Role | Can |
|---|---|
| Staff | See courses they are enrolled in; browse published courses; play guides; answer questions; see and save their own certificates |
| Manager | Everything staff can, plus: build and publish courses, set enrolment rules, see the progress board and the hygiene validity board for their companies, print certificates, enrol/remove a person by hand |
| Admin | Everything, across all their companies, plus the module's settings (stall threshold) |

- New capability keys, registered in `src/lib/permissions.ts` alongside the existing
  `tasks.*` keys: `training.course.manage`, `training.progress.view`.
- **Company scoping is the only tenancy boundary.** The portal's Odoo calls run as one fixed
  sudo account, so Odoo record rules do not enforce tenancy — every new route must scope by
  `parseCompanyIds(user.allowed_company_ids)` and fail closed, following
  `portal_read_guide`'s shape (empty scope ⇒ refuse).
- Every route that takes a chapter / question / progress id must resolve its parent server-side
  and assert BOTH, mirroring `guide-refresh/route.ts` — authorising one record while writing
  another is how a real hole happened in this repo.

---

## 4. Main flow — a new hire

1. Yuki is added to the Kitchen department at What a Jerk.
2. An enrolment rule matches (`Kitchen @ WAJ → New Kitchen Staff`); an enrolment record is
   created with her start date. Nobody had to remember.
3. She signs in on the shared kitchen tablet and taps **Working as → Yuki**.
4. Training shows her course: 4 chapters, 11 guides, a progress bar, and one green
   **Continue** button naming the next unfinished guide.
5. She taps it. The existing player opens on the live library guide.
6. She reaches the last step.
   - **No questions on this guide** → it is marked done; she returns to the course.
   - **Questions** → they are presented one at a time.
7. She answers. All correct (job-skill course) or ≥ pass mark (certification course) ⇒ passed,
   guide marked done, attempt recorded, next guide offered.
8. When every guide in every chapter is done, the course is complete. If the course issues a
   certificate, it is generated and she can save it as a PDF.

## 5. Alternative and error flows

| Situation | Behaviour |
|---|---|
| Wrong answer | Says which question, names the step that covers it, offers **Re-read step N** and **Try again**. Never reveals the correct answer. |
| Repeated failure | Nothing escalates. Unlimited attempts. Manager sees stalling on the board. |
| Abandons mid-guide | Progress is per guide, not per step. Reopening starts the guide again; nothing is lost because nothing partial was recorded. |
| Guide edited after she passed | She stays passed. Her record names the revision she passed. Manager board can show who passed an older revision. |
| Guide unpublished / removed from a course | It disappears from her course and the totals shrink. Her existing pass record survives. |
| Guide deleted while someone is mid-course | Blocked, as guide deletion already is when a guide is used by N tasks — extended to "used by N courses". |
| Course unpublished | Enrols nobody new; existing learners keep access to what they started; it vanishes from the library. |
| Not enrolled, browsing the library | Can start any published course for their company. Same progress machinery. |
| Manager previews a course | **Never recorded.** Explicit read-only flag on the player source, mirroring `isPreview` on TaskRow. |
| Shared device | Attribution goes through the existing `resolveAttribution` (`src/lib/shift-attribution.ts`). Without it every completion is credited to the tablet's own account. **Blocking requirement, not a nicety.** |
| Offline / request fails | The player already fails closed with a retry. Answers are submitted in one request per attempt; a failed submit is retried, never silently dropped. |
| Two managers editing one course | Optimistic concurrency on a course `revision`, same 409 shape the guide editor uses. |

---

## 6. Data model

All new models in `krawings_task_manager` (the addon that owns guides). Nothing existing changes
shape; the guide/step aggregate and the daily snapshot path are **not touched**.

```
krawings.training.course
  name, company_id, published, revision, description
  certificate (bool), pass_mark (int %, 100 = every answer),
  validity_months (int, 0 = never expires), reminder_lead_days (int)
  chapter_ids, enrolment_rule_ids

krawings.training.chapter
  course_id, sequence, name
  guide_link_ids

krawings.training.chapter.guide          # the ordered link
  chapter_id, guide_id, sequence
  _sql_constraints: unique(chapter_id, guide_id), unique(chapter_id, sequence)

krawings.training.question               # hangs off the GUIDE, not a step
  guide_id, sequence, text, explain_step  # explain_step = 1-based POSITION, not a step id
  answer_ids
krawings.training.answer
  question_id, sequence, text, is_correct

krawings.training.enrolment
  course_id, employee_id, company_id, source (auto|manual|self)
  started_at, completed_at, certificate_ref, certified_at, valid_until
  last_activity_at                       # drives "stalled" — see below

krawings.training.progress
  enrolment_id, guide_id, passed_at, guide_revision

krawings.training.attempt
  enrolment_id, guide_id, attempted_at, employee_id, score, passed
  answer_json                            # what they picked, for the record

krawings.training.enrolment.rule
  course_id, company_id, department_id (nullable = whole company)
```

**What counts as activity** (`last_activity_at`): opening a guide inside the course, or
submitting an attempt. Not: opening the course screen. Someone who opens the app, looks at the
list and closes it has not made progress, and treating that as activity would hide exactly the
person the board exists to surface.

**Why questions hang off the guide, not a step:** `portal_save_guide` is an atomic aggregate
rebuild — it `unlink()`s every step and recreates them, so **every step id is destroyed and
reissued on every save**. Anything keyed on a step id is orphaned the first time the guide is
edited. `explain_step` therefore stores a 1-based position. If the author reorders steps the
pointer can become wrong; that is a content problem the author can see and fix, not silent data
loss.

**Why progress is not on the guide or the daily snapshot:** the daily snapshot is disposable —
`portal_refresh_today_guide` unlinks and replaces it wholesale. Progress must never live on the
replaceable side.

---

## 7. Screens

| Screen | Route | Who |
|---|---|---|
| Training home | `/training` | all — enrolled courses first, then the library |
| Course (learner) | `/training/courses/[id]` | all — chapters, ticks, Continue |
| Questions | inside the player | all |
| My certificates | `/training/me` | all |
| Progress board | `/training/manage` | manager |
| Hygiene validity board | `/training/manage/certificates` | manager |
| Course builder | `/training/manage/courses/[id]` | manager |
| Question editor | inside the guide editor | manager |

Every screen uses `ui/AppHeader`, `ui/PrimaryButton`, `ui/KpiRow`/`KpiChip`,
`ui/ActionGrid`/`ActionCard`, `ChromeIcons` per DESIGN_GUIDE. Blue is headers only; green is
the one interactive colour; status is never colour-only.

### The "it never completes anything" contract must be retired together

The promise that a guide never completes anything is asserted in **five** places and all five
change in the same commit, or the app contradicts itself:

1. `GuidedTutorialPlayer.tsx:11-22` (header comment)
2. `task_guide.py:20-30`
3. `task_guide_step.py:156-157`
4. `task_list_line.py` `mark_done` comment
5. **On screen to staff:** "This just shows you how — you still tick the task off yourself"
   (`GuidedTutorialPlayer.tsx:455-466`)

Note the distinction that survives: a guide still never completes a **task**. It now completes a
**training item**. Point 5's wording must be kept for the `daily` source kind and changed only
for the training kind.

---

## 8. Stage 2 — hygiene and certificates

Same machinery, three settings, plus a certificate and a clock.

- **Pass mark 80%** of 20 questions (matching the existing survey exactly, so the standard does
  not change), versus 100% for job-skill courses.
- **Validity 24 months** from the pass date (§43 IfSG *Folgebelehrung* cadence).
- **Reminder 30 days** before lapse, to the **managers of that company** via the portal's
  existing `notifyManagers` path — explicitly not an Odoo activity, which is where the current
  reminder disappears.
- **Certificate**: bilingual on one page — name, course, pass date, valid-until, score, employer,
  and a reference that resolves to the stored attempt. Saveable as a PDF; managers can print all
  current ones as one document.
- **Enrolment rule is the whole company**, not a department — everyone who handles food.

### Legal wording (must appear on the certificate)

> This is the employer instruction (*Folgebelehrung*), not the health office one. The first-time
> *Erstbelehrung* from the Gesundheitsamt is a separate certificate the employee brings before
> their first shift.

Getting this wrong is an error that only surfaces during an inspection. It is printed on the
certificate itself, not buried in a help page.

### Content migration

10 lessons + 20 questions × (EN, DE) are re-typed into a portal course. Both languages appear
together in one lesson, which is what the Odoo course already does and what suits a mixed team.
No completion records exist to migrate. The Odoo course is left installed but unpublished once
the portal one is live, so the old URLs stop being a second source of truth.

---

## 9. Acceptance criteria

**Enrolment**
- *Given* a rule `Kitchen @ WAJ → New Kitchen Staff` and a published course, *when* an employee
  is added to Kitchen at WAJ, *then* an enrolment exists for them dated their start date.
- *Given* a draft course, *when* the same happens, *then* no enrolment is created.

**Learning**
- *Given* a guide with no questions, *when* a learner reaches its last step, *then* it is marked
  passed.
- *Given* a guide with 3 questions on a 100% course, *when* the learner answers 2 correctly,
  *then* it is not passed, the failed question names its step, and an attempt is recorded.
- *Given* a certification course at 80% with 20 questions, *when* the learner scores 16, *then*
  it is passed.

**Attribution**
- *Given* a shared device with "Working as Yuki", *when* a guide is passed, *then* the attempt
  and progress name Yuki, not the device account.
- *Given* a manager previewing a course, *when* they page through a guide, *then* no attempt,
  progress or enrolment row is written for them.

**Scope**
- *Given* a manager whose companies are `[6]`, *when* they request a course in company 2,
  *then* 404 — not 403, and no existence is leaked.

**Certificates**
- *Given* a certification course with validity 24 months, *when* a learner passes on 2026-08-07,
  *then* `valid_until` is 2028-08-07 and the certificate renders both languages.
- *Given* a certificate lapsing on 2026-09-06 and a 30-day lead, *when* the cron runs on
  2026-08-07, *then* the company's managers are notified once, not repeatedly.

**Stalling**
- *Given* a stall threshold of 3 days, *when* a learner's `last_activity_at` is 6 days ago and
  the course is unfinished, *then* they appear under "Needs a look" and nowhere else.

**Content changes**
- *Given* a learner passed guide G at revision 4, *when* the manager saves G (revision 5),
  *then* the learner stays passed and the record still names revision 4.

---

## 10. Risks carried from the subsystem audit

1. **Guide save destroys step ids.** Nothing may key on them. (Handled: `explain_step` is a position.)
2. **Daily snapshot is disposable.** No progress may live on it. (Handled: separate models.)
3. **Shared-tablet mis-attribution.** Blocking requirement, §5.
4. **Manager preview writing records.** Blocking requirement, §5.
5. **No test suite exists.** `tests/__init__.py` imports `test_setup_guide`, which does not
   exist, so the addon's tests do not run at all. This build adds the first real tests in the
   addon: enrolment matching, pass/fail arithmetic, attribution, and company scoping.
6. **Catalogue scaling.** `/api/tasks/training/guides` loads the whole library and filters in JS.
   Fine at 12 guides; a course catalogue with progress per person needs server-side filtering.
7. **Legacy per-task guide save path** (`portal_save_guide` on `krawings.task.template.line`)
   is still live and is a second way to write guide content. Out of scope here, but it means two
   save paths must both stay question-aware. Retiring it is a separate decision.

---

## 11. Open assumptions

- The owner edits two drafts before this is useful: the questions for all 12 guides, and a first
  "New Kitchen Staff" course. **This is the single biggest risk to the feature being used** — the
  onboarding checklist is empty for exactly this reason.
- Stall threshold default 3 days; owner tunes it after seeing real behaviour.
- Certificates are generated on demand from the stored record rather than stored as files, so a
  wording correction re-renders every certificate rather than leaving old PDFs wrong.
- German and English appear together in one lesson (as today), rather than as true Odoo
  translations with a language switch.

---

## 12. Implementation order

Each step is independently deployable and reversible.

1. **Models + company-scoped read APIs.** Course, chapter, link, question, answer. No UI.
2. **Question editor** inside the existing guide editor. Authoring can start immediately.
3. **Course builder** — chapters, drag guides in, publish. Manager only.
4. **Learner course screen + progress/attempts.** Includes attribution and the preview guard.
   Retire the "never completes anything" wording in the same commit.
5. **Enrolment rules + automatic enrolment on join.**
6. **Manager progress board** (stalled first).
7. **Stage 2:** pass mark, validity, certificate render, hygiene content, validity board,
   reminder cron.

Steps 1–6 are stage 1. Step 7 is stage 2 and gets its own review before it starts.
