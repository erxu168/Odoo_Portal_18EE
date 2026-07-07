'use client';

/**
 * Shifts — Requests inbox (staff).
 * Incoming cover requests (directed to me or ask-all I am eligible for, plus
 * ones I accepted that wait for the manager) and my outgoing requests.
 * Incoming detail sheet per the approved mock: shift card, message quote,
 * live over-cap warnbox from the API projection, "Answer by …" deadline line,
 * and buttons "Accept — goes to manager for approval" (or "Accept — shift
 * becomes yours" when approval is off) / "Decline". Outgoing rows show status
 * and a Cancel action while still pending. 409s surface the server's message
 * and refresh the list.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePoll } from '@/lib/use-poll';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Badge, EmptyState, SearchBar, SectionTitle, Sheet, Spinner } from '@/components/shifts/ui';
import type { BadgeVariant } from '@/components/shifts/ui';
import { ds } from '@/lib/design-system';
import { berlinParts, dateToOdoo, fmtDay, nowOdooUtc } from '@/lib/shifts-time';

interface RequestsInboxProps {
  companyId: number;
  isManager: boolean;
  employeeId: number | null;
  onBack: () => void;
  onHome: () => void;
}

interface SlotSummary {
  day: string;
  timeRange: string;
  roleName: string;
  hours: number;
  start: string;
}

interface IncomingRequest {
  id: number;
  slotId: number;
  status: string;
  askAll: boolean;
  fromEmployeeId: number;
  fromName: string;
  message: string | null;
  answerDeadline: string;
  slot: SlotSummary;
  projection: { projected: number; cap: number | null; overage: number };
  requireApproval: boolean;
}

interface OutgoingRequest {
  id: number;
  slotId: number;
  status: string;
  askAll: boolean;
  toEmployeeId: number | null;
  toName: string;
  acceptedByName: string;
  message: string | null;
  answerDeadline: string;
  slot: SlotSummary;
  canCancel: boolean;
}

const LBL = 'text-[var(--fs-xs)] font-semibold tracking-wide uppercase text-gray-400 mb-1.5';

function fmtH(n: number): string {
  return n.toFixed(1);
}

function fmtCap(cap: number): string {
  return Number.isInteger(cap) ? String(cap) : cap.toFixed(1);
}

/** "today 20:00" or "Fri 10 Jul 20:00" — Berlin wall clock from an ISO UTC deadline. */
function deadlineLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const odoo = dateToOdoo(d);
  const parts = berlinParts(odoo);
  const today = berlinParts(nowOdooUtc()).date;
  return parts.date === today ? `today ${parts.hhmm}` : `${fmtDay(odoo)} ${parts.hhmm}`;
}

function slotLine(slot: SlotSummary): string {
  return `${slot.day} · ${slot.timeRange}`;
}

function outgoingBadge(status: string): { label: string; variant: BadgeVariant } {
  switch (status) {
    case 'pending_teammate': return { label: 'Waiting', variant: 'orange' };
    case 'pending_manager': return { label: 'Waiting for manager', variant: 'orange' };
    case 'approved': return { label: 'Approved', variant: 'green' };
    case 'auto_applied': return { label: 'Covered', variant: 'green' };
    case 'declined_by_teammate': return { label: 'Declined', variant: 'red' };
    case 'declined_by_manager': return { label: 'Declined by manager', variant: 'red' };
    case 'cancelled_by_requester': return { label: 'Cancelled', variant: 'gray' };
    case 'expired': return { label: 'Expired', variant: 'gray' };
    case 'invalidated': return { label: 'Shift changed', variant: 'gray' };
    case 'undone': return { label: 'Undone', variant: 'gray' };
    default: return { label: status || 'Unknown', variant: 'gray' };
  }
}

function outgoingLine(req: OutgoingRequest): string {
  if (req.status === 'pending_manager') {
    return `${req.acceptedByName || 'A teammate'} accepted · waiting for manager`;
  }
  if (req.status === 'pending_teammate') {
    return req.askAll ? 'Waiting for teammates' : `Waiting for ${req.toName || 'a teammate'}`;
  }
  return `Asked ${req.toName || 'a teammate'}`;
}

function WarnBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 bg-amber-100 rounded-xl px-3.5 py-3 text-[var(--fs-sm)] leading-relaxed text-amber-800">
      <svg viewBox="0 0 24 24" className="w-[17px] h-[17px] flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <div>{children}</div>
    </div>
  );
}

