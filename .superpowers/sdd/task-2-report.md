# Task 2 Report — Extract StepResidenceWork

## What changed

**Created:** `src/components/hr/StepResidenceWork.tsx`
- Verbatim copy of the inline `ResidenceWorkStep` function from `EmployeeProfileEdit.tsx`, promoted to a default-export component.
- Added `submitLabel?: string` prop (defaults to `'Save & finish'`) as specified.
- Local `Field` helper included at the bottom of the new file.

**Modified:** `src/components/hr/EmployeeProfileEdit.tsx`
- Added import: `import StepResidenceWork from '@/components/hr/StepResidenceWork';`
- Replaced `<ResidenceWorkStep .../>` usage (step 4) with `<StepResidenceWork .../>`
- Deleted the now-unused inline `ResidenceWorkStep` function (old lines 128–235).
- Deleted the now-unused local `Field` helper (old lines 237–244).
- No other changes — all other steps, logic, and error display are untouched.

## Build result (final ~10 lines)

```
├ ○ /shifts                                             34 kB           122 kB
├ ƒ /tasks                                              151 B          87.7 kB
├ ƒ /tasks/admin                                        1.4 kB         97.7 kB
├ ƒ /tasks/manager                                      2.68 kB          99 kB
├ ƒ /tasks/manager/dept/[id]                            4.59 kB        98.3 kB
├ ƒ /tasks/manager/templates                            3.14 kB        99.4 kB
├ ƒ /tasks/manager/templates/[id]                       8.67 kB         111 kB
├ ƒ /tasks/staff                                        5.71 kB         108 kB
└ ○ /termination                                        13.7 kB         101 kB
+ First Load JS shared by all                           87.5 kB
```

Build outcome: `✓ Compiled successfully` — no TypeScript errors, no "Failed to compile".

## Files changed

- `src/components/hr/StepResidenceWork.tsx` (new, 125 lines)
- `src/components/hr/EmployeeProfileEdit.tsx` (modified, -119 lines / +8 net)

## Git

Commit: `9455c04` — `[REF] hr: extract StepResidenceWork into a reusable component`
`git diff --stat HEAD~1 HEAD` shows exactly 2 files.
`git grep` confirmed zero dangling references to `ResidenceWorkStep` or local `Field` in `EmployeeProfileEdit.tsx`.

## Concerns

None. The extraction is a clean lift-and-shift. Behaviour of the existing "Edit full profile" wizard is unchanged.
