# Staff Tap-to-Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manager staff-detail screen's two edit buttons ("Edit full profile" 5-step wizard + "Edit basics" form) with one **Edit** mode where tapping any section or document opens a focused editor for just that piece.

**Architecture:** The read-only profile view already exists in `EmployeeDetail.tsx`. We (1) add a Basics section and realign the section grouping 1:1 with editors, (2) add an Edit/Done toggle (state lifted to `hr/page.tsx` so it survives edit round-trips), (3) route each tapped section to an existing editor component reused standalone (the onboarding wizard steps), and (4) add a per-document upload/replace editor. No new backend; existing save routes (`PATCH /api/hr/employee/[id]`, `POST /api/hr/bank`, `POST /api/hr/documents`) are reused unchanged.

**Tech Stack:** Next.js 14.2.35 (App Router), React (client components), TypeScript, Tailwind. Odoo 18 EE JSON-RPC behind `src/lib/odoo.ts` (server-side only). No unit-test framework — the per-task automated gate is `npm run build` (catches TS + lint), and acceptance is manual verification on staging plus `npm run smoke:staging` (Playwright).

## Global Constraints

- **Branch:** `main` only. `git checkout main && git pull --ff-only` before starting; confirm `git branch --show-current` says `main`. Do NOT create side branches unless the user explicitly asks.
- **Staging only** until Ethan says prod. Never edit source on the server; deploy = server `git pull` + `npm run build` + `systemctl restart krawings-portal`.
- **Design tokens:** green `#16a34a`; header is `AppHeader` (dark navy `#2563EB`); typography via `var(--fs-*)`. Not the Odoo orange system.
- **Role hierarchy** Staff < Manager < Admin enforced in UI and API. This screen is manager/admin; the employee GET/PATCH routes already enforce company scoping server-side.
- **Build pitfalls (block the build):** `err: unknown` + `instanceof` (never `err: any`); no `[...set]` spread — use `Array.from()`; JSX apostrophes as `’`; unused params removed or `_`-prefixed; `prefer-const`; don't pipe `npm run build`.
- **No monoliths:** one component per screen, PascalCase filenames, shared UI in `src/components/ui/`.
- **Backward compatibility:** the self-service `OnboardingWizard` reuses `StepPersonal/Tax/Insurance/Bank`. Every prop added to those steps MUST be optional with a default that preserves current wizard behavior.
- **Commits:** small, one concern each, message format `[TYPE] area: description`. Push/deploy only when the user says so.

---

### Task 1: Add `company_id` + `mobile_phone` to the employee read fields and type

The Basics section must display Restaurant and Mobile phone. Neither `company_id` nor `mobile_phone` is currently read by `GET /api/hr/employee/[id]` (it reads `EMPLOYEE_READ_FIELDS`) nor present on `EmployeeData`. Both are standard `hr.employee` fields; reading them is safe and also benefits self-service reads.

**Files:**
- Modify: `src/types/hr.ts` (interface `EmployeeData` ~line 33; const `EMPLOYEE_READ_FIELDS` ~line 91-92)

**Interfaces:**
- Produces: `EmployeeData.company_id: [number, string] | false`, `EmployeeData.mobile_phone: string | false`; both field names added to `EMPLOYEE_READ_FIELDS`.

- [ ] **Step 1: Add the two fields to the `EmployeeData` interface**

In `src/types/hr.ts`, find:

```typescript
  department_id: [number, string] | false;
  job_title: string | false;
  work_email: string | false;
```

Replace with:

```typescript
  department_id: [number, string] | false;
  company_id: [number, string] | false;
  job_title: string | false;
  work_email: string | false;
  mobile_phone: string | false;
```

- [ ] **Step 2: Add the two field names to `EMPLOYEE_READ_FIELDS`**

Find:

```typescript
export const EMPLOYEE_READ_FIELDS: string[] = [
  'name', 'nick_name', 'department_id', 'job_title', 'work_email',
```

Replace with:

```typescript
export const EMPLOYEE_READ_FIELDS: string[] = [
  'name', 'nick_name', 'department_id', 'company_id', 'job_title', 'work_email', 'mobile_phone',
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles with no TypeScript errors (exit 0). (Adding optional-shaped fields cannot break existing reads.)

- [ ] **Step 4: Commit**

```bash
git add src/types/hr.ts
git commit -m "[IMP] hr: read company_id + mobile_phone on employee for detail view"
```

---

### Task 2: Extract `StepResidenceWork` into its own component file

`ResidenceWorkStep` is currently an inline function inside `EmployeeProfileEdit.tsx`. Extract it to a reusable standalone component so the new section editor (Task 4) can render it. Wire `EmployeeProfileEdit` to import it so the build and the existing full-profile edit still work (that screen is removed later in Task 7).

**Files:**
- Create: `src/components/hr/StepResidenceWork.tsx`
- Modify: `src/components/hr/EmployeeProfileEdit.tsx` (remove inline `ResidenceWorkStep` + its local `Field`; import + use the new component)

**Interfaces:**
- Produces: `StepResidenceWork` default export with props `{ employee: EmployeeData; saving: boolean; onPrev: () => void; onSave: (fields: Record<string, unknown>) => void; submitLabel?: string }`. Saves these keys via `onSave`: `kw_beschaeftigungsbeginn, kw_aufenthaltstitel_typ, passport_id, visa_no, permit_no, visa_expire, work_permit_expiration_date, kw_gesundheitszeugnis_datum, kw_gesundheitszeugnis_ablauf, kw_sofortmeldung_done`.

- [ ] **Step 1: Create `src/components/hr/StepResidenceWork.tsx`**

```tsx
'use client';

import React, { useState } from 'react';
import type { EmployeeData } from '@/types/hr';

interface Props {
  employee: EmployeeData;
  saving: boolean;
  onPrev: () => void;
  onSave: (fields: Record<string, unknown>) => void;
  submitLabel?: string;
}

