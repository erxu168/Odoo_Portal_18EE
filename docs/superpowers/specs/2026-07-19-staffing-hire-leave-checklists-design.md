# Staff Lifecycle Checklists (Joining · Promotion · Leaving) — Design Spec

**Date:** 2026-07-19
**Module:** HR (Krawings Portal, `erxu168/Odoo_Portal_18EE`)
**Status:** Design — awaiting user review before implementation planning

---

## 1. Goal

Give managers/admins an operational checklist for each stage of a person's time at the
restaurant, inside the portal's HR module:

- **Joining** (hire / onboarding)
- **Promotion** (level change / "crossboarding")
- **Leaving** (termination / offboarding)

Each stage produces a checklist with a **Business** section (tasks the team does) and an
**Employee** section (tasks the person does, on their own phone). Some tasks carry an optional
deadline + **phone-push reminder**; most are plain ticks.

This mirrors how established HR platforms model the employee lifecycle (BambooHR, Rippling,
Workday) — onboarding / crossboarding / offboarding, with templates scoped by the employee's
attributes and a shared base + team add-ons to avoid duplication — but is built **natively in
the portal** so reminders reach the responsible person's phone through the portal's own push
system, including floor staff who are portal users but **not** Odoo users.

Odoo is read-only here: the portal reads employee data (name, team, level, manager, start/leave
date) from Odoo but **writes nothing back**. Checklists live entirely in the portal DB.

### Why portal-native (approach decision)

Odoo 18 EE staging **has** the activity-plan feature (`mail.activity.plan` +
`mail.activity.plan.template`, with Onboarding/Offboarding plans already defined on company 1
only, not WAJ). Its shape maps closely to this design (per-department plans, per-task delay and
responsible). **But** `mail.activity` assigns to `res.users` and reminds via Odoo email/bell;
portal users are keyed to `hr.employee` (`portal_users.employee_id`) with **no `res.users`
link**, and the portal reaches people through `sendPushToUser`. Odoo's native reminders would
not reach a new hire's phone. The user chose **portal-native**, modelled on Odoo's structure.
Mirroring tasks into Odoo's backend is out of scope (possible future one-way sync).

---

## 2. Decisions locked in brainstorming

| Decision | Choice |
|---|---|
| Lifecycle stages | **Joining · Promotion · Leaving** (three first-class stages) |
| Who the tasks are for | **Both** — a Business section and an Employee section per checklist |
| Task behaviour | **Mix** — most are plain ticks; a few carry a deadline + reminder |
| Joining / Leaving scope | **By team** — a shared **base** list everyone gets **+ a team add-on** (Kitchen / FOH / Office), merged at start |
| Promotion scope | **By target level** — one list per step-up (`→ Associate`, `→ Team Lead`), same across teams |
| Responsible for a task | **Chosen per task** in the master template |
| How a checklist starts | **Auto, with a confirm** — on hire, on a level change, and on starting a termination |
| Reminders | Portal **push** only (no email in v1), fired by an hourly cron |
| Master checklist editing | **Admins only** in v1 (managers can run & tick). Flippable — see §9 |
| Where it lives | Inside the existing **HR** module |

---

## 3. Lifecycle model

Two independent facts about a person drive different stages ("two dials"):

- **Team** (Kitchen / Front-of-house / Office) — from `hr.department` — drives **Joining** & **Leaving**.
- **Level** (Trainee / Associate / Team Lead) — the company's role ladder — drives **Promotion**.

They are **not** combined into a team×level grid. Instead:

- **Joining checklist** = `Every new hire` **base** + the employee's **team add-on**, merged into one list.
- **Leaving checklist** = `Every leaver` **base** + the employee's **team add-on**, merged.
- **Promotion checklist** = the single **level** list for the target level (`→ Associate` or `→ Team Lead`).

A person accumulates a **journey**: Joined → Promoted → … → Left. Each stage's checklist is a
separate instance and is preserved as history.

