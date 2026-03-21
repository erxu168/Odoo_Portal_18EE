'use client';

import React, { useState, useEffect } from 'react';

interface InventoryDashboardProps {
  userRole: string;
  onNavigate: (screen: string) => void;
  onHome: () => void;
}

export default function InventoryDashboard({ userRole, onNavigate, onHome }: InventoryDashboardProps) {
  const [stats, setStats] = useState({ pending: 0, submitted: 0, quickPending: 0, templates: 0 });
  const [loading, setLoading] = useState(true);

  const canManage = userRole === 'manager' || userRole === 'admin';

  useEffect(() => {
    async function load() {
      try {
        const [sessRes, quickRes, tmplRes] = await Promise.all([
          fetch('/api/inventory/sessions'),
          canManage ? fetch('/api/inventory/quick-count') : null,
          canManage ? fetch('/api/inventory/templates') : null,
        ]);
        const sessData = await sessRes.json();
        const sessions = sessData.sessions || [];
        const pending = sessions.filter((s: any) => s.status === 'pending' || s.status === 'in_progress').length;
        const submitted = sessions.filter((s: any) => s.status === 'submitted').length;

        let quickPending = 0;
        if (quickRes) {
          const quickData = await quickRes.json();
          quickPending = (quickData.counts || []).filter((c: any) => c.status === 'pending').length;
        }

        let templates = 0;
        if (tmplRes) {
          const tmplData = await tmplRes.json();
          templates = (tmplData.templates || []).length;
        }

        setStats({ pending, submitted, quickPending, templates });
      } catch (err) {
        console.error('Failed to load inventory stats:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [canManage]);

  const tiles = [
    {
      id: 'my-lists',
      label: 'My Lists',
      sublabel: stats.pending > 0 ? `${stats.pending} pending` : 'Assigned counts',
      badge: stats.pending,
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="18" height="18" rx="3"/>
          <path d="M7 8h10M7 12h10M7 16h6" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: 'quick-count',
      label: 'Quick Count',
      sublabel: 'Search + count any item',
      badge: 0,
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="11" cy="11" r="7"/>
          <path d="M16.5 16.5L21 21" strokeLinecap="round"/>
          <path d="M8 11h6M11 8v6" strokeLinecap="round"/>
        </svg>
      ),
    },
    ...(canManage ? [{
      id: 'manage',
      label: 'Manage Lists',
      sublabel: stats.templates > 0 ? `${stats.templates} templates` : 'Create templates',
      badge: 0,
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round"/>
          <circle cx="19" cy="18" r="3"/>
        </svg>
      ),
    }] : []),
    ...(canManage ? [{
      id: 'review',
      label: 'Review',
      sublabel: (stats.submitted + stats.quickPending) > 0 ? `${stats.submitted + stats.quickPending} to review` : 'Approve counts',
      badge: stats.submitted + stats.quickPending,
      icon: (
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 12l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"/>
        </svg>
      ),
    }] : []),
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#1A1F2E] px-5 pt-14 pb-5 relative overflow-hidden">
        <div className="absolute -top-10 -right-5 w-44 h-44 rounded-full bg-[radial-gradient(circle,rgba(22,163,74,0.08)_0%,transparent_70%)]" />
        <div className="flex items-center gap-3 relative">
          <button onClick={onHome}
            className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Inventory</h1>
            <p className="text-[12px] text-white/50 mt-0.5">
              {loading ? 'Loading...' : stats.pending > 0 ? `${stats.pending} lists waiting` : 'Stock counting'}
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4">
        <div className="grid grid-cols-2 gap-3">
          {tiles.map((tile) => (
            <button key={tile.id} onClick={() => onNavigate(tile.id)}
              className="aspect-square rounded-2xl bg-white border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] flex flex-col items-center justify-center gap-2.5 relative active:scale-95 transition-transform p-3">
              {tile.badge > 0 && (
                <span className="absolute top-2.5 right-2.5 min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold font-mono leading-[22px] text-center">
                  {tile.badge}
                </span>
              )}
              <div className="w-14 h-14 rounded-[16px] flex items-center justify-center bg-[#F1F3F5] text-green-700">
                {tile.icon}
              </div>
              <div className="text-center">
                <div className="text-[13px] font-bold text-gray-900">{tile.label}</div>
                <div className="text-[11px] text-gray-500 mt-0.5">{tile.sublabel}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
