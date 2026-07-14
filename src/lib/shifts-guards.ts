/**
 * Shifts module — cover-request state-machine guards.
 *
 * The guards here are non-negotiable (see build spec):
 * - Accept (teammate): now < answer_deadline; now < slot.start − settle_buffer;
 *   slot re-read live: exists, still published, resource still == the
 *   requester's resource, role unchanged vs snapshot, acceptor role-eligible
 *   and not overlapping-scheduled. Any failed guard → never write Odoo.
 * - Approve (manager / auto): same live guards; idempotent — if the slot's
 *   resource is already the target's, the caller skips the Odoo write and just
 *   finalizes the request.
 * - Expiry is enforced inside every mutation (lazyExpireIfDue), never at
 *   render time only: answer_deadline (pending_teammate) or
 *   slot.start − settle_buffer (both pending states).
 */
import { getOdoo } from '@/lib/odoo';
import {
  casTransition,
  getActiveCoverRequestForSlot,
  getCoverRequest,
  getShiftSettings,
} from '@/lib/shifts-db';
import { notifyEmployee, notifyManagers } from '@/lib/shifts-notify';
import { fetchEmployees, fetchSlot } from '@/lib/shifts-odoo';
import { fmtDay, fmtTimeRange, odooToDate } from '@/lib/shifts-time';
import type { CoverRequest, ShiftSettings, ShiftSlot, SlotSnapshot } from '@/types/shifts';

const HOUR_MS = 3_600_000;

type AcceptFailCode = 'expired' | 'slot_changed' | 'not_eligible' | 'too_late' | 'overlap';

export type RevalidateAcceptResult =
  | { ok: true; slot: ShiftSlot }
  | { ok: false; code: AcceptFailCode; message: string };

export type RevalidateApproveResult =
  | { ok: true; slot: ShiftSlot; toResourceId: number }
  | { ok: false; code: string; message: string };

/** Slot summary {day, time, roleName} for notification payloads. */
function slotSummary(slot: ShiftSlot | null, snap: SlotSnapshot): { day: string; time: string; roleName: string } {
  const start = slot?.start || snap.start;
  const end = slot?.end || snap.end;
  return {
    day: start ? fmtDay(start) : '',
    time: start && end ? fmtTimeRange(start, end) : '',
    roleName: slot?.roleName || '',
  };
}

