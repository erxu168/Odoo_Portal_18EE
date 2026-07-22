import { getCurrentUser, hasRole } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { getOdoo } from '@/lib/odoo';

/**
 * May `user` read/write the hr.employee record `targetEmployeeId`? The single
 * source of truth for employee-record authorization (personnel data is PII/
 * DATEV, so this must be consistent across the employee page and every HR
 * sub-route). Self is always allowed. Otherwise the caller must be a manager
 * AND — because portal roles are global — share a company with the target
 * employee, so a manager of one restaurant cannot reach another's staff.
 * Admins are cross-company by design. A manager/admin with no employee link of
 * their own is still authorized by role (the self shortcut just doesn't apply).
 */
export async function canAccessEmployee(
  user: NonNullable<ReturnType<typeof getCurrentUser>>,
  targetEmployeeId: number,
): Promise<boolean> {
  if (user.employee_id != null && targetEmployeeId === user.employee_id) return true;
  if (!hasRole(user, 'manager')) return false;
  if (user.role === 'admin') return true;
  const allowed = parseCompanyIds(user.allowed_company_ids);
  if (allowed.length === 0) return false;
  const emps = await getOdoo().read('hr.employee', [targetEmployeeId], ['company_id']);
  const cid = emps?.[0]?.company_id;
  const companyId = Array.isArray(cid) ? (cid[0] as number) : typeof cid === 'number' ? cid : null;
  return companyId !== null && allowed.includes(companyId);
}

/**
 * May `user` read/write the termination record `terminationId`? Resolves the
 * record's employee and defers to canAccessEmployee — so a manager can only
 * touch a termination for a staff member of their own restaurant.
 */
export async function canAccessTermination(
  user: NonNullable<ReturnType<typeof getCurrentUser>>,
  terminationId: number,
): Promise<boolean> {
  const recs = await getOdoo().read('kw.termination', [terminationId], ['employee_id']);
  const emp = recs?.[0]?.employee_id;
  const employeeId = Array.isArray(emp) ? (emp[0] as number) : typeof emp === 'number' ? emp : null;
  if (employeeId == null) return false;
  return canAccessEmployee(user, employeeId);
}
