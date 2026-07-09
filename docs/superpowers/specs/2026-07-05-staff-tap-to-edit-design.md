# Design: Unified tap-to-edit for the staff (employee) detail screen

**Date:** 2026-07-05
**Repo:** `erxu168/Odoo_Portal_18EE` (Krawings Portal, Next.js)
**Scope:** Manager-side staff detail screen only (`EmployeeDetail`). Staging only until Ethan says prod.
**Status:** Approved design, pending implementation plan.

---

## Problem

The manager staff detail screen has **two** edit entry points that overlap and both force a multi-step flow:

- **"Edit full profile"** → `EmployeeProfileEdit.tsx`, a **5-step wizard** (Personal → Tax → Insurance → Bank → Residence/work) you must page through even to change one field.
- **"Edit basics (name, role, contact)"** → `EmployeeForm.tsx`, a single form for name/restaurant/department/role/phone/email.

To change one piece of information the manager picks the right button, then pages through a wizard. It feels like "going through the entire process." (Note: the *manager* full-profile flow does **not** contain the 6 legal disclaimer checkboxes — those live only in the staff self-service `OnboardingWizard` → `StepConsents`. The friction here is the linear wizard, not disclaimers.)

## Goal

Replace the two buttons with **one Edit mode**. In the default (view) state the screen is a clean read-only profile. Tap **Edit** and every section becomes tappable; tapping a section opens a focused editor for **just that section**, saves, and returns. No wizard paging, no forced order, no ceremony.

Confirmed decisions (from Ethan):
1. **Everything on one screen** — one Edit flow covers all info (basics + personal + tax + insurance + bank + residence/work + documents), fully replacing both current buttons.
2. **Edit the whole section** — tapping one section opens all of that section's fields together (not field-by-field).
3. **Documents are editable** — in edit mode a manager can upload/replace a staff member's document.
4. **Manager screen only for now.** Staff self-edit (`MyProfile`) is a later phase and **must record a change history** ("staff can edit their info, but any changes will be tracked"). This design keeps the section-editor pieces reusable so that phase can plug in without a rewrite.

## Non-goals (out of scope)

- Staff self-service `MyProfile` editing and the change-tracking/audit log (explicitly Phase 2).
- **Contract & hours** stays its own button and screen (`EmployeeContract`) — separate admin/pay concern.
- **Offboard / Terminate** and **Mark as left** — unchanged.
- No new backend/API routes and no new Odoo fields. Reuse existing save paths.
- No accordion/in-place editing (rejected: higher mobile layout risk, against project CSS rules).

---

## Chosen approach (Approach A: profile view + tap-a-section-to-edit)

The read-only comprehensive view **already exists** in `EmployeeDetail.tsx` (it already renders Personal / Tax / Insurance / Residence / Gastro sections + Document cards). So this is mostly: (a) add a **Basics** section and realign the section grouping 1:1 with the editors, (b) add an **Edit/Done** toggle, (c) route each tapped section to an existing editor, (d) allow per-document upload/replace.

### View mode (default)
`EmployeeDetail` renders the header card + read-only sections + document cards exactly as today, plus a new **Basics** section. Documents remain tap-to-view. An **Edit** action appears in the `AppHeader` action slot (top-right).

### Edit mode (after tapping Edit)
- The header action flips to **Done**.
- A one-line hint appears: "Tap any section to edit."
- Each section card shows a pencil affordance and becomes a tappable button.
- Each document card becomes tappable to manage (upload/replace) instead of view.
- Tapping a section → navigate to that section's focused editor (a sub-screen, consistent with the module's existing screen-state-machine navigation). Save writes just that section via the existing API and returns to the detail screen (which re-fetches so the new value shows).

### Section ↔ editor mapping (reuse existing components)

