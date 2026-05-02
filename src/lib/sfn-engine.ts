/**
 * sfn-engine.ts — SFN Optimizer v2 core engine
 * §3b EStG 2026 · §32a EStG 2026 · SV 2026 · Two-pass team scheduler
 * Pure TypeScript, no Odoo dependencies.
 */

// ── TYPES ─────────────────────────────────────────────────────

export type Role = 'kitchen' | 'service' | 'bar';
export type Scenario = 'conservative' | 'balanced' | 'max';
export type ShiftType = 'normal' | 'night' | 'sunday' | 'holiday';

export interface OpeningHours {
  day: string;
  open: boolean;
  startH: number;   // 0–23
  endH: number;     // 1–30 (>24 = next day)
}

export interface StaffingWindow {
  name: string;
  startH: number;
  endH: number;
}

export interface StaffingReq {
  kitchen: number;
  service: number;
  bar: number;
}

export interface Employee {
  id: number;
  name: string;
  grundlohn: number;
  stkl: number;
  kfb: number;
  kv: 'gkv' | 'pkv';
  kv_zusatz: number;
  pv_kinder: boolean;
  rv: boolean;
  role: Role;
  flex: boolean;
  target_brutto: number;
}

export interface Shift {
  date: Date;
  day: number;
  startH: number;
  endH: number;
  lengthH: number;
  sfnLst: number;
  sfnSV: number;
  basePay: number;
  grossPay: number;
  type: ShiftType;
  role: Role;
  passOne: boolean;
}

export interface Schedule {
  employeeId: number;
  year: number;
  month: number;
  scenario: Scenario;
  shifts: Shift[];
  totalH: number;
  totalSFN: number;
  totalGross: number;
  totalBase: number;
  net: NetResult;
  coverageShifts: number;
  sfnShifts: number;
}

export interface NetResult {
  sv: number;
  lst: number;
  soli: number;
  kist: number;
  net: number;
  taxable: number;
  category: 'mini' | 'midi' | 'normal';
}

export interface CoverageGap {
  date: Date;
  day: number;
  windowName: string;
  startH: number;
  endH: number;
  role: Role;
  required: number;
  actual: number;
  deficit: number;
}

export interface TeamScheduleResult {
  schedules: Schedule[];
  gaps: CoverageGap[];
  totalSFN: number;
  totalGross: number;
  totalNet: number;
}

// ── BERLIN PUBLIC HOLIDAYS ────────────────────────────────────

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

export function getBerlinHolidays(year: number): Set<string> {
  const e = easterSunday(year);
  const add = (d: Date, days: number) => {
    const r = new Date(d); r.setDate(r.getDate() + days); return r;
  };
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return new Set([
    fmt(new Date(year, 0, 1)),
    fmt(add(e, -2)),
    fmt(e),
    fmt(add(e, 1)),
    fmt(new Date(year, 4, 1)),
    fmt(add(e, 39)),
    fmt(add(e, 49)),
    fmt(add(e, 50)),
    fmt(new Date(year, 9, 3)),
    fmt(new Date(year, 11, 25)),
    fmt(new Date(year, 11, 26)),
  ]);
}

function isClosed(d: Date): boolean {
  return d.getMonth() === 11 && (d.getDate() === 25 || d.getDate() === 26);
}

// ── §3b RATE ENGINE ────────────────────────────────────────────

