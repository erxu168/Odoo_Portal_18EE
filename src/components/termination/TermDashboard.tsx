'use client';

import React, { useState, useEffect } from 'react';
import { useCompany } from '@/lib/company-context';
import { ds, getBadgeStyle } from '@/lib/design-system';

interface TermDashboardProps {
  onNavigate: (screen: string) => void;
}

export default function TermDashboard({ onNavigate }: TermDashboardProps) {
  const { companyId } = useCompany();
  const [stats, setStats] = useState({ draft: 0, confirmed: 0, signed: 0, archived: 0 });
  const [recent, setRecent] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/hr/termination?company_id=${companyId}&limit=100`);
        const data = await res.json();
        const records = data.records || [];
        setStats({
          draft: records.filter((r: any) => r.state === 'draft').length,
          confirmed: records.filter((r: any) => r.state === 'confirmed').length,
          signed: records.filter((r: any) => r.state === 'signed').length,
          archived: records.filter((r: any) => r.state === 'archived').length,
        });
        setRecent(records.slice(0, 5));
      } catch (_e) { void _e; }
      finally { setLoading(false); }
    })();
  }, [companyId]);

  const tiles = [
    {
      key: 'new',
      label: 'Neue Kuendigung',
      sublabel: 'Erstellen',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      ),
      badge: null,
      color: 'bg-green-50 border-green-200', iconBg: 'bg-green-100', iconColor: 'text-green-600',
    },
    {
      key: 'drafts',
      label: 'Entwuerfe',
      sublabel: 'Offen',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      ),
      badge: stats.draft > 0 ? stats.draft : null,
      color: 'bg-amber-50 border-amber-200', iconBg: 'bg-amber-100', iconColor: 'text-amber-600',
    },
    {
      key: 'confirmed',
      label: 'Bestaetigt',
      sublabel: 'Aktiv',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      ),
      badge: stats.confirmed > 0 ? stats.confirmed : null,
      color: 'bg-blue-50 border-blue-200', iconBg: 'bg-blue-100', iconColor: 'text-blue-600',
    },
    {
      key: 'archive',
      label: 'Archiv',
      sublabel: 'Abgeschlossen',
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
        </svg>
      ),
      badge: stats.archived + stats.signed > 0 ? stats.archived + stats.signed : null,
      color: 'bg-gray-50 border-gray-200', iconBg: 'bg-gray-100', iconColor: 'text-gray-500',
    },
  ];

  function formatDate(d: string | false): string {
    if (!d) return '---';
    const parts = d.split('-');
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  }

  const typeLabels: Record<string, string> = {
    ordentlich: 'Ordentlich',
    ordentlich_probezeit: 'Ordentlich (Probezeit)',
    fristlos: 'Fristlos',
    aufhebung: 'Aufhebung',
    bestaetigung: 'Bestaetigung',
  };

  const stateLabels: Record<string, string> = {
    draft: 'Entwurf', confirmed: 'Bestaetigt', signed: 'Unterschrieben',
    archived: 'Archiviert', cancelled: 'Storniert',
  };

  const stateBadgeMap: Record<string, string> = {
    draft: 'draft', confirmed: 'confirmed', signed: 'done',
    archived: 'neutral', cancelled: 'cancel',
  };

  return (
    <div className="px-4 py-5">
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : (
        <>
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

          {recent.length > 0 && (
            <div className="mt-6">
              <div className={`${ds.sectionLabel} mb-3`}>Letzte Vorgaenge</div>
              <div className="space-y-2">
                {recent.map((r: any) => (
                  <button
                    key={r.id}
                    onClick={() => onNavigate(`detail:${r.id}`)}
                    className={`${ds.cardHover} w-full text-left p-3.5`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[14px] font-semibold text-gray-900 truncate">{r.employee_name}</span>
                      <span className="text-[11px] text-gray-400 font-medium">KW-{r.id}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span
                        className="px-2 py-0.5 rounded-md text-[10px] font-bold"
                        style={getBadgeStyle(stateBadgeMap[r.state] || 'neutral')}
                      >
                        {stateLabels[r.state] || r.state}
                      </span>
                      <span
                        className="px-2 py-0.5 rounded-md text-[10px] font-bold"
                        style={getBadgeStyle('neutral')}
                      >
                        {typeLabels[r.termination_type] || r.termination_type}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1.5">
                      {formatDate(r.letter_date)}
                      {r.last_working_day && <> &middot; Letzter Tag: {formatDate(r.last_working_day)}</>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
