# Task 3 Report — Make onboarding steps reusable standalone

**Status:** DONE  
**Commit:** `be27c92` — [IMP] hr: make onboarding steps reusable standalone (submitLabel, requireAck)  
**Date:** 2026-07-05

---

## What changed per file

### `src/components/hr/StepPersonal.tsx`
- Added `submitLabel?: string` to `Props` interface.
- Updated function signature to destructure `submitLabel = 'Continue'`.
- Button label changed from hardcoded `'Continue'` to `{saving ? 'Saving...' : submitLabel}`.

### `src/components/hr/StepTax.tsx`
- Added `submitLabel?: string` to `Props` interface.
- Updated function signature to destructure `submitLabel = 'Continue'`.
- Button label changed from hardcoded `'Continue'` to `{saving ? 'Saving...' : submitLabel}`.

### `src/components/hr/StepBank.tsx`
- Added `submitLabel?: string` to `Props` interface (after existing `employeeId?`).
- Updated function signature to destructure `submitLabel = 'Continue'`.
- Button label changed from hardcoded `'Continue'` to `{isSaving ? 'Saving...' : submitLabel}`.

### `src/components/hr/StepInsurance.tsx`
- Added `submitLabel?: string` and `requireAck?: boolean` to `Props` interface.
- Updated function signature to destructure `submitLabel = 'Continue'` and `requireAck = true`.
- Wrapped the amber warning `<div>` AND the acknowledgment `<label>` in `{requireAck && (<> ... </>)}`.
- Button `disabled` changed from `saving || !acknowledged` to `saving || (requireAck && !acknowledged)`.
- Button label changed from hardcoded `"Continue"` to `{saving ? "Saving..." : submitLabel}`.

---

## Build result (final lines)

```
✓ Compiled successfully
   Linting and checking validity of types ...
   [pre-existing warnings only — no errors]
...
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```
Build completed with no TypeScript errors. All warnings are pre-existing and unrelated to these changes.

---

## Files changed

```
 src/components/hr/StepBank.tsx      |  5 +++--
 src/components/hr/StepInsurance.tsx | 44 +++++++++++++++++++++----------------
 src/components/hr/StepPersonal.tsx  |  5 +++--
 src/components/hr/StepTax.tsx       |  5 +++--
 4 files changed, 34 insertions(+), 25 deletions(-))
```
Exactly the 4 specified files — no other files touched.

---

## Backward-compat verification

- `OnboardingWizard.tsx` was NOT modified.
- All new props are optional with defaults (`submitLabel = 'Continue'`, `requireAck = true`).
- When `OnboardingWizard` renders these steps without the new props, behavior is byte-for-byte identical to before: button says "Continue" and `StepInsurance` requires acknowledgment before submit.

---

## Concerns

None. Task completed cleanly.
