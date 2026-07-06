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
import { Badge, EmptyState, Sheet, Spinner } from '@/components/shifts/ui';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { ds } from '@/lib/design-system';
import { berlinISOWeekKey, berlinParts, nowOdooUtc, weekKeyDays } from '@/lib/shifts-time';
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

const LBL = 'text-[var(--fs-xs)] font-semibold tracking-wide uppercase text-gray-400 mb-1.5';
const HINT = 'text-[var(--fs-xs)] text-gray-400';
const DAY_ABBR = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

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

export default function CreateShift({ companyId, isManager, onBack, prefill, onCreated }: CreateShiftProps) {
  const todayBerlin = useMemo(() => berlinParts(nowOdooUtc()).date, []);
  const lastTimes = useMemo(() => readLastTimes(companyId), [companyId]);

  // Form state — times default to the last shift you made (restaurant shifts
  // cluster around a few times), falling back to a sensible dinner shift.
  const [date, setDate] = useState(prefill?.date || todayBerlin);
  const [start, setStart] = useState(prefill?.startHHMM || lastTimes?.start || '16:00');
  const [end, setEnd] = useState(prefill?.endHHMM || lastTimes?.end || '22:00');
  const [roleId, setRoleId] = useState<number | null>(prefill?.roleId ?? null);
  const [count, setCount] = useState(1);
  const [mode, setMode] = useState<'open' | 'pick'>('open');
  const [pickedId, setPickedId] = useState<number | null>(null);
  const [copySelected, setCopySelected] = useState<Set<string>>(new Set(prefill?.date ? [prefill.date] : [todayBerlin]));
  const [note, setNote] = useState('');

  // Data
  const [roles, setRoles] = useState<RoleInfo[]>([]);
  const [employees, setEmployees] = useState<ShiftEmployee[]>([]);
  const [hoursMap, setHoursMap] = useState<Map<number, number>>(new Map());
  const [monthHours, setMonthHours] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Reusable "quick start" templates.
  const [templates, setTemplates] = useState<ShiftTemplate[]>([]);
  const [showSaveTpl, setShowSaveTpl] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplBusy, setTplBusy] = useState(false);
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
      setEmployees(Array.isArray(data.employees) ? data.employees : []);
      const mh = new Map<number, number>();
      const mhObj =
        data.monthHoursByEmployee && typeof data.monthHoursByEmployee === 'object' ? data.monthHoursByEmployee : {};
      for (const [k, v] of Object.entries(mhObj)) {
        const id = Number(k);
        if (Number.isFinite(id) && typeof v === 'number') mh.set(id, v);
      }
      setMonthHours(mh);
      setRoleId(prev => prev ?? (roleList[0]?.id ?? null));
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
    setStart(t.startHHMM);
    setEnd(t.endHHMM);
    if (t.roleId !== null) setRoleId(t.roleId);
    setCount(t.headcount >= 1 ? t.headcount : 1);
  }

  async function saveTemplate() {
    const name = tplName.trim();
    if (!name) return;
    setTplBusy(true);
    try {
      const res = await fetch('/api/shifts/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, name, start, end, role_id: roleId, headcount: count }),
      });
      if (res.ok) {
        setShowSaveTpl(false);
        setTplName('');
        await loadTemplates();
      }
    } catch { /* ignore */ } finally {
      setTplBusy(false);
    }
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

  const picked = mode === 'pick' && pickedId !== null ? employees.find(e => e.id === pickedId) ?? null : null;

  // Projection: existing week hours + every shift this form will create for them.
  const addedHours = durH !== null ? durH * count * Math.max(copySelected.size, 1) : 0;
  const pickedBase = picked ? hoursMap.get(picked.id) ?? 0 : 0;
  const pickedProjected = Math.round((pickedBase + addedHours) * 100) / 100;
  const pickedOverage = picked && picked.cap !== null && pickedProjected > picked.cap
    ? Math.round((pickedProjected - picked.cap) * 100) / 100
    : 0;

  // Minijob €603/month check (projected month earnings at the person's rate).
  const MINIJOB_CAP = 603;
  const pickedMonthEarnings =
    picked && picked.employmentType === 'minijob'
      ? Math.round(((monthHours.get(picked.id) ?? 0) + addedHours) * picked.hourlyRate)
      : 0;
  const minijobOver = !!picked && picked.employmentType === 'minijob' && pickedMonthEarnings > MINIJOB_CAP;

  const sortedPeople = useMemo(() => {
    const eligible = (e: ShiftEmployee) => roleId === null || e.roleIds.includes(roleId);
    return [...employees].sort((a, b) => {
      const ea = eligible(a) ? 0 : 1;
      const eb = eligible(b) ? 0 : 1;
      if (ea !== eb) return ea - eb;
      return a.name.localeCompare(b.name);
    });
  }, [employees, roleId]);

  function toggleCopyDay(d: string) {
    if (d === date) return; // the shift's own day is locked on
    setCopySelected(prev => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }

  const canSubmit = !submitting && !!date && durH !== null && count >= 1 && (mode === 'open' || pickedId !== null);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body: Record<string, unknown> = {
        company_id: companyId,
        date,
        start,
        end,
        role_id: roleId,
        count,
        note: note.trim(),
        copy_days: Array.from(copySelected).filter(d => d !== date),
      };
      if (mode === 'pick' && pickedId !== null) body.assign_employee_id = pickedId;
      const res = await fetch('/api/shifts/slots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`);
      saveLastTimes(companyId, start, end); // remember for next time
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
        <AppHeader supertitle="Shifts" title="New Shift" showBack onBack={onBack} />
        <EmptyState icon="🔒" title="Managers only" body="Creating shifts is a manager task." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="Shifts" title="New Shift" showBack onBack={onBack} />

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
        <div className="px-4 pt-4 pb-48 flex flex-col gap-3 max-w-lg mx-auto w-full">
          {/* QUICK START (reusable templates) */}
          <div className={`${ds.card} p-4`}>
            <div className={LBL}>Quick start</div>
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
                    className="absolute top-1/2 -translate-y-1/2 right-1 w-6 h-6 rounded-full flex items-center justify-center text-green-700/50 active:text-red-600"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => { setTplName(''); setShowSaveTpl(true); }}
                className="px-3.5 py-2 rounded-full border border-dashed border-gray-300 text-gray-500 text-[var(--fs-sm)] font-semibold active:bg-gray-50"
              >
                ＋ Save these times
              </button>
            </div>
            {templates.length === 0 && (
              <div className={`${HINT} mt-2`}>Save times you use a lot (e.g. &ldquo;Dinner 16&ndash;22&rdquo;) and reuse them in one tap.</div>
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
            <div>
              <div className={LBL}>Role</div>
              <select
                value={roleId ?? ''}
                onChange={e => {
                  setRoleId(e.target.value === '' ? null : Number(e.target.value));
                }}
                className={ds.input}
              >
                {roles.length === 0 && <option value="">Any role</option>}
                {roles.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <div className={LBL}>People needed</div>
              <div className="inline-flex items-center border border-gray-200 rounded-xl overflow-hidden h-12 bg-white">
                <button
                  onClick={() => setCount(c => Math.max(1, c - 1))}
                  aria-label="Fewer people"
                  className="w-12 h-12 flex items-center justify-center text-gray-600 text-[var(--fs-xl)] active:bg-gray-100 border-r border-gray-200"
                >
                  −
                </button>
                <span className="min-w-[56px] text-center font-mono text-[var(--fs-xl)] font-semibold text-gray-900 tabular-nums">{count}</span>
                <button
                  onClick={() => setCount(c => Math.min(10, c + 1))}
                  aria-label="More people"
                  className="w-12 h-12 flex items-center justify-center text-gray-600 text-[var(--fs-xl)] font-semibold active:bg-gray-100 border-l border-gray-200"
                >
                  +
                </button>
              </div>
              {count > 1 && mode === 'open' && (
                <div className={`${HINT} mt-1.5`}>{count} people = {count} open shifts per selected day.</div>
              )}
              {count > 1 && mode === 'pick' && (
                <div className={`${HINT} mt-1.5 text-amber-700 font-semibold`}>
                  ⚠ This makes {count} identical shifts, all on {picked?.name || 'this person'} at the same time — usually you want 1.
                </div>
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
                  Pick a person
                </button>
              </div>
            </div>

            {mode === 'open' ? (
              <div className={HINT}>Open shifts appear in staff “Open Shifts” once published.</div>
            ) : sortedPeople.length === 0 ? (
              <div className={HINT}>Nobody on the roster yet — add people in Roster &amp; Caps.</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {sortedPeople.map(e => {
                  const isPicked = pickedId === e.id;
                  const h = hoursMap.get(e.id) ?? 0;
                  const eligibleForRole = roleId === null || e.roleIds.includes(roleId);
                  return (
                    <button
                      key={e.id}
                      onClick={() => setPickedId(isPicked ? null : e.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors ${
                        isPicked ? 'border-green-600 bg-green-50' : 'border-gray-200 bg-white active:bg-gray-50'
                      }`}
                    >
                      <span className="w-9 h-9 rounded-full bg-gray-100 text-gray-600 text-[var(--fs-xs)] font-bold flex items-center justify-center flex-shrink-0">
                        {initials(e.name)}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[var(--fs-sm)] font-bold text-gray-900 truncate">{e.name}</span>
                        <span className="block text-[var(--fs-xs)] text-gray-500 tabular-nums">
                          {e.cap !== null ? `${fmtH(h)} / ${fmtCap(e.cap)} h this week` : `${fmtH(h)} h this week · no cap`}
                        </span>
                      </span>
                      {!eligibleForRole && <Badge variant="gray">Not this role</Badge>}
                    </button>
                  );
                })}
              </div>
            )}

            {picked && pickedOverage > 0 && picked.cap !== null && (
              <WarnBox>
                This puts {firstName(picked.name)} at <b>{fmtH(pickedProjected)} of {fmtCap(picked.cap)} hours</b> that week —{' '}
                <b>{fmtH(pickedOverage)} h over</b> their cap. You can still assign them; the shift will be flagged so you can keep an eye on it.
              </WarnBox>
            )}

            {minijobOver && picked && (
              <WarnBox>
                Minijob limit: this puts {firstName(picked.name)} at about <b>€{pickedMonthEarnings}</b> this month —{' '}
                over the <b>€{MINIJOB_CAP}</b> cap. You can still assign them, but it may affect their Minijob status.
              </WarnBox>
            )}
          </div>

          {/* COPY TO MORE DAYS */}
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

          {/* NOTE */}
          <div className={`${ds.card} p-4`}>
            <div className={LBL}>Note (optional)</div>
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. Delivery day — extra prep"
              className={ds.input}
            />
          </div>
        </div>
      )}

      {/* Footer */}
      {!loading && !error && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-3 safe-bottom z-[60]">
          <div className="max-w-lg mx-auto flex flex-col gap-2">
            {submitError && (
              <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[var(--fs-sm)] text-red-700">
                {submitError}
              </div>
            )}
            <button onClick={() => void submit()} disabled={!canSubmit} className={`${ds.btnPrimary} disabled:opacity-50`}>
              {submitting
                ? 'Creating…'
                : picked
                  ? `Create & assign to ${firstName(picked.name)}`
                  : 'Create shift'}
            </button>
            {picked && pickedOverage > 0 && (
              <button
                onClick={() => {
                  setMode('open');
                  setPickedId(null);
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

      {/* Save-as-template sheet */}
      <Sheet open={showSaveTpl} onClose={() => setShowSaveTpl(false)}>
        <div className="flex flex-col gap-3">
          <div className="text-[var(--fs-lg)] font-bold text-gray-900">Save as a template</div>
          <div className="text-[var(--fs-sm)] text-gray-500">
            Reuse {start}&ndash;{end}
            {roleId ? ` · ${roles.find(r => r.id === roleId)?.name ?? ''}` : ''}
            {count > 1 ? ` · ${count} people` : ''} with one tap next time.
          </div>
          <div>
            <div className={LBL}>Template name</div>
            <input
              type="text"
              value={tplName}
              onChange={e => setTplName(e.target.value)}
              placeholder="e.g. Dinner"
              maxLength={40}
              className={ds.input}
            />
          </div>
          <button
            onClick={() => void saveTemplate()}
            disabled={tplBusy || !tplName.trim()}
            className={`${ds.btnPrimary} disabled:opacity-50`}
          >
            {tplBusy ? 'Saving…' : 'Save template'}
          </button>
        </div>
      </Sheet>

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
