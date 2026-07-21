import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, AuthError } from '@/lib/auth';
import { parseCompanyIds } from '@/lib/db';
import { resolveAttribution } from '@/lib/shift-attribution';
import { uploadLinePhoto, resyncSetupGuide, getListLineScope } from '@/lib/odoo-tasks';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = requireAuth();
    const id = parseInt(params.id, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const body = await req.json();
    if (!body.data_base64 || !body.filename) {
      return NextResponse.json({ error: 'data_base64 and filename are required' }, { status: 400 });
    }
    // Scope the write: the line must be in an allowed company and not a past
    // (read-only) day — closes a proof-photo IDOR (also gates the resync below).
    const scope = await getListLineScope(id);
    if (!scope) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    const allowed = parseCompanyIds(user.allowed_company_ids);
    if (allowed.length && scope.companyId && !allowed.includes(scope.companyId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (scope.date && scope.date < new Date().toISOString().slice(0, 10)) {
      return NextResponse.json({ error: 'Past task lists are read-only' }, { status: 403 });
    }
    const result = await uploadLinePhoto(id, body.filename, body.data_base64);
    // If this line is a photo-required setup guide with all pins done, the proof
    // photo now satisfies the gate — re-drive completion (no-op otherwise).
    // Best-effort: the photo is already saved, so a resync hiccup must not fail
    // the request (the next pin toggle re-syncs; guides default proof-off anyway).
    const { employeeId } = resolveAttribution(user);
    if (employeeId) {
      try { await resyncSetupGuide(id, employeeId); } catch { /* leave pending; re-syncs on next toggle */ }
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    const message = err instanceof Error ? err.message : 'Failed to upload photo';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
