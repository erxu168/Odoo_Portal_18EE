'use client';

/**
 * Shifts — Create Shift (manager).
 * Date + start/end (live duration hint), role select + people stepper,
 * "Leave open / Pick a person" segmented assign (over-cap picks show the exact
 * overage in an amber warnbox but are never blocked), copy-to-more-days day
 * dots (the shift's own day is locked on), optional note. Creates DRAFT slots
 * via POST /api/shifts/slots — staff only see them after Publish.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { Badge, EmptyState, Spinner, ToggleSwitch } from '@/components/shifts/ui';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { ds } from '@/lib/design-system';
import { arbzgConflicts, berlinISOWeekKey, berlinParts, nowOdooUtc, weekKeyDays } from '@/lib/shifts-time';
import type { ShiftEmployee, ShiftTemplate } from '@/types/shifts';

interface CreatePrefill {
  date?: string;
  startHHMM?: string;
  endHHMM?: string;
  roleId?: number;
}

interface CreateShiftProps {
  companyId: number;
  isManager: boolean;
  employeeId: number | null;
  onBack: () => void;
  onHome: () => void;
  prefill?: CreatePrefill;
  onCreated: () => void;
}

interface RoleInfo {
  id: number;
  name: string;
}

interface DeptInfo {
  id: number;
  name: string;
}

const LBL = 'text-[var(--fs-xs)] font-semibold tracking-wide uppercase text-gray-400 mb-1.5';
const HINT = 'text-[var(--fs-xs)] text-gray-500';
const DAY_ABBR = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
/** Blank "Until" on a repeat = keep repeating for this rolling window (~8 weeks). */
const DEFAULT_REPEAT_DAYS = 56;

function fmtH(n: number): string {
  return n.toFixed(1);
}

function fmtCap(cap: number): string {
  return Number.isInteger(cap) ? String(cap) : cap.toFixed(1);
}

function firstName(name: string): string {
  return (name || '').split(' ')[0] || name;
}

function initials(name: string): string {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function hhmmToMin(s: string): number | null {
  const m = (s || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Duration in hours; end at or before start rolls to the next day (overnight). */
function durationFromTimes(start: string, end: string): number | null {
  const s = hhmmToMin(start);
  const e = hhmmToMin(end);
  if (s === null || e === null) return null;
  const mins = (e - s + 1440) % 1440;
  return (mins === 0 ? 1440 : mins) / 60;
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

const lastTimesKey = (companyId: number) => `kw_last_shift_time_${companyId}`;
function readLastTimes(companyId: number): { start: string; end: string } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(lastTimesKey(companyId));
    if (raw) {
      const o = JSON.parse(raw);
      if (typeof o?.start === 'string' && typeof o?.end === 'string') return { start: o.start, end: o.end };
    }
  } catch { /* ignore */ }
  return null;
}
function saveLastTimes(companyId: number, start: string, end: string): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(lastTimesKey(companyId), JSON.stringify({ start, end })); } catch { /* ignore */ }
}

/** "Mon 7 Jul" weekday label for a YYYY-MM-DD string (UTC-safe). */
function weekdayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
}

/** Full weekday name ("Tuesday") for a YYYY-MM-DD string (UTC-safe). */
function weekdayName(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
}