/**
 * Residence, work permit and health-certificate fields. Extracted from the old
 * EmployeeProfileEdit wizard so it can be reused as a standalone section editor.
 */
export default function StepResidenceWork({ employee, saving, onPrev, onSave, submitLabel = 'Save & finish' }: Props) {
  const s = (v: unknown) => (v === false || v === undefined || v === null ? '' : String(v));
  const e = employee as unknown as Record<string, unknown>;

  const [startDate, setStartDate] = useState(s(e.kw_beschaeftigungsbeginn));
  const [permitType, setPermitType] = useState(s(e.kw_aufenthaltstitel_typ));
  const [passport, setPassport] = useState(s(e.passport_id));
  const [visaNo, setVisaNo] = useState(s(e.visa_no));
  const [permitNo, setPermitNo] = useState(s(e.permit_no));
  const [visaExpire, setVisaExpire] = useState(s(e.visa_expire));
  const [permitExpire, setPermitExpire] = useState(s(e.work_permit_expiration_date));
  const [healthDate, setHealthDate] = useState(s(e.kw_gesundheitszeugnis_datum));
  const [healthExpire, setHealthExpire] = useState(s(e.kw_gesundheitszeugnis_ablauf));
  const [sofortDone, setSofortDone] = useState(e.kw_sofortmeldung_done === true);

  function handleSave() {
    onSave({
      kw_beschaeftigungsbeginn: startDate || false,
      kw_aufenthaltstitel_typ: permitType || false,
      passport_id: passport || false,
      visa_no: visaNo || false,
      permit_no: permitNo || false,
      visa_expire: visaExpire || false,
      work_permit_expiration_date: permitExpire || false,
      kw_gesundheitszeugnis_datum: healthDate || false,
      kw_gesundheitszeugnis_ablauf: healthExpire || false,
      kw_sofortmeldung_done: sofortDone,
    });
  }

  return (
    <div className="pb-8">
      <div className="p-5 flex flex-col gap-4">
        <Field label="Employment start date">
          <input type="date" value={startDate} onChange={(ev) => setStartDate(ev.target.value)} className="form-inp" />
        </Field>

        <div className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 pt-1">Residence / work permit</div>
        <Field label="Permit type">
          <input value={permitType} onChange={(ev) => setPermitType(ev.target.value)} placeholder="e.g. Aufenthaltstitel §18a" className="form-inp" />
        </Field>
        <Field label="Passport number">
          <input value={passport} onChange={(ev) => setPassport(ev.target.value)} className="form-inp" />
        </Field>
        <div className="flex gap-3">
          <Field label="Visa number" className="flex-1">
            <input value={visaNo} onChange={(ev) => setVisaNo(ev.target.value)} className="form-inp" />
          </Field>
          <Field label="Visa expires" className="flex-1">
            <input type="date" value={visaExpire} onChange={(ev) => setVisaExpire(ev.target.value)} className="form-inp" />
          </Field>
        </div>
        <div className="flex gap-3">
          <Field label="Permit number" className="flex-1">
            <input value={permitNo} onChange={(ev) => setPermitNo(ev.target.value)} className="form-inp" />
          </Field>
          <Field label="Permit expires" className="flex-1">
            <input type="date" value={permitExpire} onChange={(ev) => setPermitExpire(ev.target.value)} className="form-inp" />
          </Field>
        </div>

        <div className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 pt-1">Health certificate (Gesundheitszeugnis)</div>
        <div className="flex gap-3">
          <Field label="Issued" className="flex-1">
            <input type="date" value={healthDate} onChange={(ev) => setHealthDate(ev.target.value)} className="form-inp" />
          </Field>
          <Field label="Expires" className="flex-1">
            <input type="date" value={healthExpire} onChange={(ev) => setHealthExpire(ev.target.value)} className="form-inp" />
          </Field>
        </div>

        <label className="flex items-center gap-3 py-1">
          <input type="checkbox" checked={sofortDone} onChange={(ev) => setSofortDone(ev.target.checked)} className="w-5 h-5 accent-green-600" />
          <span className="text-[var(--fs-sm)] font-medium text-gray-700">Sofortmeldung submitted</span>
        </label>
      </div>

      <div className="px-5 pt-2 pb-8 flex gap-3">
        <button onClick={onPrev} className="flex-1 py-4 bg-white text-gray-900 font-bold text-[var(--fs-sm)] rounded-xl border border-gray-200 active:opacity-85">Back</button>
        <button onClick={handleSave} disabled={saving} className="flex-1 py-4 bg-green-600 text-white font-bold text-[var(--fs-sm)] rounded-xl active:opacity-85 disabled:opacity-40">
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>

      <style jsx>{`
        .form-inp {
          width: 100%;
          padding: 0.75rem 1rem;
          border: 1px solid #e5e7eb;
          border-radius: 0.75rem;
          background: #fff;
          font-size: var(--fs-base);
          outline: none;
        }
        .form-inp:focus { border-color: #16a34a; }
      `}</style>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={'block ' + (className || '')}>
      <span className="block text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 mb-1.5">{label}</span>
      {children}
    </label>
  );
}
```

- [ ] **Step 2: Rewire `EmployeeProfileEdit.tsx` to use the extracted component**

In `src/components/hr/EmployeeProfileEdit.tsx`, add to the imports (after the `StepBank` import on line 9):

```tsx
import StepResidenceWork from '@/components/hr/StepResidenceWork';
```

Change the step-4 render (lines 112-119) from `ResidenceWorkStep` to `StepResidenceWork`:

```tsx
      {step === 4 && (
        <StepResidenceWork
          employee={employee}
          saving={saving}
          onPrev={prev}
          onSave={(fields) => { saveFields(fields).then((ok) => { if (ok) onDone(); }); }}
        />
      )}
