# 2026-08-08 — Closing Shift Report — design + §20 pre-coding record

Signed off by Ethan on the clickable mock:
https://claude.ai/code/artifact/e6168c87-6ff1-45ab-805a-8347b0bdcc74

## 1. Feature summary

A short end-of-night questionnaire, **one report per hr.department per night** per
restaurant. Staff answer manager-defined questions (yes/no, choose-one, rating 1–5,
optional short text). Answers a manager marked as a "problem" require a note and allow
photos, and are highlighted red for managers. Managers review by date, turn a flagged
answer into an ad-hoc Task Manager task with one tap, and see trends. Optional 08:00
morning email listing departments that missed last night (per-company toggle, default OFF).

Own portal module (`closing-report`), Shift Handover architectural pattern (portal
SQLite; Odoo only for departments + task creation). Normal chrome (not full-screen).

## 2. Roles

- **staff** — fill in / correct their department's report; read it after submit.
- **manager / admin** — everything staff can, plus review screen, trends, question
  builder, settings (morning email), delete a bogus report.
- Shared-tablet station accounts must have a resolved PIN actor for any write
  (same rule as Shift Handover).

## 3. Entry points

1. Dashboard tile + drawer entry (automatic from `modules.ts` registry; promoted via
   `PROMOTED_TILE_IDS` so saved tile orders surface it).
2. **Card at the bottom of the daily checklist on `/tasks/staff`** (after the day-part
   sections, always visible even when Closing has no tasks). Shows "Fill in Closing
   Report" or "Report submitted ✓ by <name>". Hidden entirely if the user lacks the
   `closing-report` module (card self-hides on 403).
3. Managers: "Review" link on the module's own screen header (role-gated).

## 4. The night boundary ("operational date")

`closingOperationalDate(now)` = Berlin calendar day, **minus one day when the Berlin
hour is < 05:00**. A close finished at 00:30 belongs to the previous evening. The same
boundary is the **edit lock**: the submitter may correct the report until 05:00 Berlin
after the night it belongs to; then it is immutable.

## 5. Data model (SQLite, `data/portal.db`)

- `closing_questions` — template. `id, company_id, department_id, position, text,
  qtype ('yes_no'|'choice'|'rating'|'text'), options_json (choice only),
  problem_values_json (answer values that flag), active, created_at, updated_at`.
  Template edits affect future reports only.
- `closing_reports` — `id, company_id, department_id, department_name, report_date
  (YYYY-MM-DD Berlin), submitted_at, submitted_by_user_id, submitted_by_name,
  updated_at`. `UNIQUE(company_id, department_id, report_date)` — the one-per-night
  rule, enforced by the DB, race-safe.
- `closing_answers` — **snapshot**: `id, report_id, question_id (informational),
  position, question_text, qtype, options_json, value, is_problem (0/1), note`.
  Later template edits never rewrite a submitted report.
- `closing_photos` — Shift Handover pattern: data-URL TEXT column,
  `filterValidPhotos`-style validation (max 3/answer, `data:image/` only, size cap).
- `closing_settings` — `company_id PK, missing_email_enabled (default 0)`.
- `closing_email_log` — `UNIQUE(company_id, report_date)` claim so the cron can never
  double-send.

## 6. API (`/api/closing-report/*`) — every route: `moduleForbidden('closing-report')`
then module-local `authorize(cap)` (PIN-actor aware), then company scoping via
`resolveCompany` (query → `kw_company_id` cookie → scope check, fail closed).

