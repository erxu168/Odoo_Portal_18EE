/**
 * GET /api/staffing/checklists/preview?employee_id=&stage=&department_id?=&target_level?=
 * Non-destructive: returns what a start WOULD create (counts, reference date, warnings)
 * so the confirm prompt can show "6 base + 3 Kitchen = 9". Creates nothing.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCapability, AuthError } from '@/lib/auth';
import { canAccessCompany } from '@/lib/inventory-access';
import { berlinToday } from '@/lib/berlin-date';
import { getEmployeeContext } from '@/lib/staffing-odoo';
import { previewMergedTasks } from '@/lib/staffing-checklist-db';
import type { Stage } from '@/types/staffing';

export async function GET(req: NextRequest) {
  try {
    const user = requireCapability('staffing.instances.manage');
    const sp = new URL(req.url).searchParams;
    const employeeId = Number(sp.get('employee_id'));
    const stage = sp.get('stage') as Stage;
    if (!employeeId || !['joining', 'promotion', 'leaving'].includes(stage)) {
      return NextResponse.json({ error: 'employee_id and a valid stage are required' }, { status: 400 });
    }
    const ctx = await getEmployeeContext(employeeId);
    if (!ctx) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    if (!canAccessCompany(user, ctx.companyId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const departmentId = sp.get('department_id') != null && sp.get('department_id') !== ''
      ? Number(sp.get('department_id')) : ctx.departmentId;
    const targetLevel = sp.get('target_level');

    const counts = previewMergedTasks(
      ctx.companyId, stage,
      stage === 'promotion' ? null : departmentId,
      stage === 'promotion' ? targetLevel : null,
    );
    const referenceDate = stage === 'joining'
      ? (ctx.firstContractDate || berlinToday())
      : berlinToday();

    return NextResponse.json({
      ...counts,
      setupComplete: counts.total > 0,
      referenceDate,
      hasContractDate: !!ctx.firstContractDate,
      departmentId: stage === 'promotion' ? null : departmentId,
      departmentName: ctx.departmentName,
      employeeName: ctx.name,
      currentLevel: ctx.level,
    });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] GET preview', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
