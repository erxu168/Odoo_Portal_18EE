'use client';

import React, { useState, useEffect } from 'react';
import { useCompany } from '@/lib/company-context';
import SortableTileGrid from '@/components/ui/SortableTileGrid';

interface MfgDashboardProps {
  onNavigate: (screen: string) => void;
}

export default function MfgDashboard({ onNavigate }: MfgDashboardProps) {
  const { companyId } = useCompany();
  const [stats, setStats] = useState({ active: 0, confirmed: 0, inProgress: 0, done: 0, bomCount: 0, pickListCount: 0 });
  const [loading, setLoading] = useState(true);
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user?.preferences?.manufacturing_tile_order) setSavedOrder(d.user.preferences.manufacturing_tile_order); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    (async () => {
      try {
        const cq = `company_id=${companyId}`;
        const [moRes, bomRes, pickRes] = await Promise.all([
          fetch(`/api/manufacturing-orders?limit=200&${cq}`).then(r => r.json()),
          fetch(`/api/boms?${cq}`).then(r => r.json()),
          fetch(`/api/manufacturing-orders/pick-list?${cq}`).then(r => r.json()).catch(() => ({ total_components: 0 })),
        ]);
        const mos = moRes.orders || [];
        const active = mos.filter((m: any) => m.state === 'confirmed' || m.state === 'progress').length;
        const confirmed = mos.filter((m: any) => m.state === 'confirmed').length;
        const inProgress = mos.filter((m: any) => m.state === 'progress').length;
        const done = mos.filter((m: any) => m.state === 'done').length;
        setStats({ active, confirmed, inProgress, done, bomCount: bomRes.total || 0, pickListCount: pickRes.total_components || 0 });
      } catch (e) { void e; }
      finally { setLoading(false); }
    })();
  }, [companyId]);

  const tiles = [
    {
      key: 'orders',
      label: 'Manufacturing',
      sublabel: 'Active orders',
      color: 'bg-orange-50 border-orange-200', iconBg: 'bg-orange-100', iconColor: 'text-orange-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 20V8l5 4V8l5 4V4l10 8v8H2z"/>
        </svg>
      ),
      badge: stats.active > 0 ? stats.active : null,
    },
    {
      key: 'pick-list',
      label: 'Pick List',
      sublabel: 'Collect ingredients',
      color: 'bg-amber-50 border-amber-200', iconBg: 'bg-amber-100', iconColor: 'text-amber-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
          <rect x="9" y="3" width="6" height="4" rx="1"/>
          <path d="M9 14l2 2 4-4"/>
        </svg>
      ),
      badge: stats.pickListCount > 0 ? stats.pickListCount : null,
    },
    {
      key: 'recipes',
      label: 'Recipes',
      sublabel: 'Bills of materials',
      color: 'bg-blue-50 border-blue-200', iconBg: 'bg-blue-100', iconColor: 'text-blue-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
          <line x1="8" y1="7" x2="16" y2="7"/>
          <line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      ),
      badge: stats.bomCount > 0 ? stats.bomCount : null,
    },
    {
      key: 'completed',
      label: 'Completed',
      sublabel: 'Finished orders',
      color: 'bg-green-50 border-green-200', iconBg: 'bg-green-100', iconColor: 'text-green-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      ),
      badge: stats.done > 0 ? stats.done : null,
    },
    {
      key: 'label-print',
      label: 'Label Print',
      sublabel: 'Print without producing',
      color: 'bg-purple-50 border-purple-200', iconBg: 'bg-purple-100', iconColor: 'text-purple-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 6 2 18 2 18 9"/>
          <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/>
          <rect x="6" y="14" width="12" height="8"/>
        </svg>
      ),
      badge: null,
    },
  ];

  return (
    <div className="px-4 py-5">
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : (
        <SortableTileGrid
          items={tiles}
          getItemId={(t) => t.key}
          storageKey="manufacturing_tile_order"
          savedOrder={savedOrder}
          renderItem={(tile) => (
            <button
              onClick={() => onNavigate(tile.key)}
              className={`relative rounded-2xl border ${tile.color} shadow-sm p-4 text-left w-full active:scale-[0.97] transition-transform`}
            >
              <div className={`w-11 h-11 rounded-xl ${tile.iconBg} ${tile.iconColor} flex items-center justify-center mb-3`}>
                {tile.icon}
              </div>
              <div className="text-[var(--fs-md)] font-bold text-gray-900">{tile.label}</div>
              <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{tile.sublabel}</div>
              {tile.badge !== null && (
                <span className="absolute top-3 right-3 min-w-[22px] h-6 px-2 rounded-full bg-red-500 text-white text-[var(--fs-xs)] font-bold flex items-center justify-center">
                  {tile.badge}
                </span>
              )}
            </button>
          )}
        />
      )}
    </div>
  );
}