| Route | Method | Cap | Notes |
|---|---|---|---|
| `questions` | GET | view | active questions for a department (fill screen) |
| `manage/questions` | GET/POST | manage | list all / add |
| `manage/questions/[id]` | PATCH/DELETE | manage | edit / delete (delete = hard; snapshots keep history) |
| `manage/questions/reorder` | PUT | manage | positions array |
| `report` | GET | view | `?department_id&date` → report+answers+photos, or null |
| `report` | POST | submit (resolved actor) | validates: every non-text question answered; flagged answer ⇒ non-empty note; UNIQUE conflict ⇒ 409 "already submitted" |
| `report/[id]` | PUT | submit | only the submitter, only before the 05:00 lock |
| `report/[id]` | DELETE | manage | manager removes a bogus report (confirm dialog) |
| `review` | GET | review | `?date` → per-department cards: report or missing; departments = those with ≥1 active question |
| `trends` | GET | review | `?department_id&days` → submission rate, avg rating per night, problem counts |
| `create-task` | POST | review | `{report_id, answer_id, name}` → `ensureListForDeptDate` + `addAdHocLine` (mid_day); stores `task_line_id` on the answer so the button flips to "Task created" and is idempotent |
| `settings` | GET/PUT | manage | morning-email toggle |
| `/api/cron/closing-report-missing` | GET | `?token=CRON_SECRET` | 08:00 Berlin: for each opted-in company, departments-with-questions minus reports for last night → email managers; claim row prevents double-send |

## 7. Capabilities (`permissions.ts`)

```
closing.view    staff+manager+admin   See closing reports
closing.submit  staff+manager+admin   Fill in / correct the report
closing.review  manager+admin         Review reports, trends, create follow-up tasks
closing.manage  manager+admin         Edit questions, settings, delete a report
```

## 8. Screens (`src/components/closing-report/`, routes under `src/app/closing-report/`)

- `/closing-report` — staff fill/read screen. Department = the actor's department when
  known, else picker over departments-with-questions. All states: no questions
  configured (explain + who to ask), unanswered validation, flagged-answer note
  (required) + photos (`PhotoCaptureStrip`, four-way rule), submitted read view with
  lock countdown, locked view, 409 recovery (someone else submitted first → reload into
  read view).
- `/closing-report/manager` — review by date (‹ date ›), per-department cards, problem
  answers on top in red with note + photos + Create task, missing card, delete via
  `useConfirm`.
- `/closing-report/manager/trends` — stat tiles + rating-per-night bars + recurring
  problem counts, department switcher.
- `/closing-report/manager/questions` — per-department builder: add/edit/delete/
  reorder (`DragRow`), qtype picker, choice options editor, problem-answer marking,
  "changes apply from the next report" note, morning-email toggle, empty state offers
  a one-tap starter set (seeded per department on demand, never automatically).
- Layout: `src/app/closing-report/layout.tsx` with `ModuleGate` (+ FOLDERS entry in
  `tests/module-access.unit.spec.ts`).

## 9. UX rules honored

Immediate feedback after every mutation (optimistic updates + `Toast`), no scroll jump,
`useConfirm` before deletes, one green `PrimaryButton`-style CTA per screen, plain
language, photo inputs via the shared conformant components, mobile-first 390px.

## 10. Acceptance criteria (abridged Given/When/Then)

- Given no report tonight, when staff answer all questions and submit, then the report
  is stored with snapshots and the tasks-page card flips to "submitted ✓" immediately.
- Given a flagged answer without a note, when submitting, then submit is blocked with
  an inline message on that question.
- Given two devices submitting for the same dept+night, then exactly one succeeds and
  the other lands on the read view (409 handled).
- Given a report older than the 05:00 lock, when the submitter opens it, then no edit
  UI is offered and the PUT is rejected server-side.
- Given a flagged answer, when a manager taps Create task, then an ad-hoc task exists
  in that department's list for today and the button cannot create a second one.
- Given the toggle ON and a department with questions but no report, when the 08:00
  cron fires, then managers of that company get one email, exactly once per night.
- Given a user without the module, then the tile, drawer entry, tasks-page card and
  every API route deny (server-side, not just hidden).

## 11. Open assumptions

- Follow-up tasks land in day-part **opening** with no deadline (visible first thing
  when the morning team opens the list; adopted from the Codex cross-check).
- "Departments that must submit" = departments with ≥1 active question (a manager opts
  a department in by giving it questions).
- Morning-email recipients = active portal users with role manager/admin scoped to the
  company.
- Trends "rating per night" averages all rating-type answers of that department's night.
