'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * Dashboard — canonical design system (colored semantic tiles, 2-col grid).
 * Active tiles link to modules; future tiles shown as disabled with "Coming soon" subtitle.
 */

interface Tile {
  id: string;
  label: string;
  subtitle: string;
  href: string | null;
  minRole: string;
  bg: string;
  border: string;
  iconBg: string;
  iconColor: string;
  icon: React.ReactNode;
}

const TILES: Tile[] = [
  {
    id: 'production', label: 'Manufacturing', subtitle: 'Prep & production orders', href: '/manufacturing', minRole: 'staff',
    bg: 'bg-orange-50', border: 'border-orange-200', iconBg: 'bg-orange-100', iconColor: 'text-orange-600',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20V8l5 4V8l5 4V4l10 8v8H2z"/></svg>,
  },
  {
    id: 'recipes', label: 'Chef Guide', subtitle: 'Cooking & production guides', href: '/recipes', minRole: 'staff',
    bg: 'bg-green-50', border: 'border-green-200', iconBg: 'bg-green-100', iconColor: 'text-green-600',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="13" y2="11"/></svg>,
  },
  {
    id: 'inventory', label: 'Inventory', subtitle: 'Stock counting & tracking', href: '/inventory', minRole: 'staff',
    bg: 'bg-blue-50', border: 'border-blue-200', iconBg: 'bg-purple-100', iconColor: 'text-blue-600',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>,
  },
  {
    id: 'purchase', label: 'Purchase', subtitle: 'Orders & suppliers', href: '/purchase', minRole: 'staff',
    bg: 'bg-blue-50', border: 'border-blue-200', iconBg: 'bg-blue-100', iconColor: 'text-blue-600',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>,
  },
  {
    id: 'hr', label: 'HR', subtitle: 'Profile & onboarding', href: '/hr', minRole: 'staff',
    bg: 'bg-rose-50', border: 'border-rose-200', iconBg: 'bg-rose-100', iconColor: 'text-rose-600',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  },
  {
    id: 'termination', label: 'Termination', subtitle: 'Letters & offboarding', href: '/hr/termination', minRole: 'admin',
    bg: 'bg-red-50', border: 'border-red-200', iconBg: 'bg-red-100', iconColor: 'text-red-600',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>,
  },
  {
    id: 'credentials', label: 'Supplier Logins', subtitle: 'Vendor credentials', href: '/admin/credentials', minRole: 'manager',
    bg: 'bg-violet-50', border: 'border-violet-200', iconBg: 'bg-violet-100', iconColor: 'text-violet-600',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>,
  },
  {
    id: 'shifts', label: 'Shift Schedule', subtitle: 'Coming soon', href: null, minRole: 'staff',
    bg: 'bg-amber-50', border: 'border-amber-200', iconBg: 'bg-amber-100', iconColor: 'text-amber-600',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  },
  {
    id: 'tasks', label: 'My Tasks', subtitle: 'Coming soon', href: null, minRole: 'staff',
    bg: 'bg-red-50', border: 'border-red-200', iconBg: 'bg-red-100', iconColor: 'text-red-600',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>,
  },
  {
    id: 'leave', label: 'Leave', subtitle: 'Coming soon', href: null, minRole: 'staff',
    bg: 'bg-teal-50', border: 'border-teal-200', iconBg: 'bg-teal-100', iconColor: 'text-teal-600',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>,
  },
  {
    id: 'payroll', label: 'Payroll', subtitle: 'Coming soon', href: null, minRole: 'staff',
    bg: 'bg-indigo-50', border: 'border-indigo-200', iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600',
    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  },
];

const ROLE_LEVEL: Record<string, number> = { staff: 1, manager: 2, admin: 3 };

const TASK_STATUS_STYLES: Record<string, { dot: string; pill: string; pillText: string }> = {
  overdue:  { dot: 'bg-red-500',   pill: 'bg-red-100',   pillText: 'text-red-800' },
  due_soon: { dot: 'bg-amber-500', pill: 'bg-amber-100', pillText: 'text-amber-800' },
  upcoming: { dot: 'bg-blue-500',  pill: 'bg-blue-100',  pillText: 'text-blue-800' },
  done:     { dot: 'bg-green-500', pill: 'bg-green-100', pillText: 'text-green-800' },
};

