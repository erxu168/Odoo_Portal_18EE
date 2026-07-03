'use client';

/**
 * Shifts — My Shifts (staff).
 * Week strip (7 day dots, green = working, ring = today) + agenda of the
 * selected week, week total vs cap. Per-shift sheet: "Ask a teammate to cover"
 * (picker fed by eligibleBySlot from GET /api/shifts/mine — live hours,
 * overlaps greyed with the reason, optional ask-all, message, deadline hint,
 * sick lane), status chips while a cover request is pending, cancel for my
 * outgoing requests, and a "Pending — not yours yet" section for shifts I
 * accepted that still wait for the manager.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Badge, EmptyState, SearchBar, SectionTitle, Sheet, Spinner, WeekNav } from '@/components/shifts/ui';
import { ds } from '@/lib/design-system';
import {
  berlinParts,
  currentWeekKey,
  fmtDay,
  fmtTimeRange,
  nowOdooUtc,
  odooToDate,
  offsetWeekKey,
  weekKeyDays,
} from '@/lib/shifts-time';
import type { ShiftSlot } from '@/types/shifts';

interface MyShiftsProps {
  companyId: number;
  isManager: boolean;
  employeeId: number | null;
  onBack: () => void;
  onHome: () => void;
  onOpenRequests: () => void;
}

interface EligibleTeammate {
  employeeId: number;
  name: string;
  weekHours: number;
  cap: number | null;
  overlap: boolean;
}

interface OutgoingRequest {
  id: number;
  slotId: number;
  status: string;
  toName: string;
  acceptedByName: string;
  askAll: boolean;
}

interface MineSettings {
  allowAskAll: boolean;
  allowSickReport: boolean;
  answerDeadlineHours: number;
  requireApproval: boolean;
}

interface MineDay {
  date: string;
  slots: ShiftSlot[];
}

interface MineData {
  weekKey: string;
  days: MineDay[];
  weekHours: number;
  cap: number | null;
  outgoing: OutgoingRequest[];
  incomingCount: number;
  tentative: ShiftSlot[];
  eligibleBySlot: Record<string, EligibleTeammate[]>;
  settings: MineSettings;
}

const DAY_LETTERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const LBL = 'text-[var(--fs-xs)] font-semibold tracking-wide uppercase text-gray-400 mb-1.5';
const DAY_MONTH_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' });

function fmtH(n: number): string {
  return n.toFixed(1);
}

function fmtCap(cap: number): string {
  return Number.isInteger(cap) ? String(cap) : cap.toFixed(1);
}

/** "6 – 12 Jul" from a week key (WeekNav itself appends "· this week"). */
function weekLabel(weekKey: string): string {
  const days = weekKeyDays(weekKey);
  const a = DAY_MONTH_FMT.format(new Date(`${days[0]}T00:00:00Z`));
  const b = DAY_MONTH_FMT.format(new Date(`${days[6]}T00:00:00Z`));
  const [ad, am] = a.split(' ');
  const bm = b.split(' ')[1];
  return am === bm ? `${ad} – ${b}` : `${a} – ${b}`;
}

function normOutgoing(raw: unknown): OutgoingRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'number' ? r.id : null;
  const slotId = typeof r.slotId === 'number' ? r.slotId : typeof r.slot_id === 'number' ? r.slot_id : null;
  if (id === null || slotId === null) return null;
  return {
    id,
    slotId,
    status: typeof r.status === 'string' ? r.status : '',
    toName: typeof r.toName === 'string' ? r.toName : typeof r.to_name === 'string' ? r.to_name : '',
    acceptedByName: typeof r.acceptedByName === 'string' ? r.acceptedByName : '',
    askAll: r.askAll === true || r.ask_all === true || r.ask_all === 1,
  };
}

function requestStatusLine(req: OutgoingRequest): string {
  if (req.status === 'pending_manager') {
    return `${req.acceptedByName || req.toName || 'A teammate'} accepted · waiting for manager`;
  }
  return req.askAll ? 'Waiting for teammates' : `Waiting for ${req.toName || 'a teammate'}`;
}

