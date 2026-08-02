'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { defaultModuleIds, NAV_MODULES } from '@/lib/modules';

interface AppDrawerProps {
  open: boolean;
  onClose: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  staff: 'Staff',
  manager: 'Manager',
  admin: 'Admin',
};

// Per-module nav icons. The nav LIST itself comes from the shared registry
// (NAV_MODULES) so it can never drift from the dashboard; this map only supplies
// each item's line-icon. A module with no icon here still appears — it just falls
// back to the generic grid icon.
const ic = (paths: React.ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths}</svg>
);
const NAV_ICONS: Record<string, React.ReactNode> = {
  'shift-handover': ic(<><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></>),
  production: ic(<path d="M2 20V8l5 4V8l5 4V4l10 8v8H2z"/>),
  recipes: ic(<><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="13" y2="11"/></>),
  'production-guide': ic(<path d="M2 20V8l5 4V8l5 4V4l10 8v8H2z"/>),
  inventory: ic(<><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>),
  labels: ic(<><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></>),
  waste: ic(<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></>),
  products: ic(<><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></>),
  purchase: ic(<><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></>),
  shifts: ic(<><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>),
  tasks: ic(<><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></>),
  'prep-planner': ic(<><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>),
  cooktimer: ic(<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>),
  sales: ic(<><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>),
  hr: ic(<><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>),
  rentals: ic(<><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/></>),
};
const DEFAULT_NAV_ICON = ic(<><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></>);

