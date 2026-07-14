# Portal Staff Management — Phase 1: Add / Edit / Deactivate (+ Terminate) — Design Spec

**Date:** 2026-06-28
**Status:** Approved (design), building
**Repo:** erxu168/Odoo_Portal_18EE (Next.js portal) — staging only until prod is requested
**Roadmap:** Phase 1 of 4 (this) → Departments & roles → Contracts & hours → Time off. Related: [[portal_account_provisioning]] (invites).

---

## 1. Goal
Let admins/managers **manage staff from the portal** instead of Odoo: add a new employee, edit their details, deactivate leavers, and start the formal **termination** flow — all from the existing **HR → Employees** area. Odoo stays the system of record; the portal writes to it.

## 2. Permissions (locked)
- **Admins:** manage any staff, any restaurant.
- **Managers:** only staff in **their own restaurant(s)** = the portal user's `allowed_company_ids`.
- Enforced **server-side** (create/edit/deactivate validate `company_id ∈ allowed`; list is scoped) AND in the UI (company picker sourced from the already-scoped `/api/companies`). Pattern to reuse: `src/app/api/shifts/_manager.ts` `requireManagerCompany`, and `parseCompanyIds(user.allowed_company_ids)` from `src/lib/db.ts`.

## 3. The Add / Edit form (essentials)
Fields written to `hr.employee`:
- `name` (required — record name)
- `company_id` (required by Odoo; scoped picker from `/api/companies`)
- `department_id` (**required by Odoo** — necessary beyond the bare "essentials"; a dropdown filtered to the chosen company)
- `job_title` (Char, optional — free text "job role"; the richer `job_id` picker comes in the Departments & roles phase)
- `work_email`, `mobile_phone` (optional)

Detailed personal/tax/bank fields stay out — those come from the employee via onboarding. On **Add** success, offer **"Send portal invite"** (reuse the invite feature) so add→invite is one flow.

## 4. Deactivate vs Terminate (merge)
- **Deactivate ("Mark as left"):** quick archive — `write('hr.employee',[id],{active:false})` after a confirm. For trial no-shows etc. (Reactivate available via `{active:true}`.)
- **Terminate (formal offboarding):** merge the existing termination tool in — an **"Offboard / Terminate"** button on the employee page deep-links into the existing `TermWizard` with the person pre-selected. The termination flow already links by `employee_id` and has a terminal `action_archive_employee` step that sets `active=false`; we reuse it untouched.

## 5. Architecture

### API routes
- **Create** — add `POST` to `src/app/api/hr/employees/route.ts` (currently GET-only). Guard-style manager check; non-admin: validate `company_id ∈ parseCompanyIds(user.allowed_company_ids)` → 403; `const id = await getOdoo().create('hr.employee', vals)`; return `{ employee: {...} }`. Model on `hr/termination/route.ts` POST.
- **Edit + deactivate** — new `src/app/api/hr/employee/[id]/route.ts` `PATCH` (`{ params }: { params: { id: string } }`). Read the employee's `company_id` from Odoo; non-admin: verify it (and any new `company_id`) ∈ allowed → 403. Write a **route-local allowlist**: `name, company_id, department_id, job_title, work_email, mobile_phone, active`. `active:false` = deactivate. Do NOT extend the self-service allowlist in `hr/employee/route.ts`.
- **Scope fix** — `GET /api/hr/employees`: for non-admins push `['company_id','in', allowed]` into the domain (today it accepts an arbitrary `company_id` and is unscoped).
- **Termination archive auth fix** — add `requireRole('manager')` to `src/app/api/termination/[id]/archive/route.ts` (currently the only termination route with no auth).

### UI (HR module — `src/app/hr/page.tsx` screen-state machine)
- New screen `{ type: 'employee-edit'; employeeId: number | null }` (`null` = create). Mirrors the existing `MyProfile onEdit` wiring.
- New component `src/components/hr/EmployeeForm.tsx` — the Add/Edit form. Company `<select>` from `/api/companies` (scoped); department `<select>` filtered to the chosen company (from `/api/hr/filters`); job role text; phone; email. Submit → POST (create) or PATCH (edit). On create success → confirm + offer "Send invite".
- `EmployeeOverview.tsx` — add a **"+ Add staff"** primary button (managers/admins) → `onAdd()` → `employee-edit` with `null`. Source the company filter dropdown from `/api/companies` (scoped) instead of the unscoped `/api/hr/filters`.
- `EmployeeDetail.tsx` — replace the placeholder footer (lines 159-166) with **Edit** (→ `employee-edit` with id), **Deactivate** (confirm → PATCH `{active:false}`), and **Offboard / Terminate** (→ `router.push('/termination?employee='+id)`).
- `src/app/termination/page.tsx` — wrap in `<Suspense>`, read `useSearchParams()`; if `?employee=ID`, start on `{ type: 'wizard' }` and pass `preselectEmployeeId`. `TermWizard` gains optional `preselectEmployeeId?: number` — after its employee fetch, auto-select that employee and jump to `setStep('type')`.

### Odoo write layer (verified)
`getOdoo()` singleton exposes `create(model, vals)→id`, `write(model, ids[], vals)→bool`, `call`, `buttonCall`. Service account (biz@krawings.de → uid 2) has `hr.group_hr_manager` — can create/write/archive. Company scoping in Odoo reflects the **service account**, so portal-user scoping MUST be enforced in route code (above).

## 6. Odoo facts (introspected)
- `hr.employee` create requires `company_id` + `department_id` (both M2O). `name` is the record name (UI-required). `active` Boolean archives.
- Active companies: **Krawings=2, Ssam Korean BBQ=3, What a Jerk=6, WAJ ALT=7**. 16 departments, 17 jobs (filter by `company_id`).
- `kw.termination.employee_id` → hr.employee; termination never auto-archives; `action_archive_employee` is the manual terminal step.

## 7. Error handling
- Missing required field → 400 with a plain message.
- Manager acting outside their companies → 403.
- Odoo create/write failure → 500 `{ error }`, logged.
- Deactivate is confirmed in the UI before firing (irreversible-ish; reactivate exists).

## 8. Testing
- `npm run build` (typecheck gate).
- End-to-end on staging with a throwaway: create employee via portal API (in an allowed company) → appears in list → edit a field → deactivate (archive) → confirm archived in Odoo → then delete the test employee. Verify manager scoping (a manager company id NOT in allowed → 403). Verify termination deep-link preselects.
- Clean up all test data.

## 9. Out of scope (later phases)
`job_id`/position management + department CRUD (Phase 2); contracts/hours (Phase 3); time off (Phase 4); unifying HR-Employees with the Staff-Access invite screen into one hub; reactivate/"show archived" UI (deactivate is enough for Phase 1).

## 10. Implementation task list
1. API: `POST /api/hr/employees` (create + scope).
2. API: `PATCH /api/hr/employee/[id]` (edit + deactivate + scope).
3. API: scope-fix `GET /api/hr/employees`; add auth to termination `[id]/archive`.
4. UI: `EmployeeForm.tsx` + `employee-edit` screen + `onAdd`/`onEdit` wiring in `hr/page.tsx`.
5. UI: "+ Add staff" in `EmployeeOverview` (+ scoped company dropdown); Edit/Deactivate/Offboard in `EmployeeDetail`.
6. Termination deep-link: `preselectEmployeeId` in `TermWizard` + `Suspense`/`useSearchParams` in termination page.
7. `npm run build`, deploy to staging, end-to-end test, clean up.
