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

