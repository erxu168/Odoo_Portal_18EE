'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import type { PropertyWithStats } from '@/types/rentals';

function typeLabel(t: string): string {
  switch (t) {
    case 'apartment_wg': return 'WG';
    case 'house': return 'House';
    case 'studio': return 'Studio';
    default: return 'Other';
  }
}

export default function PropertiesList() {
  const router = useRouter();
  const [properties, setProperties] = useState<PropertyWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/rentals/properties')
      .then(r => r.json())
      .then(data => setProperties(data.properties || []))
      .catch(err => console.error('[rentals] properties load failed:', err))
      .finally(() => setLoading(false));
  }, []);

  const filtered = properties.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.street.toLowerCase().includes(q) ||
      p.city.toLowerCase().includes(q) ||
      p.plz.includes(q) ||
      (p.owner || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title="Properties"
        subtitle={`${properties.length} properties`}
        showBack
        onBack={() => router.push('/rentals')}
        action={
          <button
            onClick={() => router.push('/rentals/properties/new')}
            className="w-[clamp(44px,12vw,55px)] h-[clamp(44px,12vw,55px)] rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        }
      />

      {/* Search bar */}
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
            placeholder="Search properties..."
            className="flex-1 bg-transparent outline-none text-[14px] text-gray-900 placeholder-gray-400"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-gray-400 active:text-gray-600">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center px-6">
          <div className="text-4xl mb-3">🏠</div>
          <div className="text-[15px] font-semibold text-[#1F2933] mb-1">
            {search ? 'No properties found' : 'No properties yet'}
          </div>
          <div className="text-[13px] text-gray-500 max-w-[220px] leading-relaxed">
            {search ? 'Try a different search term' : 'Add your first property to get started'}
          </div>
        </div>
      ) : (
        <div className="px-4 py-2 space-y-3">
          {filtered.map(property => (
            <button
              key={property.id}
              onClick={() => router.push(`/rentals/properties/${property.id}`)}
              className="w-full bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 text-left active:bg-gray-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[14px] font-bold text-[#1F2933] truncate">{property.street}</span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#F3F4F6] text-[#374151]">
                      {typeLabel(property.type)}
                    </span>
                  </div>
                  <div className="text-[12px] text-gray-500">
                    {property.plz} {property.city}
                    {property.floor_unit ? ` \u00b7 ${property.floor_unit}` : ''}
                  </div>
                  {property.owner && (
                    <div className="text-[11px] text-gray-400 mt-0.5">Owner: {property.owner}</div>
                  )}
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
              </div>

              {/* Stats row */}
              <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-3 gap-2">
                <div>
                  <div className="text-[12px] font-bold text-[#1F2933]">
                    {property.rooms_occupied}/{property.rooms_total}
                  </div>
                  <div className="text-[10px] text-gray-400">Rooms</div>
                </div>
                <div>
                  <div className="text-[12px] font-bold text-[#1F2933]">{property.occupancy_pct}%</div>
                  <div className="text-[10px] text-gray-400">Occupied</div>
                </div>
                <div>
                  <div className="text-[12px] font-bold text-[#1F2933] tabular-nums">
                    {new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(property.monthly_income)}
                  </div>
                  <div className="text-[10px] text-gray-400">Monthly</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
