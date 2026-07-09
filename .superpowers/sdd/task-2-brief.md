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

