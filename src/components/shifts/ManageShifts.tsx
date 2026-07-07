'use client';

/**
 * Shifts — Manage Shifts (manager).
 * Week navigation + Week/Day toggle + grouping toggle (By staff / By role / By dept).
 * Mobile (<md): compact per-day list; md+: full 7-day CSS grid with chips
 * (assigned = blue, open = dashed, over-cap = red with "!"). Totals row per
 * day + week split into assigned vs open. Tap a chip to edit/reassign in a
 * bottom sheet; tap an empty cell/day to create a prefilled shift. Footer:
 * New shift · Copy last week · Publish week (drafts become visible to staff).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Badge, EmptyState, Sheet, Spinner, WeekNav } from '@/components/shifts/ui';
import { ds } from '@/lib/design-system';
import {
  berlinParts,
  currentWeekKey,
  berlinISOWeekKey,
  fmtDay,
  fmtTimeRange,
  nowOdooUtc,
  offsetWeekKey,
  weekKeyDays,
} from '@/lib/shifts-time';
import type { ShiftEmployee, ShiftSlot } from '@/types/shifts';

interface CreatePrefill {
  date?: string;
  startHHMM?: string;
  endHHMM?: string;
  roleId?: number;
}

interface ManageShiftsProps {
  companyId: number;
  isManager: boolean;
  employeeId: number | null;
  onBack: () => void;
  onHome: () => void;
  focusDate?: string;
  onCreateShift: (prefill?: CreatePrefill) => void;
}

type Grouping = 'staff' | 'role' | 'dept';
type ViewMode = 'week' | 'day';
type ChipMode = 'time' | 'person';

interface ManageEmployee extends ShiftEmployee {
  hours: number;
  overCap: boolean;
}

interface RoleInfo {
  id: number;
  name: string;
}

interface ManageData {
  employees: ManageEmployee[];
  roles: RoleInfo[];
  slots: ShiftSlot[];
  totals: { perDay: number[]; assigned: number; open: number } | null;
  pendingRequestSlotIds: number[];
}

interface RoleRow {
  roleId: number | null;
  name: string;
  shifts: number;
  open: number;
  byDay: Record<string, ShiftSlot[]>;
}

interface StaffRow {
  emp: ManageEmployee;
  byDay: Record<string, ShiftSlot[]>;
}

interface DeptSection {
  name: string;
  roles: RoleRow[];
}

const LBL = 'text-[var(--fs-xs)] font-semibold tracking-wide uppercase text-gray-400 mb-1.5';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtH(n: number): string {
  return n.toFixed(1);
}

function fmtCap(cap: number): string {
  return Number.isInteger(cap) ? String(cap) : cap.toFixed(1);
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function firstName(name: string): string {
  return (name || '').split(' ')[0] || name;
}

/** "6 – 12 Jul" (or "29 Jun – 5 Jul" across a month boundary). */
function weekLabel(weekKey: string): string {
  const days = weekKeyDays(weekKey);
  const [, m1, d1] = days[0].split('-').map(Number);
  const [, m2, d2] = days[6].split('-').map(Number);
  if (m1 === m2) return `${d1} – ${d2} ${MONTHS[m2 - 1]}`;
  return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}`;
}

/** "Mon 6 Jul" from a pure "YYYY-MM-DD" date (noon UTC = same Berlin date). */
function dayLabel(date: string): string {
  return fmtDay(`${date} 12:00:00`);
}

/** "16:00" → "16", "09:30" → "9:30" — compact chip times like the mock. */
function shortTime(hhmm: string): string {
  const [h, m] = hhmm.split(':');
  const hh = String(Number(h));
  return m === '00' ? hh : `${hh}:${m}`;
}

function chipTime(s: ShiftSlot): string {
  return `${shortTime(berlinParts(s.start).hhmm)}–${shortTime(berlinParts(s.end).hhmm)}`;
}

function hhmmToMin(s: string): number | null {
  const m = (s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function durationFromTimes(start: string, end: string): number | null {
  const s = hhmmToMin(start);
  const e = hhmmToMin(end);
  if (s === null || e === null) return null;
  const mins = (e - s + 1440) % 1440;
  return (mins === 0 ? 1440 : mins) / 60;
}

function push(rec: Record<string, ShiftSlot[]>, key: string, s: ShiftSlot) {
  if (!rec[key]) rec[key] = [];
  rec[key].push(s);
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

function Seg<T extends string>({ value, options, onChange }: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex bg-gray-100 rounded-full p-0.5">
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`px-3 py-1.5 rounded-full text-[var(--fs-xs)] font-semibold whitespace-nowrap transition-colors ${
            value === o.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export default function ManageShifts({ companyId, isManager, onBack, focusDate, onCreateShift }: ManageShiftsProps) {
  const todayBerlin = useMemo(() => berlinParts(nowOdooUtc()).date, []);

  const [weekKey, setWeekKey] = useState(() =>
    focusDate ? berlinISOWeekKey(`${focusDate} 12:00:00`) : currentWeekKey()
  );
  const [viewMode, setViewMode] = useState<ViewMode>(focusDate ? 'day' : 'week');
  const [day, setDay] = useState<string>(focusDate || todayBerlin);
  const [grouping, setGrouping] = useState<Grouping>('staff');

  const [data, setData] = useState<ManageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Slot edit sheet
  const [editSlot, setEditSlot] = useState<ShiftSlot | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [editRoleId, setEditRoleId] = useState<number | null>(null);
  const [editNote, setEditNote] = useState('');
  const [assignId, setAssignId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);

  const [confirm, setConfirm] = useState<'publish' | 'copy' | 'delete' | null>(null);
  const [lastWeekCount, setLastWeekCount] = useState<number | null>(null);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [undo, setUndo] = useState<{ body: Record<string, unknown>; label: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, []);

  const days = useMemo(() => weekKeyDays(weekKey), [weekKey]);

  // Keep the selected day inside the visible week (preserve the weekday).
  useEffect(() => {
    setDay(prev => {
      const list = weekKeyDays(weekKey);
      if (list.includes(prev)) return prev;
      const dow = new Date(`${prev}T12:00:00Z`).getUTCDay(); // 0=Sun
      const idx = (dow + 6) % 7;
      return list[idx] || list[0];
    });
  }, [weekKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/manage?company_id=${companyId}&week=${weekKey}`);
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof raw.error === 'string' ? raw.error : `HTTP ${res.status}`);
      const totals =
        raw.totals && Array.isArray(raw.totals.perDay) && raw.totals.perDay.length === 7
          ? {
              perDay: raw.totals.perDay.map(num),
              assigned: num(raw.totals.assigned),
              open: num(raw.totals.open),
            }
          : null;
      setData({
        employees: Array.isArray(raw.employees) ? raw.employees : [],
        roles: Array.isArray(raw.roles) ? raw.roles : [],
        slots: Array.isArray(raw.slots) ? raw.slots : [],
        totals,
        pendingRequestSlotIds: Array.isArray(raw.pendingRequestSlotIds) ? raw.pendingRequestSlotIds : [],
      });
    } catch (err: unknown) {
      console.error('[shifts] manage fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Could not load the week');
    } finally {
      setLoading(false);
    }
  }, [companyId, weekKey]);

  useEffect(() => {
    if (companyId) void load();
  }, [companyId, load]);

  const pendingSet = useMemo(() => new Set(data?.pendingRequestSlotIds ?? []), [data]);

  // ---- Bucketing for all three groupings -----------------------------------
  const view = useMemo(() => {
    const employees = data?.employees ?? [];
    const slots = (data?.slots ?? []).slice().sort((a, b) => a.start.localeCompare(b.start));
    const roles = data?.roles ?? [];

    const empById = new Map<number, ManageEmployee>();
    for (const e of employees) empById.set(e.id, e);

    const staffRows: StaffRow[] = employees
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(emp => ({ emp, byDay: {} }));
    const staffByEmp = new Map<number, StaffRow>(staffRows.map(r => [r.emp.id, r]));

    const openByDay: Record<string, ShiftSlot[]> = {};
    let openCount = 0;

    const roleRows: RoleRow[] = roles.map(r => ({ roleId: r.id, name: r.name, shifts: 0, open: 0, byDay: {} }));
    const roleByKey = new Map<number, RoleRow>(roleRows.map(r => [r.roleId as number, r]));

    const deptMap = new Map<string, Map<number, RoleRow>>();

    for (const s of slots) {
      const d = berlinParts(s.start).date;
      const isOpen = !s.employeeId;

      // By staff
      if (isOpen) {
        push(openByDay, d, s);
        openCount++;
      } else {
        let row = staffByEmp.get(s.employeeId as number);
        if (!row) {
          // Assigned to someone outside the roster response — still show them.
          row = {
            emp: {
              id: s.employeeId as number,
              name: s.employeeName || 'Unknown',
              resourceId: s.resourceId,
              departmentId: null,
              departmentName: '',
              cap: null,
              skill: null,
              roleIds: [],
              employmentType: null,
              hourlyRate: 13.9, // min-wage fallback; real rate comes from the roster response
              hasContract: false,
              hours: 0,
              overCap: false,
            },
            byDay: {},
          };
          staffRows.push(row);
          staffByEmp.set(s.employeeId as number, row);
        }
        push(row.byDay, d, s);
      }

      // By role
      const rk = s.roleId ?? 0;
      let rr = roleByKey.get(rk);
      if (!rr) {
        rr = { roleId: s.roleId ?? null, name: s.roleName || 'No role', shifts: 0, open: 0, byDay: {} };
        roleByKey.set(rk, rr);
        roleRows.push(rr);
      }
      rr.shifts++;
      if (isOpen) rr.open++;
      push(rr.byDay, d, s);

      // By department (from the assigned employee; open/unknown → fallback)
      const deptName = s.employeeId
        ? empById.get(s.employeeId)?.departmentName || 'No department'
        : 'No department';
      let deptRoles = deptMap.get(deptName);
      if (!deptRoles) {
        deptRoles = new Map();
        deptMap.set(deptName, deptRoles);
      }
      let dr = deptRoles.get(rk);
      if (!dr) {
        dr = { roleId: s.roleId ?? null, name: s.roleName || 'No role', shifts: 0, open: 0, byDay: {} };
        deptRoles.set(rk, dr);
      }
      dr.shifts++;
      if (isOpen) dr.open++;
      push(dr.byDay, d, s);
    }

    const deptSections: DeptSection[] = Array.from(deptMap.entries())
      .sort((a, b) => {
        if (a[0] === 'No department') return 1;
        if (b[0] === 'No department') return -1;
        return a[0].localeCompare(b[0]);
      })
      .map(([name, rMap]) => ({
        name,
        roles: Array.from(rMap.values()).sort((x, y) => x.name.localeCompare(y.name)),
      }));

    return { staffRows, openByDay, openCount, roleRows, deptSections };
  }, [data]);

  const totals = useMemo(() => {
    if (data?.totals) return data.totals;
    const perDay = days.map(() => 0);
    let assigned = 0;
    let open = 0;
    for (const s of data?.slots ?? []) {
      const i = days.indexOf(berlinParts(s.start).date);
      if (i >= 0) perDay[i] += s.hours;
      if (s.employeeId) assigned += s.hours;
      else open += s.hours;
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    return { perDay: perDay.map(round), assigned: round(assigned), open: round(open) };
  }, [data, days]);

  const draftCount = (data?.slots ?? []).filter(s => s.state === 'draft').length;
  const weekTotalsLabel = `${fmtH(totals.assigned + totals.open)} h · ${fmtH(totals.assigned)} assigned + ${fmtH(totals.open)} open`;

  // ---- Slot sheet -----------------------------------------------------------
  function openSheet(slot: ShiftSlot) {
    const ps = berlinParts(slot.start);
    const pe = berlinParts(slot.end);
    setEditSlot(slot);
    setEditDate(ps.date);
    setEditStart(ps.hhmm);
    setEditEnd(pe.hhmm);
    setEditRoleId(slot.roleId);
    setEditNote(slot.note || '');
    setAssignId(slot.employeeId);
    setShowAll(false);
    setSaving(false);
    setSheetError(null);
  }

  function closeSheet() {
    setEditSlot(null);
    setSheetError(null);
  }

  async function saveSlot() {
    if (!editSlot) return;
    setSaving(true);
    setSheetError(null);
    try {
      const res = await fetch(`/api/shifts/slots/${editSlot.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          date: editDate,
          start: editStart,
          end: editEnd,
          role_id: editRoleId,
          note: editNote.trim(),
          assign_employee_id: assignId,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.error === 'string' ? d.error : `HTTP ${res.status}`);
      closeSheet();
      showToast('Shift updated');
      void load();
    } catch (err: unknown) {
      setSheetError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }

  /** A POST /api/shifts/slots body from the current edit-sheet values (one shift). */
  function editSheetToCreateBody(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      company_id: companyId, date: editDate, start: editStart, end: editEnd,
      role_id: editRoleId, note: editNote.trim(), count: 1,
    };
    if (assignId !== null) body.assign_employee_id = assignId;
    return body;
  }

  async function createFromBody(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch('/api/shifts/slots', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof d.error === 'string' ? d.error : `HTTP ${res.status}`);
    return true;
  }

  async function doDuplicate() {
    if (!editSlot) return;
    setSaving(true);
    setSheetError(null);
    try {
      await createFromBody(editSheetToCreateBody());
      closeSheet();
      showToast('Shift duplicated — a copy was added as a draft');
      void load();
    } catch (err: unknown) {
      setSheetError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    if (!editSlot) return;
    setConfirm(null);
    setSaving(true);
    setSheetError(null);
    const restoreBody = editSheetToCreateBody(); // capture before we clear the sheet
    try {
      const res = await fetch(`/api/shifts/slots/${editSlot.id}?company_id=${companyId}`, { method: 'DELETE' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.error === 'string' ? d.error : `HTTP ${res.status}`);
      closeSheet();
      // Offer a 6s Undo instead of a plain toast.
      setUndo({ body: restoreBody, label: 'Shift deleted' });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 6000);
      void load();
    } catch (err: unknown) {
      setSheetError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }

  async function undoDelete() {
    if (!undo) return;
    const body = undo.body;
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    try {
      await createFromBody(body);
      showToast('Shift restored');
      void load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not restore the shift');
    }
  }

  async function doPublish() {
    setConfirm(null);
    try {
      const res = await fetch('/api/shifts/publish-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, week: weekKey }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.error === 'string' ? d.error : `HTTP ${res.status}`);
      const n = typeof d.published === 'number' ? d.published : draftCount;
      showToast(`Published ${n} shift${n === 1 ? '' : 's'} — staff can see them now`);
      void load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not publish the week');
    }
  }

  // Peek at last week so the confirm can say how many shifts will be copied.
  async function openCopyConfirm() {
    setLastWeekCount(null);
    setConfirm('copy');
    try {
      const prev = offsetWeekKey(weekKey, -1);
      const res = await fetch(`/api/shifts/manage?company_id=${companyId}&week=${prev}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.slots)) setLastWeekCount(data.slots.length);
    } catch { /* preview only — ignore */ }
  }

  async function doCopyLastWeek() {
    setConfirm(null);
    try {
      const res = await fetch('/api/shifts/copy-last-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, week: weekKey }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.error === 'string' ? d.error : `HTTP ${res.status}`);
      const n = typeof d.created === 'number' ? d.created : 0;
      showToast(`Copied ${n} shift${n === 1 ? '' : 's'} from last week as drafts`);
      void load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not copy last week');
    }
  }

  // ---- Chip + cell renderers ------------------------------------------------
  const chip = (s: ShiftSlot, mode: ChipMode, block: boolean) => {
    const isOpen = !s.employeeId;
    const base = isOpen
      ? 'bg-white border border-dashed border-gray-400 text-gray-600'
      : s.overCap
        ? 'bg-red-100 text-red-800'
        : 'bg-blue-100 text-blue-800';
    // Drafts (not yet published) read as faded with an amber dashed outline so a
    // manager can tell live vs still-pending shifts at a glance.
    const cls = s.state === 'draft'
      ? `${base} opacity-70 outline-dashed outline-1 outline-offset-[-2px] outline-amber-500`
      : base;
    return (
      <button
        key={s.id}
        onClick={e => {
          e.stopPropagation();
          openSheet(s);
        }}
        className={`relative ${block ? 'w-full' : ''} rounded-md px-1.5 py-1 text-[var(--fs-xs)] font-bold leading-tight text-center ${cls}`}
      >
        {mode === 'person' && block ? (
          <>
            <span className="block truncate">{isOpen ? 'Open' : firstName(s.employeeName)}</span>
            <span className="tabular-nums whitespace-nowrap">
              {chipTime(s)}
              {s.overCap ? ' !' : ''}
            </span>
          </>
        ) : (
          <span className="tabular-nums whitespace-nowrap">
            {mode === 'person' ? `${isOpen ? 'Open' : firstName(s.employeeName)} ` : ''}
            {chipTime(s)}
            {s.overCap ? ' !' : ''}
          </span>
        )}
        {pendingSet.has(s.id) && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-500 border border-white" />
        )}
      </button>
    );
  };

  const gridCell = (key: string, date: string, cellSlots: ShiftSlot[], mode: ChipMode, roleId?: number | null) => (
    <div
      key={key}
      onClick={() => onCreateShift({ date, ...(roleId !== null && roleId !== undefined ? { roleId } : {}) })}
      className="bg-white p-1 flex flex-col gap-1 min-h-[56px] cursor-pointer active:bg-gray-50"
    >
      {cellSlots.map(s => chip(s, mode, true))}
    </div>
  );

  const labelCell = (key: string, title: string, sub: string, subOver = false) => (
    <div key={key} className="bg-white px-3 py-2 flex flex-col justify-center min-w-0">
      <div className="text-[var(--fs-sm)] font-bold text-gray-900 truncate">{title}</div>
      <div className={`text-[var(--fs-xs)] tabular-nums ${subOver ? 'text-red-600 font-bold' : 'text-gray-500'}`}>{sub}</div>
    </div>
  );

  const capText = (emp: ManageEmployee) =>
    emp.cap === null ? `${fmtH(emp.hours)} h · no cap` : `${fmtH(emp.hours)} / ${fmtCap(emp.cap)} h`;
  const isOver = (emp: ManageEmployee) => emp.overCap || (emp.cap !== null && emp.hours > emp.cap);

  function gridRows(): React.ReactNode {
    if (grouping === 'staff') {
      return (
        <>
          {view.staffRows.map(r => (
            <React.Fragment key={`st-${r.emp.id}`}>
              {labelCell(`stl-${r.emp.id}`, r.emp.name, capText(r.emp), isOver(r.emp))}
              {days.map(d => gridCell(`stc-${r.emp.id}-${d}`, d, r.byDay[d] || [], 'time'))}
            </React.Fragment>
          ))}
          <React.Fragment key="open-row">
            {labelCell('opl', 'Open shifts', `${view.openCount} unclaimed`)}
            {days.map(d => gridCell(`opc-${d}`, d, view.openByDay[d] || [], 'time'))}
          </React.Fragment>
        </>
      );
    }
    if (grouping === 'role') {
      return (
        <>
          {view.roleRows.map(r => (
            <React.Fragment key={`ro-${r.roleId ?? 0}`}>
              {labelCell(
                `rol-${r.roleId ?? 0}`,
                r.name,
                `${r.shifts} shift${r.shifts === 1 ? '' : 's'} · ${r.open} gap${r.open === 1 ? '' : 's'}`
              )}
              {days.map(d => gridCell(`roc-${r.roleId ?? 0}-${d}`, d, r.byDay[d] || [], 'person', r.roleId))}
            </React.Fragment>
          ))}
        </>
      );
    }
    return (
      <>
        {view.deptSections.map(sec => (
          <React.Fragment key={`dp-${sec.name}`}>
            <div className="col-span-full bg-gray-100 px-3 py-1.5 text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-600">
              {sec.name}
            </div>
            {sec.roles.map(r => (
              <React.Fragment key={`dpr-${sec.name}-${r.roleId ?? 0}`}>
                {labelCell(
                  `dpl-${sec.name}-${r.roleId ?? 0}`,
                  r.name,
                  `${r.shifts} shift${r.shifts === 1 ? '' : 's'} · ${r.open} open`
                )}
                {days.map(d => gridCell(`dpc-${sec.name}-${r.roleId ?? 0}-${d}`, d, r.byDay[d] || [], 'person', r.roleId))}
              </React.Fragment>
            ))}
          </React.Fragment>
        ))}
      </>
    );
  }

  // ---- Compact day rows (mobile week view + day view) -----------------------
  const mobileRow = (key: string, label: string, rowSlots: ShiftSlot[], mode: ChipMode) => (
    <div key={key} className="flex items-start gap-2 px-4 py-2 border-t border-gray-100">
      <div className="w-28 flex-shrink-0 pt-1 text-[var(--fs-sm)] font-semibold text-gray-700 truncate">{label}</div>
      <div className="flex-1 flex flex-wrap gap-1.5">{rowSlots.map(s => chip(s, mode, false))}</div>
    </div>
  );

  function renderDayRows(date: string): React.ReactNode {
    const rows: React.ReactNode[] = [];
    if (grouping === 'staff') {
      for (const r of view.staffRows) {
        const s = r.byDay[date] || [];
        if (s.length) rows.push(mobileRow(`mst-${r.emp.id}`, r.emp.name, s, 'time'));
      }
      const open = view.openByDay[date] || [];
      if (open.length) rows.push(mobileRow('mopen', 'Open', open, 'time'));
    } else if (grouping === 'role') {
      for (const r of view.roleRows) {
        const s = r.byDay[date] || [];
        if (s.length) rows.push(mobileRow(`mro-${r.roleId ?? 0}`, r.name, s, 'person'));
      }
    } else {
      for (const sec of view.deptSections) {
        const secRows = sec.roles
          .map(r => ({ r, s: r.byDay[date] || [] }))
          .filter(x => x.s.length > 0);
        if (!secRows.length) continue;
        rows.push(
          <div key={`mdh-${sec.name}`} className="px-4 pt-2 pb-0.5 text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400">
            {sec.name}
          </div>
        );
        for (const x of secRows) rows.push(mobileRow(`mdp-${sec.name}-${x.r.roleId ?? 0}`, x.r.name, x.s, 'person'));
      }
    }
    if (!rows.length) {
      return <div className="px-4 py-3 text-[var(--fs-sm)] text-gray-400">No shifts — tap + to add one</div>;
    }
    return rows;
  }

  const dayCard = (date: string, i: number) => (
    <div key={date} className={`${ds.card} overflow-hidden`}>
      <div className="flex items-center justify-between pl-4 pr-2 py-2 bg-gray-50">
        <span className="text-[var(--fs-sm)] font-bold text-gray-900">{dayLabel(date)}</span>
        <span className="flex items-center gap-1.5">
          <span className="text-[var(--fs-xs)] text-gray-500 tabular-nums">
            {totals.perDay[i] > 0 ? `${fmtH(totals.perDay[i])} h` : '—'}
          </span>
          <button
            onClick={() => onCreateShift({ date })}
            aria-label={`Add shift on ${dayLabel(date)}`}
            className="w-8 h-8 rounded-lg bg-gray-100 text-gray-600 text-[var(--fs-md)] font-bold flex items-center justify-center active:bg-gray-200"
          >
            +
          </button>
        </span>
      </div>
      <div className="pb-1">{renderDayRows(date)}</div>
    </div>
  );

  const legend = (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-1 pt-2.5 text-[var(--fs-xs)] text-gray-500">
      <span className="flex items-center gap-1.5">
        <span className="w-3.5 h-3.5 rounded bg-blue-100 border border-blue-200" />
        Assigned
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3.5 h-3.5 rounded bg-white border-[1.5px] border-dashed border-gray-400" />
        Open — waiting to be claimed
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3.5 h-3.5 rounded bg-blue-100 opacity-70 outline-dashed outline-1 outline-amber-500" />
        Draft — not published yet
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3.5 h-3.5 rounded bg-red-100 border border-red-200" />
        Over weekly hours
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-amber-500" />
        Cover request pending
      </span>
    </div>
  );

  // ---- Sheet helpers ---------------------------------------------------------
  const employees = data?.employees ?? [];
  const byName = (a: ManageEmployee, b: ManageEmployee) => a.name.localeCompare(b.name);
  const isEligible = (e: ManageEmployee) => editRoleId === null || e.roleIds.includes(editRoleId);
  const eligiblePeople = employees.filter(isEligible).sort(byName);
  const otherPeople = employees.filter(e => !isEligible(e)).sort(byName);
  const visibleOthers = showAll ? otherPeople : otherPeople.filter(e => e.id === assignId);

  const editDur = durationFromTimes(editStart, editEnd);
  const projectionFor = (emp: ManageEmployee): number => {
    const base = emp.hours;
    if (editSlot && emp.id === editSlot.employeeId) return base;
    return Math.round((base + (editDur ?? editSlot?.hours ?? 0)) * 100) / 100;
  };

  const selEmp = assignId !== null ? employees.find(e => e.id === assignId) : undefined;
  const selProjected = selEmp ? projectionFor(selEmp) : 0;
  const selOverage =
    selEmp && selEmp.cap !== null && selProjected > selEmp.cap
      ? Math.round((selProjected - selEmp.cap) * 100) / 100
      : 0;

  const pickerRow = (emp: ManageEmployee, eligibleForRole: boolean) => {
    const selected = assignId === emp.id;
    const projected = projectionFor(emp);
    const over = emp.cap !== null && projected > emp.cap;
    return (
      <button
        key={emp.id}
        onClick={() => setAssignId(emp.id)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
          selected ? 'border-green-600 bg-green-50' : 'border-gray-200 bg-white active:bg-gray-50'
        }`}
      >
        <span className="flex-1 min-w-0">
          <span className="block text-[var(--fs-sm)] font-bold text-gray-900 truncate">{emp.name}</span>
          <span className={`block text-[var(--fs-xs)] tabular-nums ${over ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
            {`${fmtH(projected)}${emp.cap !== null ? ` / ${fmtCap(emp.cap)}` : ''} h that week with this shift`}
          </span>
        </span>
        {!eligibleForRole && <Badge variant="gray">Not this role</Badge>}
      </button>
    );
  };

  // ---- Guards ----------------------------------------------------------------
  if (!isManager) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader supertitle="Shifts" title="Manage Shifts" showBack onBack={onBack} />
        <EmptyState icon="🔒" title="Managers only" body="The schedule is managed by managers." />
      </div>
    );
  }

  const hasAnything = (data?.slots ?? []).length > 0 || employees.length > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Shifts" title="Manage Shifts" subtitle="Plan, publish & reassign" showBack onBack={onBack} />

      <div className="pt-3 pb-36 max-w-6xl mx-auto w-full">
        <WeekNav
          weekKey={weekKey}
          label={weekLabel(weekKey)}
          onPrev={() => setWeekKey(k => offsetWeekKey(k, -1))}
          onNext={() => setWeekKey(k => offsetWeekKey(k, 1))}
        />

        <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
          <Seg<ViewMode>
            value={viewMode}
            options={[
              { key: 'week', label: 'Week' },
              { key: 'day', label: 'Day' },
            ]}
            onChange={setViewMode}
          />
          <Seg<Grouping>
            value={grouping}
            options={[
              { key: 'staff', label: 'By staff' },
              { key: 'role', label: 'By role' },
              { key: 'dept', label: 'By dept' },
            ]}
            onChange={setGrouping}
          />
        </div>

        {loading ? (
          <Spinner />
        ) : error ? (
          <div className="flex flex-col items-center justify-center px-6 py-16">
            <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load the week</p>
            <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
            <button onClick={() => void load()} className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl active:bg-green-700">
              Retry
            </button>
          </div>
        ) : !hasAnything ? (
          <EmptyState
            icon="🗓️"
            title="Nothing planned yet"
            body="Create a shift below, or copy last week to get started."
          />
        ) : viewMode === 'day' ? (
          <div className="px-4 flex flex-col gap-3">
            <div className="flex gap-1.5">
              {days.map(d => {
                const [wd, dn] = dayLabel(d).split(' ');
                const on = d === day;
                return (
                  <button
                    key={d}
                    onClick={() => setDay(d)}
                    className={`flex-1 flex flex-col items-center py-2 rounded-xl text-[var(--fs-xs)] font-bold transition-colors ${
                      on ? 'bg-green-600 text-white' : 'bg-white border border-gray-200 text-gray-500 active:bg-gray-50'
                    }`}
                  >
                    <span>{wd.slice(0, 2)}</span>
                    <span className="text-[var(--fs-sm)] tabular-nums">{dn}</span>
                  </button>
                );
              })}
            </div>
            <div className="text-[var(--fs-sm)] text-gray-500 px-1 tabular-nums">{weekTotalsLabel}</div>
            {dayCard(day, Math.max(days.indexOf(day), 0))}
            {legend}
          </div>
        ) : (
          <>
            {/* Mobile: compact list per day */}
            <div className="md:hidden px-4 flex flex-col gap-3">
              <div className="text-[var(--fs-sm)] text-gray-500 px-1 tabular-nums">{weekTotalsLabel}</div>
              {days.map((d, i) => dayCard(d, i))}
              {legend}
            </div>

            {/* Tablet / desktop: full week grid */}
            <div className="hidden md:block px-4">
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
                <div
                  className="grid gap-px bg-gray-200 min-w-[860px]"
                  style={{ gridTemplateColumns: 'minmax(170px,1.3fr) repeat(7, minmax(92px,1fr))' }}
                >
                  <div className="bg-gray-50 px-3 py-2 flex items-end text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-500">
                    {grouping === 'staff' ? 'Team' : grouping === 'role' ? 'Role' : 'Department / Role'}
                  </div>
                  {days.map(d => {
                    const [wd, dn] = dayLabel(d).split(' ');
                    return (
                      <div key={`h-${d}`} className="bg-gray-50 py-1.5 text-center">
                        <div className="text-[var(--fs-xs)] font-bold uppercase text-gray-500">{wd}</div>
                        <div className="text-[var(--fs-sm)] font-bold text-gray-900 tabular-nums">{dn}</div>
                      </div>
                    );
                  })}

                  {gridRows()}

                  <div className="bg-gray-100 px-3 py-2">
                    <div className="text-[var(--fs-sm)] font-bold text-gray-900">Total scheduled</div>
                    <div className="text-[var(--fs-xs)] text-gray-500 tabular-nums">{weekTotalsLabel}</div>
                  </div>
                  {days.map((d, i) => (
                    <div
                      key={`t-${d}`}
                      className="bg-gray-100 flex items-center justify-center py-2 text-[var(--fs-sm)] font-bold text-gray-900 tabular-nums"
                    >
                      {totals.perDay[i] > 0 ? (
                        `${Number.isInteger(totals.perDay[i]) ? totals.perDay[i] : totals.perDay[i].toFixed(1)} h`
                      ) : (
                        <span className="text-gray-400 font-normal">—</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              {legend}
            </div>
          </>
        )}
      </div>

      {/* Footer actions */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 safe-bottom z-[60]">
        <div className="max-w-6xl mx-auto flex gap-2">
          <button
            onClick={() => onCreateShift(viewMode === 'day' ? { date: day } : undefined)}
            className="flex-1 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl py-3 text-[var(--fs-sm)] active:bg-gray-50"
          >
            New shift
          </button>
          <button
            onClick={() => void openCopyConfirm()}
            className="flex-1 bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl py-3 text-[var(--fs-sm)] active:bg-gray-50"
          >
            Copy last week
          </button>
          <button
            onClick={() => setConfirm('publish')}
            disabled={draftCount === 0}
            className="flex-1 bg-green-600 text-white font-semibold rounded-xl py-3 text-[var(--fs-sm)] active:bg-green-700 shadow-lg shadow-green-600/30 disabled:opacity-50"
          >
            Publish week
          </button>
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>

      {/* Slot edit / assign sheet */}
      <Sheet open={editSlot !== null} onClose={closeSheet}>
        {editSlot && (
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[var(--fs-lg)] font-bold text-gray-900">
                  {`${fmtDay(editSlot.start)} · ${fmtTimeRange(editSlot.start, editSlot.end)}`}
                </div>
                <div className="text-[var(--fs-sm)] text-gray-500">
                  {`${editSlot.roleName || 'Any role'} · ${fmtH(editSlot.hours)} hours · ${
                    editSlot.employeeName ? `assigned to ${editSlot.employeeName}` : 'open'
                  }`}
                </div>
              </div>
              <Badge variant={editSlot.state === 'draft' ? 'gray' : 'green'}>
                {editSlot.state === 'draft' ? 'Draft' : 'Published'}
              </Badge>
            </div>

            {pendingSet.has(editSlot.id) && (
              <WarnBox>
                A cover request is waiting on this shift — saving changes will cancel it and both people will be told.
              </WarnBox>
            )}

            <div>
              <div className={LBL}>Date</div>
              <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} className={ds.input} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className={LBL}>Start</div>
                <input type="time" value={editStart} onChange={e => setEditStart(e.target.value)} className={ds.input} />
              </div>
              <div>
                <div className={LBL}>End</div>
                <input type="time" value={editEnd} onChange={e => setEditEnd(e.target.value)} className={ds.input} />
              </div>
            </div>
            <div>
              <div className={LBL}>Role</div>
              <select
                value={editRoleId ?? ''}
                onChange={e => setEditRoleId(e.target.value === '' ? null : Number(e.target.value))}
                className={ds.input}
              >
                <option value="">Any role</option>
                {(data?.roles ?? []).map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <div className={LBL}>Note</div>
              <input
                type="text"
                value={editNote}
                onChange={e => setEditNote(e.target.value)}
                placeholder="Optional note for this shift"
                className={ds.input}
              />
            </div>

            <div>
              <div className={LBL}>Assigned to</div>
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={() => setAssignId(null)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-dashed text-left transition-colors ${
                    assignId === null ? 'border-green-600 bg-green-50' : 'border-gray-300 bg-white active:bg-gray-50'
                  }`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block text-[var(--fs-sm)] font-bold text-gray-900">Leave open</span>
                    <span className="block text-[var(--fs-xs)] text-gray-500">Anyone eligible can claim it once published</span>
                  </span>
                </button>
                {eligiblePeople.map(e => pickerRow(e, true))}
                {visibleOthers.map(e => pickerRow(e, false))}
                {otherPeople.length > 0 && (
                  <button onClick={() => setShowAll(v => !v)} className={`${ds.btnGhost} self-start px-1 py-1`}>
                    {showAll ? 'Only show matching roles' : `Show all people (${otherPeople.length} more)`}
                  </button>
                )}
              </div>
            </div>

            {selEmp && selOverage > 0 && selEmp.cap !== null && (
              <WarnBox>
                This puts {firstName(selEmp.name)} at <b>{fmtH(selProjected)} of {fmtCap(selEmp.cap)} hours</b> that week —{' '}
                <b>{fmtH(selOverage)} h over</b> their cap. You can still assign them; the shift will be flagged so you can keep an eye on it.
              </WarnBox>
            )}

            {sheetError && (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[var(--fs-sm)] text-red-700">
                {sheetError}
              </div>
            )}

            <button onClick={() => void saveSlot()} disabled={saving} className={`${ds.btnPrimary} disabled:opacity-50`}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button onClick={() => void doDuplicate()} disabled={saving} className={`${ds.btnSecondary} disabled:opacity-50`}>
              Duplicate this shift
            </button>
            <button onClick={() => setConfirm('delete')} disabled={saving} className={`${ds.btnDanger} disabled:opacity-50`}>
              Delete shift
            </button>
            <button onClick={closeSheet} className={ds.btnSecondary}>
              Cancel
            </button>
          </div>
        )}
      </Sheet>

      {confirm === 'publish' && (
        <ConfirmDialog
          title="Publish this week?"
          message={`Publish ${draftCount} draft shift${draftCount === 1 ? '' : 's'} so staff can see ${draftCount === 1 ? 'it' : 'them'}. Already-published shifts stay exactly as they are; everyone newly assigned gets notified.`}
          confirmLabel="Publish week"
          onConfirm={() => void doPublish()}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'copy' && (
        <ConfirmDialog
          title="Copy last week?"
          message={
            lastWeekCount === null
              ? 'Checking last week…'
              : lastWeekCount === 0
                ? 'Last week has no shifts to copy.'
                : `Copy the ${lastWeekCount} shift${lastWeekCount === 1 ? '' : 's'} from last week into this week as drafts — same times, roles and people. Nothing is visible to staff until you publish.`
          }
          confirmLabel="Copy last week"
          onConfirm={() => void doCopyLastWeek()}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'delete' && editSlot && (
        <ConfirmDialog
          variant="danger"
          title="Delete this shift?"
          message={`${fmtDay(editSlot.start)} · ${fmtTimeRange(editSlot.start, editSlot.end)}${
            editSlot.employeeName ? ` — assigned to ${editSlot.employeeName}` : ''
          }. You’ll get a few seconds to undo.`}
          confirmLabel="Delete shift"
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirm(null)}
        />
      )}

      {toast && !undo && (
        <div className="fixed bottom-24 left-1/2 z-[120] -translate-x-1/2 rounded-full bg-gray-900 px-5 py-3 text-[var(--fs-base)] text-white shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}
      {undo && (
        <div className="fixed bottom-24 left-1/2 z-[120] -translate-x-1/2 flex items-center gap-4 rounded-full bg-gray-900 px-5 py-3 text-white shadow-lg whitespace-nowrap">
          <span className="text-[var(--fs-base)]">{undo.label}</span>
          <button onClick={() => void undoDelete()} className="text-[var(--fs-base)] font-bold text-green-400 active:text-green-300">
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