function hourRate(baseDate: Date, absH: number, holidays: Set<string>) {
  const wall = absH % 24;
  const d = new Date(baseDate);
  if (absH >= 24) d.setDate(d.getDate() + 1);
  const dateStr = d.toISOString().slice(0, 10);
  const isHol = holidays.has(dateStr);
  const isSun = d.getDay() === 0;
  const mo = d.getMonth() + 1, dy = d.getDate();
  const isSpec = (mo === 12 && (dy === 25 || dy === 26)) || (mo === 5 && dy === 1);
  const isX24 = mo === 12 && dy === 24;
  const isNYE = mo === 12 && dy === 31;
  let dr = 0;
  if (isSpec)                              dr = 1.50;
  else if ((isX24 || isNYE) && wall >= 14) dr = 1.25;
  else if (isHol)                          dr = 1.25;
  else if (isSun)                          dr = 0.50;
  let nr = 0;
  if (absH >= 24 && absH < 28)            nr = 0.40;
  else if (wall >= 20 || wall < 6)        nr = 0.25;
  return { total: dr + nr, isHol, isSun };
}

export function calcShiftSFN(
  date: Date, startH: number, length: number,
  holidays: Set<string>, gl: number
): { sfnLst: number; sfnSV: number } {
  const glLst = Math.min(gl, 50);
  const glSV  = Math.min(gl, 25);
  let sfnLst = 0, sfnSV = 0;
  for (let i = 0; i < length; i++) {
    const r = hourRate(date, startH + i, holidays);
    sfnLst += r.total * glLst;
    sfnSV  += r.total * glSV;
  }
  return { sfnLst, sfnSV };
}

function getShiftType(
  date: Date, startH: number, length: number, holidays: Set<string>
): ShiftType {
  if (holidays.has(date.toISOString().slice(0, 10))) return 'holiday';
  if (date.getDay() === 0)                           return 'sunday';
  if (startH >= 20 || startH + length > 24)         return 'night';
  return 'normal';
}

// ── TAX ENGINE — §32a EStG 2026 ───────────────────────────────

function lstBasic(zvE: number): number {
  const x = Math.max(0, Math.round(zvE));
  if (x <= 12348) return 0;
  if (x <= 17799) { const y = (x - 12348) / 10000; return Math.floor((979.18 * y + 1400) * y); }
  if (x <= 69878) { const z = (x - 17799) / 10000; return Math.floor((192.59 * z + 2397) * z + 966.53); }
  if (x <= 277825) return Math.floor(0.42 * x - 10911.92);
  return Math.floor(0.45 * x - 19246.67);
}

function calcLSt(zvE_annual: number, stkl: number, kfb: number): number {
  const wk = stkl !== 6 ? 1230 : 0;
  let x = Math.max(0, zvE_annual - wk);
  if (stkl === 2) { const e = 4260 + Math.max(0, kfb - 0.5) * 480; x = Math.max(0, x - e); }
  if (stkl === 3) return 2 * lstBasic(x / 2);
  return lstBasic(x);
}

function calcSoli(lstAnnual: number): number {
  if (lstAnnual <= 20350) return 0;
  return Math.min(lstAnnual * 0.055, (lstAnnual - 20350) * 0.119);
}

// ── SOCIAL INSURANCE — SV 2026 ────────────────────────────────

function calcSV(gross: number, sfn: number, emp: Employee) {
  const grundlohn = gross - sfn;
  if (grundlohn <= 603) {
    const rv = emp.rv ? grundlohn * 0.036 : 0;
    return { sv: rv, kv: 0, pv: 0, rv, av: 0, category: 'mini' as const };
  }
  if (grundlohn <= 2000) {
    const ae = grundlohn;
    const kvHalf = emp.kv === 'gkv' ? (14.6 + emp.kv_zusatz) / 100 / 2 : 0;
    const f2 = Math.max(0, 1.431639227 * ae - 863.2784538);
    const f1 = Math.max(0, 1.145937223 * ae - 291.8744452);
    const kv = f2 * kvHalf;
    const pv = f2 * (3.6 / 100 / 2) + (emp.pv_kinder ? 0 : f1 * 0.006);
    const rv = f2 * (emp.rv ? 18.6 / 100 / 2 : 0);
    const av = f2 * (2.6 / 100 / 2);
    return { sv: kv + pv + rv + av, kv, pv, rv, av, category: 'midi' as const };
  }
  const kvRate = emp.kv === 'gkv' ? (14.6 + emp.kv_zusatz) / 100 / 2 : 0;
  const pvRate = emp.pv_kinder ? 0.018 : 0.024;
  const bbgKV = 69750 / 12, bbgRV = 101400 / 12;
  const kv = Math.min(gross, bbgKV) * kvRate;
  const pv = Math.min(gross, bbgKV) * pvRate;
  const rv = Math.min(gross, bbgRV) * (emp.rv ? 0.093 : 0);
  const av = Math.min(gross, bbgRV) * 0.013;
  return { sv: kv + pv + rv + av, kv, pv, rv, av, category: 'normal' as const };
}