---

## 4. User-facing experience

### 4.1 Checklist Setup — master lists (admins)

New screen under HR → Manager Tools → **Checklist Setup**, grouped by stage:

- **Joining:** `Every new hire` (base) · `Kitchen` add-on · `Front-of-house` add-on · `Office` add-on
- **Promotion:** `→ Associate` · `→ Team Lead`
- **Leaving:** `Every leaver` (base) · team add-ons

Editing a list = editing its **tasks**. A team add-on shows a note that it stacks on top of the
base; only team-specific extras go in it. Each task has:

- **Title** (e.g. "Order uniform", "Set up POS PIN", "Grant cash-drawer & void permissions")
- **List section:** *Business* or *Employee*
- **Responsible:** *A specific person* (pick a portal user), *The employee's manager*
  (`hr.employee.parent_id`), or *The employee themselves* (Employee-section tasks only)
- **Deadline (optional):** N days after the reference date
- **Reminder (toggle):** meaningful only when a deadline is set
- **Order** (drag to sort within its section)

### 4.2 Starting a checklist — auto with confirm

- **Joining:** after `POST /api/hr/employees` creates the employee, `EmployeeForm`'s success
  step offers to start the Joining checklist — *"Every new hire (6) + Kitchen extras (3) = 9
  tasks"* — with the team pre-filled from `department_id`.
- **Promotion:** when the employee's **level/role** is changed upward in staff management, the
  portal offers to start the matching level checklist (`→ Associate` / `→ Team Lead`).
- **Leaving:** after a termination (`kw.termination`) is created, the leave checklist is offered.
- **Manual fallback:** a "Start checklist" action on the employee's page for any stage.
- Starting **merges** the relevant master lists, resolves each task's responsible portal user
  and deadline date, and **copies** them into a per-employee instance (snapshot). Later edits to
  a master list never rewrite existing instances.

### 4.3 Working a checklist

- **Employee page (`EmployeeDetail`):** a **journey timeline** (Joined ✓ → Promoted → Associate …)
  plus a progress card per active checklist. Opening a checklist shows two sections — **Business**
  and **Employee** — each tickable; responsible shown; deadline date shown, **overdue red /
  due-soon amber**. Ticking records who + when.
- **The employee's own HR dashboard:** a "Your tasks" list showing only their **Employee**
  tasks across active checklists, with reminders.
- **Manager "Needs attention":** overdue checklist tasks add to the existing attention badge.

### 4.4 Reminders

Hourly cron (`/api/cron/staffing-checklist-reminders`, guarded by `CRON_SECRET`, same shape as
`shift-confirm-reminders`) scans pending tasks that have a deadline **and** reminder on, and
sends a phone push via `sendPushToUser` to the resolved responsible person at staged moments
(e.g. 3 days before, on the day, once overdue). A `reminder_stage` counter makes each stage fire
**once** (idempotent).

---

## 5. Data model (new file `src/lib/staffing-checklist-db.ts`, SQLite)

Follows the portal's per-module `*-db.ts` convention (cf. `inventory-db.ts`, `issues-db.ts`).

**`checklist_templates`** — master lists
- `id`, `company_id`, `stage` (`'joining'|'promotion'|'leaving'`),
  `scope` (`'base'|'team'|'level'`),
  `department_id` (int, nullable — set when `scope='team'`),
  `target_level` (text/role id, nullable — set when `scope='level'`, e.g. Associate / Team Lead),
  `name`, `active`, `created_at`, `updated_at`
- Expected rows: one `base` per (company, joining) and (company, leaving); one `team` per team;
  one `level` per promotion target.

**`checklist_template_tasks`** — master tasks
- `id`, `template_id` (FK), `audience` (`'business'|'employee'`), `title`, `description` (nullable),
  `sequence`, `responsible_type` (`'specific_user'|'employee_manager'|'the_employee'`),
  `responsible_user_id` (nullable), `due_offset_days` (nullable), `reminder` (bool), `active`