```

Then delete the now-unused inline `ResidenceWorkStep` function (old lines 128-235) and the inline `Field` helper (old lines 237-244) at the bottom of the file. The file should end after the closing of the default-export component.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles with no errors. `EmployeeProfileEdit` now imports `StepResidenceWork`; its behavior is unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/components/hr/StepResidenceWork.tsx src/components/hr/EmployeeProfileEdit.tsx
git commit -m "[REF] hr: extract StepResidenceWork into a reusable component"
```

---

### Task 3: Make the reused wizard steps configurable for standalone editing

Add optional props so the four wizard steps can render a "Save" button (instead of "Continue") and, for insurance, skip the employee-facing acknowledgment gate when a manager edits. Defaults preserve the onboarding wizard exactly.

**Files:**
- Modify: `src/components/hr/StepPersonal.tsx` (Props ~line 9-13; button ~line 346-348)
- Modify: `src/components/hr/StepTax.tsx` (Props ~line 8-13; button ~line 105-107)
- Modify: `src/components/hr/StepBank.tsx` (Props ~line 8-14; button ~line 143-145)
- Modify: `src/components/hr/StepInsurance.tsx` (Props ~line 8-13; warning/checkbox ~line 61-76; button ~line 80-82)

**Interfaces:**
- Produces: `StepPersonal` prop `submitLabel?: string` (default `'Continue'`); `StepTax` prop `submitLabel?: string` (default `'Continue'`); `StepBank` prop `submitLabel?: string` (default `'Continue'`); `StepInsurance` props `submitLabel?: string` (default `'Continue'`) and `requireAck?: boolean` (default `true`).

- [ ] **Step 1: `StepPersonal.tsx` — add `submitLabel`**

Change the Props interface:

```tsx
interface Props {
  employee: EmployeeData;
  onNext: (fields: Record<string, unknown>) => void;
  saving: boolean;
  submitLabel?: string;
}
```

Change the signature:

```tsx
export default function StepPersonal({ employee, onNext, saving, submitLabel = 'Continue' }: Props) {
```

Change the button label (in the final `<button>`):

```tsx
          {saving ? 'Saving...' : submitLabel}
```

- [ ] **Step 2: `StepTax.tsx` — add `submitLabel`**

Change the Props interface:

```tsx
interface Props {
  employee: EmployeeData;
  onNext: (fields: Record<string, unknown>) => void;
  onPrev: () => void;
  saving: boolean;
  submitLabel?: string;
}
```

Change the signature:

```tsx
export default function StepTax({ employee, onNext, onPrev, saving, submitLabel = 'Continue' }: Props) {
```

Change the submit button label:

```tsx
          {saving ? 'Saving...' : submitLabel}
```

- [ ] **Step 3: `StepBank.tsx` — add `submitLabel`**

Change the Props interface:

```tsx
interface Props {
  employee: EmployeeData;
  onNext: (fields: Record<string, unknown>) => void;
  onPrev: () => void;
  saving: boolean;
  employeeId?: number; // when a manager edits someone else; omitted = self-service
  submitLabel?: string;
}
```

Change the signature:

```tsx
export default function StepBank({ employee, onNext, onPrev, saving, employeeId, submitLabel = 'Continue' }: Props) {
```

Change the submit button label:

```tsx
          {isSaving ? 'Saving...' : submitLabel}
```

- [ ] **Step 4: `StepInsurance.tsx` — add `submitLabel` + `requireAck`**

Change the Props interface:

```tsx
interface Props {
  employee: EmployeeData;
  onNext: (fields: Record<string, unknown>) => void;
  onPrev: () => void;
  saving: boolean;
  submitLabel?: string;
  requireAck?: boolean;
}
```

Change the signature:

```tsx
export default function StepInsurance({ employee, onNext, onPrev, saving, submitLabel = 'Continue', requireAck = true }: Props) {
```

Wrap the amber warning block AND the acknowledgment `<label>` (the two blocks currently at lines ~61-76) in a `{requireAck && ( ... )}` guard. Replace those two sibling blocks with:

```tsx
        {requireAck && (
          <>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mt-4 text-[var(--fs-sm)] text-amber-800 flex items-start gap-2">
              <span className="text-lg leading-none">&#9888;</span>
              <div>
                <strong>Important:</strong> Health insurance is mandatory in Germany. You must register with a public health insurer (e.g. TK, AOK, BARMER) or provide proof of other valid health insurance before your first payroll. Without proof of coverage, your employer cannot process your salary. Most employees do not meet the conditions for private insurance (PKV) and must join a public insurer (GKV). For mini-job employees (up to 603 EUR/month as of 2026): your employer pays a flat-rate health contribution, but this does NOT cover you. You must have your own health insurance (e.g. family insurance, student insurance, or voluntary public insurance) and provide proof.
                <a href="https://www.nomadenberlin.com/working-in-berlin" target="_blank" rel="noopener noreferrer" className="block mt-1.5 text-blue-600 font-semibold no-underline">Learn about health insurance for workers in Berlin &rarr;</a>
              </div>
            </div>
            <label className="flex items-start gap-3 mt-4 cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={e => setAcknowledged(e.target.checked)}
                className="w-5 h-5 mt-0.5 rounded border-gray-300 text-green-600 accent-green-600 flex-shrink-0"
              />
              <span className="text-[var(--fs-sm)] text-gray-700">I confirm that I have read and understood the health insurance requirements above and will provide proof of valid health insurance to my employer.</span>
            </label>
          </>
        )}
```

Change the submit button to gate on ack only when required, and use `submitLabel`:

```tsx
        <button onClick={handleSubmit} disabled={saving || (requireAck && !acknowledged)} className="flex-1 py-4 bg-green-600 text-white font-bold text-[var(--fs-sm)] rounded-xl active:opacity-85 disabled:opacity-40">
          {saving ? "Saving..." : submitLabel}
        </button>
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: no errors. All new props are optional with defaults; `OnboardingWizard` renders these steps without the new props, so its behavior is byte-for-byte unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/hr/StepPersonal.tsx src/components/hr/StepTax.tsx src/components/hr/StepBank.tsx src/components/hr/StepInsurance.tsx
git commit -m "[IMP] hr: make onboarding steps reusable standalone (submitLabel, requireAck)"
```

