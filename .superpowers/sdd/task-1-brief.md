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

