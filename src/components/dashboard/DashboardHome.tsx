'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Dashboard tiles — all use same gray bg + blue icons.
 * Only badge color carries semantic meaning.
 * See DESIGN_GUIDE.md for rules.
 */
const TILES = [
  {
    id: 'production', label: 'Manufacturing', href: '/manufacturing',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20V8l5 4V8l5 4V4l10 8v8H2z"/></svg>,
  },
  {
    id: 'shifts', label: 'Shift Schedule', href: null,
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  },
  {
    id: 'tasks', label: 'My Tasks', href: null,
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>,
  },
  {
    id: 'inventory', label: 'Inventory', href: '/inventory',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>,
  },
  {
    id: 'repair', label: 'Report Repair', href: null,
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>,
  },
  {
    id: 'purchase', label: 'Purchase', href: '/purchase',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>,
  },
  {
    id: 'leave', label: 'Leave', href: null,
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>,
  },
  {
    id: 'payroll', label: 'Payroll', href: null,
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  },
  {
    id: 'contacts', label: 'Staff', href: '/admin/users',
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>,
  },
  {
    id: 'profile', label: 'Profile', href: null,
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  },
  {
    id: 'settings', label: 'Settings', href: null,
    isGray: true,
    icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
  },
];

const TASK_STATUS_STYLES: Record<string, { dot: string; pill: string; pillText: string }> = {
  overdue:  { dot: 'bg-red-500',   pill: 'bg-red-100',   pillText: 'text-red-800' },
  due_soon: { dot: 'bg-amber-500', pill: 'bg-amber-100', pillText: 'text-amber-800' },
  upcoming: { dot: 'bg-blue-500',  pill: 'bg-blue-100',  pillText: 'text-blue-800' },
  done:     { dot: 'bg-green-500', pill: 'bg-green-100', pillText: 'text-green-800' },
};

function getBadgeColor(tileId: string, count: number): string {
  if (count === 0) return '';
  if (tileId === 'tasks') return 'bg-red-500';
  if (tileId === 'repair') return 'bg-red-500';
  if (tileId === 'contacts') return 'bg-red-500';
  if (tileId === 'leave') return 'bg-green-500';
  return 'bg-blue-500';
}

