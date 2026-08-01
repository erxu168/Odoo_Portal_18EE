'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCompany } from '@/lib/company-context';
import { useTopBar } from '@/components/ui/TopBarContext';
import { useShift } from '@/lib/shift-context';

/**
 * StationHome — the home screen for a shared department tablet (kitchen station).
 * Rendered by app/page.tsx ONLY for `is_shared_device` accounts; personal phones
 * keep the normal DashboardHome. Tasks-first: today's checklist is the hero,
 * with Cooking Guide / Inventory / Purchase as big tiles and a read-only roster.
 *
 * "Prompt when it matters": tapping an attributed tool (Tasks, Inventory) with
 * nobody signed in opens the PIN sheet first, then continues to the tool — so
 * ticks and counts get credited to the real person.
 */

interface RosterEntry { name: string; role: string; start: string; end: string; }

function initials(name: string) {
  return name.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

export default function StationHome() {
  const router = useRouter();
  const { companyId, companyName, loading: companyLoading } = useCompany();
  const { setHidden } = useTopBar();
  const { activePerson } = useShift();   // the PIN'd person on this shared tablet

  const [list, setList] = useState<any>(null);
  const [listReady, setListReady] = useState(false);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  // This launcher has its OWN blue hero header, so hide the global top bar while it's
  // shown (and restore it on navigate-away) — otherwise two blue headers stack with a
  // gap. The root's -mt-9 cancels the layout's reserved top-bar space so the hero sits
  // flush at the top.
  useEffect(() => { setHidden(true); return () => setHidden(false); }, [setHidden]);

  // Refetch when the PIN'd person changes: the hero mounts UNDER the sign-in
  // gate, so a fetch on mount alone always ran before anyone was signed in.
  useEffect(() => {
    fetch('/api/tasks/today')
      .then(r => r.json())
      .then(d => setList(d.list ?? null))
      .catch(() => setList(null))
      .finally(() => setListReady(true));
  }, [activePerson?.id]);

  useEffect(() => {
    if (companyLoading) return;          // company picker still resolving
    if (!companyId) { setRoster([]); return; } // no company → nothing to show (not a hang)
    fetch(`/api/station/roster?company_id=${companyId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setRoster(d?.roster ?? []))
      .catch(() => setRoster([]));
  }, [companyId, companyLoading]);

  // Whoever is here has already signed in at the PIN gate (StationGate), so
  // navigation is direct — their work is already credited to them.
  function goGuide() {
    try {
      sessionStorage.setItem('kw_recipes_reset', '1');
      sessionStorage.setItem('kw_guide_scope', 'cooking');
    } catch { /* storage disabled */ }
    router.push('/recipes');
  }

  const total = list?.line_count ?? 0;
  const done = list?.completed_count ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const upcoming: any[] = Array.isArray(list?.lines) ? list.lines.filter((l: any) => l.state !== 'done') : [];
  const allDone = total > 0 && done >= total;
  const TASK_PREVIEW = 6;

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dateStr = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]}`;

  return (
    <div className="min-h-screen bg-gray-50 pb-8 -mt-9">
      {/* Station header */}
      <div className="bg-[#2563EB] px-5 pt-8 pb-5 rounded-b-[28px]">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[var(--fs-xs)] font-bold text-white/60 tracking-widest uppercase">Kitchen Station</p>
            <h1 className="text-[var(--fs-xxl)] font-bold text-white leading-tight truncate">{companyName || greeting}</h1>
          </div>
          <div className="text-right flex-shrink-0 ml-3">
            <div className="text-[var(--fs-sm)] font-semibold text-white/90">{dateStr}</div>
            <div className="text-[var(--fs-xs)] text-white/60 font-mono">
              {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
            </div>
          </div>
        </div>
      </div>

      {/* Tasks — the hero of the station screen: shows the actual checklist. */}
      <div className="px-4 -mt-3">
        <div className="w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
          <button onClick={() => router.push('/tasks')} className="w-full flex items-center justify-between text-left active:opacity-70 mb-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-[26px] flex-shrink-0 ${allDone ? 'bg-green-100' : 'bg-[#F1F3F5]'}`} aria-hidden="true">
                {allDone ? '✅' : '📋'}
              </div>
              <div className="min-w-0">
                <div className="text-[var(--fs-xl)] font-bold text-gray-900 leading-tight">Today&rsquo;s Tasks</div>
                <div className="text-[var(--fs-xs)] text-gray-500">{total > 0 ? `${done} of ${total} done` : 'Department checklist'}</div>
              </div>
            </div>
            <span className="text-[var(--fs-sm)] font-bold text-[#2563EB] flex-shrink-0 ml-2">Open &rarr;</span>
          </button>

          {total > 0 && (
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-3">
              <div className="h-full bg-green-600 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          )}

          {!listReady ? (
            <div className="flex flex-col gap-2">{[0, 1, 2].map(i => <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />)}</div>
          ) : total === 0 ? (
            <div className="text-center py-6">
              <div className="text-[var(--fs-md)] font-semibold text-gray-600">No checklist for today yet</div>
              <div className="text-[var(--fs-xs)] text-gray-400 mt-1">It&rsquo;ll appear here once a manager publishes it.</div>
            </div>
          ) : allDone ? (
            <div className="text-center py-4 text-[var(--fs-md)] font-semibold text-green-700">All tasks done — nice work! 🎉</div>
          ) : (
            <div className="flex flex-col divide-y divide-gray-100">
              {upcoming.slice(0, TASK_PREVIEW).map((t: any) => (
                <button key={t.id} onClick={() => router.push('/tasks')} className="flex items-center gap-3 py-2.5 text-left active:opacity-70">
                  <span className="w-5 h-5 rounded-full border-2 border-gray-300 flex-shrink-0" />
                  <span className="text-[var(--fs-sm)] text-gray-800 truncate">{t.name}</span>
                </button>
              ))}
              {upcoming.length > TASK_PREVIEW && (
                <div className="pt-2 text-[var(--fs-xs)] font-semibold text-gray-400 pl-8">+{upcoming.length - TASK_PREVIEW} more</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tools — compact secondary launcher (the task list above is the focus). */}
      <div className="px-4 pt-5">
        <div className="text-[var(--fs-xs)] font-bold text-gray-400 tracking-widest uppercase mb-2 px-1">Tools</div>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          <StationTile label="Cooking Guide" onClick={goGuide} emoji="👨‍🍳" />
          <StationTile label="Inventory" onClick={() => router.push('/inventory')} emoji="📦" />
          <StationTile label="Purchase" onClick={() => router.push('/purchase')} emoji="🛒" />
          <StationTile label="Label Printer" onClick={() => router.push('/labels')} emoji="🏷️" />
          <StationTile label="Waste Tracker" onClick={() => router.push('/waste')} emoji="🗑️" />
        </div>
      </div>

      {/* Today's roster */}
      <div className="px-4 pt-5">
        <div className="flex items-center gap-2 mb-2 px-1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
          <span className="text-[var(--fs-xs)] font-bold text-gray-500 tracking-widest uppercase">On today</span>
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm px-3 py-1 divide-y divide-gray-100">
          {roster === null ? (
            <div className="py-4 text-center text-[var(--fs-xs)] text-gray-400">Loading…</div>
          ) : roster.length === 0 ? (
            <div className="py-4 text-center text-[var(--fs-sm)] text-gray-400">No one scheduled today</div>
          ) : (
            roster.map((r, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5">
                <div className="w-8 h-8 rounded-full bg-[#F1F3F5] flex items-center justify-center text-[12px] font-bold text-gray-600 flex-shrink-0">{initials(r.name)}</div>
                <div className="min-w-0 flex-1">
                  <div className="text-[var(--fs-sm)] font-semibold text-gray-900 truncate">{r.name}</div>
                  {r.role && <div className="text-[var(--fs-xs)] text-gray-500 truncate">{r.role}</div>}
                </div>
                <div className="text-[var(--fs-xs)] font-mono text-gray-500 tabular-nums flex-shrink-0">{r.start}–{r.end}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="text-center pt-6">
        <span className="text-[11px] text-gray-400 tracking-wider">
          <span className="text-green-600 font-semibold">KRAWINGS</span> · Shared Tablet
        </span>
      </div>
    </div>
  );
}

function StationTile({ label, emoji, onClick }: { label: string; emoji: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-gray-200 bg-white p-2 flex flex-col items-center justify-center text-center gap-1 min-h-[72px] active:scale-[0.97] transition-transform"
    >
      <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#F1F3F5] text-[20px]" aria-hidden="true">
        {emoji}
      </div>
      <div className="text-[var(--fs-xs)] font-bold text-gray-900 leading-tight">{label}</div>
    </button>
  );
}
