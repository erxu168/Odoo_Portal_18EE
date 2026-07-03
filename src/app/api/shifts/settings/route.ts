/**
 * GET /api/shifts/settings?company_id= — read the company's shift settings.
 * PUT /api/shifts/settings — update them (manager only).
 *
 * PUT body: {company_id, requireApproval?, answerDeadlineHours?,
 * settleBufferHours?, allowAskAll?, allowSickReport?}. Missing fields keep
 * their current values; the saved ShiftSettings object is returned.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getShiftSettings, saveShiftSettings } from '@/lib/shifts-db';
import type { ShiftSettings } from '@/types/shifts';
import { requireManagerCompany, serverError } from '../_manager';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = requireManagerCompany(req.nextUrl.searchParams.get('company_id'));
    if (!auth.ok) return auth.res;
    return NextResponse.json(getShiftSettings(auth.companyId));
  } catch (err: unknown) {
    return serverError('GET settings', err);
  }
}

function readBool(v: unknown, fallback: boolean): boolean | null {
  if (v === undefined) return fallback;
  return typeof v === 'boolean' ? v : null;
}

function readHours(v: unknown, fallback: number): number | null {
  if (v === undefined) return fallback;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 168 ? v : null;
}

export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const auth = requireManagerCompany(body.company_id);
    if (!auth.ok) return auth.res;
    const { companyId } = auth;

    const current = getShiftSettings(companyId);
    const requireApproval = readBool(body.requireApproval, current.requireApproval);
    const allowAskAll = readBool(body.allowAskAll, current.allowAskAll);
    const allowSickReport = readBool(body.allowSickReport, current.allowSickReport);
    const answerDeadlineHours = readHours(body.answerDeadlineHours, current.answerDeadlineHours);
    const settleBufferHours = readHours(body.settleBufferHours, current.settleBufferHours);

    if (
      requireApproval === null ||
      allowAskAll === null ||
      allowSickReport === null ||
      answerDeadlineHours === null ||
      settleBufferHours === null
    ) {
      return NextResponse.json({ error: 'Invalid settings values' }, { status: 400 });
    }

    const settings: ShiftSettings = {
      companyId,
      requireApproval,
      answerDeadlineHours,
      settleBufferHours,
      allowAskAll,
      allowSickReport,
    };
    saveShiftSettings(settings);

    return NextResponse.json(settings);
  } catch (err: unknown) {
    return serverError('PUT settings', err);
  }
}
