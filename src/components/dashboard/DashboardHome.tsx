'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ActionGrid, ActionCard } from '@/components/ui/ActionCard';
import CookPlanModal, { type CookPlanItem } from '@/components/prep-planner/CookPlanModal';
import { DEFAULT_COMPANY_ID } from '@/components/prep-planner/companies';
import { GOVERNED_MODULE_IDS } from '@/lib/modules';

function berlinToday(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 10);
}

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
  emoji: string;
  scope?: 'cooking' | 'production';
}

const TILES: Tile[] = [
  { id: 'production', label: 'Manufacturing', subtitle: 'Prep & production orders', href: '/manufacturing', minRole: 'staff', emoji: '🏭' },
  { id: 'recipes', label: 'Chef Guide', subtitle: 'Cooking guides', href: '/recipes', minRole: 'staff', scope: 'cooking', emoji: '👨‍🍳' },
  { id: 'production-guide', label: 'Production Guide', subtitle: 'Sauces, prep & batches', href: '/recipes', minRole: 'manager', scope: 'production', emoji: '🥫' },
  { id: 'inventory', label: 'Inventory', subtitle: 'Stock counting & tracking', href: '/inventory', minRole: 'staff', emoji: '📦' },
  { id: 'products', label: 'Products', subtitle: 'Catalog, units & photos', href: '/products', minRole: 'manager', emoji: '🏷️' },
  { id: 'purchase', label: 'Purchase', subtitle: 'Orders & suppliers', href: '/purchase', minRole: 'staff', emoji: '🛒' },
  { id: 'hr', label: 'HR', subtitle: 'Profile & onboarding', href: '/hr', minRole: 'staff', emoji: '👤' },
  { id: 'credentials', label: 'Supplier Logins', subtitle: 'Vendor credentials', href: '/admin/credentials', minRole: 'manager', emoji: '🔑' },
  { id: 'tablets', label: 'Shared Tablets', subtitle: 'Kitchen tablet access', href: '/admin/tablets', minRole: 'manager', emoji: '📱' },
  { id: 'rentals', label: 'Rentals', subtitle: 'Properties & tenancies', href: '/rentals', minRole: 'admin', emoji: '🏠' },
  { id: 'prep-planner', label: 'Prep Planner', subtitle: 'Demand forecasts & prep targets', href: '/prep-planner', minRole: 'manager', emoji: '📊' },
  { id: 'cooktimer', label: 'Cooking Timer', subtitle: 'Stations & cook profiles', href: '/cooktimer-setup', minRole: 'manager', emoji: '🍳' },
  { id: 'sales', label: 'Sales', subtitle: 'What a Jerk revenue & top sellers', href: '/sales', minRole: 'manager', emoji: '📈' },
  { id: 'shifts', label: 'Planning', subtitle: 'Shifts, claims & covers', href: '/shifts', minRole: 'staff', emoji: '📅' },
  { id: 'tasks', label: 'My Tasks', subtitle: 'Daily department checklist', href: '/tasks', minRole: 'staff', emoji: '✅' },
  { id: 'leave', label: 'Leave', subtitle: 'Coming soon', href: null, minRole: 'staff', emoji: '🌴' },
  { id: 'payroll', label: 'Payroll', subtitle: 'Coming soon', href: null, minRole: 'staff', emoji: '💳' },
];

const ROLE_LEVEL: Record<string, number> = { staff: 1, manager: 2, admin: 3 };

const TASK_STATUS_STYLES: Record<string, { dot: string; pill: string; pillText: string }> = {
  overdue:  { dot: 'bg-red-500',   pill: 'bg-red-100',   pillText: 'text-red-800' },
  due_soon: { dot: 'bg-amber-500', pill: 'bg-amber-100', pillText: 'text-amber-800' },
  upcoming: { dot: 'bg-blue-500',  pill: 'bg-blue-100',  pillText: 'text-blue-800' },
  done:     { dot: 'bg-green-500', pill: 'bg-green-100', pillText: 'text-green-800' },
};