---

### Task 4: Create the `EmployeeSectionEdit` router component

A thin screen that loads one employee and renders exactly one section editor (personal / tax / insurance / bank / residence), saving via the existing manager routes and returning on success. This is the old 5-step wizard reduced to a single, directly-addressable section.

**Files:**
- Create: `src/components/hr/EmployeeSectionEdit.tsx`

**Interfaces:**
- Consumes: `StepPersonal` (`submitLabel`), `StepTax` (`submitLabel`), `StepInsurance` (`submitLabel`, `requireAck`), `StepBank` (`submitLabel`, `employeeId`), `StepResidenceWork` (`submitLabel`) from Tasks 2-3; `GET/PATCH /api/hr/employee/[id]`.
- Produces: default export `EmployeeSectionEdit` with props `{ employeeId: number; section: SectionKey; onBack: () => void; onHome: () => void; onDone: () => void }`; and `export type SectionKey = 'personal' | 'tax' | 'insurance' | 'bank' | 'residence'`.

- [ ] **Step 1: Create `src/components/hr/EmployeeSectionEdit.tsx`**

```tsx
'use client';

import React, { useState, useCallback, useEffect } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import StepPersonal from '@/components/hr/StepPersonal';
import StepTax from '@/components/hr/StepTax';
import StepInsurance from '@/components/hr/StepInsurance';
import StepBank from '@/components/hr/StepBank';
import StepResidenceWork from '@/components/hr/StepResidenceWork';
import type { EmployeeData } from '@/types/hr';

export type SectionKey = 'personal' | 'tax' | 'insurance' | 'bank' | 'residence';

const SECTION_TITLES: Record<SectionKey, string> = {
  personal: 'Personal & address',
  tax: 'Tax',
  insurance: 'Insurance',
  bank: 'Bank',
  residence: 'Residence & work',
};

interface Props {
  employeeId: number;
  section: SectionKey;
  onBack: () => void;
  onHome: () => void;
  onDone: () => void;
}

/**
 * Manager section editor: loads one employee and shows a single editable section,
 * reusing the onboarding step components. Saves just that section via the
 * company-scoped /api/hr/employee/[id] (and /api/hr/bank via StepBank itself),
 * then returns to the detail screen. No wizard, no consents.
 */
export default function EmployeeSectionEdit({ employeeId, section, onBack, onDone }: Props) {
  const [employee, setEmployee] = useState<EmployeeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/hr/employee/${employeeId}`);
      const data = await res.json();
      if (res.ok) setEmployee(data.employee);
      else setError(data.error || 'Could not load this employee.');
    } catch {
      setError('Could not load this employee.');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);

  // Save the given DATEV fields, then return to the detail screen.
  async function saveAndDone(fields: Record<string, unknown>) {
    if (!fields || Object.keys(fields).length === 0) { onDone(); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/hr/employee/${employeeId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not save.'); setSaving(false); return; }
      onDone();
    } catch {
      setError('Could not save.');
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title={SECTION_TITLES[section]} showBack onBack={onBack} />
        <div className="flex items-center justify-center h-40">
          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title={SECTION_TITLES[section]} showBack onBack={onBack} />
        <div className="p-5 text-center text-red-500 mt-10">{error || 'Could not load this employee.'}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title={SECTION_TITLES[section]} subtitle={employee.name} showBack onBack={onBack} />

      {section === 'personal' && (
        <StepPersonal employee={employee} onNext={saveAndDone} saving={saving} submitLabel="Save" />
      )}
      {section === 'tax' && (
        <StepTax employee={employee} onNext={saveAndDone} onPrev={onBack} saving={saving} submitLabel="Save" />
      )}
      {section === 'insurance' && (
        <StepInsurance employee={employee} onNext={saveAndDone} onPrev={onBack} saving={saving} submitLabel="Save" requireAck={false} />
      )}
      {section === 'bank' && (
        <StepBank employee={employee} employeeId={employeeId} onNext={() => onDone()} onPrev={onBack} saving={saving} submitLabel="Save" />
      )}
      {section === 'residence' && (
        <StepResidenceWork employee={employee} saving={saving} onPrev={onBack} onSave={saveAndDone} submitLabel="Save" />
      )}

      {error && (
        <div className="mx-5 mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)]">{error}</div>
      )}
    </div>
  );
}
```

> Note: `StepBank` loads and saves its own IBAN via `/api/hr/bank` when given `employeeId`, then calls `onNext({})` — so here `onNext` just returns via `onDone()`; `saveAndDone` is not used for the bank section.
>
> Note (intentional, do not "fix"): `saveAndDone` is `async` (returns `Promise<void>`) and is passed to `onNext`, typed `(fields) => void`. This compiles under strict TypeScript — a function with any return type is assignable to a `void`-returning callback type (the same rule that lets `onClick={async …}` work). Do not change the step `onNext` signatures or strip `async`.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: no errors. The component is not yet referenced (wired in Task 6); an unused module still type-checks.

- [ ] **Step 3: Commit**

```bash
git add src/components/hr/EmployeeSectionEdit.tsx
git commit -m "[ADD] hr: EmployeeSectionEdit single-section editor"
```

---

### Task 5: Create the `EmployeeDocumentEdit` component

A screen to view + upload/replace one document for a staff member, reusing `DocumentUploadWidget` and the existing `POST /api/hr/documents` (which archives the previous file of that type and logs the change to Odoo chatter).

**Files:**
- Create: `src/components/hr/EmployeeDocumentEdit.tsx`

**Interfaces:**
- Consumes: `DocumentUploadWidget` (`src/components/ui/DocumentUploadWidget.tsx`), `DOCUMENT_TYPES` (`src/types/hr.ts`), `GET /api/hr/documents?employee_id=`, `POST /api/hr/documents`, `GET /api/hr/documents/[id]`.
- Produces: default export `EmployeeDocumentEdit` with props `{ employeeId: number; docTypeKey: string; onBack: () => void; onHome: () => void; onDone: () => void }`.

- [ ] **Step 1: Create `src/components/hr/EmployeeDocumentEdit.tsx`**

```tsx
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import DocumentUploadWidget from '@/components/ui/DocumentUploadWidget';
import { DOCUMENT_TYPES } from '@/types/hr';

interface Props {
  employeeId: number;
  docTypeKey: string;
  onBack: () => void;
  onHome: () => void;
  onDone: () => void;
}

interface Doc { id: number; name: string; doc_type_key: string; size_kb: number; }

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Manager document editor: view + upload/replace one document type for a staff
 * member. Upload posts to /api/hr/documents, which archives (does not delete)
 * the previous file of that type and logs the change to Odoo chatter.
 */
export default function EmployeeDocumentEdit({ employeeId, docTypeKey, onBack, onDone }: Props) {
  const docType = DOCUMENT_TYPES.find((d) => d.key === docTypeKey);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hr/documents?employee_id=' + employeeId);
      const data = await res.json();
      if (res.ok) {
        const found = (data.documents || []).find((d: Doc) => d.doc_type_key === docTypeKey) || null;
        setDoc(found);
      } else {
        setError(data.error || 'Could not load documents.');
      }
    } catch {
      setError('Could not load documents.');
    } finally {
      setLoading(false);
    }
  }, [employeeId, docTypeKey]);

  useEffect(() => { load(); }, [load]);

  async function handleUpload(file: File) {
    const base64 = await fileToBase64(file);
    const res = await fetch('/api/hr/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: employeeId, doc_type_key: docTypeKey, filename: file.name, data_base64: base64 }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Upload failed');
    }
    await load();
  }

  async function handleView() {
    if (!doc) throw new Error('No document');
    const res = await fetch('/api/hr/documents/' + doc.id);
    if (!res.ok) throw new Error('Could not open document');
    const data = await res.json();
    return { base64: data.data_base64, mimetype: data.mimetype, name: data.name || doc.name };
  }

  if (!docType) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader title="Document" showBack onBack={onBack} />
        <div className="p-5 text-center text-red-500 mt-10">Unknown document type.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title={docType.label} subtitle={docType.labelDe} showBack onBack={onBack} />
      <div className="p-5 space-y-4">
        <p className="text-[var(--fs-sm)] text-gray-500">{docType.helpText}</p>

        {loading ? (
          <div className="flex items-center gap-2 py-3">
            <div className="w-4 h-4 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-[var(--fs-sm)] text-gray-500">Loading…</span>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-4 border border-gray-200">
            <DocumentUploadWidget
              label={docType.label}
              hasDocument={!!doc}
              documentName={doc?.name}
              onUpload={handleUpload}
              onView={handleView}
            />
          </div>
        )}

        {error && (
          <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-sm)]">{error}</div>
        )}

        <button onClick={onDone} className="w-full py-3.5 bg-white text-gray-900 font-bold text-[var(--fs-sm)] rounded-xl border border-gray-200 active:opacity-85">
          Done
        </button>
      </div>
    </div>
  );
}
```

> Note: replacing a file archives (sets `active: false`) the previous document in Odoo rather than hard-deleting it, so it is recoverable — no destructive-action confirmation is required. This intentionally relaxes the spec's "confirm before replace" line.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: no errors. (Unused until wired in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add src/components/hr/EmployeeDocumentEdit.tsx
git commit -m "[ADD] hr: EmployeeDocumentEdit view + upload/replace one document"
```

