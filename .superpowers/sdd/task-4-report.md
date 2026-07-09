# Task 4 Report — EmployeeSectionEdit

## What was created
`src/components/hr/EmployeeSectionEdit.tsx` — 120 lines, verbatim from the brief.

Exports:
- `export type SectionKey = 'personal' | 'tax' | 'insurance' | 'bank' | 'residence'`
- `default export EmployeeSectionEdit` (props: `employeeId`, `section`, `onBack`, `onHome`, `onDone`)

Key internals:
- Loads employee via `GET /api/hr/employee/[id]` on mount with loading/error states.
- `saveAndDone` is async, PATCHes `/api/hr/employee/[id]`, then calls `onDone()`.
- Five section branches: StepPersonal, StepTax, StepInsurance (requireAck=false), StepBank (employeeId + onNext=()=>onDone()), StepResidenceWork — all with submitLabel="Save".
- Loader spinner and error states use AppHeader for consistent navigation.

## Build result (final lines)
```
✓ Compiled successfully
[route table — no TypeScript errors, no "Failed to compile"]
ƒ Middleware  26.5 kB
○ (Static) prerendered as static content
ƒ (Dynamic) server-rendered on demand
```
Build: CLEAN. Warnings are pre-existing unused-var lints in unrelated files; no new warnings from this file.

## Files changed
- Created: `src/components/hr/EmployeeSectionEdit.tsx` (120 lines)
- No other files touched.

## Commit
`f2f5705  [ADD] hr: EmployeeSectionEdit single-section editor`
`git diff --stat HEAD~1 HEAD` → 1 file changed, 120 insertions(+)

## Concerns
None. The async `saveAndDone` → `onNext: (fields) => void` assignment compiled without error as expected by TypeScript's void-return assignability rule. Component is dead code until Task 6 wires it in.