/** "YYYY-MM-DD" + n days (pure calendar arithmetic, UTC-safe). */
function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** JS weekday index (0=Sun..6=Sat) for a YYYY-MM-DD string (UTC-safe). */
function weekdayIndex(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Mon-first weekday chips: [jsIndex, label]. */
const WEEKDAY_CHIPS: [number, string][] = [[1, 'Mo'], [2, 'Tu'], [3, 'We'], [4, 'Th'], [5, 'Fr'], [6, 'Sa'], [0, 'Su']];

export default function CreateShift({ companyId, isManager, onBack, prefill, onCreated }: CreateShiftProps) {
  const todayBerlin = useMemo(() => berlinParts(nowOdooUtc()).date, []);
  const lastTimes = useMemo(() => readLastTimes(companyId), [companyId]);

  // Form state — times default to the last shift you made (restaurant shifts
  // cluster around a few times), falling back to a sensible dinner shift.
  const [date, setDate] = useState(prefill?.date || todayBerlin);
  const [start, setStart] = useState(prefill?.startHHMM || lastTimes?.start || '16:00');
  const [end, setEnd] = useState(prefill?.endHHMM || lastTimes?.end || '22:00');
  // Multi-add: each ticked role → one open shift; each ticked person → one shift.
  const [roleIds, setRoleIds] = useState<Set<number>>(new Set(prefill?.roleId != null ? [prefill.roleId] : []));
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [mode, setMode] = useState<'open' | 'pick'>('open');
  const [pickedIds, setPickedIds] = useState<Set<number>>(new Set());
  // Minimum skill to claim an open shift ('1' = anyone). Only used in "open" mode.
  const [minSkill, setMinSkill] = useState<'1' | '2' | '3'>('1');
  const [copySelected, setCopySelected] = useState<Set<string>>(new Set(prefill?.date ? [prefill.date] : [todayBerlin]));
  const [note, setNote] = useState('');
  const [repeat, setRepeat] = useState<'none' | 'daily' | 'weekly' | 'custom'>('none');
  const [until, setUntil] = useState('');
  const [repeatDays, setRepeatDays] = useState<Set<number>>(new Set());

  // Data
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [departments, setDepartments] = useState<DeptInfo[]>([]);
  const [employees, setEmployees] = useState<ShiftEmployee[]>([]);
  const [hoursMap, setHoursMap] = useState<Map<number, number>>(new Map());
  const [weekSlotsByEmp, setWeekSlotsByEmp] = useState<Map<number, { start: string; end: string }[]>>(new Map());
  const [monthHours, setMonthHours] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reusable shift templates.
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [deleteTpl, setDeleteTpl] = useState<ShiftTemplate | null>(null);

  const loadRoster = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shifts/roster?company_id=${companyId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      const roleList: RoleInfo[] = Array.isArray(data.roles) ? data.roles : [];
      setRoles(roleList);
      const deptList: DeptInfo[] = Array.isArray(data.departments) ? data.departments : [];
      setDepartments(deptList);
      // Department is required — pre-pick it when there's only one so the manager
      // doesn't have to. With several, they must choose (guarded in canSubmit).
      setDepartmentId(prev => prev ?? (deptList.length === 1 ? deptList[0].id : null));
      setEmployees(Array.isArray(data.employees) ? data.employees : []);
      const mh = new Map<number, number>();
      const mhObj =
        data.monthHoursByEmployee && typeof data.monthHoursByEmployee === 'object' ? data.monthHoursByEmployee : {};
      for (const [k, v] of Object.entries(mhObj)) {
        const id = Number(k);
        if (Number.isFinite(id) && typeof v === 'number') mh.set(id, v);
      }
      setMonthHours(mh);
    } catch (err: unknown) {
      console.error('[shifts] roster fetch failed:', err);
      setError(err instanceof Error ? err.message : 'Could not load roles and people');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (companyId) void loadRoster();
  }, [companyId, loadRoster]);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await fetch(`/api/shifts/templates?company_id=${companyId}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.templates)) setTemplates(data.templates);
    } catch { /* templates are a convenience — ignore load errors */ }
  }, [companyId]);

  useEffect(() => {
    if (companyId) void loadTemplates();
  }, [companyId, loadTemplates]);

  function applyTemplate(t: ShiftTemplate) {
    setNote(t.name);
    setStart(t.startHHMM);
    setEnd(t.endHHMM);
    if (t.roleId !== null) setRoleIds(new Set([t.roleId]));
    setSaveAsTemplate(false); // already saved
  }

  async function removeTemplate(t: ShiftTemplate) {
    setDeleteTpl(null);
    try {
      await fetch(`/api/shifts/templates/${t.id}?company_id=${companyId}`, { method: 'DELETE' });
      await loadTemplates();
    } catch { /* ignore */ }
  }

  // The shift's ISO week (Berlin) drives both the day-dot row and live hours.
  const weekOfDate = date ? berlinISOWeekKey(`${date} 12:00:00`) : null;
  const weekDates = useMemo(() => (weekOfDate ? weekKeyDays(weekOfDate) : []), [weekOfDate]);

  // Recurrence: dates from the shift date through "until".
  const recurrence = useMemo(() => {
    if (repeat === 'none') return [] as string[];
    // "Until" is optional — blank (or invalid) means keep repeating for a rolling
    // horizon (shifts are real records, so we materialise a sensible window).
    const effUntil = until && until >= date ? until : addDays(date, DEFAULT_REPEAT_DAYS);
    const out: string[] = [];
    if (repeat === 'custom') {
      if (repeatDays.size === 0) return out;
      let cur = date;
      for (let i = 0; i < 200 && cur <= effUntil; i++) {
        if (repeatDays.has(weekdayIndex(cur))) out.push(cur);
        cur = addDays(cur, 1);
      }
      return out;
    }
    const step = repeat === 'daily' ? 1 : 7;
    let cur = date;
    for (let i = 0; i < 200 && cur <= effUntil; i++) {
      out.push(cur);
      cur = addDays(cur, step);
    }
    return out;
  }, [repeat, until, date, repeatDays]);

  function setRepeatMode(mode: 'none' | 'daily' | 'weekly' | 'custom') {
    setRepeat(mode);
    // Seed custom weekdays with the shift's own weekday the first time.
    if (mode === 'custom' && repeatDays.size === 0 && date) setRepeatDays(new Set([weekdayIndex(date)]));
  }
  function toggleRepeatDay(wd: number) {
    setRepeatDays(prev => {
      const next = new Set(prev);
      if (next.has(wd)) next.delete(wd);
      else next.add(wd);
      return next;
    });
  }

  // Live week hours for everyone, for the week the shift lands in.
  useEffect(() => {
    if (!companyId || !weekOfDate) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/shifts/manage?company_id=${companyId}&week=${weekOfDate}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
        if (cancelled) return;
        const m = new Map<number, number>();
        for (const e of Array.isArray(data.employees) ? data.employees : []) {
          if (e && typeof e.id === 'number') m.set(e.id, typeof e.hours === 'number' ? e.hours : 0);
        }
        setHoursMap(m);
        // Keep each person's existing week shifts for ArbZG rest/long-day checks.
        const sm = new Map<number, { start: string; end: string }[]>();
        for (const s of Array.isArray(data.slots) ? data.slots : []) {
          if (s && typeof s.employeeId === 'number' && s.employeeId) {
            const arr = sm.get(s.employeeId) ?? [];
            arr.push({ start: s.start, end: s.end });
            sm.set(s.employeeId, arr);
          }
        }
        setWeekSlotsByEmp(sm);
      } catch (err: unknown) {
        console.warn('[shifts] week hours fetch failed:', err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId, weekOfDate]);

  // Changing the date moves the shift to (possibly) another week: reset the dots.
  useEffect(() => {
    if (date) setCopySelected(new Set([date]));
  }, [date]);

  const durH = durationFromTimes(start, end);
  const overnight = durH !== null && (hhmmToMin(end) ?? 0) <= (hhmmToMin(start) ?? 0);

  const selectedRoles = useMemo(() => Array.from(roleIds), [roleIds]);
  const pickedList = useMemo(
    () => (mode === 'pick' ? employees.filter(e => pickedIds.has(e.id)) : []),
    [mode, employees, pickedIds],
  );

  function toggleRole(id: number) {
    setRoleIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function togglePicked(id: number) {
    setPickedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  // Shifts this form will create: (roles or 1) × (people, in pick mode) × occurrences.
  const occurrences = repeat !== 'none' ? Math.max(recurrence.length, 1) : Math.max(copySelected.size, 1);
  const roleFactor = Math.max(selectedRoles.length, 1);
  const perOccurrence = mode === 'pick' ? pickedList.length * roleFactor : roleFactor;
  const totalShifts = perOccurrence * occurrences;

  // Per-person projection for the cap / Minijob warnings — each person gets one
  // shift per selected role per occurrence.
  const MINIJOB_CAP = 603;
  const addedHoursPerPerson = durH !== null ? durH * roleFactor * occurrences : 0;
  const overCapPicked = pickedList.filter(p => {
    if (p.cap === null) return false;
    return (hoursMap.get(p.id) ?? 0) + addedHoursPerPerson > p.cap + 1e-9;
  });
  const minijobPicked = pickedList.filter(
    p =>
      p.employmentType === 'minijob' &&
      ((monthHours.get(p.id) ?? 0) + addedHoursPerPerson) * p.hourlyRate > MINIJOB_CAP,
  );

  // ArbZG (rest < 11h to a neighbouring shift; > 10h day) per picked person, for
  // the base date — surfaced where the manager actually assigns.
  const arbzgPicked = useMemo(() => {
    if (!date || durH === null || pickedList.length === 0) return [] as { name: string; issues: string[] }[];
    const out: { name: string; issues: string[] }[] = [];
    for (const p of pickedList) {
      const issues = arbzgConflicts(weekSlotsByEmp.get(p.id) ?? [], date, start, end);
      if (issues.length > 0) out.push({ name: firstName(p.name), issues });
    }
    return out;
  }, [date, start, end, durH, pickedList, weekSlotsByEmp]);

  const inDept = useCallback(
    (e: ShiftEmployee) => departmentId === null || e.departmentId === departmentId,
    [departmentId],
  );

  const roleOk = useCallback(
    (e: ShiftEmployee) => selectedRoles.length === 0 || selectedRoles.some(r => e.roleIds.includes(r)),
    [selectedRoles],
  );

  const sortedPeople = useMemo(() => {
    return [...employees].sort((a, b) => {
      // Department match first (the picked dept narrows the list), then role, then name.
      const da = inDept(a) ? 0 : 1;
      const db = inDept(b) ? 0 : 1;
      if (da !== db) return da - db;
      const ra = roleOk(a) ? 0 : 1;
      const rb = roleOk(b) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
  }, [employees, roleOk, inDept]);

  function toggleCopyDay(d: string) {
    if (d === date) return; // the shift's own day is locked on
    setCopySelected(prev => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  // Department is required whenever the company has departments set up (never
  // hard-blocks a company that has none).
  const needDept = departments.length > 0;
  const canSubmit = !submitting && !!date && durH !== null
    && (mode === 'open' || pickedIds.size > 0)
    && (repeat === 'none' || recurrence.length > 0)
    && (!needDept || departmentId !== null);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Exact list of dates to create on (recurrence, or the base day + same-week copies).
      const occurrenceDates = repeat !== 'none'
        ? recurrence
        : Array.from(new Set([date, ...Array.from(copySelected)])).sort();
      // One create call per (role, person) combo — each spans all occurrence dates.
      const roles: (number | null)[] = selectedRoles.length > 0 ? selectedRoles : [null];
      const combos: { roleId: number | null; personId: number | null }[] = [];
      if (mode === 'pick') {
        for (const p of Array.from(pickedIds)) for (const r of roles) combos.push({ roleId: r, personId: p });
      } else {
        for (const r of roles) combos.push({ roleId: r, personId: null });
      }
      for (const c of combos) {
        const body: Record<string, unknown> = {
          company_id: companyId,
          date: occurrenceDates[0] ?? date,
          start,
          end,
          role_id: c.roleId,
          department_id: departmentId,
          count: 1,
          note: note.trim(),
          copy_days: occurrenceDates.slice(1),
        };
        if (c.personId !== null) body.assign_employee_id = c.personId;
        else if (minSkill !== '1') body.min_skill = minSkill; // open shift skill gate

        const res = await fetch('/api/shifts/slots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      }
      saveLastTimes(companyId, start, end); // remember for next time
      if (saveAsTemplate && note.trim()) {
        // Also save this shift as a reusable template (best-effort; first role).
        try {
          await fetch('/api/shifts/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ company_id: companyId, name: note.trim(), start, end, role_id: selectedRoles[0] ?? null, headcount: 1 }),
          });
        } catch { /* template save is a convenience — ignore */ }
      }
      onCreated();
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isManager) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader supertitle="Planning" title="New Shift" showBack onBack={onBack} />
        <EmptyState icon="🔒" title="Managers only" body="Creating shifts is a manager task." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Planning" title="New Shift" showBack onBack={onBack} />

      {loading ? (
        <Spinner />
      ) : error ? (
        <div className="flex flex-col items-center justify-center px-6 py-16">
          <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load roles and people</p>
          <p className="text-[var(--fs-xs)] text-gray-500 mb-5 text-center">{error}</p>
          <button onClick={() => void loadRoster()} className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl active:bg-green-700">
            Retry
          </button>
        </div>
      ) : (
        <div className="px-4 pt-4 pb-48 flex flex-col gap-3 max-w-xl mx-auto w-full">
          {/* NAME (+ reuse a saved shift template) */}
          <div className={`${ds.card} p-4`}>
            <div className={LBL}>Shift name</div>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Dinner"
              maxLength={40}
              className={ds.input}
            />
            {templates.length > 0 && (
              <>
                <div className={`${LBL} mt-3`}>Or reuse a shift template</div>
                <div className="flex flex-wrap gap-2">
                  {templates.map(t => (
                    <div key={t.id} className="relative">
                      <button
                        type="button"
                        onClick={() => applyTemplate(t)}
                        className="pl-3.5 pr-8 py-2 rounded-full bg-green-50 border border-green-200 text-green-800 text-[var(--fs-sm)] font-semibold active:bg-green-100"
                      >
                        {t.name} · {t.startHHMM}–{t.endHHMM}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTpl(t)}
                        aria-label={`Delete template ${t.name}`}
                        className="absolute top-1/2 -translate-y-1/2 right-0 w-8 h-8 rounded-full flex items-center justify-center text-green-700/50 active:text-red-600 after:absolute after:-inset-1.5 after:content-['']"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* WHEN */}
          <div className={`${ds.card} p-4 flex flex-col gap-3`}>
            <div>
              <div className={LBL}>Date</div>
              <input type="date" min={todayBerlin} value={date} onChange={e => setDate(e.target.value)} className={ds.input} />
              {date && (
                <div className={`${HINT} mt-1.5 ${date < todayBerlin ? 'text-red-600 font-semibold' : ''}`}>
                  {date < todayBerlin ? `⚠ ${weekdayLabel(date)} is in the past` : weekdayLabel(date)}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className={LBL}>Start</div>
                <input type="time" value={start} onChange={e => setStart(e.target.value)} className={ds.input} />
              </div>
              <div>
                <div className={LBL}>End</div>
                <input type="time" value={end} onChange={e => setEnd(e.target.value)} className={ds.input} />
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-[var(--fs-xs)] text-gray-500">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <circle cx="12" cy="12" r="9" />
                <polyline points="12 7 12 12 15 14" />
              </svg>
              {durH !== null ? `${fmtH(durH)} hours${overnight ? ' · ends next day' : ''}` : 'Pick a start and end time'}
            </div>
          </div>

          {/* WHO */}
          <div className={`${ds.card} p-4 flex flex-col gap-3`}>
            {departments.length > 0 && (
              <div>
                <div className={LBL}>Department</div>
                <select
                  value={departmentId ?? ''}
                  onChange={e => setDepartmentId(e.target.value === '' ? null : Number(e.target.value))}
                  className={ds.input}
                >
                  <option value="">Choose a department…</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                {departmentId === null && (
                  <div className={`${HINT} mt-1.5 text-amber-700 font-semibold`}>
                    Pick a department for this shift.
                  </div>
                )}
              </div>
            )}
            <div>
              <div className={LBL}>
                Roles {selectedRoles.length > 0 && <span className="text-gray-400 normal-case">· each makes a shift</span>}
              </div>
              {roles.length === 0 ? (
                <div className="text-[var(--fs-sm)] text-gray-400">No roles set up — the shift will have no role.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {roles.map(r => {
                    const on = roleIds.has(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => toggleRole(r.id)}
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
              {mode === 'open' && selectedRoles.length > 1 && (
                <div className={`${HINT} mt-1.5`}>Creates one open shift per role.</div>
              )}
            </div>
          </div>

          {/* ASSIGN NOW */}
          <div className={`${ds.card} p-4 flex flex-col gap-3`}>
            <div>
              <div className={LBL}>Assign now (optional)</div>
              <div className="flex bg-gray-100 rounded-full p-1">
                <button
                  onClick={() => setMode('open')}
                  className={`flex-1 py-2 rounded-full text-[var(--fs-sm)] font-semibold transition-colors ${mode === 'open' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                >
                  Leave open
                </button>
                <button
                  onClick={() => setMode('pick')}
                  className={`flex-1 py-2 rounded-full text-[var(--fs-sm)] font-semibold transition-colors ${mode === 'pick' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                >
                  Pick people
                </button>
              </div>
            </div>

            {mode === 'open' ? (
              <div className="flex flex-col gap-2">
                <div className={HINT}>Open shifts appear in staff “Open Shifts” once published.</div>
                <div>
                  <div className={LBL}>Who can take it</div>
                  <div className="flex gap-2">
                    {([['1', 'Anyone'], ['2', 'Associate & up'], ['3', 'Team Lead only']] as const).map(([v, label]) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setMinSkill(v)}
                        className={`flex-1 py-2 rounded-xl text-[var(--fs-sm)] font-semibold border transition-colors ${
                          minSkill === v ? 'border-green-600 bg-green-50 text-green-700' : 'border-gray-200 bg-white text-gray-500'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {minSkill !== '1' && (
                    <div className={`${HINT} mt-1.5`}>
                      Only {minSkill === '3' ? 'Team Leads' : 'Associates and Team Leads'} will be able to claim it.
                    </div>
                  )}
                </div>
              </div>
            ) : sortedPeople.length === 0 ? (
              <div className={HINT}>Nobody on the roster yet — add people in Roster &amp; Caps.</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {sortedPeople.map(e => {
                  const isPicked = pickedIds.has(e.id);
                  const h = hoursMap.get(e.id) ?? 0;
                  const eligibleForRole = roleOk(e);
                  const matchesDept = inDept(e);
                  return (
                    <button
                      key={e.id}
                      onClick={() => togglePicked(e.id)}
                      aria-pressed={isPicked}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                        isPicked ? 'border-green-600 bg-green-50' : 'border-gray-200 bg-white active:bg-gray-50'
                      } ${!matchesDept && !isPicked ? 'opacity-55' : ''}`}
                    >
                      <span className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${isPicked ? 'bg-green-600 border-green-600' : 'border-gray-300'}`}>
                        {isPicked && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                        )}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[var(--fs-sm)] font-bold text-gray-900 truncate">{e.name}</span>
                        <span className="block text-[var(--fs-xs)] text-gray-500 tabular-nums">
                          {e.cap !== null ? `${fmtH(h)} / ${fmtCap(e.cap)} h this week` : `${fmtH(h)} h this week · no cap`}
                        </span>
                      </span>
                      {!matchesDept ? (
                        <Badge variant="gray">Not this dept</Badge>
                      ) : (
                        !eligibleForRole && <Badge variant="gray">Not this role</Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {overCapPicked.length > 0 && (
              <WarnBox>
                Over the weekly cap: {overCapPicked.map(p => firstName(p.name)).join(', ')}. You can still
                assign {overCapPicked.length === 1 ? 'them' : 'them'}; those shifts are flagged so you can keep an eye on it.
              </WarnBox>
            )}

            {minijobPicked.length > 0 && (
              <WarnBox>
                Minijob limit: {minijobPicked.map(p => firstName(p.name)).join(', ')} may go over the <b>€{MINIJOB_CAP}</b>/month
                cap this month. You can still assign them, but it may affect their Minijob status.
              </WarnBox>
            )}

            {arbzgPicked.map(w => (
              <WarnBox key={w.name}>
                Working-time law (ArbZG): <b>{w.name}</b> — {w.issues.join('; ')}. You can still assign, but this
                may not be legal.
              </WarnBox>
            ))}
          </div>

          {/* REPEAT */}
          <div className={`${ds.card} p-4 flex flex-col gap-3`}>
            <div className={LBL}>Repeat</div>
            <div className="flex flex-wrap gap-2">
              {([['none', 'Doesn’t repeat'], ['daily', 'Every day'], ['weekly', 'Every week'], ['custom', 'Custom days']] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setRepeatMode(v)}
                  className={`px-3.5 py-2 rounded-full text-[var(--fs-sm)] font-semibold transition-colors ${
                    repeat === v ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 active:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {repeat === 'custom' && (
              <div className="flex gap-1.5">
                {WEEKDAY_CHIPS.map(([wd, l]) => (
                  <button
                    key={wd}
                    type="button"
                    onClick={() => toggleRepeatDay(wd)}
                    aria-pressed={repeatDays.has(wd)}
                    className={`flex-1 py-2 rounded-lg text-[var(--fs-xs)] font-bold transition-colors ${
                      repeatDays.has(wd) ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500 active:bg-gray-200'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
            {repeat !== 'none' && (
              <>
                <div>
                  <div className={LBL}>Until (optional)</div>
                  <input type="date" min={date} value={until} onChange={e => setUntil(e.target.value)} className={ds.input} />
                  <div className={`${HINT} mt-1`}>Leave blank to keep repeating.</div>
                </div>
                <div className={HINT}>
                  {recurrence.length > 0
                    ? `Creates ${recurrence.length} shift${recurrence.length === 1 ? '' : 's'} — ${repeat === 'daily' ? 'every day' : repeat === 'weekly' ? `every ${weekdayName(date)}` : 'on the chosen days'} through ${weekdayLabel(recurrence[recurrence.length - 1])}${until && until >= date ? '' : ' (no end date — rolling ~8 weeks; add a date to change)'}.`
                    : 'Pick at least one weekday.'}
                </div>
              </>
            )}
          </div>

          {/* COPY TO MORE DAYS (only when not repeating) */}
          {repeat === 'none' && (
          <div className={`${ds.card} p-4 flex flex-col gap-3`}>
            <div>
              <div className={LBL}>Copy to more days (optional)</div>
              <div className="flex gap-1.5">
                {weekDates.map((d, i) => {
                  const on = copySelected.has(d);
                  const locked = d === date;
                  const dayNum = Number(d.slice(8, 10));
                  return (
                    <button
                      key={d}
                      onClick={() => toggleCopyDay(d)}
                      disabled={locked}
                      aria-pressed={on}
                      className={`flex-1 flex flex-col items-center py-2 rounded-xl text-[var(--fs-xs)] font-bold transition-colors ${
                        on ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-500 active:bg-gray-200'
                      } ${locked ? 'ring-2 ring-green-200' : ''}`}
                    >
                      <span>{DAY_ABBR[i]}</span>
                      <span className="text-[var(--fs-sm)] tabular-nums">{dayNum}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className={HINT}>Same time and role on each selected day.</div>
          </div>
          )}

          {/* SAVE AS TEMPLATE */}
          <div className={`${ds.card} p-4 flex items-center justify-between gap-3`}>
            <div className="min-w-0">
              <div className="text-[var(--fs-md)] font-semibold text-gray-900">Save as a shift template</div>
              <div className={HINT}>
                {note.trim()
                  ? `Reuse "${note.trim()}" (${start}–${end}) in one tap next time.`
                  : 'Add a shift name above to save this as a template.'}
              </div>
            </div>
            <ToggleSwitch on={saveAsTemplate} onToggle={() => setSaveAsTemplate(v => !v)} disabled={!note.trim()} />
          </div>
        </div>
      )}

      {/* Footer */}
      {!loading && !error && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 safe-bottom z-[60]">
          <div className="max-w-xl mx-auto flex flex-col gap-2">
            {submitError && (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[var(--fs-sm)] text-red-700">
                {submitError}
              </div>
            )}
            <button onClick={() => void submit()} disabled={!canSubmit} className={`${ds.btnPrimary} disabled:opacity-50`}>
              {submitting
                ? 'Creating…'
                : totalShifts > 1
                  ? `Create ${totalShifts} shifts`
                  : mode === 'pick' && pickedList.length === 1
                    ? `Create & assign to ${firstName(pickedList[0].name)}`
                    : 'Create shift'}
            </button>
            <button
              onClick={onBack}
              className="w-full py-2.5 rounded-xl text-[var(--fs-sm)] font-semibold text-gray-500 active:text-gray-700"
            >
              Cancel
            </button>
            {overCapPicked.length > 0 && (
              <button
                onClick={() => {
                  setMode('open');
                  setPickedIds(new Set());
                }}
                className="w-full py-2.5 rounded-xl text-[var(--fs-sm)] font-semibold text-gray-500 bg-gray-100 active:bg-gray-200"
              >
                Leave open instead
              </button>
            )}
            <div className="text-[var(--fs-xs)] text-gray-400 text-center">
              Saved as a draft — staff won’t see it until you publish.
            </div>
          </div>
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
      )}


      {deleteTpl && (
        <ConfirmDialog
          title="Delete this template?"
          message={`"${deleteTpl.name}" (${deleteTpl.startHHMM}-${deleteTpl.endHHMM}) will be removed. Shifts you already created are not affected.`}
          confirmLabel="Delete template"
          cancelLabel="Keep it"
          variant="danger"
          onConfirm={() => void removeTemplate(deleteTpl)}
          onCancel={() => setDeleteTpl(null)}
        />
      )}
    </div>
  );
}