/* ------------------------------------------------------------------ */
/*  Sortable Tile Wrapper                                             */
/* ------------------------------------------------------------------ */
function SortableTile({
  tile, badges, isDragging, router,
}: {
  tile: Tile; badges: Record<string, number>; isDragging: boolean; router: ReturnType<typeof useRouter>;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: tile.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.9 : undefined,
  };
  const count = badges[tile.id] || 0;
  const disabled = !tile.href;

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <button
        onClick={() => {
          if (!tile.href) return;
          if (tile.href === '/recipes') sessionStorage.setItem('kw_recipes_reset', '1');
          router.push(tile.href);
        }}
        className={`relative rounded-2xl border p-4 flex flex-col items-center justify-center text-center aspect-square shadow-sm w-full active:scale-[0.97] transition-transform ${
          disabled
            ? 'bg-gray-50 border-gray-200 opacity-50'
            : `${tile.bg} ${tile.border}`
        }`}
      >
        {count > 0 && (
          <span className="absolute top-2 right-2 min-w-[22px] h-6 px-2 rounded-full bg-red-500 text-white text-[var(--fs-xs)] font-bold font-mono leading-6 text-center">{count}</span>
        )}
        <div className={`w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 mb-2 ${
          disabled ? 'bg-gray-100 text-gray-400' : `${tile.iconBg} ${tile.iconColor}`
        }`}>
          {tile.icon}
        </div>
        <div className="min-w-0">
          <div className="text-[var(--fs-md)] font-bold text-gray-900 leading-tight">{tile.label}</div>
          <div className="text-[var(--fs-xs)] text-gray-500 mt-1 leading-tight">{tile.subtitle}</div>
        </div>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Dashboard                                                    */
/* ------------------------------------------------------------------ */
export default function DashboardHome() {
  const router = useRouter();
  const [userName, setUserName] = useState<string>('');
  const [userRole, setUserRole] = useState<string>('staff');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [shift, setShift] = useState<any>(null);
  const [tasks, setTasks] = useState<any>(null);
  const [now, setNow] = useState(new Date());
  const [isCandidate, setIsCandidate] = useState(false);
  const [tileOrder, setTileOrder] = useState<string[] | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user) {
        setUserName(d.user.name);
        setUserRole(d.user.role);
        if (d.user.avatar) setAvatar(d.user.avatar);
        if (d.user.is_candidate) setIsCandidate(true);
        if (d.user.preferences?.dashboard_tile_order) {
          setTileOrder(d.user.preferences.dashboard_tile_order);
        }
      }
    }).catch(() => {});
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
    }
    load();
  }, []);

  const saveTileOrder = useCallback((order: string[]) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { dashboard_tile_order: order } }),
      }).catch(() => {});
    }, 500);
  }, []);

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dateStr = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

  const myLevel = ROLE_LEVEL[userRole] || 1;
  const filteredTiles = isCandidate
    ? TILES.filter(t => t.id === 'hr')
    : TILES.filter(t => myLevel >= (ROLE_LEVEL[t.minRole] || 1));

  // Apply saved order: reorder filtered tiles based on saved order, append any new tiles at the end
  const visibleTiles = tileOrder
    ? [
        ...tileOrder.filter(id => filteredTiles.some(t => t.id === id)).map(id => filteredTiles.find(t => t.id === id)!),
        ...filteredTiles.filter(t => !tileOrder.includes(t.id)),
      ]
    : filteredTiles;

  function handleDragEnd(event: DragEndEvent) {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = visibleTiles.findIndex(t => t.id === active.id);
    const newIndex = visibleTiles.findIndex(t => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(visibleTiles, oldIndex, newIndex);
    const newOrder = reordered.map(t => t.id);
    setTileOrder(newOrder);
    saveTileOrder(newOrder);
  }

  const tasksDone = tasks?.done || 0;
  const tasksTotal = tasks?.total || 0;
  const progressPct = tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : 0;
  const firstName = userName ? userName.split(' ')[0] : '';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#2563EB] px-5 pt-12 pb-3 rounded-b-[28px] relative overflow-hidden">
        <div className="absolute -top-10 -right-5 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
        <div className="relative flex items-center gap-3">
          <button onClick={() => router.push('/hr')} className="flex-shrink-0 active:scale-95 transition-transform">
            {avatar ? (
              <img src={`data:image/png;base64,${avatar}`} alt="" className="w-12 h-12 rounded-full object-cover border-2 border-white/20" />
            ) : firstName ? (
              <div className="w-12 h-12 rounded-full bg-green-600 flex items-center justify-center border-2 border-white/20">
                <span className="text-white text-[16px] font-bold">{firstName[0]}</span>
              </div>
            ) : null}
          </button>
          <div>
            <h1 className="text-[var(--fs-xxl)] font-bold text-white">
              {greeting}{firstName ? `, ${firstName}` : ''}
            </h1>
            <p className="text-[var(--fs-xs)] text-white/60 mt-0.5">{dateStr}</p>
          </div>
        </div>
        {shift && (
          <div className={`mt-3 flex items-center gap-3 px-4 py-3 rounded-xl relative ${shift.onShift ? 'bg-white/10 border border-white/20' : 'bg-white/5 border border-white/10'}`}>
            <div className={`w-2.5 h-2.5 rounded-full ${shift.onShift ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.5)] animate-pulse' : 'bg-gray-400'}`} />
            <div>
              <div className={`text-[var(--fs-xs)] font-semibold ${shift.onShift ? 'text-white' : 'text-white/50'}`}>
                {shift.onShift ? `${shift.name} \u00b7 ${shift.station}` : 'No shift right now'}
              </div>
              <div className="text-[var(--fs-xs)] text-white/50 font-mono">
                {shift.onShift ? `${shift.start} \u2013 ${shift.end}` : 'Check your schedule'}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Shift tasks */}
      {tasks && tasks.items && tasks.items.length > 0 && (
        <div className="px-5 pt-4">
          <div className="flex items-center justify-between mb-2.5">
            <h2 className="text-[var(--fs-md)] font-bold text-gray-900">Your current shift tasks</h2>
            <span className="text-[var(--fs-xs)] font-semibold text-gray-400">See all &rarr;</span>
          </div>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="flex-1 h-1 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-green-600 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
            <span className="text-[11px] font-semibold text-gray-400 font-mono">{tasksDone} / {tasksTotal}</span>
          </div>
          <div className="flex flex-col gap-2 mb-2">
            {tasks.items.map((task: any) => {
              const s = TASK_STATUS_STYLES[task.status] || TASK_STATUS_STYLES.upcoming;
              const isDone = task.status === 'done';
              return (
                <div key={task.id}
                  className={`flex items-center gap-3 px-3.5 py-3 bg-white border border-gray-200 rounded-xl shadow-sm ${isDone ? 'opacity-50' : ''} active:scale-[0.98] transition-transform`}>
                  {!isDone && <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />}
                  {isDone && (
                    <div className="w-5 h-5 rounded-md bg-green-500 flex-shrink-0 flex items-center justify-center">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className={`text-[var(--fs-sm)] font-bold ${isDone ? 'line-through text-gray-400' : 'text-gray-900'}`}>{task.name}</div>
                    <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{task.category}{task.photoRequired ? ' \u00b7 Photo required' : ''}</div>
                  </div>
                  <div className={`flex-shrink-0 px-2 py-0.5 rounded-md text-[12px] font-bold font-mono ${s.pill} ${s.pillText}`}>{task.dueLabel}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* App tiles */}
      <div className="px-5 pt-3">
        <p className="text-[var(--fs-xs)] font-bold text-gray-400 tracking-widest uppercase mb-3">Apps</p>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setActiveDragId(e.active.id as string)}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDragId(null)}
        >
          <SortableContext items={visibleTiles.map(t => t.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-2 gap-3">
              {visibleTiles.map(tile => (
                <SortableTile
                  key={tile.id}
                  tile={tile}
                  badges={badges}
                  isDragging={activeDragId === tile.id}
                  router={router}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className="text-center py-6">
        <span className="text-[11px] text-gray-400 tracking-wider">
          <span className="text-green-600 font-semibold">KRAWINGS</span> SSAM &middot; Staff Portal
        </span>
      </div>
    </div>
  );
}
