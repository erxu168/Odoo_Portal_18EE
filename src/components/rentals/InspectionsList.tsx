'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import type { Inspection } from '@/types/rentals';

function inspectionBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    draft:       { bg: '#F3F4F6', text: '#374151', label: 'Draft' },
    in_progress: { bg: '#FEF3C7', text: '#92400E', label: 'In Progress' },
    signed:      { bg: '#DCFCE7', text: '#166534', label: 'Signed' },
    archived:    { bg: '#DBEAFE', text: '#1E3A8A', label: 'Archived' },
  };
  return map[status] || { bg: '#F3F4F6', text: '#374151', label: status };
}

export default function InspectionsList() {
  const router = useRouter();
  const [inspections, setInspections] = useState<(Inspection & { tenant_name?: string; room_code?: string; street?: string })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/rentals/inspections')
      .then(r => r.json())
      .then(data => setInspections(data.inspections || []))
      .catch(err => console.error('[rentals] inspections load failed:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title={'\u00dc' + 'bergabeprotokoll'}
        subtitle="Move-in / move-out"
        showBack
        onBack={() => router.push('/rentals')}
        action={
          <button
            onClick={() => router.push('/rentals/inspections/new')}
            className="w-[clamp(44px,12vw,55px)] h-[clamp(44px,12vw,55px)] rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : inspections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center px-6">
          <div className="text-4xl mb-3">{'\u2705'}</div>
          <div className="text-[15px] font-semibold text-[#1F2933] mb-1">No inspections yet</div>
          <div className="text-[13px] text-gray-500 max-w-[240px] leading-relaxed">
            Create an inspection protocol when a tenant moves in or out
          </div>
          <button
            className="mt-4 bg-green-600 text-white font-semibold rounded-xl px-5 py-2.5 text-[13px] active:bg-green-700 transition-colors"
            onClick={() => router.push('/rentals/inspections/new')}
          >
            New Inspection
          </button>
        </div>
      ) : (
        <div className="px-4 py-4 space-y-2">
          {inspections.map(insp => {
            const badge = inspectionBadge(insp.status);
            return (
              <button
                key={insp.id}
                onClick={() => router.push(`/rentals/inspections/${insp.id}`)}
                className="w-full bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 text-left active:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[13px] font-semibold text-[#1F2933] capitalize">
                        {insp.type.replace('_', ' ')}
                      </span>
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ backgroundColor: badge.bg, color: badge.text }}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="text-[11px] text-gray-500">
                      {insp.inspection_date} \u00b7 {insp.inspector_name}
                    </div>
                    {(insp as any).street && (
                      <div className="text-[11px] text-gray-400 mt-0.5">{(insp as any).room_code} \u00b7 {(insp as any).street}</div>
                    )}
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
