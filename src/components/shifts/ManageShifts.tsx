'use client';

/**
 * Shifts — Manage Shifts (manager).
 * Day / Week / Month views. Week & Day add a grouping toggle (By staff / By role
 * / By dept); Month is a calendar grid (day cell shows shift count + amber dot
 * for open shifts, tap a day to quick-add). Mobile (<md): compact per-day list;
 * md+: full 7-day CSS grid with chips (assigned = blue, open = dashed, over-cap
 * = red with "!"). Tap a chip to edit/reassign in a bottom sheet; tap an empty
 * cell/day to quick-add a shift inline (no view switch) — the quick-add sheet
 * posts to /api/shifts/slots and refreshes in place, with a "More options" link
 * to the full Create Shift form. Footer: New shift · Copy last week · Publish.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Badge, EmptyState, Sheet, Spinner, ToggleSwitch, WeekNav } from '@/components/shifts/ui';
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

type ViewMode = 'week' | 'day' | 'month';
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
  departments: RoleInfo[];
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

interface DeptPersonRow {
  key: string; // "e<id>" for a person, "open" for unassigned
  label: string;
  byDay: Record<string, ShiftSlot[]>;
}
interface DeptPersonSection {
  name: string;
  people: DeptPersonRow[];
}

type SubGroup = 'role' | 'person';

const LBL = 'text-[var(--fs-xs)] font-semibold tracking-wide uppercase text-gray-400 mb-1.5';
const HINT = 'text-[var(--fs-xs)] text-gray-400';
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

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "YYYY-MM-DD" + n days (pure calendar arithmetic, UTC-safe). */
function addDaysStr(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Shift a "YYYY-MM" month anchor by delta months. */
function shiftMonth(anchor: string, delta: number): string {
  const [y, m] = anchor.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** "July 2026" for a "YYYY-MM" anchor. */
function monthLabel(anchor: string): string {
  const [y, m] = anchor.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** The 42 dates (6 weeks, Mon-first) of the calendar grid for a "YYYY-MM" month. */
function monthGridCells(anchor: string): string[] {
  const first = `${anchor}-01`;
  const firstDow = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7; // 0=Mon
  const gridStart = addDaysStr(first, -firstDow);
  const cells: string[] = [];
  for (let i = 0; i < 42; i++) cells.push(addDaysStr(gridStart, i));
  return cells;
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
  // Always grouped by Department; the sub-level toggles between Role and Person.
  const [subGroup, setSubGroup] = useState<SubGroup>('role');

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
  const [notifyOnPublish, setNotifyOnPublish] = useState(true);
  const [upcoming, setUpcoming] = useState<{ count: number; weeks: number } | null>(null); // all future drafts
  const [quickMenu, setQuickMenu] = useState<ShiftSlot | null>(null);
  const [deleteSeries, setDeleteSeries] = useState<{ slot: ShiftSlot; count: number } | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  const [copyDaySheet, setCopyDaySheet] = useState(false);
  const [copyTargets, setCopyTargets] = useState<Set<string>>(new Set());

  // Month view (calendar grid) — its own multi-week aggregation.
  const [monthAnchor, setMonthAnchor] = useState<string>(() => (focusDate || todayBerlin).slice(0, 7));
  const [monthSlots, setMonthSlots] = useState<Map<string, ShiftSlot[]>>(new Map());
  // On phones the month grid is too narrow for chips — tap a day to reveal its
  // shifts in a readable list below. isNarrow drives that (grid tap = select).
  const [monthSelectedDay, setMonthSelectedDay] = useState<string>(todayBerlin);
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 639px)');
    const on = () => setIsNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  // Keep the selected day inside the shown month.
  useEffect(() => {
    setMonthSelectedDay(todayBerlin.slice(0, 7) === monthAnchor ? todayBerlin : `${monthAnchor}-01`);
  }, [monthAnchor, todayBerlin]);

  // Inline quick-add sheet (create a shift without leaving Manage).
  const [qaDate, setQaDate] = useState<string | null>(null);
  const [qaStart, setQaStart] = useState('16:00');
  const [qaEnd, setQaEnd] = useState('22:00');
  const [qaDeptId, setQaDeptId] = useState<number | null>(null);
  // Multi-add: each ticked role → one open shift; each ticked person → one shift.
  const [qaRoleIds, setQaRoleIds] = useState<Set<number>>(new Set());
  const [qaMode, setQaMode] = useState<'open' | 'pick'>('open');
  const [qaPeopleIds, setQaPeopleIds] = useState<Set<number>>(new Set());
  const [qaMinSkill, setQaMinSkill] = useState<'1' | '2' | '3'>('1'); // open-shift skill gate
  const [qaNote, setQaNote] = useState(''); // optional shift name
  const [qaSaving, setQaSaving] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);

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
    if (pressTimer.current) clearTimeout(pressTimer.current);
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
        departments: Array.isArray(raw.departments) ? raw.departments : [],
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

  // Month view spans several ISO weeks — fetch each week the grid touches and
  // keep the actual slots per day (so cells can show real shifts, not just a
  // count). Runs only while month view is open.
  const loadMonth = useCallback(async () => {
    const cells = monthGridCells(monthAnchor);
    const weekKeys = Array.from(new Set(cells.map(d => berlinISOWeekKey(`${d} 12:00:00`))));
    try {
      const results = await Promise.all(
        weekKeys.map(wk =>
          fetch(`/api/shifts/manage?company_id=${companyId}&week=${wk}`)
            .then(r => (r.ok ? r.json() : { slots: [] }))
            .catch(() => ({ slots: [] })),
        ),
      );
      const map = new Map<string, ShiftSlot[]>();
      const seen = new Set<number>();
      for (const r of results) {
        for (const s of (Array.isArray(r.slots) ? r.slots : []) as ShiftSlot[]) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          const dt = berlinParts(s.start).date;
          const arr = map.get(dt) ?? [];
          arr.push(s);
          map.set(dt, arr);
        }
      }
      map.forEach(arr => arr.sort((a, b) => a.start.localeCompare(b.start)));
      setMonthSlots(map);
    } catch (err: unknown) {
      console.warn('[shifts] month load failed:', err instanceof Error ? err.message : String(err));
    }
  }, [companyId, monthAnchor]);

  useEffect(() => {
    if (companyId && viewMode === 'month') void loadMonth();
  }, [companyId, viewMode, loadMonth]);

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
    const deptPersonMap = new Map<string, Map<string, DeptPersonRow>>();

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
              weeklyTarget: null,
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

      // By department: prefer the department stored on the slot itself (so open
      // shifts group correctly too); fall back to the assignee's department.
      const deptName =
        s.departmentName ||
        (s.employeeId ? empById.get(s.employeeId)?.departmentName : '') ||
        'No department';
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

      // By department → person (rows are people; "Open" collects unassigned)
      const personKey = s.employeeId ? `e${s.employeeId}` : 'open';
      const personLabel = s.employeeId ? s.employeeName || 'Unknown' : 'Open';
      let deptPeople = deptPersonMap.get(deptName);
      if (!deptPeople) {
        deptPeople = new Map();
        deptPersonMap.set(deptName, deptPeople);
      }
      let pr = deptPeople.get(personKey);
      if (!pr) {
        pr = { key: personKey, label: personLabel, byDay: {} };
        deptPeople.set(personKey, pr);
      }
      push(pr.byDay, d, s);
    }

    const sortDept = (a: [string, unknown], b: [string, unknown]) => {
      if (a[0] === 'No department') return 1;
      if (b[0] === 'No department') return -1;
      return a[0].localeCompare(b[0]);
    };

    const deptSections: DeptSection[] = Array.from(deptMap.entries())
      .sort(sortDept)
      .map(([name, rMap]) => ({
        name,
        roles: Array.from(rMap.values()).sort((x, y) => x.name.localeCompare(y.name)),
      }));

    const deptPersonSections: DeptPersonSection[] = Array.from(deptPersonMap.entries())
      .sort(sortDept)
      .map(([name, pMap]) => ({
        name,
        people: Array.from(pMap.values()).sort((x, y) => {
          if (x.key === 'open') return 1; // Open last
          if (y.key === 'open') return -1;
          return x.label.localeCompare(y.label);
        }),
      }));

    return { staffRows, openByDay, openCount, roleRows, deptSections, deptPersonSections };
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
  const qaShiftCount = qaDate ? quickAddCombos().length : 0; // shifts the quick-add will make
  // Pre-publish review: people over their weekly cap, and still-open (unassigned) drafts.
  const overCapPeople = (data?.employees ?? []).filter(e => e.overCap || (e.cap !== null && e.hours > e.cap));
  const openDraftCount = (data?.slots ?? []).filter(s => s.state === 'draft' && !s.employeeId).length;
  const publishConcerns = overCapPeople.length + (openDraftCount > 0 ? 1 : 0);
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
      role_id: editRoleId, department_id: editSlot?.departmentId ?? null,
      note: editNote.trim(), count: 1,
    };
    if (assignId !== null) body.assign_employee_id = assignId;
    else if (editSlot?.minSkill) body.min_skill = editSlot.minSkill;
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

  // ---- Inline quick-add (create a shift without leaving Manage) --------------

  /** Open the quick-add sheet for a date, optionally seeded with role/person. */
  function openQuickAdd(
    date: string,
    ctx?: { roleId?: number | null; employeeId?: number | null; departmentId?: number | null },
  ) {
    const depts = data?.departments ?? [];
    setQaDate(date);
    setQaError(null);
    setQaStart('16:00');
    setQaEnd('22:00');
    setQaDeptId(ctx?.departmentId ?? (depts.length === 1 ? depts[0].id : null));
    setQaRoleIds(ctx?.roleId != null ? new Set([ctx.roleId]) : new Set());
    setQaMode(ctx?.employeeId != null ? 'pick' : 'open');
    setQaPeopleIds(ctx?.employeeId != null ? new Set([ctx.employeeId]) : new Set());
    setQaMinSkill('1');
    setQaNote('');
  }

  function toggleQaRole(id: number) {
    setQaRoleIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function toggleQaPerson(id: number) {
    setQaPeopleIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  /** The (role, person) pairs the quick-add will create — one shift each. */
  function quickAddCombos(): { roleId: number | null; personId: number | null }[] {
    const roles: (number | null)[] = qaRoleIds.size > 0 ? Array.from(qaRoleIds) : [null];
    const people = qaMode === 'pick' ? Array.from(qaPeopleIds) : [];
    if (people.length > 0) {
      const out: { roleId: number | null; personId: number | null }[] = [];
      for (const p of people) for (const r of roles) out.push({ roleId: r, personId: p });
      return out;
    }
    return roles.map(r => ({ roleId: r, personId: null }));
  }

  async function submitQuickAdd() {
    if (qaDate === null) return;
    const depts = data?.departments ?? [];
    if (depts.length > 0 && qaDeptId === null) {
      setQaError('Pick a department for this shift.');
      return;
    }
    if (qaMode === 'pick' && qaPeopleIds.size === 0) {
      setQaError('Pick at least one person, or choose “Leave open”.');
      return;
    }
    const combos = quickAddCombos();
    setQaSaving(true);
    setQaError(null);
    try {
      for (const c of combos) {
        const body: Record<string, unknown> = {
          company_id: companyId,
          date: qaDate,
          start: qaStart,
          end: qaEnd,
          role_id: c.roleId,
          department_id: qaDeptId,
          note: qaNote.trim(),
          count: 1,
        };
        if (c.personId !== null) body.assign_employee_id = c.personId;
        else if (qaMinSkill !== '1') body.min_skill = qaMinSkill;
        await createFromBody(body);
      }
      setQaDate(null);
      showToast(combos.length > 1 ? `${combos.length} shifts added as drafts` : 'Shift added as a draft');
      void load();
      if (viewMode === 'month') void loadMonth();
    } catch (err: unknown) {
      setQaError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setQaSaving(false);
    }
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

  /** A create body from an EXISTING slot — used by grid quick actions and copy-day. */
  function slotToCreateBody(s: ShiftSlot): Record<string, unknown> {
    const b: Record<string, unknown> = {
      company_id: companyId,
      date: berlinParts(s.start).date,
      start: berlinParts(s.start).hhmm,
      end: berlinParts(s.end).hhmm,
      role_id: s.roleId,
      department_id: s.departmentId, // carry the portal department override
      note: s.note ?? '',
      count: 1,
    };
    if (s.employeeId !== null) b.assign_employee_id = s.employeeId;
    else if (s.minSkill) b.min_skill = s.minSkill; // carry the open-shift skill gate
    return b;
  }

  async function duplicateSlot(s: ShiftSlot) {
    try {
      await createFromBody(slotToCreateBody(s));
      showToast('Shift duplicated — a copy was added as a draft');
      void load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not duplicate the shift');
    }
  }

  async function deleteSlotDirect(s: ShiftSlot) {
    const restoreBody = slotToCreateBody(s);
    try {
      const res = await fetch(`/api/shifts/slots/${s.id}?company_id=${companyId}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(typeof d.error === 'string' ? d.error : `HTTP ${res.status}`);
      }
      setUndo({ body: restoreBody, label: 'Shift deleted' });
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 6000);
      void load();
      if (viewMode === 'month') void loadMonth();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not delete the shift');
    }
  }

  // Deleting a shift: if it repeats on other days (same name/time/role/assignee),
  // offer "just this day" vs "this and all future" (Apple-Calendar style).
  async function startDelete(slot: ShiftSlot) {
    let count = 1;
    try {
      const res = await fetch('/api/shifts/delete-series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, slot_id: slot.id, dry_run: true }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && typeof d.count === 'number') count = d.count;
    } catch { /* fall back to a single delete */ }
    if (count > 1) setDeleteSeries({ slot, count });
    else void deleteSlotDirect(slot);
  }

  async function doDeleteSeries(slot: ShiftSlot) {
    setDeleteSeries(null);
    try {
      const res = await fetch('/api/shifts/delete-series', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, slot_id: slot.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.error === 'string' ? d.error : `HTTP ${res.status}`);
      const n = typeof d.deleted === 'number' ? d.deleted : 0;
      showToast(`Deleted ${n} shift${n === 1 ? '' : 's'}`);
      void load();
      if (viewMode === 'month') void loadMonth();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not delete the shifts');
    }
  }

  /** Copy every shift on the current `day` onto the chosen target dates. */
  async function copyDayTo(targets: string[]) {
    const src = (data?.slots ?? []).filter(s => berlinParts(s.start).date === day);
    if (src.length === 0 || targets.length === 0) return;
    try {
      for (const s of src) {
        const b = slotToCreateBody(s);
        b.date = targets[0];
        b.copy_days = targets.slice(1);
        await createFromBody(b);
      }
      showToast(`Copied ${src.length} shift${src.length === 1 ? '' : 's'} to ${targets.length} day${targets.length === 1 ? '' : 's'}`);
      void load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not copy the day');
    }
  }

  // Open the publish sheet and peek at how many drafts exist across ALL upcoming
  // weeks (so we can offer "publish everything", not just this week).
  function openPublishConfirm() {
    setUpcoming(null);
    setConfirm('publish');
    (async () => {
      try {
        const res = await fetch('/api/shifts/publish-upcoming', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id: companyId, dry_run: true }),
        });
        const d = await res.json().catch(() => ({}));
        if (res.ok && typeof d.count === 'number') setUpcoming({ count: d.count, weeks: d.weeks ?? 1 });
      } catch { /* preview only — ignore */ }
    })();
  }

  async function doPublish() {
    setConfirm(null);
    try {
      const res = await fetch('/api/shifts/publish-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, week: weekKey, notify: notifyOnPublish }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.error === 'string' ? d.error : `HTTP ${res.status}`);
      const n = typeof d.published === 'number' ? d.published : draftCount;
      showToast(`Published ${n} shift${n === 1 ? '' : 's'}${notifyOnPublish ? ' — staff notified' : ' — no notifications sent'}`);
      void load();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not publish the week');
    }
  }

  async function doPublishUpcoming() {
    setConfirm(null);
    try {
      const res = await fetch('/api/shifts/publish-upcoming', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, notify: notifyOnPublish }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof d.error === 'string' ? d.error : `HTTP ${res.status}`);
      const n = typeof d.published === 'number' ? d.published : 0;
      showToast(`Published ${n} shift${n === 1 ? '' : 's'} across ${d.weeks ?? 1} week${(d.weeks ?? 1) === 1 ? '' : 's'}${notifyOnPublish ? ' — staff notified' : ''}`);
      void load();
      if (viewMode === 'month') void loadMonth();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Could not publish upcoming shifts');
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
    // Lead with the shift name (note) when one is set, so it's easy to spot.
    const who = isOpen ? 'Open' : firstName(s.employeeName);
    const t = chipTime(s) + (s.overCap ? ' !' : '');
    let line1: string;
    let line2 = '';
    if (s.note) {
      line1 = s.note;
      line2 = (mode === 'person' ? `${who} · ` : '') + t;
    } else if (mode === 'person') {
      line1 = who;
      line2 = t;
    } else {
      line1 = t;
    }
    return (
      <button
        key={s.id}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setQuickMenu(s); }}
        onPointerDown={() => {
          longFired.current = false;
          if (pressTimer.current) clearTimeout(pressTimer.current);
          pressTimer.current = setTimeout(() => { longFired.current = true; setQuickMenu(s); }, 450);
        }}
        onPointerUp={() => { if (pressTimer.current) clearTimeout(pressTimer.current); }}
        onPointerLeave={() => { if (pressTimer.current) clearTimeout(pressTimer.current); }}
        onClick={e => {
          e.stopPropagation();
          if (longFired.current) { longFired.current = false; return; }
          openSheet(s);
        }}
        className={`relative ${block ? 'w-full' : ''} rounded-md px-1.5 py-1 text-[var(--fs-xs)] font-bold leading-tight text-center ${cls}`}
      >
        {block ? (
          <>
            <span className="block truncate">{line1}</span>
            {line2 && <span className="block truncate tabular-nums whitespace-nowrap">{line2}</span>}
          </>
        ) : (
          <span className="tabular-nums whitespace-nowrap">
            {s.note ? `${s.note} · ` : mode === 'person' ? `${who} ` : ''}
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

  // Compact chip for the Month calendar: person name for assigned shifts, the
  // ROLE for open ones (no row context there), plus time. Same colours + tap
  // behaviour (edit / long-press quick menu) as the week-grid chip.
  const monthChip = (s: ShiftSlot) => {
    const isOpen = !s.employeeId;
    const base = isOpen
      ? 'bg-white border border-dashed border-gray-400 text-gray-600'
      : s.overCap
        ? 'bg-red-100 text-red-800'
        : 'bg-blue-100 text-blue-800';
    const cls = s.state === 'draft'
      ? `${base} opacity-70 outline-dashed outline-1 outline-offset-[-2px] outline-amber-500`
      : base;
    const whoOrRole = isOpen ? s.roleName || 'Open' : firstName(s.employeeName);
    const title = s.note || whoOrRole;
    let sub = chipTime(s) + (s.overCap ? ' !' : '');
    if (s.note) sub = `${whoOrRole} · ${sub}`;
    else if (isOpen && s.roleName) sub = `Open · ${sub}`;
    else if (!isOpen && s.roleName) sub = `${sub} · ${s.roleName}`;
    return (
      <button
        key={s.id}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setQuickMenu(s); }}
        onPointerDown={() => {
          longFired.current = false;
          if (pressTimer.current) clearTimeout(pressTimer.current);
          pressTimer.current = setTimeout(() => { longFired.current = true; setQuickMenu(s); }, 450);
        }}
        onPointerUp={() => { if (pressTimer.current) clearTimeout(pressTimer.current); }}
        onPointerLeave={() => { if (pressTimer.current) clearTimeout(pressTimer.current); }}
        onClick={e => {
          e.stopPropagation();
          if (longFired.current) { longFired.current = false; return; }
          openSheet(s);
        }}
        className={`relative w-full rounded px-1.5 py-1 text-left leading-tight ${cls}`}
      >
        <span className="block truncate text-[var(--fs-xs)] font-bold">{title}</span>
        <span className="block truncate text-[11px] font-semibold tabular-nums opacity-80">{sub}</span>
        {pendingSet.has(s.id) && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-500 border border-white" />
        )}
      </button>
    );
  };

  // Group a day's slots by Department → (Role or Person) — mobile month detail.
  const renderGroupedSlots = (slots: ShiftSlot[]): React.ReactNode => {
    const byDept = new Map<string, Map<string, ShiftSlot[]>>();
    for (const s of slots) {
      const dept = s.departmentName || 'No department';
      const sub = subGroup === 'person'
        ? s.employeeId ? s.employeeName || 'Unknown' : 'Open'
        : s.roleName || 'No role';
      const subMap = byDept.get(dept) ?? new Map<string, ShiftSlot[]>();
      const list = subMap.get(sub) ?? [];
      list.push(s);
      subMap.set(sub, list);
      byDept.set(dept, subMap);
    }
    return Array.from(byDept.entries()).map(([dept, subMap]) => (
      <div key={dept} className="flex flex-col gap-1">
        <div className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 mt-1.5">{dept}</div>
        {Array.from(subMap.entries()).map(([sub, rs]) => (
          <div key={sub} className="flex flex-col gap-1 pl-0.5">
            <div className="text-[var(--fs-xs)] font-semibold text-gray-500">{sub}</div>
            {rs.map(s => monthChip(s))}
          </div>
        ))}
      </div>
    ));
  };

  const gridCell = (key: string, date: string, cellSlots: ShiftSlot[], mode: ChipMode, roleId?: number | null) => (
    <div
      key={key}
      onClick={() => openQuickAdd(date, roleId !== null && roleId !== undefined ? { roleId } : undefined)}
      className="bg-white p-1 flex flex-col gap-1 min-h-[56px] cursor-pointer active:bg-gray-50"
    >
      {cellSlots.map(s => chip(s, mode, true))}
    </div>
  );

  const labelCell = (key: string, title: string, sub: string, subOver = false, onAdd?: () => void) => (
    <div key={key} className="bg-white px-3 py-2 flex items-center gap-2 min-w-0">
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="text-[var(--fs-sm)] font-bold text-gray-900 truncate">{title}</div>
        <div className={`text-[var(--fs-xs)] tabular-nums ${subOver ? 'text-red-600 font-bold' : 'text-gray-500'}`}>{sub}</div>
      </div>
      {onAdd && (
        <button
          onClick={onAdd}
          aria-label={`Add shift for ${title}`}
          className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 text-[var(--fs-md)] font-bold flex items-center justify-center active:bg-gray-200 flex-shrink-0"
        >
          +
        </button>
      )}
    </div>
  );

  const deptIdByName = (name: string): number | null =>
    (data?.departments ?? []).find(d => d.name === name)?.id ?? null;

  const pShiftCount = (p: DeptPersonRow) => Object.values(p.byDay).reduce((n, a) => n + a.length, 0);
  const deptHeader = (name: string) => (
    <div className="col-span-full bg-gray-100 px-3 py-1.5 text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-600">
      {name}
    </div>
  );

  function gridRows(): React.ReactNode {
    if (subGroup === 'person') {
      return (
        <>
          {view.deptPersonSections.map(sec => (
            <React.Fragment key={`dpp-${sec.name}`}>
              {deptHeader(sec.name)}
              {sec.people.map(p => {
                const n = pShiftCount(p);
                return (
                  <React.Fragment key={`dppr-${sec.name}-${p.key}`}>
                    {labelCell(
                      `dppl-${sec.name}-${p.key}`,
                      p.label,
                      `${n} shift${n === 1 ? '' : 's'}`,
                      false,
                      () =>
                        openQuickAdd(day, {
                          employeeId: p.key === 'open' ? null : Number(p.key.slice(1)),
                          departmentId: deptIdByName(sec.name),
                        }),
                    )}
                    {days.map(d => gridCell(`dppc-${sec.name}-${p.key}-${d}`, d, p.byDay[d] || [], 'time'))}
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          ))}
        </>
      );
    }
    return (
      <>
        {view.deptSections.map(sec => (
          <React.Fragment key={`dp-${sec.name}`}>
            {deptHeader(sec.name)}
            {sec.roles.map(r => (
              <React.Fragment key={`dpr-${sec.name}-${r.roleId ?? 0}`}>
                {labelCell(
                  `dpl-${sec.name}-${r.roleId ?? 0}`,
                  r.name,
                  `${r.shifts} shift${r.shifts === 1 ? '' : 's'} · ${r.open} open`,
                  false,
                  () => openQuickAdd(day, { roleId: r.roleId, departmentId: deptIdByName(sec.name) }),
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
    const deptSubHeader = (name: string) => (
      <div key={`mdh-${name}`} className="px-4 pt-2 pb-0.5 text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400">
        {name}
      </div>
    );
    if (subGroup === 'person') {
      for (const sec of view.deptPersonSections) {
        const secRows = sec.people
          .map(p => ({ p, s: p.byDay[date] || [] }))
          .filter(x => x.s.length > 0);
        if (!secRows.length) continue;
        rows.push(deptSubHeader(sec.name));
        for (const x of secRows) rows.push(mobileRow(`mdpp-${sec.name}-${x.p.key}`, x.p.label, x.s, 'time'));
      }
    } else {
      for (const sec of view.deptSections) {
        const secRows = sec.roles
          .map(r => ({ r, s: r.byDay[date] || [] }))
          .filter(x => x.s.length > 0);
        if (!secRows.length) continue;
        rows.push(deptSubHeader(sec.name));
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
            onClick={() => openQuickAdd(date)}
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
        <AppHeader supertitle="Planning" title="Manage Shifts" showBack onBack={onBack} />
        <EmptyState icon="🔒" title="Managers only" body="The schedule is managed by managers." />
      </div>
    );
  }

  const hasAnything = (data?.slots ?? []).length > 0 || employees.length > 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Planning" title="Manage Shifts" subtitle="Plan, publish & reassign" showBack onBack={onBack} />

      <div className="pt-3 pb-36 max-w-6xl mx-auto w-full">
        {viewMode === 'month' ? (
          <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-2.5 py-2 mx-4 mb-3">
            <button
              onClick={() => setMonthAnchor(a => shiftMonth(a, -1))}
              aria-label="Previous month"
              className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center active:bg-gray-200 flex-shrink-0"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <div className="flex-1 text-center text-[var(--fs-md)] font-bold text-gray-900 truncate">
              {monthLabel(monthAnchor)}
              {monthAnchor === todayBerlin.slice(0, 7) && <span className="text-gray-400 font-semibold"> · this month</span>}
            </div>
            <button
              onClick={() => setMonthAnchor(a => shiftMonth(a, 1))}
              aria-label="Next month"
              className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center active:bg-gray-200 flex-shrink-0"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
        ) : (
          <WeekNav
            weekKey={weekKey}
            label={weekLabel(weekKey)}
            onPrev={() => setWeekKey(k => offsetWeekKey(k, -1))}
            onNext={() => setWeekKey(k => offsetWeekKey(k, 1))}
          />
        )}

        <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
          <Seg<ViewMode>
            value={viewMode}
            options={[
              { key: 'day', label: 'Day' },
              { key: 'week', label: 'Week' },
              { key: 'month', label: 'Month' },
            ]}
            onChange={setViewMode}
          />
          <Seg<SubGroup>
            value={subGroup}
            options={[
              { key: 'role', label: 'By role' },
              { key: 'person', label: 'By person' },
            ]}
            onChange={setSubGroup}
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
        ) : viewMode === 'month' ? (
          <div className="px-4">
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5 mb-1.5">
              {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => (
                <div key={d} className="text-center text-[var(--fs-xs)] font-bold uppercase text-gray-400">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {monthGridCells(monthAnchor).map(date => {
                const inMonth = date.slice(0, 7) === monthAnchor;
                const slots = monthSlots.get(date) ?? [];
                const openCount = slots.filter(s => !s.employeeId).length;
                const isToday = date === todayBerlin;
                return (
                  <div
                    key={date}
                    role="button"
                    onClick={() => (isNarrow ? setMonthSelectedDay(date) : openQuickAdd(date))}
                    aria-label={isNarrow ? `Show shifts on ${dayLabel(date)}` : `Add shift on ${dayLabel(date)}`}
                    className={`rounded-lg border min-h-[60px] sm:min-h-[104px] flex flex-col p-1 gap-1 cursor-pointer transition-colors ${
                      isNarrow && date === monthSelectedDay
                        ? 'border-green-600 ring-2 ring-green-600'
                        : isToday
                          ? 'border-green-500 ring-1 ring-green-500'
                          : 'border-gray-200'
                    } ${inMonth ? 'bg-white active:bg-gray-50' : 'bg-gray-50'}`}
                  >
                    <div className="flex items-center justify-end px-0.5">
                      <span className={`text-[var(--fs-xs)] font-bold tabular-nums ${
                        !inMonth ? 'text-gray-300' : isToday ? 'text-green-700' : 'text-gray-700'
                      }`}>
                        {Number(date.slice(8, 10))}
                      </span>
                    </div>

                    {/* Phones: compact count + open dot (chips don't fit) */}
                    {slots.length > 0 && (
                      <div className="sm:hidden mt-auto self-start flex items-center gap-0.5 text-[var(--fs-xs)] font-bold tabular-nums text-gray-800">
                        {slots.length}
                        {openCount > 0 && <span className="text-amber-500" aria-hidden="true">●</span>}
                      </div>
                    )}

                    {/* Tablet / desktop: real shift chips */}
                    {slots.length > 0 && (
                      <div className="hidden sm:flex flex-col gap-1 min-w-0">
                        {slots.slice(0, 3).map(s => monthChip(s))}
                        {slots.length > 3 && (
                          <button
                            onClick={e => { e.stopPropagation(); setViewMode('day'); setDay(date); }}
                            className="text-[var(--fs-xs)] font-semibold text-green-700 text-left px-1 active:opacity-70"
                          >
                            +{slots.length - 3} more
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Phones: tapped-day detail with real shifts (chips don't fit in cells) */}
            <div className="sm:hidden mt-4">
              <div className="text-[var(--fs-sm)] font-bold text-gray-900 mb-2">
                {dayLabel(monthSelectedDay)}
                {monthSelectedDay === todayBerlin && <span className="text-gray-400 font-semibold"> · today</span>}
              </div>
              {(monthSlots.get(monthSelectedDay) ?? []).length === 0 ? (
                <div className="text-[var(--fs-sm)] text-gray-400">No shifts on this day yet.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {renderGroupedSlots(monthSlots.get(monthSelectedDay) ?? [])}
                </div>
              )}
              <button onClick={() => openQuickAdd(monthSelectedDay)} className={`${ds.btnSecondary} mt-2.5`}>
                + Add a shift on {dayLabel(monthSelectedDay)}
              </button>
            </div>

            <div className="mt-3 text-[var(--fs-xs)] text-gray-500">
              <span className="sm:hidden">Tap a day to see its shifts below.</span>
              <span className="hidden sm:inline">Tap a shift to edit it, or an empty space in a day to add one.</span>
            </div>
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
            {(data?.slots ?? []).some(s => berlinParts(s.start).date === day) && (
              <button
                onClick={() => { setCopyTargets(new Set()); setCopyDaySheet(true); }}
                className="self-start text-[var(--fs-sm)] font-semibold text-green-700 active:opacity-70"
              >
                Copy this day to other days →
              </button>
            )}
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
                    {subGroup === 'person' ? 'Department / Person' : 'Department / Role'}
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
            onClick={() =>
              openQuickAdd(
                viewMode === 'month'
                  ? todayBerlin.slice(0, 7) === monthAnchor
                    ? todayBerlin
                    : `${monthAnchor}-01`
                  : day,
              )
            }
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
            onClick={openPublishConfirm}
            disabled={draftCount === 0}
            className="flex-1 bg-green-600 text-white font-semibold rounded-xl py-3 text-[var(--fs-sm)] active:bg-green-700 shadow-lg shadow-green-600/30 disabled:opacity-50"
          >
            Publish week
          </button>
        </div>
        <div className="h-[env(safe-area-inset-bottom)]" />
      </div>

      {/* Slot edit / assign sheet */}
      {/* Inline quick-add — create a shift without leaving Manage */}
      <Sheet open={qaDate !== null} onClose={() => setQaDate(null)}>
        {qaDate && (
          <div className="flex flex-col gap-3">
            <div>
              <div className="text-[var(--fs-lg)] font-bold text-gray-900 mb-2">Add shift</div>
              <div className={LBL}>Date</div>
              <input
                type="date"
                min={todayBerlin}
                value={qaDate}
                onChange={e => e.target.value && setQaDate(e.target.value)}
                className={ds.input}
              />
              <div className={`${HINT} mt-1`}>{dayLabel(qaDate)}</div>
            </div>

            <div>
              <div className={LBL}>Shift name (optional)</div>
              <input
                type="text"
                value={qaNote}
                onChange={e => setQaNote(e.target.value)}
                placeholder="e.g. Opening, Dinner"
                maxLength={40}
                className={ds.input}
              />
            </div>

            {(data?.departments ?? []).length > 0 && (
              <div>
                <div className={LBL}>Department</div>
                <select
                  value={qaDeptId ?? ''}
                  onChange={e => setQaDeptId(e.target.value === '' ? null : Number(e.target.value))}
                  className={ds.input}
                >
                  <option value="">Choose a department…</option>
                  {(data?.departments ?? []).map(dp => (
                    <option key={dp.id} value={dp.id}>{dp.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <div className={LBL}>Roles {qaRoleIds.size > 0 && <span className="text-gray-400 normal-case">· each makes a shift</span>}</div>
              {(data?.roles ?? []).length === 0 ? (
                <div className="text-[var(--fs-sm)] text-gray-400">No roles set up — the shift will have no role.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(data?.roles ?? []).map(r => {
                    const on = qaRoleIds.has(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => toggleQaRole(r.id)}
                        aria-pressed={on}
                        className={`px-3.5 py-2 rounded-full text-[var(--fs-sm)] font-semibold border transition-colors ${
                          on ? 'bg-green-600 border-green-600 text-white' : 'bg-white border-gray-200 text-gray-600 active:bg-gray-50'
                        }`}
                      >
                        {r.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className={LBL}>Start</div>
                <input type="time" value={qaStart} onChange={e => setQaStart(e.target.value)} className={ds.input} />
              </div>
              <div>
                <div className={LBL}>End</div>
                <input type="time" value={qaEnd} onChange={e => setQaEnd(e.target.value)} className={ds.input} />
              </div>
            </div>

            <div>
              <div className={LBL}>Assign</div>
              <div className="flex bg-gray-100 rounded-full p-1 mb-2">
                <button
                  type="button"
                  onClick={() => setQaMode('open')}
                  className={`flex-1 py-2 rounded-full text-[var(--fs-sm)] font-semibold transition-colors ${qaMode === 'open' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                >
                  Leave open
                </button>
                <button
                  type="button"
                  onClick={() => setQaMode('pick')}
                  className={`flex-1 py-2 rounded-full text-[var(--fs-sm)] font-semibold transition-colors ${qaMode === 'pick' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                >
                  Pick people
                </button>
              </div>
              {qaMode === 'open' ? (
                <div className="flex flex-col gap-2">
                  <div className={HINT}>One open shift per selected role — staff can claim it once published.</div>
                  <div>
                    <div className={LBL}>Who can take it</div>
                    <div className="flex gap-2">
                      {([['1', 'Anyone'], ['2', 'Associate & up'], ['3', 'Team Lead only']] as const).map(([v, label]) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setQaMinSkill(v)}
                          className={`flex-1 py-2 rounded-xl text-[var(--fs-sm)] font-semibold border transition-colors ${
                            qaMinSkill === v ? 'border-green-600 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-500'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : employees.length === 0 ? (
                <div className={HINT}>Nobody on the roster yet.</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {employees.map(e => {
                    const on = qaPeopleIds.has(e.id);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => toggleQaPerson(e.id)}
                        aria-pressed={on}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                          on ? 'border-green-600 bg-green-50' : 'border-gray-200 bg-white active:bg-gray-50'
                        }`}
                      >
                        <span className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${on ? 'bg-green-600 border-green-600' : 'border-gray-300'}`}>
                          {on && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                          )}
                        </span>
                        <span className="flex-1 min-w-0 text-[var(--fs-sm)] font-bold text-gray-900 truncate">{e.name}</span>
                      </button>
                    );
                  })}
                  <div className={`${HINT} mt-0.5`}>One shift per person you pick.</div>
                </div>
              )}
            </div>

            {qaError && (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[var(--fs-sm)] text-red-700">
                {qaError}
              </div>
            )}

            <button onClick={() => void submitQuickAdd()} disabled={qaSaving} className={`${ds.btnPrimary} disabled:opacity-50`}>
              {qaSaving ? 'Adding…' : qaShiftCount > 1 ? `Add ${qaShiftCount} shifts` : 'Add shift'}
            </button>
            <button
              onClick={() => {
                const d = qaDate;
                const firstRole = qaRoleIds.size > 0 ? Array.from(qaRoleIds)[0] : null;
                setQaDate(null);
                if (d) onCreateShift({ date: d, ...(firstRole !== null ? { roleId: firstRole } : {}) });
              }}
              className={ds.btnSecondary}
            >
              More options (recurring, template…)
            </button>
            <button onClick={() => setQaDate(null)} className={ds.btnSecondary}>Cancel</button>
            <div className="text-[var(--fs-xs)] text-gray-400 text-center">
              Saved as a draft — publish to show staff.
            </div>
          </div>
        )}
      </Sheet>

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
            <button
              onClick={() => { const s = editSlot; closeSheet(); if (s) void startDelete(s); }}
              disabled={saving}
              className={`${ds.btnDanger} disabled:opacity-50`}
            >
              Delete shift
            </button>
            <button onClick={closeSheet} className={ds.btnSecondary}>
              Cancel
            </button>
          </div>
        )}
      </Sheet>

      <Sheet open={confirm === 'publish'} onClose={() => setConfirm(null)}>
        <div className="flex flex-col gap-3">
          <div className="text-[var(--fs-lg)] font-bold text-gray-900">Publish this week</div>
          <div className="text-[var(--fs-sm)] text-gray-500">
            {draftCount} draft shift{draftCount === 1 ? '' : 's'} will become visible to staff and everyone newly assigned gets notified. Already-published shifts stay exactly as they are.
          </div>

          {publishConcerns > 0 ? (
            <div className="flex flex-col gap-2">
              <div className={LBL}>Before you publish</div>
              {overCapPeople.map(e => (
                <div key={e.id} className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-[var(--fs-sm)] text-red-800">
                  <span aria-hidden="true">⚠</span>
                  <span><b>{e.name}</b> is over their weekly hours{e.cap !== null ? ` (${fmtH(e.hours)} / ${fmtCap(e.cap)} h)` : ''}.</span>
                </div>
              ))}
              {openDraftCount > 0 && (
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-[var(--fs-sm)] text-amber-800">
                  <span aria-hidden="true">🕒</span>
                  <span>{openDraftCount} shift{openDraftCount === 1 ? '' : 's'} still open — no one is assigned yet.</span>
                </div>
              )}
              <div className="text-[var(--fs-xs)] text-gray-400">You can still publish — these are reminders, not blockers.</div>
            </div>
          ) : (
            <div className="rounded-lg bg-green-50 border border-green-100 px-3 py-2 text-[var(--fs-sm)] text-green-800">
              ✓ No over-cap people and no unfilled shifts. Good to go.
            </div>
          )}

          <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[var(--fs-sm)] font-semibold text-gray-900">Notify assigned staff</div>
              <div className="text-[var(--fs-xs)] text-gray-400">Turn off to publish quietly — no messages sent.</div>
            </div>
            <ToggleSwitch on={notifyOnPublish} onToggle={() => setNotifyOnPublish(v => !v)} />
          </div>
          <button onClick={() => void doPublish()} className={ds.btnPrimary}>
            Publish this week ({draftCount})
          </button>
          {upcoming && upcoming.weeks > 1 && (
            <button onClick={() => void doPublishUpcoming()} className={ds.btnSecondary}>
              Publish all {upcoming.count} upcoming · {upcoming.weeks} weeks
            </button>
          )}
          {upcoming && upcoming.weeks > 1 && (
            <div className="text-[var(--fs-xs)] text-gray-400 text-center -mt-1">
              You’ve got drafts in {upcoming.weeks} weeks — publish just this one or all of them.
            </div>
          )}
          <button onClick={() => setConfirm(null)} className={ds.btnSecondary}>Not yet</button>
        </div>
      </Sheet>

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
      {/* Repeating-shift delete: this day only vs this and all future occurrences */}
      <Sheet open={deleteSeries !== null} onClose={() => setDeleteSeries(null)}>
        {deleteSeries && (
          <div className="flex flex-col gap-3">
            <div className="text-[var(--fs-lg)] font-bold text-gray-900">Delete a repeating shift</div>
            <div className="text-[var(--fs-sm)] text-gray-500">
              “{deleteSeries.slot.note || 'This shift'}” also appears on other days (same time
              {deleteSeries.slot.roleName ? ` · ${deleteSeries.slot.roleName}` : ''}). What should be deleted?
            </div>
            <button
              onClick={() => { const s = deleteSeries.slot; setDeleteSeries(null); void deleteSlotDirect(s); }}
              className={ds.btnSecondary}
            >
              Just {fmtDay(deleteSeries.slot.start)}
            </button>
            <button
              onClick={() => void doDeleteSeries(deleteSeries.slot)}
              className={ds.btnDanger}
            >
              This and all {deleteSeries.count} upcoming
            </button>
            <button onClick={() => setDeleteSeries(null)} className={ds.btnSecondary}>Cancel</button>
          </div>
        )}
      </Sheet>

      {/* Quick actions on a shift (long-press / right-click) */}
      <Sheet open={quickMenu !== null} onClose={() => setQuickMenu(null)}>
        {quickMenu && (
          <div className="flex flex-col gap-2">
            <div>
              <div className="text-[var(--fs-md)] font-bold text-gray-900">
                {fmtDay(quickMenu.start)} · {fmtTimeRange(quickMenu.start, quickMenu.end)}
              </div>
              <div className="text-[var(--fs-sm)] text-gray-500">{quickMenu.employeeName || 'Open shift'}</div>
            </div>
            <button onClick={() => { const s = quickMenu; setQuickMenu(null); openSheet(s); }} className={ds.btnSecondary}>Edit</button>
            <button onClick={() => { const s = quickMenu; setQuickMenu(null); void duplicateSlot(s); }} className={ds.btnSecondary}>Duplicate</button>
            <button onClick={() => { const s = quickMenu; setQuickMenu(null); void startDelete(s); }} className={ds.btnDanger}>Delete</button>
          </div>
        )}
      </Sheet>

      {/* Copy this day to other days */}
      <Sheet open={copyDaySheet} onClose={() => setCopyDaySheet(false)}>
        <div className="flex flex-col gap-3">
          <div className="text-[var(--fs-lg)] font-bold text-gray-900">Copy {dayLabel(day)} to…</div>
          <div className="text-[var(--fs-sm)] text-gray-500">Every shift on this day is copied (as drafts) to the days you pick.</div>
          <div className="flex flex-wrap gap-2">
            {days.filter(d => d !== day).map(d => {
              const on = copyTargets.has(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCopyTargets(prev => {
                    const n = new Set(prev);
                    if (n.has(d)) n.delete(d); else n.add(d);
                    return n;
                  })}
                  className={`px-3 py-2 rounded-full text-[var(--fs-sm)] font-semibold transition-colors ${
                    on ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 active:bg-gray-200'
                  }`}
                >
                  {dayLabel(d)}
                </button>
              );
            })}
          </div>
          <button
            disabled={copyTargets.size === 0}
            onClick={() => { void copyDayTo(Array.from(copyTargets)); setCopyDaySheet(false); setCopyTargets(new Set()); }}
            className={`${ds.btnPrimary} disabled:opacity-50`}
          >
            Copy to {copyTargets.size} day{copyTargets.size === 1 ? '' : 's'}
          </button>
        </div>
      </Sheet>

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
