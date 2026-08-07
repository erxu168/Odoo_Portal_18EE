'use client';

/**
 * Who did what — the staff accountability report.
 *
 * READ ONLY. It writes nothing and changes nothing; it is a view over
 * completions that already happened.
 *
 * It reports on what people DID, never on what was missed. A task nobody did
 * cannot be pinned on anyone — tasks belong to a department and whoever is on
 * shift picks them up — so "Marco missed 3" is a sentence this data cannot
 * honestly support. The screen says so rather than letting a manager infer it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import ManagerTabs from '../../_components/ManagerTabs';
import { useCompany } from '@/lib/company-context';
import { berlinToday } from '@/lib/berlin-date';
import type { AccountabilityPerson, AccountabilityTotals, AccountabilityRow } from '@/lib/task-review';

/** N days before today, anchored in UTC.
 *
 *  It used to parse Berlin's date as LOCAL noon and read it back in UTC, so on
 *  a device more than twelve hours from UTC the start of the range came out a
 *  day early while the end stayed Berlin-correct — a window quietly one day
 *  wider than the button claimed. */
function daysAgo(n: number): string {
  const d = new Date(`${berlinToday()}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const RANGES: { label: string; days: number }[] = [
  { label: '7 days', days: 6 },
  { label: '30 days', days: 29 },
  { label: '90 days', days: 89 },
];

function lateness(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function TaskReportPage() {
  const { companyId } = useCompany();
  const [days, setDays] = useState(6);
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(berlinToday());
  const [people, setPeople] = useState<AccountabilityPerson[]>([]);
  const [totals, setTotals] = useState<AccountabilityTotals | null>(null);
  const [open, setOpen] = useState<AccountabilityPerson | null>(null);
  const [rows, setRows] = useState<AccountabilityRow[] | null>(null);
  /** True match count — the drawer shows only the most recent slice. */
  const [rowTotal, setRowTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Only the newest request may write state — a slow earlier range must never
  // clobber a fresher one.
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    if (!companyId) return;
    const token = ++reqRef.current;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/tasks/report?company_id=${companyId}&from=${from}&to=${to}`, { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (token !== reqRef.current) return;
      if (!res.ok || !body.ok) { setError(body.error || 'Could not build the report'); return; }
      setPeople(body.people || []);
      setTotals(body.totals || null);
    } catch {
      if (token === reqRef.current) setError('Network error');
    } finally {
      if (token === reqRef.current) setLoading(false);
    }
  }, [companyId, from, to]);

  useEffect(() => { void load(); }, [load]);

  function pickRange(d: number) {
    setDays(d);
    setFrom(daysAgo(d));
    setTo(berlinToday());
  }

  async function openPerson(p: AccountabilityPerson) {
    setOpen(p); setRows(null); setRowTotal(0);
    // A person with no employee record has nothing to look up — their
    // completions are grouped by the name preserved on the task.
    if (!p.employee_id) { setRows([]); return; }
    const res = await fetch(
      `/api/tasks/report?company_id=${companyId}&from=${from}&to=${to}&employee_id=${p.employee_id}`,
      { cache: 'no-store' },
    );
    const body = await res.json().catch(() => ({}));
    setRows(res.ok && body.ok ? (body.rows || []) : []);
    setRowTotal(res.ok && body.ok ? (body.total || 0) : 0);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader supertitle="TASKS" title="Who did what" subtitle="Completed tasks, by person" />
      <ManagerTabs />

      <div className="max-w-2xl mx-auto px-4 py-4">
        <div className="flex gap-2 mb-3">
          {RANGES.map(r => (
            <button
              key={r.days}
              type="button"
              onClick={() => pickRange(r.days)}
              aria-pressed={days === r.days}
              className={`flex-1 min-h-[44px] rounded-xl text-[var(--fs-sm)] font-bold border ${
                days === r.days
                  ? 'bg-green-600 border-green-600 text-white'
                  : 'bg-white border-gray-200 text-gray-600'
              }`}
            >
              Last {r.label}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[var(--fs-xs)] font-semibold text-red-700 mb-3">
            {error}
          </p>
        )}

        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-200 rounded-2xl animate-pulse" />)}</div>
        ) : !totals || totals.done === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2">📋</p>
            <p className="font-semibold text-gray-600">Nothing completed in this period</p>
            <p className="text-[var(--fs-sm)] mt-1">Try a longer range.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[
                { v: totals.done, l: 'Done' },
                { v: totals.on_time, l: 'On time' },
                { v: totals.late, l: 'Late' },
                { v: totals.flagged, l: 'Flagged' },
              ].map(k => (
                <div key={k.l} className="bg-white border border-gray-200 rounded-xl px-2 py-2.5 text-center">
                  <p className={`text-[var(--fs-lg)] font-extrabold tabular-nums ${
                    (k.l === 'Late' || k.l === 'Flagged') && k.v > 0 ? 'text-amber-700' : 'text-gray-900'
                  }`}>{k.v}</p>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mt-0.5">{k.l}</p>
                </div>
              ))}
            </div>

            {totals.untimed > 0 && (
              // Without this line "on time" looks smaller than it should and a
              // manager reads a problem that is not there.
              <p className="text-[var(--fs-xs)] text-gray-500 mb-3 leading-snug">
                {totals.untimed} of these had no deadline to measure against, so they count as
                done but neither on time nor late. Set <b>Service times</b> in Settings and
                tasks without their own time inherit one.
              </p>
            )}

            <div className="space-y-2">
              {people.map(p => (
                <button
                  key={p.employee_id}
                  type="button"
                  onClick={() => void openPerson(p)}
                  className="w-full bg-white border border-gray-200 rounded-2xl p-3 flex items-center gap-3 text-left hover:bg-gray-50 active:scale-[0.99] transition-transform"
                >
                  <span className="w-10 h-10 rounded-full bg-gray-100 border border-gray-200 grid place-items-center text-[var(--fs-xs)] font-bold text-gray-500 flex-shrink-0">
                    {p.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold text-[var(--fs-sm)] text-gray-800 truncate">{p.name}</span>
                    <span className="block text-[var(--fs-xs)] text-gray-500 tabular-nums">
                      {p.done} done · {p.on_time} on time
                      {p.late > 0 && <> · <b className="text-amber-700">{p.late} late</b> (avg {lateness(p.avg_late_minutes)})</>}
                      {p.flagged > 0 && <> · {p.flagged} flagged</>}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <p className="text-[var(--fs-xs)] text-gray-400 mt-4 leading-snug">
              This shows what people <b>did</b>. It cannot show what was missed — tasks belong to
              a department, not a person, so an unfinished task has nobody to attribute it to.
            </p>
          </>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-[100] bg-black/40 flex items-end sm:items-center justify-center"
          onClick={() => { setOpen(null); setRows(null); }}>
          <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[85dvh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
              <h2 className="font-bold text-gray-800 text-[var(--fs-base)] min-w-0 truncate">{open.name}</h2>
              <button type="button" onClick={() => { setOpen(null); setRows(null); }} aria-label="Close"
                className="w-11 h-11 -mr-2 grid place-items-center rounded-lg text-gray-400 hover:text-gray-700">
                <span aria-hidden="true" className="text-[var(--fs-lg)] leading-none">✕</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 pb-5 min-h-0">
              {rows === null ? (
                <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}</div>
              ) : rows.length === 0 ? (
                <p className="text-[var(--fs-sm)] text-gray-400 py-6 text-center">
                  {open.employee_id
                    ? 'Nothing in this period.'
                    : 'These completions are not linked to a staff record, so there is no individual list.'}
                </p>
              ) : (<>
              {rowTotal > rows.length && (
                // Never truncate in silence in a report people are judged by.
                <p className="text-[var(--fs-xs)] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 mb-2">
                  Showing the most recent {rows.length} of {rowTotal}. Narrow the date range to see the rest.
                </p>
              )}
              {rows.map(r => (
                <div key={r.line_id} className="py-2.5 border-b border-gray-100 last:border-0">
                  <p className="font-semibold text-[var(--fs-sm)] text-gray-800 leading-snug">{r.name}</p>
                  <p className="text-[var(--fs-xs)] text-gray-500 tabular-nums mt-0.5">
                    {r.date} · {r.department_name}
                    {r.late_by_minutes > 0
                      ? <> · <b className="text-amber-700">{lateness(r.late_by_minutes)} late</b></>
                      : r.deadline ? ' · on time' : ' · no deadline'}
                  </p>
                  {r.flagged && (
                    <p className="text-[var(--fs-xs)] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mt-1">
                      Photo flagged{r.flag_reason ? `: ${r.flag_reason}` : ''}
                    </p>
                  )}
                </div>
              ))}
              </>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