export function calcMonthlyNet(gross: number, sfn: number, emp: Employee): NetResult {
  const svResult = calcSV(gross, sfn, emp);
  const { sv, category } = svResult;
  if (category === 'mini') {
    return { sv, lst: 0, soli: 0, kist: 0, net: gross - sv, taxable: 0, category };
  }
  const taxable = Math.max(0, gross - sfn - sv);
  const lstAnnual = calcLSt(taxable * 12, emp.stkl, emp.kfb);
  const lst = lstAnnual / 12;
  const soli = calcSoli(lstAnnual) / 12;
  return { sv, lst, soli, kist: 0, net: gross - sv - lst - soli, taxable, category };
}

export function grossFromNet(targetNet: number, sfnFraction: number, emp: Employee): number {
  let lo = targetNet, hi = targetNet * 3.5;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const r = calcMonthlyNet(mid, mid * sfnFraction, emp);
    if (r.net < targetNet) lo = mid; else hi = mid;
    if (Math.abs(r.net - targetNet) < 0.20) break;
  }
  return (lo + hi) / 2;
}

// ── GREEDY SINGLE-EMPLOYEE SCHEDULER (Pass 2) ─────────────────

function weekOf(day: number) { return Math.floor((day - 1) / 7); }

export function buildSingleSchedule(
  year: number, month: number,
  emp: Employee, targetGross: number, scenario: Scenario,
  openingHours: OpeningHours[], holidays: Set<string>,
  lockedDays: Set<number> = new Set()
): Shift[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const gl = emp.grundlohn;
  const candidates: Array<{
    date: Date; day: number; startH: number; length: number;
    sfnLst: number; sfnSV: number; basePay: number; grossPay: number;
    sfnPerH: number; type: ShiftType; endH: number;
  }> = [];

  for (let d = 1; d <= daysInMonth; d++) {
    if (lockedDays.has(d)) continue;
    const dt = new Date(year, month - 1, d);
    if (isClosed(dt)) continue;
    const dow = dt.getDay();
    const dh = openingHours[dow];
    if (!dh.open) continue;
    for (let sh = dh.startH; sh < Math.min(24, dh.endH); sh++) {
      const maxLen = Math.min(10, dh.endH - sh);
      for (let len = maxLen; len >= 4; len--) {
        const endDate = new Date(dt);
        if (sh + len > 24) endDate.setDate(endDate.getDate() + 1);
        if (isClosed(endDate)) continue;
        const r = calcShiftSFN(dt, sh, len, holidays, gl);
        candidates.push({
          date: dt, day: d, startH: sh, length: len,
          sfnLst: r.sfnLst, sfnSV: r.sfnSV,
          basePay: gl * len, grossPay: gl * len + r.sfnLst,
          sfnPerH: r.sfnLst / len,
          type: getShiftType(dt, sh, len, holidays),
          endH: sh + len,
        });
        break;
      }
    }
  }

  if (scenario === 'max') candidates.sort((a, b) => b.sfnLst - a.sfnLst || b.length - a.length);
  else if (scenario === 'conservative') candidates.sort((a, b) => b.sfnPerH - a.sfnPerH || a.length - b.length);
  else candidates.sort((a, b) => b.sfnPerH - a.sfnPerH || b.length - a.length);

  const dayUsed = new Set<number>(lockedDays);
  const weekH: Record<number, number> = {};
  const weekDays: Record<number, number> = {};
  const lastEndH: Record<number, number> = {};
  const chosen: Shift[] = [];
  let accGross = 0;

  for (const c of candidates) {
    if (accGross >= targetGross) break;
    if (dayUsed.has(c.day)) continue;
    const wk = weekOf(c.day);
    if ((weekH[wk] || 0) + c.length > 40) continue;
    if ((weekDays[wk] || 0) >= 5) continue;
    const prevEnd = lastEndH[c.day - 1];
    if (prevEnd !== undefined && prevEnd > 24 && c.startH - (prevEnd - 24) < 11) continue;

    let length = c.length;
    const remaining = targetGross - accGross;
    if (c.grossPay > remaining * 1.02) {
      for (let tl = length - 1; tl >= 4; tl--) {
        const tr = calcShiftSFN(c.date, c.startH, tl, holidays, gl);
        if (gl * tl + tr.sfnLst <= remaining * 1.02) { length = tl; break; }
      }
    }

    const fr = calcShiftSFN(c.date, c.startH, length, holidays, gl);
    const thisGross = gl * length + fr.sfnLst;
    chosen.push({
      date: c.date, day: c.day,
      startH: c.startH, endH: c.startH + length, lengthH: length,
      sfnLst: fr.sfnLst, sfnSV: fr.sfnSV,
      basePay: gl * length, grossPay: thisGross,
      type: getShiftType(c.date, c.startH, length, holidays),
      role: emp.role, passOne: false,
    });
    dayUsed.add(c.day);
    weekH[wk] = (weekH[wk] || 0) + length;
    weekDays[wk] = (weekDays[wk] || 0) + 1;
    lastEndH[c.day] = c.startH + length;
    accGross += thisGross;
  }

  return chosen.sort((a, b) => a.day - b.day);
}

