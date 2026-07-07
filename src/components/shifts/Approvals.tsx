'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { usePoll } from '@/lib/use-poll';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Badge, EmptyState, SearchBar, SectionTitle, Spinner } from '@/components/shifts/ui';
import { ds } from '@/lib/design-system';
import { berlinParts, durationHours, fmtDay, fmtTimeRange, nowOdooUtc, odooToDate } from '@/lib/shifts-time';

/**
 * Approvals — manager decision queue.
 * "Needs your decision" (sick reports marked At risk, then accepted covers),
 * "Auto-applied" (undoable within 24h) and "Decided this week" (dimmed log).
 * Decisions only happen inside the detail views, never from the list.
 * Hour projections come live from the API at fetch time — never from snapshots.
 */

interface ApprovalsProps {
  companyId: number;
  isManager: boolean;
  employeeId: number | null;
  onBack: () => void;
  onHome: () => void;
}

type BadgeVariant = 'red' | 'amber' | 'blue' | 'green' | 'gray' | 'orange';

type Raw = Record<string, unknown>;

/** Display-ready slot summary. start/end are Odoo strings when the API sent them ('' otherwise). */
interface SlotView {
  day: string;
  time: string;
  roleName: string;
  hours: number;
  start: string;
  end: string;
}

interface HourMath {
  fromBefore: number;
  fromAfter: number;
  toBefore: number;
  toAfter: number;
  /** Target (incoming) employee's weekly cap — the API only projects the receiver. */
  cap: number | null;
  overage: number;
}

interface CoverItem {
  id: number;
  status: string;
  message: string | null;
  fromName: string;
  toName: string;
  createdAt: string;
  /** decidedAt/updatedAt when present, else createdAt. */
  when: string;
  canUndo: boolean;
  slot: SlotView | null;
  hours: HourMath | null;
}

interface SickItem {
  id: number;
  employeeName: string;
  note: string | null;
  createdAt: string;
  slot: SlotView | null;
}

type View =
  | { kind: 'list' }
  | { kind: 'cover'; item: CoverItem; mode: 'pending' | 'auto' }
  | { kind: 'sick'; item: SickItem };

const CARD =
  'bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)]';

const STATUS_BADGE: Record<string, { variant: BadgeVariant; label: string }> = {
  pending_manager: { variant: 'orange', label: 'Pending' },
  approved: { variant: 'green', label: 'Approved' },
  auto_applied: { variant: 'blue', label: 'Auto-applied' },
  declined_by_manager: { variant: 'red', label: 'Declined' },
  declined_by_teammate: { variant: 'red', label: 'Declined' },
  expired: { variant: 'gray', label: 'Expired' },
  invalidated: { variant: 'gray', label: 'Cancelled' },
  cancelled_by_requester: { variant: 'gray', label: 'Cancelled' },
  undone: { variant: 'gray', label: 'Undone' },
};

// -- normalizers (tolerate partial API shapes; decided/auto items carry only display strings) ----

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function normSlot(v: unknown): SlotView | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Raw;
  const start = str(r.start);
  const end = str(r.end);
  const day = str(r.day) || (start ? fmtDay(start) : '');
  const time = str(r.timeRange) || (start && end ? fmtTimeRange(start, end) : '');
  if (!day && !time) return null;
  return {
    day,
    time,
    roleName: str(r.roleName),
    hours: num(r.hours) ?? (start && end ? durationHours(start, end) : 0),
    start,
    end,
  };
}