| Section (view) | Fields | Editor component (reused) | Save path (existing) |
|---|---|---|---|
| **Basics** (new) | name, restaurant (company_id), department, job role, mobile phone, work email | `EmployeeForm` | `PATCH /api/hr/employee/[id]` |
| **Personal & address** | birthday, gender, nationality, place of birth, marital, address, emergency contact | `StepPersonal` | `PATCH /api/hr/employee/[id]` |
| **Tax** | tax ID, tax class, church tax, child allowance | `StepTax` | `PATCH /api/hr/employee/[id]` |
| **Bank** | IBAN | `StepBank` | `POST /api/hr/bank` |
| **Insurance** | SV number, Krankenkasse, type | `StepInsurance` | `PATCH /api/hr/employee/[id]` |
| **Residence & work** | start date, permit type, passport, visa/permit no + expiry, health-cert dates, Sofortmeldung | `StepResidenceWork` (extracted from `EmployeeProfileEdit`) | `PATCH /api/hr/employee/[id]` |
| **Documents** | one card per `DOCUMENT_TYPES` entry | per-document editor reusing `DocumentUploadWidget` | `GET/POST /api/hr/documents`, `GET /api/hr/documents/[id]` |

Notes:
- Currently the read-only view shows IBAN ("On file") under **Tax** and splits residence into **Residence** + **Gastro**. Realign so display sections match editors 1:1: split **Bank** out of Tax; merge **Residence** + **Gastro** into one **Residence & work** section. This keeps "tap section → editor" unambiguous (one section = one editor).
- `ResidenceWorkStep` currently lives *inside* `EmployeeProfileEdit.tsx`. Extract it to its own file `StepResidenceWork.tsx` so it can be reused standalone (and by a future self-edit phase). Its "Save & finish" button becomes "Save".
- The wizard steps (`StepPersonal/Tax/Insurance/Bank`) expose `onNext(fields)` which saves + advances. Reused standalone, `onNext` will save + return to the detail screen; primary button label reads "Save". A thin wrapper screen supplies the right callbacks so the step components themselves need minimal change (relabel primary button for standalone context; wire `onPrev`/back to return to the detail view).

### Navigation / state machine (`src/app/hr/page.tsx`)
- Add a screen for section editing, e.g. `{ type: 'employee-section-edit'; employeeId; section: SectionKey }`, rendered by a new thin router component `EmployeeSectionEdit` that maps `section` → the correct editor component and wires save→`goBack`.
- Add a screen for document editing, e.g. `{ type: 'employee-doc-edit'; employeeId; docTypeKey }`, rendered by a new `EmployeeDocumentEdit` (view current + upload/replace via `DocumentUploadWidget`).
- `EmployeeDetail` props change: remove `onEdit` + `onFullEdit`; add `onEditSection(section)` and `onEditDocument(docTypeKey)`. `EmployeeDetail` owns the local `editMode` boolean.
- Keep the existing `employee-edit` screen (used by `EmployeeOverview` "Add new", `employeeId: null`) — creating a new staff member still uses `EmployeeForm`. Only the *detail-screen* "Edit basics" entry point is removed; basics editing now flows through the section editor (which reuses `EmployeeForm`).
- Retire the `employee-profile-edit` screen + the "Edit full profile"/"Edit basics" buttons. `EmployeeProfileEdit.tsx` is removed once `StepResidenceWork` is extracted (this is the wizard we are intentionally replacing — in scope, not an unrelated refactor).

### Documents editing detail
In edit mode, tapping a document card opens `EmployeeDocumentEdit` for that `docTypeKey`: shows the current file (view) if present, and a `DocumentUploadWidget` to upload or replace. Upload posts to `POST /api/hr/documents` (creates `documents.document` in Odoo, tagged by type). On success, return to detail and re-fetch.

---

## Components / files

**New**
- `src/components/hr/EmployeeSectionEdit.tsx` — thin router: `section` → editor, wires save→back.
- `src/components/hr/EmployeeDocumentEdit.tsx` — per-document view + upload/replace.
- `src/components/hr/StepResidenceWork.tsx` — extracted from `EmployeeProfileEdit.tsx`.

