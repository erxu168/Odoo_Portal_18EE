/**
 * Staff Lifecycle Checklists — read-only Odoo helpers.
 *
 * The checklist feature reads employee/termination context from Odoo to resolve
 * team, manager, dates and level; it never writes to Odoo.
 *
 * Level = hr.employee.x_skill_level ('1'=Trainee, '2'=Associate, '3'=Team Lead).
 */
import { getOdoo } from './odoo';
import { listUsers } from './db';

const m2oId = (v: unknown): number | null => (Array.isArray(v) ? (v[0] as number) : null);
const m2oName = (v: unknown): string | null => (Array.isArray(v) ? (v[1] as string) : null);
const asDate = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export interface EmployeeContext {
  employeeId: number;
  name: string;
  companyId: number;
  departmentId: number | null;
  departmentName: string | null;
  managerEmployeeId: number | null;
  firstContractDate: string | null;
  level: string | null;
}

export async function getEmployeeContext(employeeId: number): Promise<EmployeeContext | null> {
  const odoo = getOdoo();
  const rows = await odoo.searchRead('hr.employee', [['id', '=', employeeId]],
    ['name', 'company_id', 'department_id', 'parent_id', 'first_contract_date', 'x_skill_level'],
    { limit: 1 });
  const e = rows?.[0] as Record<string, unknown> | undefined;
  if (!e) return null;
  return {
    employeeId,
    name: (e.name as string) || '',
    companyId: m2oId(e.company_id) || 0,
    departmentId: m2oId(e.department_id),
    departmentName: m2oName(e.department_id),
    managerEmployeeId: m2oId(e.parent_id),
    firstContractDate: asDate(e.first_contract_date),
    level: e.x_skill_level ? String(e.x_skill_level) : null,
  };
}

export interface TerminationContext {
  id: number;
  employeeId: number;
  companyId: number;
  lastWorkingDay: string | null;
}

export async function getTerminationContext(terminationId: number): Promise<TerminationContext | null> {
  const odoo = getOdoo();
  const rows = await odoo.searchRead('kw.termination', [['id', '=', terminationId]],
    ['employee_id', 'company_id', 'last_working_day', 'letter_date'], { limit: 1 });
  const t = rows?.[0] as Record<string, unknown> | undefined;
  if (!t) return null;
  return {
    id: terminationId,
    employeeId: m2oId(t.employee_id) || 0,
    companyId: m2oId(t.company_id) || 0,
    lastWorkingDay: asDate(t.last_working_day) || asDate(t.letter_date),
  };
}

/**
 * A deterministic active admin portal-user id for a company — the fallback owner
 * for manager tasks when the employee's manager has no portal account. Lowest id
 * among admins with access to the company; null if none exist.
 */
export function resolveCompanyAdminUserId(companyId: number): number | null {
  const admins = listUsers()
    .filter(u => u.role === 'admin' && u.active && u.status === 'active')
    .filter(u => {
      let ids: number[] = [];
      try { ids = JSON.parse(u.allowed_company_ids || '[]'); } catch { ids = []; }
      return ids.length === 0 || ids.includes(companyId);
    })
    .sort((a, b) => a.id - b.id);
  return admins[0]?.id ?? null;
}