export default function AppDrawer({ open, onClose }: AppDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<{ name: string; email: string; role: string; avatar?: string | null; is_candidate?: boolean; modules?: string[] } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (open && !user) {
      fetch('/api/auth/me')
        .then((r) => r.json())
        .then((d) => { if (d.user) setUser(d.user); })
        .catch(() => {});
    }
  }, [open, user]);

  function navigate(href: string, scope: 'cooking' | 'production' = 'cooking') {
    onClose();
    if (href === '/recipes') {
      sessionStorage.setItem('kw_recipes_reset', '1');
      sessionStorage.setItem('kw_guide_scope', scope);
    }
    router.push(href);
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      // Cached floor plans are per-user company data on possibly-shared
      // devices — drop them before the session ends (best effort).
      try {
        const me = await fetch('/api/auth/me').then(r => r.json()).catch(() => null);
        if (me?.user?.id) {
          const { clearFloorplanCache } = await import('@/lib/inventory-floorplan/offline');
          await clearFloorplanCache(me.user.id);
        }
      } catch { /* never block logout */ }
      await fetch('/api/auth/logout', { method: 'POST' });
      onClose();
      router.push('/login');
      router.refresh();
    } catch {
      setLoggingOut(false);
    }
  }

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
    : '';
  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';
  const isCandidate = user?.is_candidate === true;
  // Per-user module access (admin-configurable). While it loads (or if the
  // fetch fails) fall back to the ROLE DEFAULT — never "show everything", or a
  // manager-only module (e.g. Products) would flash for staff. Matches the
  // Home dashboard's tile-gating rule.
  const effModules = user?.modules ?? (user?.role ? defaultModuleIds(user.role) : []);
  const canSee = (id: string) => effModules.includes(id);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[60] bg-black/40 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        className={`fixed top-0 left-0 bottom-0 z-[61] w-[280px] max-w-[85vw] bg-white flex flex-col transition-transform duration-300 ease-out ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* User header */}
        <div className="bg-[#2563EB] px-5 pt-12 pb-3">
          <div className="flex items-center gap-3">
            <button onClick={() => { onClose(); router.push('/hr'); }} className="flex-shrink-0 active:scale-95 transition-transform">
              {user?.avatar ? (
                <img src={`data:image/png;base64,${user.avatar}`} alt="" className="w-11 h-11 rounded-full object-cover border-2 border-white/20" />
              ) : (
                <div className="w-11 h-11 rounded-full bg-green-600 flex items-center justify-center">
                  <span className="text-white text-[14px] font-bold">{initials}</span>
                </div>
              )}
            </button>
            <div className="min-w-0">
              <div className="text-[var(--fs-md)] font-bold text-white truncate">{user?.name || 'Loading...'}</div>
              <div className="text-[var(--fs-xs)] text-white/50 truncate">{user?.email || ''}</div>
              {user?.role && (
                <span className="inline-block mt-1 text-[12px] font-semibold text-green-400 bg-green-400/10 px-2.5 py-0.5 rounded-full">
                  {ROLE_LABELS[user.role] || user.role}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Navigation links */}
        <nav className="flex-1 overflow-y-auto py-2">
          {/* Main nav */}
          <div className="px-3 py-1">
            <p className="px-3 py-2 text-[12px] font-bold text-gray-400 tracking-widest uppercase">Navigate</p>
            <NavItem label="Home" href="/" current={pathname} onClick={navigate}
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>} />
            {/* Module links come from the shared registry (NAV_MODULES) so this can
                never drift from the dashboard. HR is rendered below, always. */}
            {!isCandidate && NAV_MODULES
              .filter((m) => m.id !== 'hr' && canSee(m.id))
              .map((m) => (
                <NavItem key={m.id} label={m.label} href={m.href as string} current={pathname}
                  onClick={m.scope === 'production' ? () => navigate('/recipes', 'production') : navigate}
                  icon={NAV_ICONS[m.id] ?? DEFAULT_NAV_ICON} />
              ))}
            <NavItem label="HR" href="/hr" current={pathname} onClick={navigate}
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>} />
          </div>

          {/* Admin section */}
          {isManager && !isCandidate && (
            <div className="px-3 py-1">
              <div className="mx-3 border-t border-gray-100 my-1" />
              <p className="px-3 py-2 text-[12px] font-bold text-gray-400 tracking-widest uppercase">Admin</p>
              {isAdmin && (
                <>
                  <NavItem label="Admin home" href="/admin" current={pathname} onClick={navigate}
                    icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>} />
                  <NavItem label="Access rules" href="/admin/permissions" current={pathname} onClick={navigate}
                    icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>} />
                  <NavItem label="Termination" href="/hr/termination" current={pathname} onClick={navigate}
                    icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg>} />
                </>
              )}
              <NavItem label="Supplier Logins" href="/admin/credentials" current={pathname} onClick={navigate}
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>} />
              <NavItem label="Shared Tablets" href="/admin/tablets" current={pathname} onClick={navigate}
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="10" y1="18" x2="14" y2="18"/></svg>} />
              <NavItem label="Settings" href="/admin/settings" current={pathname} onClick={navigate}
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>} />
            </div>
          )}

          {/* Account section */}
          <div className="px-3 py-1">
            <div className="mx-3 border-t border-gray-100 my-1" />
            <p className="px-3 py-2 text-[12px] font-bold text-gray-400 tracking-widest uppercase">Account</p>
            <NavItem label="Change Password" href="/change-password" current={pathname} onClick={navigate}
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>} />
            <button onClick={handleLogout} disabled={loggingOut}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-red-600 active:bg-red-50 transition-colors">
              {loggingOut ? (
                <div className="w-5 h-5 border-2 border-red-300 border-t-red-600 rounded-full animate-spin" />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
              )}
              <span className="text-[var(--fs-sm)] font-bold">Log Out</span>
            </button>
          </div>
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100">
          <span className="text-[11px] text-gray-400 tracking-wider">
            <span className="text-green-600 font-semibold">KRAWINGS</span> Staff Portal
          </span>
        </div>
      </div>
    </>
  );
}

function NavItem({ label, href, icon, current, onClick }: {
  label: string;
  href: string;
  icon: React.ReactNode;
  current: string;
  onClick: (href: string) => void;
}) {
  const active = href === '/' ? current === '/' : current.startsWith(href);
  return (
    <button onClick={() => onClick(href)}
      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${
        active
          ? 'bg-green-50 text-green-700'
          : 'text-gray-700 active:bg-gray-50'
      }`}>
      <span className={active ? 'text-green-600' : 'text-gray-400'}>{icon}</span>
      <span className={`text-[var(--fs-sm)] font-bold ${active ? 'text-green-700' : ''}`}>{label}</span>
    </button>
  );
}
