/**
 * POST /api/shifts/sick-reports/[id]/resolve {company_id, action:'reopen'|'keep'}
 *
 * Manager resolves a sick report from the approvals queue:
 * - reopen: any active cover request on the slot is invalidated first, then
 *   the slot is unassigned (resource_id = false) and kept published so it goes
 *   back to the open pool; over-cap flags are recomputed for the former
 *   assignee's week. Odoo write happens BEFORE the SQLite resolve CAS.
 * - keep: the shift stays assigned; the report is just closed.
 */
import { NextRequest, NextResponse } from 'next/server';
import { listSickReports, resolveSickReport } from '@/lib/shifts-db';
import { invalidateActiveRequestsForSlot } from '@/lib/shifts-guards';
import { fetchSlot, recomputeWeekFlags, updateSlot } from '@/lib/shifts-odoo';
import { berlinISOWeekKey } from '@/lib/shifts-time';
import { requireManagerCompany, serverError } from '../../../_manager';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const reportId = parseInt(params.id, 10);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      return NextResponse.json({ error: 'Invalid report id' }, { status: 400 });
    }
    const action = body.action;
    if (action !== 'reopen' && action !== 'keep') {
      return NextResponse.json({ error: 'action must be "reopen" or "keep"' }, { status: 400 });
    }

    const report = listSickReports(companyId).find(r => r.id === reportId);
    if (!report) {
      return NextResponse.json({ error: 'Sick report not found' }, { status: 404 });
    }
    if (report.status === 'resolved') {
      return NextResponse.json({ ok: true }); // idempotent — already handled
    }

    if (action === 'reopen') {
      const slot = await fetchSlot(report.slotId);
      if (slot) {
        // Unassigning invalidates any active cover request on the slot first.
        await invalidateActiveRequestsForSlot(slot.id, 'The shift was reopened after a sick report.');
        await updateSlot(slot.id, { resourceId: null, state: 'published' });
        if (slot.employeeId !== null) {
          await recomputeWeekFlags(companyId, berlinISOWeekKey(slot.start), [slot.employeeId]);
        }
      } else {
        console.warn(`[shifts] Sick report ${reportId}: slot ${report.slotId} no longer exists — resolving anyway`);
      }
    }

    // CAS open → resolved; a raced double-resolve is treated as success.
    resolveSickReport(reportId, action === 'reopen' ? 'reopened' : 'kept');

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return serverError('POST sick-reports/resolve', err);
  }
}
