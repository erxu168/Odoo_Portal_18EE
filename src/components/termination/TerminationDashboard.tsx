'use client';

import React, { useState, useEffect } from 'react';

interface Props {
  onNew: () => void;
  onList: (filter?: string) => void;
  onDetail: (id: number) => void;
}

export default function TerminationDashboard({ onNew, onList }: Props) {
  const [stats, setStats] = useState({ draft: 0, confirmed: 0, signed: 0, delivered: 0, total: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/termination');
        const data = await res.json();
        if (data.ok) {
          const recs = data.data || [];
          setStats({
            draft: recs.filter((r: any) => r.state === 'draft').length,
            confirmed: recs.filter((r: any) => r.state === 'confirmed').length,
            signed: recs.filter((r: any) => r.state === 'signed').length,
            delivered: recs.filter((r: any) => r.state === 'delivered').length,
            total: recs.length,
          });
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    })();
  }, []);

  const tiles = [
    {
      key: 'new',
      label: 'Neue K\u00fcndigung',
      sublabel: 'Erstellen',
      color: 'bg-red-50 border-red-200',
      iconBg: 'bg-red-100',
      iconColor: 'text-red-600',
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>,
      badge: null,
      action: () => onNew(),
    },
    {
      key: 'active',
      label: 'In Bearbeitung',
      sublabel: 'Best\u00e4tigt / Unterschrieben',
      color: 'bg-orange-50 border-orange-200',
      iconBg: 'bg-orange-100',
      iconColor: 'text-orange-600',
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>,
      badge: (stats.confirmed + stats.signed) || null,
      action: () => onList('active'),
    },
    {
      key: 'delivered',
      label: 'Zugestellt',
      sublabel: 'Erfolgreich zugestellt',
      color: 'bg-green-50 border-green-200',
      iconBg: 'bg-green-100',
      iconColor: 'text-green-600',
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
      badge: stats.delivered || null,
      action: () => onList('delivered'),
    },
    {
      key: 'all',
      label: 'Alle K\u00fcndigungen',
      sublabel: 'Gesamter Verlauf',
      color: 'bg-blue-50 border-blue-200',
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
      icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
      badge: stats.total || null,
      action: () => onList(),
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
              onClick={tile.action}
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
