'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface AppDrawerProps {
  open: boolean;
  onClose: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  staff: 'Staff',
  manager: 'Manager',
  admin: 'Admin',
};

export default function AppDrawer({ open, onClose }: AppDrawerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<{ name: string; email: string; role: string } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (open && !user) {
      fetch('/api/auth/me')
        .then((r) => r.json())
        .then((d) => { if (d.user) setUser(d.user); })
        .catch(() => {});
    }
  }, [open, user]);

  function navigate(href: string) {
    onClose();
    router.push(href);
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
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
        <div className="bg-[#2563EB] px-5 pt-14 pb-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-green-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[14px] font-bold">{initials}</span>
            </div>
            <div className="min-w-0">
              <div className="text-[15px] font-bold text-white truncate">{user?.name || 'Loading...'}</div>
              <div className="text-[12px] text-white/50 truncate">{user?.email || ''}</div>
              {user?.role && (
                <span className="inline-block mt-1 text-[10px] font-semibold text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
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
            <p className="px-3 py-2 text-[10px] font-bold text-gray-400 tracking-widest uppercase">Navigate</p>
            <NavItem label="Home" href="/" current={pathname} onClick={navigate}
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>} />
            <NavItem label="Manufacturing" href="/manufacturing" current={pathname} onClick={navigate}
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 20V8l5 4V8l5 4V4l10 8v8H2z"/></svg>} />
            <NavItem label="Purchase" href="/purchase" current={pathname} onClick={navigate}
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/></svg>} />
            <NavItem label="Inventory" href="/inventory" current={pathname} onClick={navigate}
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>} />
            <NavItem label="HR & Onboarding" href="/hr" current={pathname} onClick={navigate}
              icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg>} />
          </div>

          {/* Admin section */}
          {isManager && (
            <div className="px-3 py-1">
              <div className="mx-3 border-t border-gray-100 my-1" />
              <p className="px-3 py-2 text-[10px] font-bold text-gray-400 tracking-widest uppercase">Admin</p>
              {isAdmin && (
                <NavItem label="Manage Staff" href="/admin/users" current={pathname} onClick={navigate}
                  icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>} />
              )}
              <NavItem label="Settings" href="/admin/settings" current={pathname} onClick={navigate}
                icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>} />
            </div>
          )}

          {/* Account section */}
          <div className="px-3 py-1">
            <div className="mx-3 border-t border-gray-100 my-1" />
            <p className="px-3 py-2 text-[10px] font-bold text-gray-400 tracking-widest uppercase">Account</p>
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
              <span className="text-[14px] font-semibold">Log Out</span>
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
      <span className={`text-[14px] font-semibold ${active ? 'text-green-700' : ''}`}>{label}</span>
    </button>
  );
}
