# Task 6 Report: Integrate tap-to-edit into EmployeeDetail + hr/page.tsx

## Status: DONE

## Edits Applied

### EmployeeDetail.tsx

**Step 1 — Props interface + signature**
Replaced `onEdit`/`onFullEdit` with `editMode: boolean`, `onToggleEditMode`, `onEditSection`, `onEditDocument`. Updated function destructuring accordingly. `onHome` stays declared in Props but not destructured (established codebase pattern, not touched).

**Step 2 — AppHeader Edit/Done toggle + edit hint**
Replaced single `<AppHeader title={emp.name} showBack onBack={onBack} />` with expanded form including an `action` button that shows "Edit" or "Done" based on `editMode`, plus a conditional green hint banner when editing.

**Step 3 — Basics section + realigned DATEV sections**
Replaced old 5 sections (Personal / Tax / Insurance / Residence / Gastro) with:
- New `Basics` section before the DATEV title, reading `emp.job_title`, `emp.company_id`, `dept`, `emp.mobile_phone`, `emp.work_email` (all `optional`)
- `Personal & address` (merged old Personal + address fields)
- `Tax` (removed IBAN — moved to its own section)
- `Bank` (new, IBAN only, `optional`)
- `Insurance`
- `Residence & work` (merged old Residence + Gastro)
All sections pass `onEdit={editMode ? () => onEditSection('...') : undefined}`.

**Step 4 — Document cards editable in edit mode**
Updated the document card `<button>`: `disabled` is `false` in edit mode; `onClick` routes to `onEditDocument(dt.key)` in edit mode, or `handleOpenDoc` in view mode; subtitle and trailing icon adapt to edit/view state.

**Step 5 — Remove two old edit buttons**
Removed "Edit full profile" (`onFullEdit`) and "Edit basics (name, role, contact)" (`onEdit`) buttons from the bottom action block. Kept Contract & hours, Offboard / Terminate, Mark as left.

**Step 6 — Section + Row helpers updated**
`Section` now accepts `onEdit?: () => void`. When present it renders as a `<button>` with green border; otherwise a plain `<div>`. Title row shows a pencil SVG when `onEdit` is set.
`Row` gains `optional?: boolean`. Blank optional fields render "—" in gray instead of "Missing" in red.

### hr/page.tsx

**Step 7 — Imports + Screen union**
Added `import EmployeeSectionEdit, { type SectionKey }` and `import EmployeeDocumentEdit`. Added two Screen union members: `employee-section-edit` (with `section: SectionKey`) and `employee-doc-edit` (with `docTypeKey: string`).

**Step 8 — staffEditMode state**
Added `const [staffEditMode, setStaffEditMode] = useState(false);` after the `screen` state declaration.

**Step 9 — Reset edit mode on employee select**
Changed `onSelect` in the `employees` case to `(id: number) => { setStaffEditMode(false); navigate({ type: 'employee-detail', employeeId: id }); }`.

**Step 10 — Rewire employee-detail case**
Removed `onEdit`/`onFullEdit` props, added `editMode={staffEditMode}`, `onToggleEditMode`, `onEditSection` (routes 'basics' → `employee-edit`, others → `employee-section-edit`), `onEditDocument` (→ `employee-doc-edit`).

**Step 11 — Two new screen cases**
Added `employee-section-edit` (renders `EmployeeSectionEdit` with `employeeId`, `section`, `onBack`, `onHome`, `onDone`) and `employee-doc-edit` (renders `EmployeeDocumentEdit` with `employeeId`, `docTypeKey`, `onBack`, `onHome`, `onDone`) after the `employee-profile-edit` case.

## Build Result

```
✓ Compiled successfully
Linting and checking validity of types ... (warnings only — all pre-existing, none from modified files)
Build complete — 2 files changed, 117 insertions(+), 50 deletions(-)
```

No TypeScript errors. All "dynamic server usage" notices are pre-existing and unrelated to this task.

## Files Changed

- `src/components/hr/EmployeeDetail.tsx`
- `src/app/hr/page.tsx`

## Commit

`e60a95f` — [IMP] hr: unified tap-to-edit on staff detail (replaces two edit buttons)

## Concerns

None. The diff is exactly the two specified files. `EmployeeProfileEdit` remains importable and wired (removal is Task 7). The `onHome` prop is declared in Props but not destructured — correct per codebase pattern, not changed. `SectionKey` import is used in the Screen union and the `section as SectionKey` cast.