**`checklist_instances`** — a person's live checklist for one stage
- `id`, `employee_id` (Odoo `hr.employee` id), `company_id`, `stage`,
  `department_id` (nullable — joining/leaving), `target_level` (nullable — promotion),
  `from_level` (nullable — promotion history), `reference_date` (ISO date),
  `status` (`'open'|'done'|'cancelled'`), `started_by` (portal user), `started_at`,
  `termination_id` (nullable — links a leave checklist to its `kw.termination`)

**`checklist_instance_tasks`** — a person's tasks (snapshot copy, merged)
- `id`, `instance_id` (FK), `audience`, `title`, `description`, `sequence`,
  `source` (`'base'|'team'|'level'` — for display only),
  `assignee_user_id` (nullable — resolved responsible portal user),
  `assignee_employee_id` (nullable — used for "the_employee" delivery),
  `due_date` (ISO date, nullable), `reminder` (bool),
  `status` (`'pending'|'done'|'skipped'`), `done_by` (nullable), `done_at`, `note` (nullable),
  `reminder_stage` (int, default 0)

**Merge rule (at start):**
- Joining/Leaving → tasks = base template tasks **+** the team add-on's tasks (base first, then
  add-on, within each audience section). No dedup; base and add-on tasks are distinct.
- Promotion → tasks = the single target-level template's tasks.
- Each copied task resolves responsible (§5.1) and `due_date = reference_date + due_offset_days`.

**5.1 Responsible resolution (at start):**
- `specific_user` → `responsible_user_id`
- `employee_manager` → portal user whose `employee_id` = the employee's `parent_id`; fallback = admin
- `the_employee` → portal user whose `employee_id` = this employee (Employee-section tasks only)

**Reference dates:**
- Joining → `hr.employee.first_contract_date`
- Promotion → effective date of the level change (the edit date)
- Leaving → `kw.termination.last_working_day` (fallback `letter_date`)

---

## 6. API routes (new, under `src/app/api/staffing/`)

- `GET/POST /api/staffing/templates` — list / create master lists (admin)
- `GET/PATCH/DELETE /api/staffing/templates/[id]` — one master list (admin)
- `GET/POST /api/staffing/templates/[id]/tasks` — list / add master tasks (admin)
- `PATCH/DELETE /api/staffing/templates/[id]/tasks/[taskId]` — edit / remove master task (admin)
- `POST /api/staffing/checklists` — start an instance `{ employee_id, stage, department_id?, target_level?, termination_id? }` (server merges + snapshots)
- `GET /api/staffing/checklists?employee_id=` — a person's instances + progress (for the timeline)
- `GET /api/staffing/checklists/[id]` — one instance + its tasks (two sections)
- `PATCH /api/staffing/checklists/[id]/tasks/[taskId]` — tick / skip / note a task
- `POST /api/staffing/checklists/[id]/cancel` — cancel an instance
- `GET /api/staffing/my-tasks` — the current employee's own pending Employee tasks
- `GET /api/cron/staffing-checklist-reminders?token=CRON_SECRET` — hourly reminder job

All routes go through `src/lib/auth.ts`, `getOdoo()` for employee lookups, and the existing
permission/module gates. Company-scoped via the active company.

---

## 7. Frontend (new components under `src/components/hr/`)

- `ChecklistSetup.tsx` — master lists grouped by stage (admin)
- `ChecklistTemplateEditor.tsx` — edit one master list's tasks (add/edit/reorder; base-note for add-ons)
- `EmployeeJourney.tsx` — the journey timeline + per-checklist progress cards on `EmployeeDetail`
- `EmployeeChecklistView.tsx` — the two-section (Business / Employee) tickable checklist
- `StartChecklistPrompt.tsx` — the "auto, with confirm" dialog (team/level + confirm)
- `MyLifecycleTasks.tsx` — the employee's own task list on the HR dashboard

