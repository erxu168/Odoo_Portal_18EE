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