function PickRadio({
  selected,
  disabled,
  title,
  sub,
  onSelect,
}: {
  selected: boolean;
  disabled?: boolean;
  title: string;
  sub: string;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`w-full flex items-start gap-2.5 rounded-xl border-[1.5px] px-3.5 py-3 text-left bg-white ${
        selected ? 'border-green-600 bg-green-50/40' : 'border-gray-200'
      } ${disabled ? 'opacity-50' : 'active:bg-gray-50'}`}
    >
      <span
        className={`relative mt-0.5 w-[18px] h-[18px] rounded-full border-2 flex-shrink-0 ${
          selected ? 'border-green-600 bg-green-600' : 'border-gray-300'
        }`}
      >
        {selected && <span className="absolute inset-1 rounded-full bg-white" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[var(--fs-md)] font-bold text-gray-900">{title}</span>
        <span className="block text-[var(--fs-sm)] text-gray-500 leading-snug">{sub}</span>
      </span>
    </button>
  );
}

export default function MyShifts({ companyId, employeeId, onBack, onOpenRequests }: MyShiftsProps) {
  const [weekKey, setWeekKey] = useState(currentWeekKey());
  const [data, setData] = useState<MineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [sheetSlot, setSheetSlot] = useState<ShiftSlot | null>(null);
  const [sheetMode, setSheetMode] = useState<'detail' | 'picker'>('detail');
  const [pickTarget, setPickTarget] = useState<number | 'all' | null>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [confirmSick, setConfirmSick] = useState(false);
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/mine?company_id=${companyId}&week=${weekKey}`);
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw.error === 'string' ? raw.error : `HTTP ${res.status}`);
      const outgoingRaw: unknown[] = Array.isArray(raw.requests?.outgoing) ? raw.requests.outgoing : [];
      const settings = (raw.settings || {}) as Record<string, unknown>;
      setData({
        weekKey: typeof raw.weekKey === 'string' ? raw.weekKey : weekKey,
        days: Array.isArray(raw.days) ? raw.days : [],
        weekHours: typeof raw.weekHours === 'number' ? raw.weekHours : 0,
        cap: typeof raw.cap === 'number' ? raw.cap : null,
        outgoing: outgoingRaw.map(normOutgoing).filter((r): r is OutgoingRequest => r !== null),
        incomingCount: typeof raw.requests?.incomingCount === 'number' ? raw.requests.incomingCount : 0,
        tentative: Array.isArray(raw.tentative) ? raw.tentative : [],
        eligibleBySlot:
          raw.eligibleBySlot && typeof raw.eligibleBySlot === 'object' ? raw.eligibleBySlot : {},
        settings: {
          allowAskAll: settings.allowAskAll !== false,
          allowSickReport: settings.allowSickReport !== false,
          answerDeadlineHours: typeof settings.answerDeadlineHours === 'number' ? settings.answerDeadlineHours : 12,
          requireApproval: settings.requireApproval !== false,
        },
      });
    } catch (err: unknown) {
      console.error('[shifts] Failed to load my shifts:', err);
      setError(err instanceof Error ? err.message : 'Could not load your shifts');
    } finally {
      setLoading(false);
    }
  }, [companyId, weekKey]);

  useEffect(() => {
    if (employeeId !== null) void load();
  }, [load, employeeId]);

  function closeSheet() {
    setSheetSlot(null);
    setSheetMode('detail');
    setPickTarget(null);
    setMessage('');
    setSheetError(null);
  }

  async function sendCoverRequest() {
    if (!sheetSlot || pickTarget === null) return;
    setSending(true);
    setSheetError(null);
    try {
      const body: Record<string, unknown> = {
        company_id: companyId,
        slot_id: sheetSlot.id,
        message: message.trim() || null,
      };
      if (pickTarget === 'all') body.ask_all = true;
      else body.to_employee_id = pickTarget;
      const res = await fetch('/api/shifts/cover-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const resp = await res.json().catch(() => ({}));
      if (res.status === 409) {
        closeSheet();
        showToast(typeof resp.error === 'string' ? resp.error : 'There is already an open request for this shift');
        void load();
        return;
      }
      if (!res.ok) throw new Error(typeof resp.error === 'string' ? resp.error : `HTTP ${res.status}`);
      closeSheet();
      showToast('Request sent');
      void load();
    } catch (err: unknown) {
      setSheetError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSending(false);
    }
  }

  async function reportSick() {
    if (!sheetSlot) return;
    setConfirmSick(false);
    setSending(true);
    try {
      const res = await fetch('/api/shifts/sick-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, slot_id: sheetSlot.id, note: message.trim() || null }),
      });
      const resp = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof resp.error === 'string' ? resp.error : `HTTP ${res.status}`);
      closeSheet();
      showToast('Your manager has been told');
      void load();
    } catch (err: unknown) {
      setSheetError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSending(false);
    }
  }

  async function cancelRequest() {
    if (!cancelReq) return;
    const req = cancelReq;
    setCancelReq(null);
    try {
      const res = await fetch(`/api/shifts/cover-requests/${req.id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId }),
      });
      const resp = await res.json().catch(() => ({}));
      if (res.status === 409) {
        closeSheet();
        showToast(typeof resp.error === 'string' ? resp.error : 'This request has already been decided');
        void load();
        return;
      }
      if (!res.ok) throw new Error(typeof resp.error === 'string' ? resp.error : `HTTP ${res.status}`);
      closeSheet();
      showToast('Request cancelled');
      void load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Network error');
    }
  }

  if (employeeId === null) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader supertitle="Shifts" title="My Shifts" showBack onBack={onBack} />
        <EmptyState
          icon="🔗"
          title="Account not linked"
          body="Your account isn’t linked to an employee record. Ask your manager to connect it in Manage Staff."
        />
      </div>
    );
  }

  const settings: MineSettings = data?.settings ?? {
    allowAskAll: true,
    allowSickReport: true,
    answerDeadlineHours: 12,
    requireApproval: true,
  };

  const dates = data && data.days.length === 7 ? data.days.map(d => d.date) : weekKeyDays(weekKey);
  const todayBerlin = berlinParts(nowOdooUtc()).date;

  const agendaSlots: ShiftSlot[] = (data?.days ?? [])
    .flatMap(d => d.slots)
    .filter(s => s.state === 'published');
  const shiftDates = new Set(agendaSlots.map(s => berlinParts(s.start).date));

  const activeReqBySlot = new Map<number, OutgoingRequest>();
  for (const req of data?.outgoing ?? []) {
    if (req.status === 'pending_teammate' || req.status === 'pending_manager') {
      activeReqBySlot.set(req.slotId, req);
    }
  }

  const q = search.trim().toLowerCase();
  const visibleSlots = agendaSlots.filter(s => {
    if (!q) return true;
    return (
      (s.roleName || '').toLowerCase().includes(q) ||
      fmtDay(s.start).toLowerCase().includes(q) ||
      fmtTimeRange(s.start, s.end).includes(q)
    );
  });

  const incomingCount = data?.incomingCount ?? 0;
  const sheetReq = sheetSlot ? activeReqBySlot.get(sheetSlot.id) ?? null : null;
  const sheetIsFuture = sheetSlot ? odooToDate(sheetSlot.start).getTime() > Date.now() : false;
  const eligible: EligibleTeammate[] = sheetSlot
    ? data?.eligibleBySlot[String(sheetSlot.id)] ?? []
    : [];
  const pickedName =
    pickTarget === 'all'
      ? 'Everyone eligible'
      : pickTarget !== null
        ? eligible.find(e => e.employeeId === pickTarget)?.name ?? 'Your teammate'
        : null;

  const weekIsCurrent = weekKey === currentWeekKey();
  const weekCap = data?.cap ?? null;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        supertitle="Shifts"
        title="My Shifts"
        subtitle={weekLabel(weekKey)}
        showBack
        onBack={onBack}
      />

      {error ? (
        <div className="flex flex-col items-center justify-center px-6 py-16">
          <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load your shifts</p>
          <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
          <button onClick={() => void load()} className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl">
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="px-4 pt-3 flex flex-col gap-3">
            <WeekNav
              weekKey={weekKey}
              label={weekLabel(weekKey)}
              onPrev={() => setWeekKey(offsetWeekKey(weekKey, -1))}
              onNext={() => setWeekKey(offsetWeekKey(weekKey, 1))}
            />

            <div className={`${ds.card} px-3 py-3`}>
              <div className="flex gap-1">
                {dates.map((date, i) => {
                  const hasShift = shiftDates.has(date);
                  const isToday = date === todayBerlin;
                  return (
                    <div key={date} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[var(--fs-xs)] font-semibold text-gray-400">{DAY_LETTERS[i]}</span>
                      <span
                        className={`w-9 h-9 rounded-full flex items-center justify-center text-[var(--fs-sm)] font-bold ${
                          hasShift ? 'bg-green-600 text-white' : 'bg-white border border-gray-200 text-gray-500'
                        } ${isToday ? 'ring-2 ring-offset-2 ring-green-600' : ''}`}
                      >
                        {Number(date.slice(8, 10))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {!loading && incomingCount > 0 && (
              <button
                onClick={onOpenRequests}
                className={`${ds.card} w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-50`}
              >
                <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                <span className="flex-1 min-w-0 text-[var(--fs-md)] font-bold text-gray-900">
                  {incomingCount === 1
                    ? 'A teammate asked you to cover a shift'
                    : `${incomingCount} cover requests are waiting for you`}
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 flex-shrink-0">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            )}
          </div>

          <div className="pt-1">
            <SearchBar value={search} onChange={setSearch} placeholder="Search your shifts…" />
          </div>

          <div className="px-4 pb-24">
            {loading ? (
              <Spinner />
            ) : (
              <>
                <SectionTitle>
                  {`${weekIsCurrent ? 'This week' : 'Week'} · ${fmtH(data?.weekHours ?? 0)}${
                    weekCap !== null ? ` / ${fmtCap(weekCap)}` : ''
                  } h`}
                </SectionTitle>

                {visibleSlots.length === 0 ? (
                  <EmptyState
                    icon="🗓️"
                    title={q ? 'No matches' : 'No shifts this week'}
                    body={q ? 'Try a different search.' : 'Shifts your manager assigns to you — or that you claim — show up here.'}
                  />
                ) : (
                  <div className={ds.card}>
                    {visibleSlots.map((s, i) => {
                      const req = activeReqBySlot.get(s.id);
                      const isFuture = odooToDate(s.start).getTime() > Date.now();
                      return (
                        <React.Fragment key={s.id}>
                          {i > 0 && <div className="h-px bg-gray-100 mx-4" />}
                          <button
                            onClick={() => {
                              setSheetSlot(s);
                              setSheetMode('detail');
                              setPickTarget(null);
                              setMessage('');
                              setSheetError(null);
                            }}
                            className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-50"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-[var(--fs-md)] font-bold text-gray-900">
                                {`${fmtDay(s.start)} · ${fmtTimeRange(s.start, s.end)}`}
                              </div>
                              <div className="text-[var(--fs-sm)] text-gray-500 truncate">
                                {req ? requestStatusLine(req) : `${s.roleName || 'Any role'} · ${fmtH(s.hours)} h`}
                              </div>
                            </div>
                            {req ? (
                              <Badge variant="orange">Cover pending</Badge>
                            ) : isFuture ? (
                              <Badge variant="blue">Upcoming</Badge>
                            ) : (
                              <Badge variant="gray">Past</Badge>
                            )}
                          </button>
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}

                {(data?.tentative.length ?? 0) > 0 && (
                  <>
                    <SectionTitle>Pending — not yours yet</SectionTitle>
                    <div className={ds.card}>
                      {(data?.tentative ?? []).map((s, i) => (
                        <React.Fragment key={s.id}>
                          {i > 0 && <div className="h-px bg-gray-100 mx-4" />}
                          <div className="flex items-center gap-3 px-4 py-3">
                            <div className="flex-1 min-w-0">
                              <div className="text-[var(--fs-md)] font-bold text-gray-900">
                                {`${fmtDay(s.start)} · ${fmtTimeRange(s.start, s.end)}`}
                              </div>
                              <div className="text-[var(--fs-sm)] text-gray-500 truncate">
                                {`${s.roleName || 'Any role'} · ${fmtH(s.hours)} h`}
                              </div>
                            </div>
                            <Badge variant="orange">Pending</Badge>
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                    <div className="text-[var(--fs-xs)] text-gray-400 text-center mt-2 leading-relaxed">
                      You accepted these covers — they become yours when the manager approves.
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}

      <Sheet open={sheetSlot !== null} onClose={closeSheet}>
        {sheetSlot && sheetMode === 'detail' && (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-[var(--fs-lg)] font-bold text-gray-900">
                {`${fmtDay(sheetSlot.start)} · ${fmtTimeRange(sheetSlot.start, sheetSlot.end)}`}
              </div>
              <div className="text-[var(--fs-sm)] text-gray-500">
                {`${sheetSlot.roleName || 'Any role'} · ${fmtH(sheetSlot.hours)} hours`}
              </div>
            </div>

            {sheetSlot.note && (
              <div>
                <div className={LBL}>Note</div>
                <div className="bg-gray-100 rounded-lg px-3 py-2.5 text-[var(--fs-sm)] text-gray-700">
                  {sheetSlot.note}
                </div>
              </div>
            )}

            {sheetReq ? (
              <>
                <div className={`${ds.card} px-4 py-3`}>
                  <div className={LBL}>Cover request</div>
                  <div className="text-[var(--fs-md)] font-bold text-gray-900">{requestStatusLine(sheetReq)}</div>
                  <div className="text-[var(--fs-xs)] text-gray-400 mt-1 leading-relaxed">
                    {settings.requireApproval
                      ? 'The shift stays yours until your manager approves.'
                      : 'The shift moves as soon as someone accepts.'}
                  </div>
                </div>
                <button onClick={() => setCancelReq(sheetReq)} className={ds.btnDanger}>
                  Cancel request
                </button>
              </>
            ) : sheetIsFuture ? (
              <>
                <button
                  onClick={() => {
                    setSheetMode('picker');
                    setSheetError(null);
                  }}
                  className={ds.btnPrimary}
                >
                  Ask a teammate to cover
                </button>
                {settings.allowSickReport && (
                  <button
                    onClick={() => setConfirmSick(true)}
                    className="text-[var(--fs-sm)] font-semibold text-red-800 text-center py-1"
                  >
                    Sick today? Report sick instead →
                  </button>
                )}
              </>
            ) : (
              <div className="text-[var(--fs-xs)] text-gray-400 text-center">This shift is in the past.</div>
            )}
          </div>
        )}

        {sheetSlot && sheetMode === 'picker' && (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-[var(--fs-lg)] font-bold text-gray-900">Ask a teammate to cover</div>
              <div className="text-[var(--fs-sm)] text-gray-500">
                {`${fmtDay(sheetSlot.start)} · ${fmtTimeRange(sheetSlot.start, sheetSlot.end)} · ${fmtH(sheetSlot.hours)} hours`}
              </div>
            </div>

            <div>
              <div className={LBL}>Who do you want to ask?</div>
              <div className="flex flex-col gap-2">
                {eligible.length === 0 && (
                  <div className="text-[var(--fs-sm)] text-gray-500 px-1 py-2">
                    Nobody is eligible to cover this shift right now.
                  </div>
                )}
                {eligible.map(t => (
                  <PickRadio
                    key={t.employeeId}
                    selected={pickTarget === t.employeeId}
                    disabled={t.overlap}
                    title={t.name}
                    sub={
                      t.overlap
                        ? `Already working ${fmtDay(sheetSlot.start).split(' ')[0]} ${fmtTimeRange(sheetSlot.start, sheetSlot.end)}`
                        : t.cap !== null
                          ? `${fmtH(t.weekHours)} / ${fmtCap(t.cap)} h this week`
                          : `${fmtH(t.weekHours)} h · no cap`
                    }
                    onSelect={() => setPickTarget(t.employeeId)}
                  />
                ))}
                {settings.allowAskAll && eligible.some(t => !t.overlap) && (
                  <PickRadio
                    selected={pickTarget === 'all'}
                    title="Ask all eligible at once"
                    sub={settings.requireApproval ? 'First yes wins — manager still approves' : 'First yes wins'}
                    onSelect={() => setPickTarget('all')}
                  />
                )}
              </div>
            </div>

            <div>
              <div className={LBL}>Message (optional)</div>
              <input
                type="text"
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="e.g. Doctor’s appointment…"
                className={ds.input}
              />
            </div>

            {pickedName && (
              <div className="text-[var(--fs-xs)] text-gray-400 leading-relaxed">
                {`${pickedName} gets ${fmtCap(settings.answerDeadlineHours)} hours to answer.`}
                {settings.requireApproval
                  ? ' The shift stays yours until your manager approves.'
                  : ' The shift moves as soon as someone accepts.'}
              </div>
            )}

            {sheetError && (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[var(--fs-sm)] text-red-700">
                {sheetError}
              </div>
            )}

            <button
              onClick={() => void sendCoverRequest()}
              disabled={pickTarget === null || sending}
              className={`${ds.btnPrimary} disabled:opacity-50`}
            >
              {sending ? 'Sending…' : 'Send request'}
            </button>
            {settings.allowSickReport && (
              <button
                onClick={() => setConfirmSick(true)}
                className="text-[var(--fs-xs)] font-semibold text-red-800 text-center"
              >
                Sick today? Report sick instead →
              </button>
            )}
          </div>
        )}
      </Sheet>

      {confirmSick && sheetSlot && (
        <ConfirmDialog
          title="Report sick for this shift?"
          message="Your manager is told right away and the shift is marked at risk. You don’t need to arrange cover."
          confirmLabel="Report sick"
          cancelLabel="Not now"
          variant="danger"
          onConfirm={() => void reportSick()}
          onCancel={() => setConfirmSick(false)}
        />
      )}

      {cancelReq && (
        <ConfirmDialog
          title="Cancel this cover request?"
          message="Your teammate will be told. The shift stays yours."
          confirmLabel="Cancel request"
          cancelLabel="Keep it"
          variant="danger"
          onConfirm={() => void cancelRequest()}
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