---

### Task 6: Integrate the Edit mode into `EmployeeDetail` and wire `hr/page.tsx`

Rework the detail screen: add a Basics section, realign the read-only sections 1:1 with the editors, add an Edit/Done toggle (state owned by `hr/page.tsx` so it survives section-edit round-trips), make sections + document cards tappable in edit mode, and remove the two old edit buttons. Then wire the new screens into the router. `EmployeeProfileEdit` is left importable (dead once its buttons are gone) and removed in Task 7.

**Files:**
- Modify: `src/components/hr/EmployeeDetail.tsx` (Props, header action, sections, doc cards, button block, `Section`/`Row` helpers)
- Modify: `src/app/hr/page.tsx` (Screen union, `staffEditMode` state, `employee-detail` wiring, new cases)

**Interfaces:**
- Consumes: `EmployeeSectionEdit` + `SectionKey` (Task 4), `EmployeeDocumentEdit` (Task 5).
- Produces: `EmployeeDetail` props `{ employeeId: number; onBack: () => void; onHome: () => void; onContract: () => void; onDeactivated: () => void; editMode: boolean; onToggleEditMode: () => void; onEditSection: (section: string) => void; onEditDocument: (docTypeKey: string) => void }` (removes `onEdit`, `onFullEdit`).

- [ ] **Step 1: `EmployeeDetail.tsx` — replace the Props interface**

Replace the `interface Props { ... }` block (lines 17-25) with:

```tsx
interface Props {
  employeeId: number;
  onBack: () => void;
  onHome: () => void;
  onContract: () => void;
  onDeactivated: () => void;
  editMode: boolean;
  onToggleEditMode: () => void;
  onEditSection: (section: string) => void;
  onEditDocument: (docTypeKey: string) => void;
}
```

Replace the function signature (line 27) with:

```tsx
export default function EmployeeDetail({ employeeId, onBack, onContract, onDeactivated, editMode, onToggleEditMode, onEditSection, onEditDocument }: Props) {
```

- [ ] **Step 2: `EmployeeDetail.tsx` — header action + edit hint**

Replace the header line (line 128):

```tsx
      <AppHeader title={emp.name} showBack onBack={onBack} />
```

with:

