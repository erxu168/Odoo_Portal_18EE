'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCompany } from '@/lib/company-context';
import { useTopBar } from '@/components/ui/TopBarContext';

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

  useEffect(() => {
    fetch('/api/tasks/today')
      .then(r => r.json())
      .then(d => setList(d.list ?? null))
      .catch(() => setList(null))
      .finally(() => setListReady(true));
  }, []);

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
  const nextTask = Array.isArray(list?.lines) ? list.lines.find((l: any) => l.state !== 'done') : null;
  const allDone = total > 0 && done >= total;

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

      {/* Tasks hero */}
      <div className="px-4 -mt-3">
        <button
          onClick={() => router.push('/tasks')}
          className="w-full text-left bg-white border border-gray-200 rounded-2xl shadow-sm p-5 active:scale-[0.99] transition-transform"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center text-2xl ${allDone ? 'bg-green-100' : 'bg-[#F1F3F5]'}`} aria-hidden="true">
                {allDone ? '✅' : '📋'}
              </div>
              <div>
                <div className="text-[var(--fs-lg)] font-bold text-gray-900 leading-tight">Today&rsquo;s Tasks</div>
                <div className="text-[var(--fs-xs)] text-gray-500">Department checklist</div>
              </div>
            </div>
            <span className="text-[var(--fs-xs)] font-bold text-[#2563EB]">Open &rarr;</span>
          </div>

          {!listReady ? (
            <div className="h-2 bg-gray-100 rounded-full animate-pulse" />
          ) : total === 0 ? (
            <div className="text-[var(--fs-sm)] text-gray-500 py-1">No checklist for today yet.</div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-2.5">
                <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-green-600 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[13px] font-bold text-gray-500 font-mono tabular-nums">{done} / {total}</span>
              </div>
              {allDone ? (
                <div className="text-[var(--fs-sm)] font-semibold text-green-700">All tasks done — nice work! 🎉</div>
              ) : (
                <div className="text-[var(--fs-sm)] text-gray-700">
                  <span className="text-gray-400 font-semibold">Next:</span>{' '}
                  <span className="font-semibold text-gray-900">{nextTask?.name || '—'}</span>
                </div>
              )}
            </>
          )}
        </button>
      </div>

      {/* Tool tiles */}
      <div className="px-4 pt-4 grid grid-cols-3 gap-3">
        <StationTile label="Cooking Guide" onClick={goGuide} emoji="👨‍🍳" />
        <StationTile label="Inventory" onClick={() => router.push('/inventory')} emoji="📦" />
        <StationTile label="Purchase" onClick={() => router.push('/purchase')} emoji="🛒" />
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
      className="rounded-2xl border border-gray-200 bg-white p-3 flex flex-col items-center justify-center text-center aspect-square active:scale-[0.97] transition-transform"
    >
      <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-2 bg-[#F1F3F5] text-[26px]" aria-hidden="true">
        {emoji}
      </div>
      <div className="text-[var(--fs-sm)] font-bold text-gray-900 leading-tight">{label}</div>
    </button>
  );
}
