'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';

interface TenancyRow {
  id: number;
  status: string;
  start_date: string;
  end_date: string | null;
  kaltmiete: number;
  warmmiete: number;
  contract_type: string;
  tenant_name: string;
  tenant_email: string;
  room_code: string;
  room_name: string | null;
  street: string;
  plz: string;
  city: string;
}

function eur(n: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

function tenancyBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    pending:   { bg: '#FEF3C7', text: '#92400E', label: 'Pending' },
    active:    { bg: '#DCFCE7', text: '#166534', label: 'Active' },
    ending:    { bg: '#FEE2E2', text: '#991B1B', label: 'Ending' },
    ended:     { bg: '#F3F4F6', text: '#374151', label: 'Ended' },
    cancelled: { bg: '#F3F4F6', text: '#374151', label: 'Cancelled' },
  };
  return map[status] || { bg: '#F3F4F6', text: '#374151', label: status };
}

type FilterKey = 'all' | 'active' | 'ending' | 'ended';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'ending', label: 'Ending' },
  { key: 'ended', label: 'Past' },
];

export default function TenanciesList() {
  const router = useRouter();
  const [tenancies, setTenancies] = useState<TenancyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');

  useEffect(() => {
    fetch('/api/rentals/tenancies')
      .then(r => r.json())
      .then(data => setTenancies(data.tenancies || []))
      .catch(err => console.error('[rentals] tenancies load failed:', err))
      .finally(() => setLoading(false));
  }, []);

  const filtered = tenancies.filter(t => {
    if (filter === 'active' && t.status !== 'active') return false;
    if (filter === 'ending' && t.status !== 'ending') return false;
    if (filter === 'ended' && t.status !== 'ended' && t.status !== 'cancelled') return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        t.tenant_name.toLowerCase().includes(q) ||
        t.street.toLowerCase().includes(q) ||
        t.room_code.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title="Tenancies"
        subtitle={`${tenancies.length} total`}
        showBack
        onBack={() => router.push('/rentals')}
      />

      {/* Search */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center gap-2.5 bg-white border border-gray-200 rounded-xl px-3.5 h-12 focus-within:border-green-500 transition-colors">
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" className="text-gray-400 flex-shrink-0">
            <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="2"/>
            <path d="M12.5 12.5L16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tenancies..."
            className="flex-1 bg-transparent outline-none text-[14px] text-gray-900 placeholder-gray-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-gray-400 active:text-gray-600">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 overflow-x-auto px-4 py-2 scrollbar-hide">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap transition-colors ${
              filter === f.key
                ? 'bg-green-600 text-white shadow-sm'
                : 'border bg-white border-gray-200 text-gray-500'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center px-6">
          <div className="text-4xl mb-3">{'\ud83d\udcdd'}</div>
          <div className="text-[15px] font-semibold text-[#1F2933] mb-1">No tenancies found</div>
          <div className="text-[13px] text-gray-500 max-w-[220px] leading-relaxed">
            {search ? 'Try a different search' : 'Create a tenancy from a room detail page'}
          </div>
        </div>
      ) : (
        <div className="px-4 py-2 space-y-2">
          {filtered.map(t => {
            const badge = tenancyBadge(t.status);
            return (
              <button
                key={t.id}
                onClick={() => router.push(`/rentals/tenancies/${t.id}`)}
                className="w-full bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 text-left active:bg-gray-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-green-700 font-bold text-[14px]">{t.tenant_name.charAt(0)}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] font-semibold text-[#1F2933] truncate">{t.tenant_name}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {t.room_code} \u00b7 {t.street}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-0.5 tabular-nums">
                        {t.start_date}{t.end_date ? ` \u2192 ${t.end_date}` : ' \u2192 open-ended'}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ backgroundColor: badge.bg, color: badge.text }}>
                      {badge.label}
                    </span>
                    <span className="text-[12px] font-bold text-[#1F2933] tabular-nums">{eur(t.warmmiete)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