// ── TWO-PASS TEAM SCHEDULER ────────────────────────────────────

export function runCoveragePass(
  year: number, month: number,
  employees: Employee[],
  openingHours: OpeningHours[],
  staffingWindows: StaffingWindow[],
  staffingReqs: StaffingReq[][],
  holidays: Set<string>
): {
  assignedShifts: Map<number, Shift[]>;
  gaps: CoverageGap[];
  daysClaimed: Map<number, Set<number>>;
} {
  const daysInMonth = new Date(year, month, 0).getDate();
  const assignedShifts = new Map<number, Shift[]>(employees.map(e => [e.id, []]));
  const daysClaimed    = new Map<number, Set<number>>(employees.map(e => [e.id, new Set()]));
  const gaps: CoverageGap[] = [];
  const coverage: Record<string, number> = {};
  const covKey = (d: number, wi: number, role: Role) => `${d}-${wi}-${role}`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dt = new Date(year, month - 1, d);
    if (isClosed(dt)) continue;
    const dow = dt.getDay();
    const dh = openingHours[dow];
    if (!dh.open) continue;
    // 0=Mo–Thu, 1=Fr–Sa, 2=Sun
    const dayType = dow === 0 ? 2 : (dow === 5 || dow === 6) ? 1 : 0;

    staffingWindows.forEach((win, wi) => {
      const req = staffingReqs[wi]?.[dayType];
      if (!req) return;
      const roles: Role[] = ['kitchen', 'service', 'bar'];
      roles.forEach(role => {
        const needed = req[role];
        if (needed === 0) return;
        const key = covKey(d, wi, role);
        const current = coverage[key] || 0;
        const deficit = needed - current;
        if (deficit <= 0) return;

        // Available employees sorted: primary role first, flex last
        const available = employees
          .filter(emp => !daysClaimed.get(emp.id)?.has(d) && (emp.role === role || emp.flex))
          .sort((a, b) => (a.role === role ? 0 : 1) - (b.role === role ? 0 : 1));

        let filled = 0;
        for (const emp of available) {
          if (filled >= deficit) break;
          const sh = Math.max(win.startH, dh.startH);
          const eh = Math.min(win.endH, dh.endH);
          const len = Math.min(10, Math.max(4, eh - sh));
          if (len < 4) continue;
          const sfn = calcShiftSFN(dt, sh, len, holidays, emp.grundlohn);
          assignedShifts.get(emp.id)!.push({
            date: dt, day: d, startH: sh, endH: sh + len, lengthH: len,
            sfnLst: sfn.sfnLst, sfnSV: sfn.sfnSV,
            basePay: emp.grundlohn * len,
            grossPay: emp.grundlohn * len + sfn.sfnLst,
            type: getShiftType(dt, sh, len, holidays),
            role, passOne: true,
          });
          daysClaimed.get(emp.id)!.add(d);
          coverage[key] = (coverage[key] || 0) + 1;
          filled++;
        }

        const stillNeeded = needed - (coverage[key] || 0);
        if (stillNeeded > 0) {
          gaps.push({
            date: dt, day: d, windowName: win.name,
            startH: win.startH, endH: win.endH,
            role, required: needed, actual: coverage[key] || 0, deficit: stillNeeded,
          });
        }
      });
    });
  }
  return { assignedShifts, gaps, daysClaimed };
}

