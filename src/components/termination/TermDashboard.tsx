'use client';

import React, { useState, useEffect } from 'react';
import { useCompany } from '@/lib/company-context';

interface TermDashboardProps {
  onNavigate: (screen: string) => void;
}

export default function TermDashboard({ onNavigate }: TermDashboardProps) {
  const { companyId } = useCompany();
  const [stats, setStats] = useState({ draft: 0, confirmed: 0, signed: 0, delivered: 0, total: 0 });
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
          draft: records.filter((r: any) => r.state === 'draft').length,
          confirmed: records.filter((r: any) => r.state === 'confirmed').length,
          signed: records.filter((r: any) => r.state === 'signed').length,
          delivered: records.filter((r: any) => r.state === 'delivered').length,
          total: records.length,
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
      key: 'active',
      label: 'In Progress',
      sublabel: 'Draft & confirmed',
      color: 'bg-orange-50 border-orange-200',
      iconBg: 'bg-orange-100',
      iconColor: 'text-orange-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      ),
      badge: (stats.draft + stats.confirmed) > 0 ? stats.draft + stats.confirmed : null,
    },
    {
      key: 'signed',
      label: 'Signed',
      sublabel: 'Ready to send',
      color: 'bg-blue-50 border-blue-200',
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
        </svg>
      ),
      badge: stats.signed > 0 ? stats.signed : null,
    },
    {
      key: 'history',
      label: 'History',
      sublabel: 'All terminations',
      color: 'bg-gray-50 border-gray-200',
      iconBg: 'bg-gray-100',
      iconColor: 'text-gray-600',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      ),
      badge: stats.total > 0 ? stats.total : null,
    },
  ];

  return (
    <div className="px-4 py-5">
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-red-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {tiles.map(tile => (
            <button
              key={tile.key}
              onClick={() => onNavigate(tile.key)}
              className={`relative rounded-2xl border ${tile.color} shadow-sm p-4 text-left active:scale-[0.97] transition-transform`}
            >
              <div className={`w-11 h-11 rounded-xl ${tile.iconBg} ${tile.iconColor} flex items-center justify-center mb-3`}>
                {tile.icon}
              </div>
              <div className="text-[14px] font-bold text-gray-900">{tile.label}</div>
              <div className="text-[11px] text-gray-500 mt-0.5">{tile.sublabel}</div>
              {tile.badge !== null && (
                <span className="absolute top-3 right-3 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">
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