export default function RequestsInbox({ companyId, employeeId, onBack }: RequestsInboxProps) {
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState<IncomingRequest | null>(null);
  const [acting, setActing] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [declineReq, setDeclineReq] = useState<IncomingRequest | null>(null);
  const [cancelReq, setCancelReq] = useState<OutgoingRequest | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/requests?company_id=${companyId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      setIncoming(Array.isArray(data.incoming) ? data.incoming : []);
      setOutgoing(Array.isArray(data.outgoing) ? data.outgoing : []);
    } catch (err: unknown) {
      console.error('[shifts] Failed to load requests:', err);
      if (!silent) setError(err instanceof Error ? err.message : 'Could not load requests');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (employeeId !== null) void load();
  }, [load, employeeId]);

  // Live refresh so a manager's decision lands without a manual reload; paused
  // while a sheet/dialog is open so nothing jumps mid-action.
  usePoll(
    () => { if (employeeId !== null) void load(true); },
    35000,
    selected === null && declineReq === null && cancelReq === null,
  );

  function closeSheet() {
    setSelected(null);
    setSheetError(null);
  }

  async function act(id: number, action: 'accept' | 'decline' | 'cancel') {
    setActing(true);
    setSheetError(null);
    try {
      const res = await fetch(`/api/shifts/cover-requests/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        closeSheet();
        showToast(typeof data.error === 'string' ? data.error : 'This request has already been decided');
        void load();
        return;
      }
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      closeSheet();
      if (action === 'accept') {
        showToast(data.status === 'auto_applied' ? 'The shift is yours' : 'Sent to your manager for approval');
      } else if (action === 'decline') {
        showToast('Request declined');
      } else {
        showToast('Request cancelled');
      }
      void load();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error';
      if (selected) setSheetError(msg);
      else showToast(msg);
    } finally {
      setActing(false);
    }
  }

  if (employeeId === null) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader supertitle="Planning" title="Requests" showBack onBack={onBack} />
        <EmptyState
          icon="🔗"
          title="Account not linked"
          body="Your account isn’t linked to an employee record. Ask your manager to connect it in Manage Staff."
        />
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const matches = (name: string, slot: SlotSummary, message: string | null): boolean => {
    if (!q) return true;
    return (
      name.toLowerCase().includes(q) ||
      slot.day.toLowerCase().includes(q) ||
      slot.timeRange.includes(q) ||
      (slot.roleName || '').toLowerCase().includes(q) ||
      (message || '').toLowerCase().includes(q)
    );
  };
  const visibleIncoming = incoming.filter(r => matches(r.fromName, r.slot, r.message));
  const visibleOutgoing = outgoing.filter(r => matches(r.toName, r.slot, r.message));

  const actionable = selected !== null && selected.status === 'pending_teammate';

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        supertitle="Planning"
        title="Requests"
        subtitle="Cover requests to and from you"
        showBack
        onBack={onBack}
      />

      {error ? (
        <div className="flex flex-col items-center justify-center px-6 py-16">
          <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load requests</p>
          <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
          <button onClick={() => void load()} className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl">
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="pt-3">
            <SearchBar value={search} onChange={setSearch} placeholder="Search requests…" />
          </div>

          <div className="px-4 pb-24 max-w-2xl mx-auto w-full">
            {loading ? (
              <Spinner />
            ) : incoming.length === 0 && outgoing.length === 0 ? (
              <EmptyState
                icon="🔁"
                title="No requests"
                body="When a teammate asks you to cover a shift — or you ask them — it shows up here."
              />
            ) : (
              <>
                <div className="flex items-center gap-2 px-1 pt-4 pb-2">
                  <h2 className="text-[var(--fs-xs)] font-semibold text-gray-400 tracking-widest uppercase">
                    Waiting for you
                  </h2>
                  {visibleIncoming.filter(r => r.status === 'pending_teammate').length > 0 && (
                    <Badge variant="red">
                      {visibleIncoming.filter(r => r.status === 'pending_teammate').length}
                    </Badge>
                  )}
                </div>

                {visibleIncoming.length === 0 ? (
                  <div className="text-[var(--fs-sm)] text-gray-400 px-1 pb-2">
                    {q ? 'No matches.' : 'Nothing waiting for you right now.'}
                  </div>
                ) : (
                  <div className={ds.card}>
                    {visibleIncoming.map((r, i) => (
                      <React.Fragment key={r.id}>
                        {i > 0 && <div className="h-px bg-gray-100 mx-4" />}
                        <button
                          onClick={() => {
                            setSelected(r);
                            setSheetError(null);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-50"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">
                              {r.status === 'pending_manager'
                                ? `You accepted ${r.fromName}’s shift`
                                : `${r.fromName} asked you to cover`}
                            </div>
                            <div className="text-[var(--fs-sm)] text-gray-500 truncate">{slotLine(r.slot)}</div>
                            <div className="text-[var(--fs-xs)] text-gray-400 truncate">
                              {r.status === 'pending_manager'
                                ? 'Waiting for manager'
                                : `${r.slot.roleName || 'Any role'} · ${fmtH(r.slot.hours)} h`}
                            </div>
                          </div>
                          {r.status === 'pending_manager' ? (
                            <Badge variant="orange">Waiting for manager</Badge>
                          ) : (
                            <Badge variant="orange">Pending</Badge>
                          )}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                )}

                <SectionTitle>Your requests</SectionTitle>
                {visibleOutgoing.length === 0 ? (
                  <div className="text-[var(--fs-sm)] text-gray-400 px-1">
                    {q ? 'No matches.' : 'You haven’t asked anyone to cover a shift.'}
                  </div>
                ) : (
                  <div className={ds.card}>
                    {visibleOutgoing.map((r, i) => {
                      const badge = outgoingBadge(r.status);
                      return (
                        <React.Fragment key={r.id}>
                          {i > 0 && <div className="h-px bg-gray-100 mx-4" />}
                          <div className="flex items-center gap-3 px-4 py-3">
                            <div className="flex-1 min-w-0">
                              <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">
                                {slotLine(r.slot)}
                              </div>
                              <div className="text-[var(--fs-sm)] text-gray-500 truncate">{outgoingLine(r)}</div>
                            </div>
                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                              <Badge variant={badge.variant}>{badge.label}</Badge>
                              {r.canCancel && (
                                <button
                                  onClick={() => setCancelReq(r)}
                                  className="text-[var(--fs-xs)] font-semibold text-red-700 py-1 px-1 active:opacity-70"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </div>
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}

      <Sheet open={selected !== null} onClose={closeSheet}>
        {selected && (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-[var(--fs-lg)] font-bold text-gray-900">
                {selected.status === 'pending_manager'
                  ? `You accepted ${selected.fromName}’s shift`
                  : `${selected.fromName} asked you to cover`}
              </div>
              {selected.askAll && selected.status === 'pending_teammate' && (
                <div className="text-[var(--fs-sm)] text-gray-500">
                  Asked everyone eligible — first yes wins.
                </div>
              )}
            </div>

            <div className={`${ds.card} px-4 py-3`}>
              <div className={LBL}>The shift</div>
              <div className="text-[var(--fs-lg)] font-bold text-gray-900">{slotLine(selected.slot)}</div>
              <div className="text-[var(--fs-sm)] text-gray-500">
                {`${selected.slot.roleName || 'Any role'} · ${fmtH(selected.slot.hours)} hours`}
              </div>
            </div>

            {selected.message && (
              <div className={`${ds.card} px-4 py-3`}>
                <div className={LBL}>Message</div>
                <div className="bg-gray-100 rounded-lg px-3 py-2.5 text-[var(--fs-sm)] text-gray-700 italic">
                  {`“${selected.message}”`}
                </div>
              </div>
            )}

            {selected.projection.overage > 0 && selected.projection.cap !== null && (
              <WarnBox>
                Taking this puts you at{' '}
                <b>{`${fmtH(selected.projection.projected)} of ${fmtCap(selected.projection.cap)} hours`}</b>{' '}
                that week — {`${fmtH(selected.projection.overage)} h over`} your cap. You can still accept;
                your manager will see it.
              </WarnBox>
            )}

            {sheetError && (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[var(--fs-sm)] text-red-700">
                {sheetError}
              </div>
            )}

            {actionable ? (
              <>
                <div className="text-[var(--fs-xs)] text-gray-400 text-center leading-relaxed">
                  Answer by <b className="text-gray-600">{deadlineLabel(selected.answerDeadline)}</b> — after
                  that the request goes back to {selected.fromName}.
                </div>
                <button
                  onClick={() => void act(selected.id, 'accept')}
                  disabled={acting}
                  className={`${ds.btnPrimary} disabled:opacity-50`}
                >
                  {acting
                    ? 'Accepting…'
                    : selected.requireApproval
                      ? 'Accept — goes to manager for approval'
                      : 'Accept — shift becomes yours'}
                </button>
                <button
                  onClick={() => setDeclineReq(selected)}
                  disabled={acting}
                  className={`${ds.btnSecondary} disabled:opacity-50`}
                >
                  Decline
                </button>
              </>
            ) : (
              <div className="text-[var(--fs-xs)] text-gray-400 text-center leading-relaxed">
                You accepted — the shift becomes yours when your manager approves.
              </div>
            )}
          </div>
        )}
      </Sheet>

      {declineReq && (
        <ConfirmDialog
          title="Decline this request?"
          message={`${declineReq.fromName} will be told. You don’t need to give a reason.`}
          confirmLabel="Decline"
          cancelLabel="Go back"
          variant="danger"
          onConfirm={() => {
            const id = declineReq.id;
            setDeclineReq(null);
            void act(id, 'decline');
          }}
          onCancel={() => setDeclineReq(null)}
        />
      )}

      {cancelReq && (
        <ConfirmDialog
          title="Cancel this cover request?"
          message="Your teammate will be told. The shift stays yours."
          confirmLabel="Cancel request"
          cancelLabel="Keep it"
          variant="danger"
          onConfirm={() => {
            const id = cancelReq.id;
            setCancelReq(null);
            void act(id, 'cancel');
          }}
          onCancel={() => setCancelReq(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-20 left-1/2 z-[120] -translate-x-1/2 rounded-full bg-gray-900 px-5 py-3 text-[var(--fs-base)] text-white shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  );
}