export function generateTeamSchedule(
  year: number, month: number,
  employees: Employee[],
  openingHours: OpeningHours[],
  staffingWindows: StaffingWindow[],
  staffingReqs: StaffingReq[][],
  holidays: Set<string>,
  scenario: Scenario
): TeamScheduleResult {
  const { assignedShifts, gaps, daysClaimed } = runCoveragePass(
    year, month, employees, openingHours, staffingWindows, staffingReqs, holidays
  );

  const schedules: Schedule[] = employees.map(emp => {
    const pass1Shifts  = assignedShifts.get(emp.id) || [];
    const lockedDays   = daysClaimed.get(emp.id) || new Set<number>();
    const pass1Gross   = pass1Shifts.reduce((s, sh) => s + sh.grossPay, 0);
    const remaining    = Math.max(0, emp.target_brutto - pass1Gross);
    const pass2Shifts  = remaining > 0
      ? buildSingleSchedule(year, month, emp, remaining, scenario, openingHours, holidays, lockedDays)
      : [];
    const allShifts    = [...pass1Shifts, ...pass2Shifts].sort((a, b) => a.day - b.day);
    const totalSFN     = allShifts.reduce((s, sh) => s + sh.sfnLst, 0);
    const totalGross   = allShifts.reduce((s, sh) => s + sh.grossPay, 0);
    const totalBase    = allShifts.reduce((s, sh) => s + sh.basePay, 0);
    const totalH       = allShifts.reduce((s, sh) => s + sh.lengthH, 0);
    return {
      employeeId: emp.id, year, month, scenario,
      shifts: allShifts, totalH, totalSFN, totalGross, totalBase,
      net: calcMonthlyNet(totalGross, totalSFN, emp),
      coverageShifts: pass1Shifts.length,
      sfnShifts: pass2Shifts.length,
    };
  });

  return {
    schedules, gaps,
    totalSFN:   schedules.reduce((s, sc) => s + sc.totalSFN, 0),
    totalGross: schedules.reduce((s, sc) => s + sc.totalGross, 0),
    totalNet:   schedules.reduce((s, sc) => s + sc.net.net, 0),
  };
}

