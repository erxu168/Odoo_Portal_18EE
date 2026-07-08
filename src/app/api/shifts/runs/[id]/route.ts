/**
 * GET  /api/shifts/runs/[id]?company_id= — one run + coverage gaps.
 * POST /api/shifts/runs/[id]             — transition { action, select_deadline? }:
 *   'extend' | 'reopen' (both require a future deadline → state 'open'),
 *   'finalize' (→ state 'finalized'). Transitions never delete slots or picks.
 * Manager only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireManagerCompany, serverError } from '../../_manager';
import {
  getPublishRun,
  publishRunSlotIds,
  setPublishRunDeadline,
  setPublishRunState,
} from '@/lib/shifts-db';
import { fetchWeekSlots } from '@/lib/shifts-odoo';
import { effectivePublishState } from '@/lib/shifts-patterns';

export const dynamic = 'force-dynamic';

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireManagerCompany(req.nextUrl.searchParams.get('company_id'));
  if (!auth.ok) return auth.res;
  try {
    const id = parseId(params.id);
    if (id === null) return NextResponse.json({ error: 'Invalid run id' }, { status: 400 });
    const run = getPublishRun(id, auth.companyId);
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

    const now = new Date().toISOString();
    const state = effectivePublishState(run.state, run.selectDeadline, now);
    if (state === 'locked' && run.state === 'open') {
      setPublishRunState(id, auth.companyId, 'locked');
    }

    const runSlotIds = new Set(publishRunSlotIds(id));
    const weekSlots = await fetchWeekSlots(auth.companyId, run.weekKey);
    const runSlots = weekSlots.filter(s => runSlotIds.has(s.id));
    const open = runSlots.filter(s => s.employeeId === null).length;

    return NextResponse.json({ run: { ...run, state }, gaps: { open, total: runSlots.length } });
  } catch (err: unknown) {
    return serverError('GET runs/[id]', err);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;

    const id = parseId(params.id);
    if (id === null) return NextResponse.json({ error: 'Invalid run id' }, { status: 400 });
    const run = getPublishRun(id, auth.companyId);
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

    const action = body.action;
    if (action === 'finalize') {
      setPublishRunState(id, auth.companyId, 'finalized');
      return NextResponse.json({ ok: true, state: 'finalized' });
    }
    if (action === 'extend' || action === 'reopen') {
      const deadlineMs = typeof body.select_deadline === 'string' ? Date.parse(body.select_deadline) : NaN;
      if (!Number.isFinite(deadlineMs)) {
        return NextResponse.json({ error: 'A valid deadline is required' }, { status: 400 });
      }
      if (deadlineMs <= Date.now()) {
        return NextResponse.json({ error: 'The deadline must be in the future' }, { status: 400 });
      }
      setPublishRunDeadline(id, auth.companyId, new Date(deadlineMs).toISOString());
      setPublishRunState(id, auth.companyId, 'open');
      return NextResponse.json({ ok: true, state: 'open' });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: unknown) {
    return serverError('POST runs/[id]', err);
  }
}