export default function DashboardHome() {
  const router = useRouter();
  const [userName, setUserName] = useState<string>('');
  const [userRole, setUserRole] = useState<string>('staff');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [badges, setBadges] = useState<Record<string, number>>({});
  const [shift, setShift] = useState<any>(null);
  const [tasks, setTasks] = useState<any>(null);
  const [now, setNow] = useState(new Date());
  const [isCandidate, setIsCandidate] = useState(false);
  const [allowedModules, setAllowedModules] = useState<string[] | null>(null);
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);
  const [cookPlanItems, setCookPlanItems] = useState<CookPlanItem[] | null>(null);
  const [cookPlanOpen, setCookPlanOpen] = useState(false);
  const cookPlanDate = berlinToday();
  const cookPlanCompanyId = DEFAULT_COMPANY_ID;

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user) {
        setUserName(d.user.name);
        setUserRole(d.user.role);
        if (Array.isArray(d.user.modules)) setAllowedModules(d.user.modules);
        if (d.user.avatar) setAvatar(d.user.avatar);
        if (d.user.is_candidate) setIsCandidate(true);
        if (d.user.preferences?.dashboard_tile_order) {
          setSavedOrder(d.user.preferences.dashboard_tile_order);
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

  const loadCookPlan = useCallback(async () => {
    try {
      const res = await fetch(`/api/prep-planner/cook-plan?companyId=${cookPlanCompanyId}&date=${cookPlanDate}`);
      if (!res.ok) { setCookPlanItems([]); return; }
      const data = await res.json();
      setCookPlanItems(data.items || []);
      return data.items as CookPlanItem[];
    } catch {
      setCookPlanItems([]);
    }
  }, [cookPlanCompanyId, cookPlanDate]);

  // Fetch cook plan after we know the role
  useEffect(() => {
    if (!userRole) return;
    if (isCandidate) return;
    loadCookPlan().then(items => {
      if (!items || items.length === 0) return;
      const pending = items.filter(i => !i.my_ack).length;
      // Auto-open for staff once per day (dismissable, sessionStorage-gated)
      if (userRole === 'staff' && pending > 0) {
        const seenKey = `cook_plan_seen_${cookPlanDate}`;
        try {
          if (!sessionStorage.getItem(seenKey)) {
            setCookPlanOpen(true);
          }
        } catch { /* storage disabled, skip auto-open */ }
      }
    });
  }, [userRole, isCandidate, loadCookPlan, cookPlanDate]);

  function closeCookPlan() {
    setCookPlanOpen(false);
    try { sessionStorage.setItem(`cook_plan_seen_${cookPlanDate}`, '1'); } catch { /* ignore */ }
  }

  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dateStr = `${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

  const myLevel = ROLE_LEVEL[userRole] || 1;
  const visibleTiles = isCandidate
    ? TILES.filter(t => t.id === 'hr')
    : TILES.filter(t => {
        // Placeholder tiles (not governed by access control) always show.
        if (!GOVERNED_MODULE_IDS.has(t.id)) return true;
        // Until access loads, fall back to role default; then use the admin-set list.
        if (allowedModules == null) return myLevel >= (ROLE_LEVEL[t.minRole] || 1);
        return allowedModules.includes(t.id);
      });

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
            {avatar && !avatarBroken ? (
              <img src={`data:image/png;base64,${avatar}`} alt="" onError={() => setAvatarBroken(true)} className="w-12 h-12 rounded-full object-cover border-2 border-white/20" />
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

      {/* Today's prep callout */}
      {cookPlanItems && cookPlanItems.length > 0 && (() => {
        const pending = cookPlanItems.filter(i => !i.my_ack).length;
        const total = cookPlanItems.length;
        const allDone = pending === 0;
        const totalQty = cookPlanItems.reduce((s, i) => s + (i.my_ack?.planned_qty ?? i.forecast_qty), 0);
        return (
          <div className="px-5 pt-4">
            <button
              onClick={() => setCookPlanOpen(true)}
              className={`w-full rounded-2xl border p-4 flex items-center gap-3 text-left active:scale-[0.98] transition-transform ${
                allDone ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'
              }`}
            >
              <div className="w-11 h-11 rounded-xl bg-[#F1F3F5] flex items-center justify-center flex-shrink-0 text-2xl" aria-hidden="true">🍳</div>
              <div className="flex-1 min-w-0">
                <div className="text-[var(--fs-md)] font-bold text-gray-900">Today&rsquo;s prep</div>
                <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">
                  {allDone
                    ? `${total} item${total === 1 ? '' : 's'} · ${Math.round(totalQty)} portions planned`
                    : `${pending} of ${total} pending · ${Math.round(totalQty)} portions`}
                </div>
              </div>
              {!allDone && (
                <span className="min-w-[22px] h-6 px-2 rounded-full bg-green-600 text-white text-[var(--fs-xs)] font-bold font-mono leading-6 text-center">
                  {pending}
                </span>
              )}
              {allDone && (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
              )}
            </button>
          </div>
        );
      })()}

      {/* App tiles */}
      <div className="px-5 pt-3">
        <p className="text-[var(--fs-xs)] font-bold text-gray-400 tracking-widest uppercase mb-3">Apps</p>
        <ActionGrid
          items={visibleTiles}
          getItemId={(t) => t.id}
          sortable={{ storageKey: 'dashboard_tile_order', savedOrder }}
          renderItem={(tile) => {
            const count = badges[tile.id] || 0;
            const disabled = !tile.href;
            return (
              <ActionCard
                emoji={tile.emoji}
                label={tile.label}
                subtitle={tile.subtitle}
                disabled={disabled}
                badge={count > 0 ? { value: count, ariaLabel: `${count} waiting` } : undefined}
                onClick={() => {
                  if (!tile.href) return;
                  if (tile.href === '/recipes') {
                    sessionStorage.setItem('kw_recipes_reset', '1');
                    sessionStorage.setItem('kw_guide_scope', tile.scope || 'cooking');
                  }
                  router.push(tile.href);
                }}
              />
            );
          }}
        />
      </div>

      <div className="text-center py-6">
        <span className="text-[11px] text-gray-400 tracking-wider">
          <span className="text-green-600 font-semibold">KRAWINGS</span> SSAM &middot; Staff Portal
        </span>
      </div>

      {cookPlanOpen && cookPlanItems && (
        <CookPlanModal
          date={cookPlanDate}
          companyId={cookPlanCompanyId}
          items={cookPlanItems}
          onClose={closeCookPlan}
          onAckChange={loadCookPlan}
        />
      )}
    </div>
  );
}
