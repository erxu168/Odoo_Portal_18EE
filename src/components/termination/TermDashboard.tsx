'use client';

import React, { useState, useEffect } from 'react';
import { useCompany } from '@/lib/company-context';

interface TermDashboardProps {
  onNavigate: (screen: string) => void;
}

export default function TermDashboard({ onNavigate }: TermDashboardProps) {
  const { companyId } = useCompany();
  const [stats, setStats] = useState({ inProgress: 0, completed: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const url = companyId
          ? `/api/termination?company_id=${companyId}&limit=500`
          : '/api/termination?limit=500';
        const res = await fetch(url);
        const json = await res.json();
        const records = json.data || [];
        setStats({
          inProgress: records.filter((r: any) => ['draft', 'confirmed', 'signed'].includes(r.state)).length,
          completed: records.filter((r: any) => ['delivered', 'archived'].includes(r.state)).length,
        });
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, [companyId]);

  const tiles = [
    {
      key: 'new',
      label: 'New Termination',
      sublabel: 'Select employee',
      color: 'bg-red-50 border-red-200',
      iconBg: 'bg-red-100',
      iconColor: 'text-red-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      ),
      badge: null,
    },
    {
      key: 'in_progress',
      label: 'In Progress',
      sublabel: 'Draft, confirmed, signed',
      color: 'bg-orange-50 border-orange-200',
      iconBg: 'bg-orange-100',
      iconColor: 'text-orange-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      ),
      badge: stats.inProgress > 0 ? stats.inProgress : null,
    },
    {
      key: 'completed',
      label: 'Completed',
      sublabel: 'Delivered & archived',
      color: 'bg-green-50 border-green-200',
      iconBg: 'bg-green-100',
      iconColor: 'text-green-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      ),
      badge: stats.completed > 0 ? stats.completed : null,
    },
  ];

  return (
    <div className="px-4 py-5">
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {/* New — full width */}
          <button
            onClick={() => onNavigate('new')}
            className={`relative w-full rounded-2xl border ${tiles[0].color} shadow-sm p-4 text-left active:scale-[0.97] transition-transform`}
          >
            <div className="flex items-center gap-4">
              <div className={`w-11 h-11 rounded-xl ${tiles[0].iconBg} ${tiles[0].iconColor} flex items-center justify-center`}>
                {tiles[0].icon}
              </div>
              <div>
                <div className="text-[var(--fs-md)] font-bold text-gray-900">{tiles[0].label}</div>
                <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{tiles[0].sublabel}</div>
              </div>
            </div>
          </button>
          {/* In Progress + Completed — side by side */}
          <div className="grid grid-cols-2 gap-3">
            {tiles.slice(1).map(tile => (
              <button
                key={tile.key}
                onClick={() => onNavigate(tile.key)}
                className={`relative rounded-2xl border ${tile.color} shadow-sm p-4 text-left active:scale-[0.97] transition-transform`}
              >
                <div className={`w-11 h-11 rounded-xl ${tile.iconBg} ${tile.iconColor} flex items-center justify-center mb-3`}>
                  {tile.icon}
                </div>
                <div className="text-[var(--fs-md)] font-bold text-gray-900">{tile.label}</div>
                <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{tile.sublabel}</div>
                {tile.badge !== null && (
                  <span className="absolute top-3 right-3 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[var(--fs-xs)] font-bold flex items-center justify-center">
                    {tile.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