Wiring:
- New `Screen` cases in `src/app/hr/page.tsx`; a "Checklist Setup" manager tile in `HrDashboard.tsx`;
  the employee's "Your tasks" on the staff dashboard.
- `EmployeeDetail.tsx` gets the journey timeline + checklist cards + "Start checklist" action.
- `EmployeeForm` success, the staff-management **level change**, and the termination create flow
  each render `StartChecklistPrompt`.
- Reuse shared UI (`AppHeader`, tile grid, confirmation dialog) and the Tasks module's
  template→checklist patterns.

---

## 8. Odoo integration points (read-only)

- `hr.employee`: `name`, `department_id` (team), `parent_id` (manager),
  `first_contract_date` (joining reference date), the **role/level** value (Trainee/Associate/
  Team Lead), `company_id`. The portal already manages the company's roles via `hr.job`
  (`/api/hr/jobs`) and stores the employee's role; the exact write path used by the promotion
  trigger is confirmed against staff-management during implementation.
- `kw.termination`: `employee_id`, `company_id`, `last_working_day` (leave reference date).
- `hr.department`: to populate the team picker (WAJ co6 has *Kitchen*; *Front-of-house* / *Office*
  to be added by the user).
- No writes to Odoo.

---

## 9. Permissions, gating, scope

- New module id (e.g. `staffing_checklists`) folded into HR; respects per-user module access and
  the role hierarchy (Staff < Manager < Admin).
- **Master checklist editing: admins only in v1.** Managers can start and tick checklists. One
  role gate on `/api/staffing/templates*` + the Setup tile flips this — an intentional, easily
  reversible v1 choice.
- Ticking: Business tasks → manager/admin; Employee tasks → the employee or their manager.
- Company-scoped throughout.

---

## 10. Explicitly out of scope (v1)

- E-signature tasks / `sign` integration.
- Email reminders (push only).
- Syncing tasks into the Odoo desktop backend (`mail.activity`).
- Analytics/completion dashboards.
- Transfers between teams and demotions (only upward level changes trigger a promotion checklist).
- Per-team promotion lists (promotion is by level only; team add-ons apply to joining/leaving).

---

## 11. Risks / notes

- **WAJ teams:** needs Front-of-house / Office departments created in Odoo for WAJ (Kitchen
  exists). A team with no add-on simply yields base-only.
- **Level field:** the promotion trigger depends on the employee's role/level being editable and
  readable in the portal; confirm the exact Odoo binding (role/`hr.job` vs `job_title`) early in
  implementation and centralise it in one helper.
- **Manager resolution** depends on `parent_id`; fallback to admin so tasks are never orphaned.
- **Snapshot copy** means master-list edits don't retroactively change live checklists — intended;
  surface this in the Setup screen so admins aren't surprised.
- **Reminder idempotency** relies on `reminder_stage`; the cron must be safe to re-run.
- Mobile-first per the Krawings design system; all new screens use existing tokens/components.

---

## 12. Verification (per project rules — real-browser test on staging)

1. Build passes (`npm run build`).
2. Create base + team add-ons for Joining/Leaving and `→ Associate` / `→ Team Lead` promotion
   lists for WAJ (co6), with a mix of Business/Employee tasks and some deadlines+reminders.
3. Add a test employee → confirm the Joining prompt merges base + team; verify both sections and
   the 9-task total from the mock.
4. Change the employee's level up → confirm the matching promotion checklist starts and the
   journey timeline updates.
5. Tick tasks as manager and as the employee (test users); verify permissions.
6. Start a termination → confirm the Leave checklist (base + team), deadlines from last working day.
7. Force a due/overdue task and run the reminder cron → verify a single push lands; re-run →
   verify no duplicate.
8. Playwright real-browser pass on staging before calling it done.
