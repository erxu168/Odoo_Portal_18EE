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

