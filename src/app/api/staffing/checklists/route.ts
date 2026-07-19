/**
 * Staff Lifecycle Checklists — instances.
 * GET  /api/staffing/checklists?employee_id=  → a person's checklists + progress (manager)
 * POST /api/staffing/checklists               → start a checklist (manager)
 *
 * Server re-reads employee/termination from Odoo and derives company, department,
 * manager, level and reference date — the client is never trusted for those.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireCapability, AuthError } from '@/lib/auth';
import { canAccessCompany } from '@/lib/inventory-access';
import { berlinToday } from '@/lib/berlin-date';
import { getEmployeeContext, getTerminationContext, resolveCompanyAdminUserId } from '@/lib/staffing-odoo';
import {
  startInstance, getInstancesForEmployee, getInstanceCounts, SetupIncompleteError,
} from '@/lib/staffing-checklist-db';
import type { Stage } from '@/types/staffing';

export async function GET(req: NextRequest) {
  try {
    const user = requireCapability('staffing.instances.manage');
    const employeeId = Number(new URL(req.url).searchParams.get('employee_id'));
    if (!employeeId) return NextResponse.json({ error: 'employee_id required' }, { status: 400 });
    const ctx = await getEmployeeContext(employeeId);
    if (!ctx) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    if (!canAccessCompany(user, ctx.companyId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    // Only instances in companies this user may access — never leak historical
    // instances snapshotted under another company (e.g. after a transfer).
    const instances = getInstancesForEmployee(employeeId)
      .filter(i => canAccessCompany(user, i.company_id))
      .map(i => ({ ...i, ...getInstanceCounts(i.id) }));
    return NextResponse.json({ instances });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] GET checklists', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = requireCapability('staffing.instances.manage');
    const b = await req.json();
    const employeeId = Number(b.employee_id);
    const stage = b.stage as Stage;
    if (!employeeId || !['joining', 'promotion', 'leaving'].includes(stage)) {
      return NextResponse.json({ error: 'employee_id and a valid stage are required' }, { status: 400 });
    }

    const ctx = await getEmployeeContext(employeeId);
    if (!ctx) return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    if (!canAccessCompany(user, ctx.companyId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Promotion target is validated (only the two defined step-ups exist).
    const targetLevel = stage === 'promotion' ? (b.target_level != null ? String(b.target_level) : null) : null;
    if (stage === 'promotion' && !(targetLevel === '2' || targetLevel === '3')) {
      return NextResponse.json({ error: 'Invalid promotion target level.' }, { status: 400 });
    }

    // Reference date + termination linkage. Any client-supplied date must be a
    // valid YYYY-MM-DD; everything else (team, dates) is derived server-side.
    let referenceDate = typeof b.reference_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.reference_date)
      ? b.reference_date : null;
    let terminationId: number | null = null;
    if (stage === 'leaving' && b.termination_id) {
      const term = await getTerminationContext(Number(b.termination_id));
      if (!term || term.employeeId !== employeeId) {
        return NextResponse.json({ error: 'Termination does not match this employee' }, { status: 400 });
      }
      if (!canAccessCompany(user, term.companyId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      terminationId = term.id;
      referenceDate = referenceDate || term.lastWorkingDay;
    }
    if (stage === 'joining') referenceDate = referenceDate || ctx.firstContractDate;
    referenceDate = referenceDate || berlinToday();

    // Team is the employee's own department (server-derived) — never client-chosen,
    // so a manager can't attach another team's list.
    const departmentId = ctx.departmentId;
    const departmentName = ctx.departmentName;

    // Guard: one open instance per stage.
    const openSame = getInstancesForEmployee(employeeId).find(i => i.stage === stage && i.status === 'open');
    if (openSame) {
      return NextResponse.json({ error: 'A checklist for this stage is already open.', id: openSame.id }, { status: 409 });
    }

    let id: number;
    try {
      id = startInstance({
        employeeId, companyId: ctx.companyId, stage,
        departmentId: stage === 'promotion' ? null : departmentId,
        departmentName: stage === 'promotion' ? null : departmentName,
        targetLevel,
        fromLevel: stage === 'promotion' ? (b.from_level != null ? String(b.from_level) : ctx.level) : null,
        referenceDate,
        startedBy: user.id,
        terminationId,
        managerEmployeeId: ctx.managerEmployeeId,
        adminUserId: resolveCompanyAdminUserId(ctx.companyId),
        startKey: typeof b.start_key === 'string' && b.start_key ? b.start_key : randomUUID(),
      });
    } catch (e: unknown) {
      if (e instanceof SetupIncompleteError) {
        return NextResponse.json({ error: 'No checklist is set up for this stage yet. Ask an admin to create one in Checklist Setup.' }, { status: 409 });
      }
      throw e;
    }
    return NextResponse.json({ id }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error('[staffing] POST checklist', err);
    return NextResponse.json({ error: 'Failed to start checklist' }, { status: 500 });
  }
}