**Modified**
- `src/components/hr/EmployeeDetail.tsx` — add Basics section; realign section grouping; add `editMode` + Edit/Done header action + hint; make sections/docs tappable in edit mode; swap props to `onEditSection` / `onEditDocument`.
- `src/app/hr/page.tsx` — add `employee-section-edit` and `employee-doc-edit` screens; update `EmployeeDetail` wiring; remove `employee-profile-edit` case + import.
- `src/components/hr/StepPersonal.tsx`, `StepTax.tsx`, `StepInsurance.tsx`, `StepBank.tsx` — allow a "Save" primary label and a "return" callback for standalone (section-editor) use; no change to save logic. (Exact minimal edits determined in the plan.)

**Removed**
- `src/components/hr/EmployeeProfileEdit.tsx` — replaced (after `StepResidenceWork` is extracted).

**Unchanged (reused as-is)**
- `src/app/api/hr/employee/[id]/route.ts`, `src/app/api/hr/bank/route.ts`, `src/app/api/hr/documents/route.ts`, `src/app/api/hr/documents/[id]/route.ts`.
- `src/components/ui/AppHeader.tsx`, `DocumentUploadWidget.tsx`, `DocumentViewer.tsx`.
- `EmployeeForm.tsx` (reused for both "Add new" and the Basics section editor).

---

## Conventions & constraints

- Portal design system: green `#16a34a`, `AppHeader` on every screen, `var(--fs-*)` typography (per `DESIGN_GUIDE.md` / `CLAUDE.md`). **Not** the Odoo orange system.
- Role hierarchy enforced in UI and API (Staff < Manager < Admin). This screen is manager/admin; edit affordances only for those roles. Server enforcement already handled by the company-scoped employee routes.
- Confirmation prompt before irreversible actions — editing a field is reversible (re-edit), so no extra prompt needed beyond existing behaviour; replacing a document overwrites the tagged doc, so confirm before replace.
- Build-safety pitfalls (from `CLAUDE.md`): `err: unknown` + `instanceof`; no `[...set]` spread (use `Array.from`); JSX apostrophes as `’`; unused params `_`-prefixed or removed; `npm run build` before restart, don't pipe it.
- Single-branch rule: work on `main` unless Ethan asks otherwise.

## Risks

- **Low.** No backend change; reuses proven save paths and step components. Largest churn is `EmployeeDetail` (view already exists) and extracting `StepResidenceWork`.
- Reusing wizard steps standalone: the button-label/return-callback tweak must not change the save payloads used by the onboarding wizard. Keep the steps' save logic untouched; only make the primary label + navigation callback configurable. Regression-check the self-service `OnboardingWizard` still works.
- Section-grouping realignment changes the read-only display slightly (Bank split out, Residence+Gastro merged). Verify all fields still appear.

## Phase 2 (later, not now)

- Apply the same tap-to-edit pattern to staff self-service `MyProfile`.
- **Change tracking:** every staff self-edit records who changed what and when (audit trail). Decide storage (Odoo `mail.thread` field tracking on `hr.employee`, vs. a portal-side SQLite audit log) at that time. The section-editor components built here are the reusable building blocks for that phase.

## Verification (per project process)

- `npm run build` passes (no TS/lint errors).
- Manual on staging (`portal.krawings.de`, manager test user Marco Bauer / employee_id 2, company What a Jerk):
  1. Open a staff member → confirm all sections render with values (view mode), Edit is top-right.
  2. Tap **Edit** → sections + docs show as tappable, button reads **Done**.
  3. Edit **Basics** (change role) → Save → returns, new role shows.
  4. Edit **Tax**, **Personal**, **Insurance**, **Bank (IBAN)**, **Residence & work** → each saves and re-displays correctly.
  5. Tap a document in edit mode → upload/replace → returns, card shows "Uploaded".
  6. **Done** → back to clean view mode.
  7. Confirm "Edit full profile" / "Edit basics" buttons are gone; "Contract & hours", "Offboard / Terminate", "Mark as left" still work.
  8. Regression: staff self-service `OnboardingWizard` still completes end-to-end (steps unchanged).
- Real-browser Playwright test on staging before calling it done (project rule).
- Update `STATUS.md`; update `MEMORY.md` if a new rule/feedback emerges.
