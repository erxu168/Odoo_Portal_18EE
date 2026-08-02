export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { authorize, initHandoverTables, resolveCompany, jsonError } from '@/lib/shift-handover/route-helpers';
import { CAP } from '@/lib/shift-handover/access';
import { getStorageItem, clearStorageItem, getIdempotentResult, parseAmount, CLEAR_REASONS, type ClearReason } from '@/lib/shift-handover/db';

// POST — clear an "In storage now" item, recording WHY it left:
// moved_out | used_up | discarded. Optional `amount` clears only PART of it (the
// rest stays); omit it, or use >= the whole amount, to clear all. An optional
// `idempotency_key` makes a retried/duplicate submit safe. Any staff on shift.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const authz = authorize(CAP.post, { requireResolvedActor: true });
  if (!authz.ok) return jsonError(authz.status, authz.error);
  initHandoverTables();
  const companyId = resolveCompany(request, authz.user);
  if (!companyId) return jsonError(400, 'Choose a restaurant first.');

  const body = await request.json().catch(() => ({}));
  const reason = body?.reason as ClearReason;
  if (!CLEAR_REASONS.includes(reason)) return jsonError(400, 'Say what happened to it.');

  const item = getStorageItem(parseInt(params.id, 10));
  if (!item || item.company_id !== companyId) return jsonError(404, 'Item not found.');

  // A supplied amount means "just some"; only a truly-absent amount clears all.
  let usedAmount: number | null = null;
  const rawAmt = body?.amount;
  if (rawAmt !== undefined) {
    if (rawAmt === null || rawAmt === '') return jsonError(400, 'Enter how much was used.');
    const used = parseAmount(rawAmt);
    if (!Number.isFinite(used) || used <= 0) return jsonError(400, 'Enter how much was used.');
    usedAmount = used;
  }

  const idemKey = typeof body?.idempotency_key === 'string' ? body.idempotency_key : null;
  if (idemKey) {
    const prior = getIdempotentResult(idemKey, companyId, 'clear');
    if (prior != null) return NextResponse.json({ ok: true, deduped: true });
  }

  const res = clearStorageItem(companyId, authz.actor, item.id, reason, usedAmount, idemKey);
  if (res.deduped) return NextResponse.json({ ok: true, deduped: true });
  if (!res.ok) return jsonError(409, 'That item was already cleared.');
  return NextResponse.json({ ok: true, reason, cleared: res.cleared, remaining: res.remaining });
}