function normCover(v: unknown): CoverItem | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Raw;
  const id = num(r.id);
  if (id === null) return null;
  const hsrc = r.hours && typeof r.hours === 'object' ? (r.hours as Raw) : null;
  const fb = hsrc ? num(hsrc.fromBefore) : null;
  const fa = hsrc ? num(hsrc.fromAfter) : null;
  const tb = hsrc ? num(hsrc.toBefore) : null;
  const ta = hsrc ? num(hsrc.toAfter) : null;
  const hours: HourMath | null =
    hsrc && fb !== null && fa !== null && tb !== null && ta !== null
      ? {
          fromBefore: fb,
          fromAfter: fa,
          toBefore: tb,
          toAfter: ta,
          cap: num(hsrc.cap),
          overage: num(hsrc.overage) ?? 0,
        }
      : null;
  return {
    id,
    status: str(r.status),
    message: str(r.message) || null,
    fromName: str(r.fromName) || 'Teammate',
    toName: str(r.toName) || 'Teammate',
    createdAt: str(r.createdAt),
    when: str(r.decidedAt) || str(r.updatedAt) || str(r.createdAt),
    canUndo: r.canUndo === true,
    slot: normSlot(r.slot),
    hours,
  };
}

function normSick(v: unknown): SickItem | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Raw;
  const id = num(r.id);
  if (id === null) return null;
  return {
    id,
    employeeName: str(r.employeeName) || 'Employee',
    note: str(r.note) || null,
    createdAt: str(r.createdAt),
    slot: normSlot(r.slot),
  };
}

// -- time formatting -------------------------------------------------------------

function isoToOdoo(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ');
}

/** "just now" / "8 min ago" / "1 h ago" / "2 d ago" */
function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** "today, 14:02" or "Fri 10 Jul, 14:02" — Berlin wall clock. */
function fmtWhen(iso: string): string {
  if (!iso || !Number.isFinite(Date.parse(iso))) return '';
  const odoo = isoToOdoo(new Date(iso).toISOString());
  const parts = berlinParts(odoo);
  const today = berlinParts(nowOdooUtc()).date;
  return parts.date === today ? `today, ${parts.hhmm}` : `${fmtDay(odoo)}, ${parts.hhmm}`;
}

/** "starts in 2 days" / "starts in 5 h" / "starts in 20 min" / "already started" */
function startsIn(startOdoo: string): string {
  const ms = odooToDate(startOdoo).getTime() - Date.now();
  if (ms <= 0) return 'already started';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `starts in ${days} day${days === 1 ? '' : 's'}`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `starts in ${hours} h`;
  return `starts in ${Math.max(1, Math.floor(ms / 60_000))} min`;
}

function firstName(name: string): string {
  return name.split(' ')[0] || name;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="w-[38px] h-[38px] rounded-full bg-gray-200 text-gray-600 text-[var(--fs-sm)] font-bold flex items-center justify-center flex-shrink-0">
      {initials(name)}
    </div>
  );
}

function WarnIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-[17px] h-[17px] flex-shrink-0 mt-0.5"
      fill="none"
      stroke="#92400E"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export default function Approvals({ companyId, onBack }: ApprovalsProps) {
  const [pending, setPending] = useState<CoverItem[]>([]);
  const [sick, setSick] = useState<SickItem[]>([]);
  const [recentAuto, setRecentAuto] = useState<CoverItem[]>([]);
  const [decided, setDecided] = useState<CoverItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<View>({ kind: 'list' });
  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmUndo, setConfirmUndo] = useState<CoverItem | null>(null);

  const fetchApprovals = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await fetch(`/api/shifts/approvals?company_id=${companyId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
        setPending(list(data.pending).map(normCover).filter((x): x is CoverItem => x !== null));
        setSick(list(data.sick).map(normSick).filter((x): x is SickItem => x !== null));
        setRecentAuto(list(data.recentAuto).map(normCover).filter((x): x is CoverItem => x !== null));
        setDecided(list(data.decided).map(normCover).filter((x): x is CoverItem => x !== null));
      } catch (err: unknown) {
        if (!silent) setError(err instanceof Error ? err.message : 'Network error');
        else console.warn('[shifts] Approvals refetch failed:', err instanceof Error ? err.message : err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [companyId]
  );

  useEffect(() => {
    if (companyId) fetchApprovals();
  }, [companyId, fetchApprovals]);

  // Live refresh so new requests / sick reports appear without a reload; paused
  // while the manager is inside a detail view or an undo confirm.
  usePoll(
    () => { if (companyId) void fetchApprovals(true); },
    35000,
    view.kind === 'list' && confirmUndo === null,
  );

  async function postAction(url: string, body: Record<string, unknown>): Promise<boolean> {
    setActing(true);
    setActionError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return true;
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Network error');
      // The request may have moved underneath us (409) — surface the real state.
      void fetchApprovals(true);
      return false;
    } finally {
      setActing(false);
    }
  }

  async function handleApprove(item: CoverItem) {
    const ok = await postAction(`/api/shifts/approvals/${item.id}/approve`, { company_id: companyId });
    if (ok) {
      await fetchApprovals(true);
      setView({ kind: 'list' });
    }
  }

  async function handleDecline(item: CoverItem) {
    const ok = await postAction(`/api/shifts/approvals/${item.id}/decline`, { company_id: companyId });
    if (ok) {
      await fetchApprovals(true);
      setView({ kind: 'list' });
    }
  }

  async function handleUndo(item: CoverItem) {
    setConfirmUndo(null);
    const ok = await postAction(`/api/shifts/approvals/${item.id}/undo`, { company_id: companyId });
    if (ok) {
      await fetchApprovals(true);
      setView({ kind: 'list' });
    }
  }

  async function handleSickResolve(item: SickItem, action: 'reopen' | 'keep') {
    const ok = await postAction(`/api/shifts/sick-reports/${item.id}/resolve`, {
      company_id: companyId,
      action,
    });
    if (ok) {
      await fetchApprovals(true);
      setView({ kind: 'list' });
    }
  }

  function openView(next: View) {
    setActionError(null);
    setView(next);
  }

  // -- filtering ------------------------------------------------------------------

  const q = search.toLowerCase();
  const matchCover = (c: CoverItem) =>
    !q || `${c.fromName} ${c.toName} ${c.slot?.roleName || ''}`.toLowerCase().includes(q);
  const matchSick = (s: SickItem) =>
    !q || `${s.employeeName} ${s.slot?.roleName || ''}`.toLowerCase().includes(q);

  const pendingF = pending.filter(matchCover);
  const sickF = sick.filter(matchSick);
  const autoF = recentAuto.filter(matchCover);
  const decidedF = decided.filter(matchCover);
  const needsCount = sickF.length + pendingF.length;

  // -- shared detail cards ----------------------------------------------------------

  function shiftCard(slot: SlotView, showStartsIn: boolean) {
    const meta = [
      slot.roleName,
      slot.hours > 0 ? `${slot.hours.toFixed(1)} hours` : '',
      showStartsIn && slot.start ? startsIn(slot.start) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <div className={`${CARD} p-3.5`}>
        <div className={ds.label}>The shift</div>
        <div className="text-[var(--fs-lg)] font-bold text-gray-900">
          {[slot.day, slot.time].filter(Boolean).join(' · ')}
        </div>
        {meta && <div className="text-[var(--fs-sm)] text-gray-500 mt-0.5">{meta}</div>}
      </div>
    );
  }

  function quoteCard(label: string, text: string) {
    return (
      <div className={`${CARD} p-3.5`}>
        <div className={ds.label}>{label}</div>
        <div className="bg-gray-100 rounded-lg px-3 py-2.5 text-[var(--fs-sm)] text-gray-700 italic">
          &ldquo;{text}&rdquo;
        </div>
      </div>
    );
  }

  function errorBanner() {
    if (!actionError) return null;
    return (
      <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[var(--fs-base)] text-red-700">
        {actionError}
      </div>
    );
  }

  // -- cover detail -----------------------------------------------------------------

  function renderCoverDetail(item: CoverItem, mode: 'pending' | 'auto') {
    const toFirst = firstName(item.toName);
    const fromFirst = firstName(item.fromName);
    const h = item.hours;
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader
          supertitle="Planning"
          title="Cover Request"
          showBack
          onBack={() => openView({ kind: 'list' })}
        />
        <div className="px-4 pt-4 pb-36 flex flex-col gap-3 max-w-2xl mx-auto w-full">
          <div className={`${CARD} p-3.5 flex items-center gap-2.5`}>
            <Avatar name={item.fromName} />
            <svg
              viewBox="0 0 24 24"
              className="w-[18px] h-[18px] flex-shrink-0"
              fill="none"
              stroke="#6B7280"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
            <Avatar name={item.toName} />
            <div className="flex-1 min-w-0 ml-1">
              <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">
                {item.fromName} → {item.toName}
              </div>
              <div className="text-[var(--fs-sm)] text-gray-500 mt-0.5">
                {mode === 'auto'
                  ? `Applied automatically ${fmtWhen(item.when)}`
                  : `${toFirst} accepted ${fmtWhen(item.when)}`}
              </div>
            </div>
          </div>

          {item.slot && shiftCard(item.slot, mode === 'pending')}

          {item.message && quoteCard('Reason', item.message)}

          {mode === 'pending' && h && (
            <div className={`${CARD} p-3.5`}>
              <div className={ds.label}>Week hours if you approve</div>
              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 text-[var(--fs-md)] font-bold text-gray-900 truncate">{item.fromName}</div>
                <div className="text-[var(--fs-sm)] text-gray-500 tabular-nums whitespace-nowrap">
                  {h.fromBefore.toFixed(1)} → <b className="text-gray-900">{h.fromAfter.toFixed(1)} h</b>
                </div>
              </div>
              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 text-[var(--fs-md)] font-bold text-gray-900 truncate">{item.toName}</div>
                <div className="text-[var(--fs-sm)] text-gray-500 tabular-nums whitespace-nowrap">
                  {h.toBefore.toFixed(1)} →{' '}
                  <b className={h.overage > 0 ? 'text-red-800' : 'text-gray-900'}>
                    {h.toAfter.toFixed(1)} h
                  </b>
                  {h.cap !== null ? ` / ${h.cap}` : ''}
                </div>
              </div>
              {h.overage > 0 && (
                <div className="flex gap-2.5 bg-amber-100 rounded-xl px-3 py-2.5 mt-2 text-[var(--fs-sm)] text-amber-800 leading-snug">
                  <WarnIcon />
                  <div>
                    {toFirst} goes <b>{h.overage.toFixed(1)} h over</b> their cap. You can still approve —
                    the shift will be flagged.
                  </div>
                </div>
              )}
              <p className="text-[var(--fs-sm)] text-gray-500 mt-2 leading-snug">
                Calculated just now — includes everything both have picked up since they agreed.
              </p>
            </div>
          )}

          {mode === 'auto' && (
            <p className="text-[var(--fs-sm)] text-gray-500 text-center leading-snug px-2">
              This cover was applied automatically. You can undo it within 24 hours — the shift goes back
              to {fromFirst}.
            </p>
          )}

          {errorBanner()}
        </div>

        <div className="fixed bottom-0 left-0 right-0 z-[60] bg-white border-t border-gray-200 max-w-2xl mx-auto px-4 py-3 safe-bottom flex flex-col gap-2">
          {mode === 'pending' ? (
            <>
              <button
                onClick={() => handleApprove(item)}
                disabled={acting}
                className={`${ds.btnPrimary} disabled:opacity-50`}
              >
                {acting ? 'Working…' : `Approve — shift goes to ${toFirst}`}
              </button>
              <button
                onClick={() => handleDecline(item)}
                disabled={acting}
                className={`${ds.btnSecondary} disabled:opacity-50`}
              >
                Decline — stays with {fromFirst}
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmUndo(item)}
              disabled={acting}
              className={`${ds.btnDanger} disabled:opacity-50`}
            >
              {acting ? 'Working…' : `Undo — give the shift back to ${fromFirst}`}
            </button>
          )}
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>

        {confirmUndo && (
          <ConfirmDialog
            title="Undo this cover?"
            message={`The shift goes back to ${confirmUndo.fromName}. Both people will be notified.`}
            confirmLabel="Undo cover"
            variant="danger"
            onConfirm={() => handleUndo(confirmUndo)}
            onCancel={() => setConfirmUndo(null)}
          />
        )}
      </div>
    );
  }

  // -- sick detail ------------------------------------------------------------------

  function renderSickDetail(item: SickItem) {
    const first = firstName(item.employeeName);
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader
          supertitle="Planning"
          title="Sick Report"
          showBack
          onBack={() => openView({ kind: 'list' })}
        />
        <div className="px-4 pt-4 pb-36 flex flex-col gap-3 max-w-2xl mx-auto w-full">
          <div className={`${CARD} p-3.5 flex items-center gap-3`}>
            <Avatar name={item.employeeName} />
            <div className="flex-1 min-w-0">
              <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">{item.employeeName}</div>
              <div className="text-[var(--fs-sm)] text-gray-500 mt-0.5">
                Reported sick {fmtWhen(item.createdAt)}
              </div>
            </div>
            <Badge variant="red">At risk</Badge>
          </div>

          {item.slot && shiftCard(item.slot, true)}

          {item.note && quoteCard('Note', item.note)}

          <div className={`${CARD} p-3.5`}>
            <div className={ds.label}>If you reopen the shift</div>
            <ul className="flex flex-col gap-1.5 text-[var(--fs-sm)] text-gray-700 leading-snug list-disc pl-4">
              <li>The shift goes back to Open Shifts — everyone eligible can claim it</li>
              <li>{first} stays off this shift</li>
              <li>You can also assign someone directly in Manage Shifts</li>
            </ul>
          </div>

          {errorBanner()}
        </div>

        <div className="fixed bottom-0 left-0 right-0 z-[60] bg-white border-t border-gray-200 max-w-2xl mx-auto px-4 py-3 safe-bottom flex flex-col gap-2">
          <button
            onClick={() => handleSickResolve(item, 'reopen')}
            disabled={acting}
            className={`${ds.btnPrimary} disabled:opacity-50`}
          >
            {acting ? 'Working…' : 'Reopen shift for others'}
          </button>
          <button
            onClick={() => handleSickResolve(item, 'keep')}
            disabled={acting}
            className={`${ds.btnSecondary} disabled:opacity-50`}
          >
            Keep assigned
          </button>
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
      </div>
    );
  }

  // -- list rows --------------------------------------------------------------------

  function coverRowMeta(c: CoverItem): string {
    if (!c.slot) return '';
    return [c.slot.day && c.slot.time ? `${c.slot.day} · ${c.slot.time}` : c.slot.day || c.slot.time, c.slot.roleName]
      .filter(Boolean)
      .join(' · ');
  }

  function statusBadge(status: string) {
    const b = STATUS_BADGE[status] ?? { variant: 'gray' as BadgeVariant, label: status };
    return <Badge variant={b.variant}>{b.label}</Badge>;
  }

  if (view.kind === 'cover') return renderCoverDetail(view.item, view.mode);
  if (view.kind === 'sick') return renderSickDetail(view.item);

  const allEmpty =
    pending.length === 0 && sick.length === 0 && recentAuto.length === 0 && decided.length === 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Planning" title="Approvals" showBack onBack={onBack} />

      <div className="pt-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search requests…" />
      </div>

      <div className="pb-24 max-w-2xl mx-auto w-full">
        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="flex flex-col items-center justify-center px-6 py-16">
            <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load approvals</p>
            <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
            <button
              onClick={() => fetchApprovals()}
              className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl active:bg-green-700"
            >
              Retry
            </button>
          </div>
        ) : allEmpty ? (
          <EmptyState
            icon="📋"
            title="Nothing to decide"
            body="Accepted cover requests and sick reports land here."
          />
        ) : (
          <>
            <SectionTitle>
              {needsCount > 0 ? `Needs your decision · ${needsCount}` : 'Needs your decision'}
            </SectionTitle>
            {needsCount === 0 ? (
              <div className={`${CARD} mx-4 px-4 py-5 text-center text-[var(--fs-sm)] text-gray-400`}>
                Nothing needs your decision right now.
              </div>
            ) : (
              <div className={`${CARD} mx-4 overflow-hidden`}>
                {sickF.map((s, i) => {
                  const today = berlinParts(nowOdooUtc()).date;
                  const dayPart = s.slot
                    ? s.slot.start && berlinParts(s.slot.start).date === today
                      ? 'today'
                      : s.slot.day
                    : '';
                  return (
                    <button
                      key={`sick-${s.id}`}
                      onClick={() => openView({ kind: 'sick', item: s })}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-50 min-h-[44px] ${
                        i > 0 ? 'border-t border-gray-100' : ''
                      }`}
                    >
                      <Avatar name={s.employeeName} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">
                          {s.employeeName}
                        </div>
                        <div className="text-[var(--fs-sm)] text-gray-500 mt-0.5 truncate">
                          Reported sick
                          {s.slot ? ` · ${[dayPart, s.slot.time].filter(Boolean).join(' ')}` : ''}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                        <Badge variant="red">At risk</Badge>
                        <div className="text-[var(--fs-sm)] text-gray-500">{timeAgo(s.createdAt)}</div>
                      </div>
                    </button>
                  );
                })}
                {pendingF.map((c, i) => (
                  <button
                    key={`cover-${c.id}`}
                    onClick={() => openView({ kind: 'cover', item: c, mode: 'pending' })}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-50 min-h-[44px] ${
                      i > 0 || sickF.length > 0 ? 'border-t border-gray-100' : ''
                    }`}
                  >
                    <Avatar name={c.fromName} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">
                        {c.fromName} → {c.toName}
                      </div>
                      <div className="text-[var(--fs-sm)] text-gray-500 mt-0.5 truncate">
                        {coverRowMeta(c)}
                      </div>
                      <div className="text-[var(--fs-sm)] text-gray-500 truncate">
                        {firstName(c.toName)} accepted {timeAgo(c.when)}
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <Badge variant="orange">Pending</Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {autoF.length > 0 && (
              <>
                <SectionTitle>Auto-applied</SectionTitle>
                <div className={`${CARD} mx-4 overflow-hidden`}>
                  {autoF.map((c, i) => (
                    <button
                      key={`auto-${c.id}`}
                      onClick={() => openView({ kind: 'cover', item: c, mode: 'auto' })}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-50 min-h-[44px] ${
                        i > 0 ? 'border-t border-gray-100' : ''
                      }`}
                    >
                      <Avatar name={c.fromName} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">
                          {c.fromName} → {c.toName}
                        </div>
                        <div className="text-[var(--fs-sm)] text-gray-500 mt-0.5 truncate">
                          {coverRowMeta(c)}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0 flex flex-col items-end gap-1">
                        <Badge variant="blue">Auto-applied</Badge>
                        <span className="text-[var(--fs-sm)] font-semibold text-green-700">Undo ›</span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {decidedF.length > 0 && (
              <>
                <SectionTitle>Decided this week</SectionTitle>
                <div className={`${CARD} mx-4 overflow-hidden opacity-65`}>
                  {decidedF.map((c, i) => (
                    <div
                      key={`decided-${c.id}`}
                      className={`flex items-center gap-3 px-4 py-3 min-h-[44px] ${
                        i > 0 ? 'border-t border-gray-100' : ''
                      }`}
                    >
                      <Avatar name={c.fromName} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">
                          {c.fromName} → {c.toName}
                        </div>
                        <div className="text-[var(--fs-sm)] text-gray-500 mt-0.5 truncate">
                          {coverRowMeta(c)}
                        </div>
                      </div>
                      <div className="flex-shrink-0">{statusBadge(c.status)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