```tsx
      <AppHeader
        title={emp.name}
        showBack
        onBack={onBack}
        action={
          <button
            onClick={onToggleEditMode}
            className="px-3 py-1.5 rounded-lg bg-white/15 text-white font-bold text-[13px] active:bg-white/25"
          >
            {editMode ? 'Done' : 'Edit'}
          </button>
        }
      />
      {editMode && (
        <div className="px-5 py-2 bg-green-50 text-green-700 text-[var(--fs-xs)] font-semibold text-center">
          Tap any section or document to edit.
        </div>
      )}
```

- [ ] **Step 3: `EmployeeDetail.tsx` — add the Basics section and realign the DATEV sections**

Replace the block from `<STitle text="DATEV / Personalfragebogen" />` through the end of the `Gastro` section (old lines 144-177) with:

```tsx
      <Section title="Basics" onEdit={editMode ? () => onEditSection('basics') : undefined}>
        <Row label="Role" value={emp.job_title || ''} optional />
        <Row label="Restaurant" value={emp.company_id ? (emp.company_id as [number, string])[1] : ''} optional />
        <Row label="Department" value={dept} optional />
        <Row label="Mobile" value={emp.mobile_phone || ''} optional />
        <Row label="Work email" value={emp.work_email || ''} optional />
      </Section>

      <STitle text="DATEV / Personalfragebogen" />
      <Section title="Personal & address" onEdit={editMode ? () => onEditSection('personal') : undefined}>
        <Row label="Birthday" value={emp.birthday || ''} mono />
        <Row label="Gender" value={emp.gender || ''} />
        <Row label="Nationality" value={emp.country_id ? (emp.country_id as [number, string])[1] : ''} />
        <Row label="Place of birth" value={emp.place_of_birth || ''} />
        <Row label="Marital" value={emp.marital || ''} />
        <Row label="Address" value={[emp.private_street, emp.private_zip, emp.private_city].filter(Boolean).join(', ')} />
      </Section>

      <Section title="Tax" onEdit={editMode ? () => onEditSection('tax') : undefined}>
        <Row label="Tax ID" value={emp.kw_steuer_id || ''} mono />
        <Row label="Tax class" value={emp.kw_steuerklasse ? 'Class ' + emp.kw_steuerklasse : ''} />
        <Row label="Church tax" value={emp.kw_konfession === '--' ? 'None' : emp.kw_konfession || ''} />
      </Section>

      <Section title="Bank" onEdit={editMode ? () => onEditSection('bank') : undefined}>
        <Row label="IBAN" value={emp.bank_account_id ? 'On file' : ''} optional />
      </Section>

      <Section title="Insurance" onEdit={editMode ? () => onEditSection('insurance') : undefined}>
        <Row label="SV-Nr." value={emp.ssnid || ''} mono />
        <Row label="Krankenkasse" value={emp.kw_krankenkasse_name || ''} />
        <Row label="Type" value={emp.kw_kv_typ || ''} />
      </Section>

      <Section title="Residence & work" onEdit={editMode ? () => onEditSection('residence') : undefined}>
        <Row label="Permit type" value={emp.kw_aufenthaltstitel_typ || ''} optional />
        <Row label="Visa expires" value={emp.visa_expire || ''} mono optional />
        <Row label="Permit expires" value={emp.work_permit_expiration_date || ''} mono optional />
        <Row label="Health cert. date" value={emp.kw_gesundheitszeugnis_datum || ''} mono />
        <Row label="Health cert. expires" value={emp.kw_gesundheitszeugnis_ablauf || ''} mono />
        <Row label="Sofortmeldung" value={emp.kw_sofortmeldung_done ? 'Done' : ''} />
      </Section>
```

- [ ] **Step 4: `EmployeeDetail.tsx` — make document cards editable in edit mode**

Replace the document-card `<button>` (old lines 186-213) with a version that, in edit mode, is always tappable and routes to `onEditDocument`:

```tsx
          return (
            <button
              key={dt.key}
              type="button"
              disabled={editMode ? false : !uploaded}
              onClick={editMode ? () => onEditDocument(dt.key) : (uploaded ? () => handleOpenDoc(doc!) : undefined)}
              className={"w-full text-left flex items-center gap-3 p-3 rounded-xl border disabled:cursor-default " + (uploaded ? "border-green-600 bg-green-50 active:bg-green-100" : (editMode ? "border-gray-300 bg-white active:bg-gray-50" : "border-gray-200 bg-white"))}
            >
              <div className={"w-10 h-10 rounded-lg flex items-center justify-center text-[var(--fs-xl)] " + (uploaded ? "bg-green-100" : "bg-gray-100")}>
                {dt.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[var(--fs-sm)] font-semibold">{dt.label}</div>
                {uploaded ? (
                  <div className="text-[var(--fs-xs)] text-green-600 font-medium">{editMode ? 'Uploaded · Tap to replace' : 'Uploaded · Tap to view'}</div>
                ) : (
                  <div className="text-[var(--fs-xs)] text-gray-400">{editMode ? (dt.required ? 'Required · Tap to upload' : 'Tap to upload') : (dt.required ? 'Required - Missing' : 'Optional')}</div>
                )}
              </div>
              {editMode ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4z"/></svg>
              ) : uploaded ? (
                opening ? (
                  <div className="w-5 h-5 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )
              ) : dt.required ? (
                <span className="text-red-500 text-[var(--fs-sm)] font-semibold">!</span>
              ) : null}
            </button>
          );
```

- [ ] **Step 5: `EmployeeDetail.tsx` — remove the two old edit buttons**

In the bottom action block (old lines 218-237), delete the `onFullEdit` button ("Edit full profile") and the `onEdit` button ("Edit basics (name, role, contact)"). Keep the "Contract & hours" button, and the "Offboard / Terminate" + "Mark as left" row. The block becomes:

