'use client';

import React, { useState, useEffect } from 'react';
import SortableTileGrid from '@/components/ui/SortableTileGrid';

interface InventoryDashboardProps {
  userRole: string;
  onNavigate: (screen: string) => void;
  onHome: () => void;
}

export default function InventoryDashboard({ userRole, onNavigate, onHome }: InventoryDashboardProps) {
  const [stats, setStats] = useState({ pending: 0, submitted: 0, quickPending: 0, templates: 0 });
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);

  const canManage = userRole === 'manager' || userRole === 'admin';

  useEffect(() => {
    fetchStats();
  }, [canManage]);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user?.preferences?.inventory_tile_order) setSavedOrder(d.user.preferences.inventory_tile_order);
    }).catch(() => {});
  }, []);

  async function fetchStats() {
    setLoading(true);
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

  async function handleGenerate() {
    setGenerating(true);
    setGenMsg(null);
    try {
      const res = await fetch('/api/inventory/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_today' }),
      });
      const data = await res.json();
      setGenMsg(data.message || `Created ${data.created} sessions`);
      setTimeout(() => setGenMsg(null), 4000);
      fetchStats();
    } catch {
      setGenMsg('Failed to generate sessions');
    } finally {
      setGenerating(false);
    }
  }

  const tiles = [
    {
      id: 'my-lists',
      label: 'My Lists',
      color: 'bg-blue-50 border-blue-200', iconBg: 'bg-blue-100', iconColor: 'text-blue-600',
      sublabel: stats.pending > 0 ? `${stats.pending} pending` : 'Assigned counts',
      badge: stats.pending,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="3"/>
          <path d="M7 8h10M7 12h10M7 16h6" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: 'quick-count',
      label: 'Quick Count',
      color: 'bg-teal-50 border-teal-200', iconBg: 'bg-teal-100', iconColor: 'text-teal-600',
      sublabel: 'Search + count any item',
      badge: 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7"/>
          <path d="M16.5 16.5L21 21" strokeLinecap="round"/>
          <path d="M8 11h6M11 8v6" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: 'mo-ingredients',
      label: 'MO Ingredients',
      color: 'bg-orange-50 border-orange-200', iconBg: 'bg-orange-100', iconColor: 'text-orange-600',
      sublabel: 'Confirmed MO needs',
      badge: 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round"/>
          <circle cx="7" cy="6" r="1.5" fill="currentColor" stroke="none"/>
          <circle cx="7" cy="12" r="1.5" fill="currentColor" stroke="none"/>
          <circle cx="7" cy="18" r="1.5" fill="currentColor" stroke="none"/>
        </svg>
      ),
    },
    ...(canManage ? [{
      id: 'manage',
      label: 'Manage Lists',
      color: 'bg-blue-50 border-blue-200', iconBg: 'bg-purple-100', iconColor: 'text-blue-600',
      sublabel: stats.templates > 0 ? `${stats.templates} templates` : 'Create templates',
      badge: 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round"/>
          <circle cx="19" cy="18" r="3"/>
        </svg>
      ),
    }] : []),
    ...(canManage ? [{
      id: 'review',
      label: 'Review',
      color: 'bg-amber-50 border-amber-200', iconBg: 'bg-amber-100', iconColor: 'text-amber-600',
      sublabel: (stats.submitted + stats.quickPending) > 0 ? `${stats.submitted + stats.quickPending} to review` : 'Approve counts',
      badge: stats.submitted + stats.quickPending,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 12l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"/>
        </svg>
      ),
    }] : []),
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#2563EB] px-5 pt-12 pb-3 relative overflow-hidden rounded-b-[28px]">
        <div className="absolute -top-10 -right-5 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
        <div className="flex items-center gap-3 relative">
          <button onClick={onHome}
            className="w-11 h-11 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Inventory</h1>
            <p className="text-[var(--fs-sm)] text-white/50 mt-0.5">
              {loading ? 'Loading...' : stats.pending > 0 ? `${stats.pending} lists waiting` : 'Stock counting'}
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-4">
        <SortableTileGrid
          items={tiles}
          getItemId={(tile) => tile.id}
          storageKey="inventory_tile_order"
          savedOrder={savedOrder}
          renderItem={(tile) => (
            <button onClick={() => onNavigate(tile.id)}
              className={`w-full relative p-4 rounded-2xl border ${(tile as any).color || 'bg-white border-gray-200'} text-left active:scale-[0.97] transition-transform shadow-sm`}>
              {tile.badge > 0 && (
                <span className="absolute top-3 right-3 min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-[var(--fs-xs)] font-bold font-mono leading-[22px] text-center">
                  {tile.badge}
                </span>
              )}
              <div className={`w-11 h-11 rounded-xl ${(tile as any).iconBg || 'bg-gray-100'} ${(tile as any).iconColor || ''} flex items-center justify-center mb-3`}>
                {tile.icon}
              </div>
              <div className="text-[var(--fs-lg)] font-bold text-gray-900">{tile.label}</div>
              <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{tile.sublabel}</div>
            </button>
          )}
        />

        {canManage && (
          <div className="mt-4">
            {genMsg && (
              <div className="mb-2 px-4 py-2.5 bg-green-50 border border-green-200 rounded-xl text-green-700 text-[var(--fs-sm)] font-semibold">
                {genMsg}
              </div>
            )}
            <button onClick={handleGenerate} disabled={generating}
              className="w-full py-3 rounded-xl bg-green-600 text-white text-[var(--fs-base)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
              {generating ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg>
              )}
              {generating ? 'Generating...' : "Generate today's sessions"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