export function runSimulation(
  fixedGross: number, emp: Employee,
  year: number, month: number,
  openingHours: OpeningHours[], holidays: Set<string>, scenario: Scenario
) {
  const actualNet = calcMonthlyNet(fixedGross, 0, emp);
  const sched = buildSingleSchedule(year, month, emp, fixedGross, scenario, openingHours, holidays);
  const schedGross = sched.reduce((s, sh) => s + sh.grossPay, 0);
  const schedSFN   = sched.reduce((s, sh) => s + sh.sfnLst, 0);
  const scale      = schedGross > 0 ? fixedGross / schedGross : 1;
  const fictSFN    = Math.min(schedSFN * scale, fixedGross * 0.90);
  const fictNet    = calcMonthlyNet(fixedGross, fictSFN, emp);
  const diff       = fictNet.net - actualNet.net;
  return {
    actualNet, fictionalNet: fictNet,
    fictionalSFN: fictSFN, fictionalBase: fixedGross - fictSFN,
    diffNet: diff,
    diffPct: actualNet.net > 0 ? (diff / actualNet.net) * 100 : 0,
    sfnPctOfGross: fixedGross > 0 ? (fictSFN / fixedGross) * 100 : 0,
  };
}

// ── CONSTANTS & DEFAULTS ──────────────────────────────────────

export const MONTHS_DE = [
  'Januar','Februar','März','April','Mai','Juni',
  'Juli','August','September','Oktober','November','Dezember',
];
export const DAYS_SHORT_DE = ['So','Mo','Di','Mi','Do','Fr','Sa'];
export const ROLE_LABELS: Record<Role, string> = {
  kitchen: '🍳\u00a0Küche',
  service: '🍽\u00a0Service',
  bar:     '🍸\u00a0Bar',
};
export const SHIFT_TYPE_LABELS: Record<ShiftType, string> = {
  normal:  'Werktag',
  night:   '🌙 Nacht',
  sunday:  '☀️ Sonntag',
  holiday: '🎉 Feiertag',
};
export function fmt(n: number): string {
  return n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '\u00a0€';
}
export function fmtH(h: number): string {
  return `${String(h % 24).padStart(2, '0')}:00${h >= 24 ? ' (+1)' : ''}`;
}

export const DEFAULT_OPENING_HOURS: OpeningHours[] = [
  { day: 'Sonntag',    open: true, startH: 10, endH: 26 },
  { day: 'Montag',     open: true, startH: 9,  endH: 23 },
  { day: 'Dienstag',   open: true, startH: 9,  endH: 23 },
  { day: 'Mittwoch',   open: true, startH: 9,  endH: 23 },
  { day: 'Donnerstag', open: true, startH: 9,  endH: 23 },
  { day: 'Freitag',    open: true, startH: 9,  endH: 26 },
  { day: 'Samstag',    open: true, startH: 10, endH: 26 },
];

export const DEFAULT_STAFFING_WINDOWS: StaffingWindow[] = [
  { name: 'Vorbereitung',   startH: 9,  endH: 12 },
  { name: 'Mittagsservice', startH: 12, endH: 15 },
  { name: 'Nachmittag',     startH: 15, endH: 18 },
  { name: 'Abendservice',   startH: 18, endH: 23 },
  { name: 'Spätservice',    startH: 23, endH: 26 },
];

// [windowIdx][dayType 0=Mo-Thu, 1=Fr-Sa, 2=Sun]
export const DEFAULT_STAFFING_REQS: StaffingReq[][] = [
  [{ kitchen:2,service:0,bar:0 }, { kitchen:2,service:0,bar:0 }, { kitchen:2,service:0,bar:0 }],
  [{ kitchen:2,service:3,bar:1 }, { kitchen:2,service:3,bar:1 }, { kitchen:2,service:4,bar:1 }],
  [{ kitchen:1,service:2,bar:1 }, { kitchen:1,service:2,bar:1 }, { kitchen:2,service:3,bar:1 }],
  [{ kitchen:2,service:3,bar:1 }, { kitchen:3,service:4,bar:2 }, { kitchen:3,service:4,bar:2 }],
  [{ kitchen:1,service:1,bar:1 }, { kitchen:1,service:2,bar:1 }, { kitchen:1,service:2,bar:1 }],
];