function logNotifyError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[shifts] Notification during expiry failed (ignored): ${msg}`);
}

/** Does the employee already have any scheduled (assigned) slot overlapping [start, end)? */
async function hasOverlappingSlot(
  employeeId: number,
  startOdoo: string,
  endOdoo: string,
  excludeSlotId: number,
): Promise<boolean> {
  const rows = (await getOdoo().searchRead(
    'planning.slot',
    [
      ['employee_id', '=', employeeId],
      ['start_datetime', '<', endOdoo],
      ['end_datetime', '>', startOdoo],
      ['id', '!=', excludeSlotId],
    ],
    ['id'],
    { limit: 1 },
  )) as Record<string, unknown>[];
  return rows.length > 0;
}

/**
 * Lazily expire a pending request when its deadline has passed.
 * Expiry rule: answer_deadline (pending_teammate only) OR
 * slot.start − settle_buffer (both pending states). Performs the CAS itself;
 * if the CAS loses a race the freshly-loaded request is returned instead.
 * Notifies requester + managers ("no cover arranged — you still work this
 * shift") fire-and-forget, since this helper is synchronous by contract.
 */
export function lazyExpireIfDue(
  req: CoverRequest,
  slot: ShiftSlot | null,
  settings: ShiftSettings,
): CoverRequest {
  if (req.status !== 'pending_teammate' && req.status !== 'pending_manager') return req;

  const now = Date.now();
  let due = false;

  if (req.status === 'pending_teammate') {
    const deadline = Date.parse(req.answerDeadline);
    if (Number.isFinite(deadline) && now >= deadline) due = true;
  }
  if (!due) {
    const startOdoo = slot?.start || req.slotSnapshot.start;
    if (startOdoo) {
      const settleCutoff = odooToDate(startOdoo).getTime() - settings.settleBufferHours * HOUR_MS;
      if (now >= settleCutoff) due = true;
    }
  }
  if (!due) return req;

  const swapped = casTransition(req.id, ['pending_teammate', 'pending_manager'], 'expired');
  if (!swapped) {
    // State moved underneath — reload and surface the real state.
    return getCoverRequest(req.id) ?? req;
  }

  const summary = slotSummary(slot, req.slotSnapshot);
  const payload = {
    ...summary,
    requestId: req.id,
    slotId: req.slotId,
    fromEmployeeId: req.fromEmployeeId,
    fromName: slot?.employeeName || '',
    message: 'No cover arranged — you still work this shift.',
  };
  void notifyEmployee(req.fromEmployeeId, req.companyId, 'cover_expired', payload).catch(logNotifyError);
  void notifyManagers(req.companyId, 'cover_expired', payload).catch(logNotifyError);

  return { ...req, status: 'expired', updatedAt: new Date().toISOString() };
}

/**
 * Re-validate a cover request for a teammate accept, against the LIVE slot.
 * All guards from the state machine; any failure means the caller must not
 * write anything to Odoo.
 */
export async function revalidateForAccept(
  req: CoverRequest,
  settings: ShiftSettings,
  acceptorEmployeeId: number,
): Promise<RevalidateAcceptResult> {
  const slot = await fetchSlot(req.slotId);

  // Expiry is enforced inside every mutation.
  const current = lazyExpireIfDue(req, slot, settings);
  if (current.status === 'expired') {
    return { ok: false, code: 'expired', message: 'This request has expired.' };
  }
  if (current.status !== 'pending_teammate') {
    return { ok: false, code: 'slot_changed', message: 'This request is no longer open.' };
  }

  if (!slot) {
    return { ok: false, code: 'slot_changed', message: 'This shift no longer exists.' };
  }
  if (slot.state !== 'published') {
    return { ok: false, code: 'slot_changed', message: 'This shift is no longer published.' };
  }
  if (slot.resourceId !== req.slotSnapshot.resourceId) {
    return { ok: false, code: 'slot_changed', message: 'This shift has been reassigned.' };
  }
  if (slot.roleId !== req.slotSnapshot.roleId) {
    return { ok: false, code: 'slot_changed', message: 'The role for this shift changed.' };
  }
  if (slot.start !== req.slotSnapshot.start || slot.end !== req.slotSnapshot.end) {
    return { ok: false, code: 'slot_changed', message: 'The time of this shift changed.' };
  }

  const settleCutoff = odooToDate(slot.start).getTime() - settings.settleBufferHours * HOUR_MS;
  if (Date.now() >= settleCutoff) {
    return { ok: false, code: 'too_late', message: 'This shift starts too soon to arrange cover.' };
  }

  if (req.toEmployeeId !== null && req.toEmployeeId !== acceptorEmployeeId) {
    return { ok: false, code: 'not_eligible', message: 'This request was sent to someone else.' };
  }
  if (acceptorEmployeeId === req.fromEmployeeId) {
    return { ok: false, code: 'not_eligible', message: 'You cannot cover your own shift.' };
  }

  const employees = await fetchEmployees(req.companyId);
  const acceptor = employees.find(e => e.id === acceptorEmployeeId);
  if (!acceptor || acceptor.resourceId === null) {
    return { ok: false, code: 'not_eligible', message: 'Your account cannot be scheduled for shifts.' };
  }
  if (slot.roleId !== null && !acceptor.roleIds.includes(slot.roleId)) {
    return { ok: false, code: 'not_eligible', message: 'You cannot work this role.' };
  }

  if (await hasOverlappingSlot(acceptorEmployeeId, slot.start, slot.end, slot.id)) {
    return { ok: false, code: 'overlap', message: 'You already have a shift at that time.' };
  }

  return { ok: true, slot };
}

/**
 * Re-validate a cover request for manager approval (or the auto-apply path),
 * against the LIVE slot. On success the caller writes Odoo FIRST
 * (resource_id = toResourceId), then does the SQLite CAS, then recomputes
 * x_over_cap_flag for both employees' affected weeks, then notifies.
 * Idempotent: when the slot's resource already equals the target's, the result
 * is ok and the caller detects slot.resourceId === toResourceId to skip the
 * Odoo write and just finalize.
 */
export async function revalidateForApprove(req: CoverRequest): Promise<RevalidateApproveResult> {
  const settings = getShiftSettings(req.companyId);
  const slot = await fetchSlot(req.slotId);

  const current = lazyExpireIfDue(req, slot, settings);
  if (current.status === 'expired') {
    return { ok: false, code: 'expired', message: 'This request has expired.' };
  }
  if (current.status !== 'pending_manager' && current.status !== 'pending_teammate') {
    return { ok: false, code: 'not_pending', message: 'This request has already been decided.' };
  }

  const targetEmployeeId = current.acceptedByEmployeeId ?? current.toEmployeeId;
  if (targetEmployeeId === null) {
    return { ok: false, code: 'no_acceptor', message: 'Nobody has accepted this request yet.' };
  }

  if (!slot) {
    return { ok: false, code: 'slot_changed', message: 'This shift no longer exists.' };
  }
  if (slot.state !== 'published') {
    return { ok: false, code: 'slot_changed', message: 'This shift is no longer published.' };
  }

  const employees = await fetchEmployees(req.companyId);
  const target = employees.find(e => e.id === targetEmployeeId);
  if (!target || target.resourceId === null) {
    return { ok: false, code: 'not_eligible', message: 'The covering person cannot be scheduled for shifts.' };
  }

  // Idempotency: a prior approve may have half-completed after the Odoo write.
  if (slot.resourceId === target.resourceId) {
    return { ok: true, slot, toResourceId: target.resourceId };
  }

  if (slot.resourceId !== req.slotSnapshot.resourceId) {
    return { ok: false, code: 'slot_changed', message: 'This shift has been reassigned.' };
  }
  if (slot.roleId !== req.slotSnapshot.roleId) {
    return { ok: false, code: 'slot_changed', message: 'The role for this shift changed.' };
  }
  if (slot.start !== req.slotSnapshot.start || slot.end !== req.slotSnapshot.end) {
    return { ok: false, code: 'slot_changed', message: 'The time of this shift changed.' };
  }

  const settleCutoff = odooToDate(slot.start).getTime() - settings.settleBufferHours * HOUR_MS;
  if (Date.now() >= settleCutoff) {
    return { ok: false, code: 'too_late', message: 'This shift starts too soon to arrange cover.' };
  }

  if (slot.roleId !== null && !target.roleIds.includes(slot.roleId)) {
    return { ok: false, code: 'not_eligible', message: 'The covering person cannot work this role.' };
  }
  if (await hasOverlappingSlot(targetEmployeeId, slot.start, slot.end, slot.id)) {
    return { ok: false, code: 'overlap', message: 'The covering person already has a shift at that time.' };
  }

  return { ok: true, slot, toResourceId: target.resourceId };
}

/**
 * Invalidate the active cover request on a slot (manager edit / assign /
 * unassign / delete via the module's own routes) and notify both parties.
 * The partial unique index guarantees at most one active request per slot.
 */
export async function invalidateActiveRequestsForSlot(slotId: number, reason: string): Promise<void> {
  const req = getActiveCoverRequestForSlot(slotId);
  if (!req) return;

  const swapped = casTransition(req.id, ['pending_teammate', 'pending_manager'], 'invalidated');
  if (!swapped) return; // state moved underneath — nothing left to invalidate

  // Best-effort live slot read for a nicer summary; snapshot is the fallback
  // (the slot may just have been deleted).
  let slot: ShiftSlot | null = null;
  try {
    slot = await fetchSlot(slotId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[shifts] Could not re-read slot ${slotId} during invalidation: ${msg}`);
  }

  const payload = {
    ...slotSummary(slot, req.slotSnapshot),
    requestId: req.id,
    slotId,
    reason,
    fromEmployeeId: req.fromEmployeeId,
    fromName: slot?.employeeName || '',
  };

  await notifyEmployee(req.fromEmployeeId, req.companyId, 'cover_invalidated', payload);
  const counterpartId = req.toEmployeeId ?? req.acceptedByEmployeeId;
  if (counterpartId !== null && counterpartId !== req.fromEmployeeId) {
    await notifyEmployee(counterpartId, req.companyId, 'cover_invalidated', payload);
  }
}
