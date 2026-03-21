'use client';

import React, { useState, useEffect } from 'react';

interface MfgDashboardProps {
  onNavigate: (screen: string) => void;
}

export default function MfgDashboard({ onNavigate }: MfgDashboardProps) {
  const [stats, setStats] = useState({ active: 0, inProgress: 0, done: 0, bomCount: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [moRes, bomRes] = await Promise.all([
          fetch('/api/manufacturing-orders?limit=50').then(r => r.json()),
          fetch('/api/boms').then(r => r.json()),
        ]);
        const mos = moRes.orders || [];
        const active = mos.filter((m: any) => m.state === 'confirmed' || m.state === 'progress').length;
        const inProgress = mos.filter((m: any) => m.state === 'progress').length;
        const done = mos.filter((m: any) => m.state === 'done').length;
        setStats({ active, inProgress, done, bomCount: bomRes.total || 0 });
      } catch (e) { void e; }
      finally { setLoading(false); }
    })();
  }, []);

  const tiles = [
    {
      key: 'orders',
      label: 'Production',
      sublabel: 'Manufacturing orders',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 20V8l5 4V8l5 4V4l10 8v8H2z"/>
        </svg>
      ),
      badge: stats.active > 0 ? stats.active : null,
      badgeColor: 'bg-orange-500',
    },
    {
      key: 'create',
      label: 'Start production',
      sublabel: 'New batch',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="16"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      ),
      badge: null,
      badgeColor: '',
    },
    {
      key: 'recipes',
      label: 'Recipes',
      sublabel: 'Bills of materials',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>
          <line x1="8" y1="7" x2="16" y2="7"/>
          <line x1="8" y1="11" x2="14" y2="11"/>
        </svg>
      ),
      badge: stats.bomCount > 0 ? stats.bomCount : null,
      badgeColor: 'bg-blue-500',
    },
    {
      key: 'completed',
      label: 'Completed',
      sublabel: 'Finished orders',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      ),
      badge: stats.done > 0 ? stats.done : null,
      badgeColor: 'bg-green-500',
    },
  ];

  return (
    <div className="px-4 py-5">
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {tiles.map(tile => (
            <button
              key={tile.key}
              onClick={() => onNavigate(tile.key)}
              className="relative bg-white rounded-2xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 text-left active:scale-[0.97] transition-transform"
            >
              <div className="w-11 h-11 rounded-xl bg-[#F1F3F5] flex items-center justify-center text-blue-600 mb-3">
                {tile.icon}
              </div>
              <div className="text-[14px] font-bold text-[#1F2933]">{tile.label}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">{tile.sublabel}</div>
              {tile.badge !== null && (
                <span className={`absolute top-3 right-3 min-w-[20px] h-5 px-1.5 rounded-full ${tile.badgeColor} text-white text-[11px] font-bold flex items-center justify-center`}>
                  {tile.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