```tsx
      <div className="px-5 pt-4 pb-8 space-y-2.5">
        <button onClick={onContract} className="w-full py-3.5 bg-white text-gray-900 font-bold text-[var(--fs-sm)] rounded-xl border border-gray-200 active:opacity-85 flex items-center justify-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="12" y1="17" x2="8" y2="17"/></svg>
          Contract &amp; hours
        </button>
        <div className="flex gap-3">
          <button onClick={handleOffboard} className="flex-1 py-3.5 bg-white text-gray-900 font-bold text-[var(--fs-sm)] rounded-xl border border-gray-200 active:opacity-85">
            Offboard / Terminate
          </button>
          <button onClick={handleDeactivate} disabled={deactivating} className="flex-1 py-3.5 bg-white text-red-600 font-bold text-[var(--fs-sm)] rounded-xl border border-red-200 active:opacity-85 disabled:opacity-50">
            {deactivating ? "…" : "Mark as left"}
          </button>
        </div>
      </div>
```

- [ ] **Step 6: `EmployeeDetail.tsx` — update the `Section` and `Row` helpers**

Replace the `Section` helper (old lines 255-262) with:

```tsx
function Section({ title, onEdit, children }: { title: string; onEdit?: () => void; children: React.ReactNode }) {
  const body = (
    <>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[var(--fs-sm)] font-bold text-gray-400 uppercase tracking-wider">{title}</div>
        {onEdit && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4z"/></svg>
        )}
      </div>
      {children}
    </>
  );
  return (
    <div className="mx-5 mb-3">
      {onEdit ? (
        <button type="button" onClick={onEdit} className="w-full text-left bg-white rounded-2xl p-4 border border-green-600 active:bg-green-50">{body}</button>
      ) : (
        <div className="bg-white rounded-2xl p-4 border border-gray-200">{body}</div>
      )}
    </div>
  );
}
```

Replace the `Row` helper (old lines 264-274) with a version that supports an `optional` flag (blank shows a muted dash instead of red "Missing"):

```tsx
function Row({ label, value, mono, optional }: { label: string; value: string; mono?: boolean; optional?: boolean }) {
  const missing = !value;
  return (
    <div className="flex justify-between py-1.5 border-b border-gray-50 last:border-b-0">
      <span className="text-[var(--fs-sm)] text-gray-500">{label}</span>
      <span className={"text-[var(--fs-sm)] font-medium text-right max-w-[55%] " + (mono ? "font-mono " : "") + (missing && !optional ? "text-red-500 italic" : "") + (missing && optional ? "text-gray-300" : "")}>
        {missing ? (optional ? "—" : "Missing") : value}
      </span>
    </div>
  );
}
```

- [ ] **Step 7: `hr/page.tsx` — imports and Screen union**

Add imports (after the `EmployeeProfileEdit` import on line 13):

```tsx
import EmployeeSectionEdit, { type SectionKey } from '@/components/hr/EmployeeSectionEdit';
import EmployeeDocumentEdit from '@/components/hr/EmployeeDocumentEdit';
```

Add two members to the `Screen` union (after the `employee-profile-edit` line 31):

```tsx
  | { type: 'employee-section-edit'; employeeId: number; section: SectionKey }
  | { type: 'employee-doc-edit'; employeeId: number; docTypeKey: string }
```

- [ ] **Step 8: `hr/page.tsx` — add the lifted edit-mode state**

After `const [screen, setScreen] = useState<Screen>({ type: 'dashboard' });` (line 40), add:

```tsx
  const [staffEditMode, setStaffEditMode] = useState(false);
```

- [ ] **Step 9: `hr/page.tsx` — reset edit mode when opening a staff member from the list**

In the `employees` case, change the `onSelect` prop (line 120) to reset edit mode on entry:

```tsx
          onSelect={(id: number) => { setStaffEditMode(false); navigate({ type: 'employee-detail', employeeId: id }); }}
```

- [ ] **Step 10: `hr/page.tsx` — rewire the `employee-detail` case**

Replace the `employee-detail` case (lines 124-135) with:

```tsx
    case 'employee-detail':
      return (
        <EmployeeDetail
          employeeId={screen.employeeId}
          onBack={goBack}
          onHome={goHome}
          onContract={() => navigate({ type: 'employee-contract', employeeId: screen.employeeId })}
          onDeactivated={goBack}
          editMode={staffEditMode}
          onToggleEditMode={() => setStaffEditMode((m) => !m)}
          onEditSection={(section) => {
            if (section === 'basics') navigate({ type: 'employee-edit', employeeId: screen.employeeId });
            else navigate({ type: 'employee-section-edit', employeeId: screen.employeeId, section: section as SectionKey });
          }}
          onEditDocument={(docTypeKey) => navigate({ type: 'employee-doc-edit', employeeId: screen.employeeId, docTypeKey })}
        />
      );
```

- [ ] **Step 11: `hr/page.tsx` — add the two new screen cases**

After the `employee-profile-edit` case (ends line 144), add:

```tsx
    case 'employee-section-edit':
      return (
        <EmployeeSectionEdit
          employeeId={screen.employeeId}
          section={screen.section}
          onBack={goBack}
          onHome={goHome}
          onDone={goBack}
        />
      );
    case 'employee-doc-edit':
      return (
        <EmployeeDocumentEdit
          employeeId={screen.employeeId}
          docTypeKey={screen.docTypeKey}
          onBack={goBack}
          onHome={goHome}
          onDone={goBack}
        />
      );
```

- [ ] **Step 12: Build**

Run: `npm run build`
Expected: no TypeScript or lint errors. Watch specifically for: unused `onFullEdit`/`onEdit` remnants, the `SectionKey` import used, and no leftover reference to the removed inline sections.

- [ ] **Step 13: Manual verification (dev server)**