export default function DashboardHome() {
  const router = useRouter();
  const [userName, setUserName] = useState<string>('');
  const [userRole, setUserRole] = useState<string>('staff');
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [shift, setShift] = useState<any>(null);
  const [tasks, setTasks] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [comingSoon, setComingSoon] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user) { setUserName(d.user.name); setUserRole(d.user.role); } }).catch(() => {});
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/dashboard');
        const data = await res.json();
        if (data.badges) setBadges(data.badges);
        if (data.shift) setShift(data.shift);
        if (data.tasks) setTasks(data.tasks);
      } catch (e) { console.error('Dashboard fetch failed:', e); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dateStr = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

  async function handleLogout() {
    setLoggingOut(true);
    try { await fetch('/api/auth/logout', { method: 'POST' }); router.push('/login'); router.refresh(); }
    catch { setLoggingOut(false); }
  }

  function handleTileTap(tile: any) {
    if (tile.href) { router.push(tile.href); }
    else { setComingSoon(tile.label); setTimeout(() => setComingSoon(null), 2000); }
  }

  void userRole;
  const tasksDone = tasks?.done || 0;
  const tasksTotal = tasks?.total || 0;
  const progressPct = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : 0;
  const firstName = userName ? userName.split(' ')[0] : '';

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <div className="bg-[#1A1F2E] px-6 pt-14 pb-6 rounded-b-[28px] relative overflow-hidden">
        <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
        <div className="flex items-start justify-between relative">
          <div>
            <h1 className="text-[22px] font-bold text-white">
              {greeting}{firstName ? `, ${firstName}` : ''}
            </h1>
            <p className="text-[13px] text-white/50 mt-0.5">{dateStr}</p>
          </div>
          <button onClick={handleLogout} disabled={loggingOut}
            className="mt-1 w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors" title="Sign out">
            {loggingOut ? (
              <div className="w-4 h-4 border-2 border-white/50 border-t-white rounded-full animate-spin" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            )}
          </button>
        </div>
        {shift && (
          <div className={`mt-3 flex items-center gap-3 px-4 py-3 rounded-xl relative ${shift.onShift ? 'bg-orange-500/10 border border-orange-500/20' : 'bg-white/5 border border-white/10'}`}>
            <div className={`w-2.5 h-2.5 rounded-full ${shift.onShift ? 'bg-orange-500 shadow-[0_0_8px_rgba(245,128,10,0.5)] animate-pulse' : 'bg-gray-500'}`} />
            <div>
              <div className={`text-[13px] font-semibold ${shift.onShift ? 'text-white' : 'text-white/50'}`}>
                {shift.onShift ? `${shift.name} \u00b7 ${shift.station}` : 'No shift right now'}
              </div>
              <div className="text-[12px] text-white/50 font-mono">
                {shift.onShift ? `${shift.start} \u2013 ${shift.end}` : 'Check your schedule'}
              </div>
            </div>
          </div>
        )}
        {!shift && !loading && (
          <div className="mt-3 flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10">
            <div className="w-2.5 h-2.5 rounded-full bg-gray-500" />
            <div className="text-[13px] text-white/50">Loading shift info...</div>
          </div>
        )}
      </div>

      {tasks && tasks.items && tasks.items.length > 0 && (
        <div className="px-5 pt-4">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[15px] font-bold text-[#1F2933]">Shift tasks</h2>
            <button onClick={() => handleTileTap(TILES.find(t => t.id === 'tasks')!)}
              className="text-[12px] font-semibold text-orange-600 active:opacity-70">See all &rarr;</button>
          </div>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-orange-500 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="text-[11px] font-semibold text-gray-400 font-mono">{tasksDone} / {tasksTotal}</span>
          </div>
          <div className="flex flex-col gap-2 mb-2">
            {tasks.items.map((task: any) => {
              const s = TASK_STATUS_STYLES[task.status] || TASK_STATUS_STYLES.upcoming;
              const isDone = task.status === 'done';
              return (
                <div key={task.id}
                  className={`flex items-center gap-3 px-3.5 py-3 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] ${isDone ? 'opacity-50' : ''} active:scale-[0.98] transition-transform`}>
                  {!isDone && <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />}
                  {isDone && (
                    <div className="w-5 h-5 rounded-md bg-green-500 flex-shrink-0 flex items-center justify-center">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`text-[13px] font-semibold ${isDone ? 'line-through text-gray-400' : 'text-[#1F2933]'}`}>{task.name}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{task.category}{task.photoRequired ? ' \u00b7 Photo required' : ''}</div>
                  </div>
                  <div className={`flex-shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold font-mono ${s.pill} ${s.pillText}`}>{task.dueLabel}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {comingSoon && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-3 bg-gray-900 text-white text-[13px] font-semibold rounded-xl shadow-lg animate-bounce">
          {comingSoon} &mdash; coming soon
        </div>
      )}

      <div className="px-5 pt-3">
        <p className="text-[11px] font-semibold text-gray-400 tracking-widest uppercase mb-2">Apps</p>
        <div className="grid grid-cols-3 gap-3">
          {TILES.map((tile: any) => {
            const count = badges[tile.id] || 0;
            const badgeColor = getBadgeColor(tile.id, count);
            const isGray = tile.isGray;
            return (
              <button key={tile.id} onClick={() => handleTileTap(tile)}
                className="aspect-square rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] flex flex-col items-center justify-center gap-2 relative active:scale-95 transition-transform">
                {count > 0 && (
                  <span className={`absolute top-2 right-2 min-w-[20px] h-5 px-1.5 rounded-full text-white text-[11px] font-bold font-mono leading-5 text-center ${badgeColor}`}>{count}</span>
                )}
                <div className={`w-12 h-12 rounded-[14px] flex items-center justify-center bg-[#F1F3F5] ${isGray ? 'text-gray-500' : 'text-blue-600'}`}>{tile.icon}</div>
                <span className="text-[12px] font-semibold text-[#1F2933] text-center px-1 leading-tight">{tile.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="text-center py-6">
        <span className="text-[11px] text-gray-400 tracking-wider">
          <span className="text-orange-500 font-semibold">KRAWINGS</span> SSAM &middot; Staff Portal
        </span>
      </div>
    </div>
  );
}
