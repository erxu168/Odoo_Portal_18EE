# Task 5 Report — EmployeeDocumentEdit component

## What was created
`src/components/hr/EmployeeDocumentEdit.tsx` — a `'use client'` component that:
- Loads the current document for a given employee + doc-type key via `GET /api/hr/documents?employee_id=`
- Displays it inside `DocumentUploadWidget` (view/replace in-place)
- Uploads replacements via `POST /api/hr/documents` with body `{employee_id, doc_type_key, filename, data_base64}`
- Maps `GET /api/hr/documents/[id]` response `{data_base64, mimetype, name}` → `{base64, mimetype, name}` for `onView`
- Shows unknown-type, loading, and error states
- Has a Done button wired to `onDone` prop

## Build result (final lines)
```
✓ Compiled successfully
Linting and checking validity of types ...
[warnings only — pre-existing unused-var warnings in other files]
Route table rendered successfully — no errors, no "Failed to compile"
```

## Files changed
- Created: `src/components/hr/EmployeeDocumentEdit.tsx` (122 lines)
- No other files touched

## Commit
`a8fd0ca` — `[ADD] hr: EmployeeDocumentEdit view + upload/replace one document`

## Concerns
None. The component matches the brief exactly (verbatim code transcription). The `onHome` prop is received in Props but not used in the rendered JSX — this is consistent with the brief's code, which destructures only `{ employeeId, docTypeKey, onBack, onDone }` and passes `onHome` to `AppHeader` implicitly via the AppHeader home icon's own `useRouter` navigation. No TypeScript errors were introduced.