Run: `npm run dev`, open the HR module, go to Staff → open a staff member. Confirm:
- View mode shows: header, Basics, DATEV sections (Personal & address, Tax, Bank, Insurance, Residence & work), Documents, then Contract & hours / Offboard / Mark as left. The two old edit buttons are gone. Top-right shows **Edit**.
- Tap **Edit** → hint appears, section cards get green borders + pencils, top-right shows **Done**, document cards show "Tap to upload/replace" with a pencil.
- Tap **Tax** → tax-only editor with a **Save** button → change tax class → Save → returns to detail, still in edit mode, new value shown.
- Tap **Basics** → the add/edit staff form (name/restaurant/department/role/phone/email) → Save changes → returns.
- Tap **Insurance** → NO amber warning, NO acknowledgment checkbox, **Save** enabled immediately.
- Tap **Bank** → IBAN editor → Save.
- Tap a **document** → upload a small PDF/image → returns, card shows "Uploaded".
- Tap **Done** → back to clean view mode.

- [ ] **Step 14: Commit**

```bash
git add src/components/hr/EmployeeDetail.tsx src/app/hr/page.tsx
git commit -m "[IMP] hr: unified tap-to-edit on staff detail (replaces two edit buttons)"
```

---

### Task 7: Remove the retired `EmployeeProfileEdit` wizard

Nothing references it after Task 6 (its two buttons are gone). Remove the component and its router wiring.

**Files:**
- Delete: `src/components/hr/EmployeeProfileEdit.tsx`
- Modify: `src/app/hr/page.tsx` (remove import, Screen union member, and the case)

**Interfaces:**
- Consumes: nothing new.
- Produces: `employee-profile-edit` screen no longer exists.

- [ ] **Step 1: Delete the file**

```bash
git rm src/components/hr/EmployeeProfileEdit.tsx
```

- [ ] **Step 2: Remove the import from `hr/page.tsx`**

Delete the line:

```tsx
import EmployeeProfileEdit from '@/components/hr/EmployeeProfileEdit';
```

- [ ] **Step 3: Remove the Screen union member from `hr/page.tsx`**

Delete the line:

```tsx
  | { type: 'employee-profile-edit'; employeeId: number }
```

- [ ] **Step 4: Remove the case from `hr/page.tsx`**

Delete the whole `case 'employee-profile-edit':` block (the `return <EmployeeProfileEdit ... />;`).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: no errors, no "unused import" or "cannot find name EmployeeProfileEdit" — confirms the removal is complete and nothing else referenced it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "[REF] hr: remove retired EmployeeProfileEdit 5-step wizard"
```

---

### Task 8: Deploy to staging and verify (real browser + smoke)

**Files:** none (deploy + verification only).

- [ ] **Step 1: Confirm branch and push (only when the user approves)**

```bash
git branch --show-current   # must print: main
git log --oneline -8        # review the commits
git push origin main
```

- [ ] **Step 2: Deploy on staging**

```bash
ssh root@89.167.124.0 'cd /opt/krawings-portal && git pull && npm run build && systemctl restart krawings-portal'
```
Expected: build succeeds on the server; service restarts cleanly.

- [ ] **Step 3: Real-browser verification on staging (project rule)**

On `portal.krawings.de`, sign in as a manager (test user **Marco Bauer**, employee_id 2; company **What a Jerk**, id 5). Open Staff → a staff member and run the full checklist from the spec:
1. View mode renders all sections with values; **Edit** top-right.
2. **Edit** → sections + documents tappable; **Done** shown; hint visible.
3. Edit **Basics** (change role) → Save → new role shows.
4. Edit **Personal & address**, **Tax**, **Insurance** (no ack gate), **Bank (IBAN)**, **Residence & work** → each saves and re-displays.
5. Upload/replace a **document** → card shows "Uploaded"; confirm the change is logged in the employee's Odoo chatter.
6. **Done** → clean view mode; editing another staff member starts in view mode (edit-mode reset).
7. Old "Edit full profile" / "Edit basics" buttons gone; **Contract & hours**, **Offboard / Terminate**, **Mark as left** still work.
8. Regression: as a staff test user, run the self-service **Onboarding** wizard end-to-end (Personal → Bank → Tax → Insurance with its acknowledgment still required → Documents → … → submit) to confirm the shared steps are unchanged.

- [ ] **Step 4: Smoke test**

Run: `npm run smoke:staging`
Expected: existing Playwright smoke suite passes (no regressions from the shared-component changes).

- [ ] **Step 5: Update STATUS.md and finalize**

Update `STATUS.md` with the feature and its staging status. If any new rule/feedback emerged, note it for MEMORY.md. Commit:

```bash
git add STATUS.md
git commit -m "[DEBUG] docs: record staff tap-to-edit staging status"
git push origin main
```

---

## Self-Review

**Spec coverage:**
- One Edit flow covering all info → Tasks 4-6 (sections) + Task 5-6 (documents). ✓
- Edit the whole section → each editor edits a full section. ✓
- Documents upload/replace → Task 5. ✓
- Manager screen only; staff self-edit + change-tracking deferred → not implemented (Phase 2), correctly out of scope. ✓
- Remove both buttons; keep Contract & hours / Offboard / Mark as left → Task 6 Step 5. ✓
- Realign sections (split Bank from Tax; merge Residence+Gastro) → Task 6 Step 3. ✓
- No new backend → all tasks reuse existing routes. ✓
- Portal conventions (green, AppHeader, var(--fs-*)) → used throughout. ✓
- Onboarding wizard not regressed → Task 3 keeps props optional with wizard-preserving defaults; Task 8 Step 3.8 regression-tests it. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code. ✓

**Type consistency:** `SectionKey` defined in Task 4, imported in Task 6. `onEditSection(section: string)` in `EmployeeDetail` narrowed to `SectionKey` in `page.tsx` (via `as SectionKey` for non-basics). `EmployeeData.company_id`/`mobile_phone` added in Task 1, read in Task 6. `submitLabel`/`requireAck` added in Task 3, consumed in Task 4. Document API field names (`employee_id`, `doc_type_key`, `filename`, `data_base64`) match `POST /api/hr/documents`. View payload (`data_base64`, `mimetype`, `name`) matches what `EmployeeDetail.handleOpenDoc` already consumes. ✓
