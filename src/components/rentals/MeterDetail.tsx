'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';

interface Meter {
  id: number;
  property_id: number;
  meter_type: string;
  meter_no: string;
  location: string | null;
  status: string;
  notes: string | null;
}

interface MeterReading {
  id: number;
  meter_id: number;
  reading_value: number;
  reading_unit: string;
  reading_date: string;
  photo_path: string | null;
  notes: string | null;
}

interface MeterProperty {
  id: number;
  street: string;
  plz: string;
  city: string;
}

const METER_ICONS: Record<string, string> = {
  electricity: '\u26A1',
  gas: '\uD83D\uDD25',
  water_cold: '\uD83D\uDCA7',
  water_hot: '\uD83C\uDF21\uFE0F',
  heating: '\uD83C\uDF21\uFE0F',
};

const METER_LABELS: Record<string, string> = {
  electricity: 'Electricity',
  gas: 'Gas',
  water_cold: 'Cold Water',
  water_hot: 'Hot Water',
  heating: 'Heating',
};

function statusBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    active:   { bg: '#DCFCE7', text: '#166534', label: 'Active' },
    inactive: { bg: '#F3F4F6', text: '#374151', label: 'Inactive' },
  };
  return map[status] || { bg: '#F3F4F6', text: '#374151', label: status };
}

export default function MeterDetail() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [meter, setMeter] = useState<Meter | null>(null);
  const [readings, setReadings] = useState<MeterReading[]>([]);
  const [property, setProperty] = useState<MeterProperty | null>(null);
  const [loading, setLoading] = useState(true);
  const [photoModal, setPhotoModal] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/rentals/meters/${id}`)
      .then(r => r.json())
      .then(data => {
        setMeter(data.meter || null);
        setReadings(data.readings || []);
        setProperty(data.property || null);
      })
      .catch(err => console.error('[rentals] meter detail load failed:', err))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Meter" showBack onBack={() => router.back()} />
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!meter) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Not Found" showBack onBack={() => router.back()} />
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-4xl mb-3">{'\uD83D\uDD0C'}</div>
          <div className="text-[15px] font-semibold text-[#1F2933]">Meter not found</div>
        </div>
      </div>
    );
  }

  const icon = METER_ICONS[meter.meter_type] || '\uD83D\uDD0C';
  const typeLabel = METER_LABELS[meter.meter_type] || meter.meter_type;
  const badge = statusBadge(meter.status);

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title={`${icon} ${typeLabel}`}
        subtitle={`#${meter.meter_no}`}
        supertitle={property ? property.street : 'METER'}
        showBack
        onBack={() => router.back()}
      />

      <div className="px-4 py-5 space-y-4">
        {/* Info card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-semibold text-[#1F2933]">Meter Info</span>
            <span
              className="px-2 py-0.5 rounded-md text-[10px] font-bold"
              style={{ backgroundColor: badge.bg, color: badge.text }}
            >
              {badge.label}
            </span>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-wider uppercase text-gray-400">Type</span>
              <span className="text-[13px] font-medium text-[#1F2933]">{icon} {typeLabel}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-wider uppercase text-gray-400">Number</span>
              <span className="text-[13px] font-medium text-[#1F2933] font-mono">{meter.meter_no}</span>
            </div>
            {meter.location && (
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold tracking-wider uppercase text-gray-400">Location</span>
                <span className="text-[13px] font-medium text-[#1F2933]">{meter.location}</span>
              </div>
            )}
          </div>

          {/* Edit button */}
          <button
            onClick={() => router.push(`/rentals/meters/${id}/edit`)}
            className="w-full mt-4 bg-gray-50 border border-gray-200 text-gray-700 font-semibold rounded-xl py-2.5 text-[13px] active:bg-gray-100 transition-colors"
          >
            Edit Meter
          </button>
        </div>

        {/* Notes */}
        {meter.notes && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
            <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-2">Notes</div>
            <p className="text-[13px] text-gray-700 whitespace-pre-wrap">{meter.notes}</p>
          </div>
        )}

        {/* Readings list */}
        <div>
          <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-2">
            Readings ({readings.length})
          </div>
          {readings.length > 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)]">
              {readings.map((r, i) => (
                <div
                  key={r.id}
                  className={`flex items-center gap-3 px-4 py-3 ${i < readings.length - 1 ? 'border-b border-gray-100' : ''}`}
                >
                  {/* Photo thumbnail */}
                  {r.photo_path ? (
                    <button
                      onClick={() => setPhotoModal(`/api/rentals/photos/${r.photo_path}`)}
                      className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 border border-gray-200"
                    >
                      <img
                        src={`/api/rentals/photos/${r.photo_path}`}
                        alt="Reading photo"
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ) : (
                    <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-gray-400 text-[14px]">{icon}</span>
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-[#1F2933] tabular-nums">
                      {r.reading_value} {r.reading_unit}
                    </div>
                    <div className="text-[11px] text-gray-500">{r.reading_date}</div>
                    {r.notes && (
                      <div className="text-[11px] text-gray-400 truncate">{r.notes}</div>
                    )}
                  </div>

                  {r.photo_path && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="M21 15l-5-5L5 21" />
                    </svg>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 text-center">
              <div className="text-[13px] text-gray-500">No readings recorded yet</div>
            </div>
          )}
        </div>

        {/* Add Reading button */}
        <button
          onClick={() => router.push(`/rentals/meters/${id}/readings/new`)}
          className="w-full bg-green-600 text-white font-semibold rounded-xl py-3.5 text-[14px] active:bg-green-700 transition-colors shadow-lg shadow-green-600/30"
        >
          Add Reading
        </button>
      </div>

      {/* Photo modal */}
      {photoModal && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPhotoModal(null)}
        >
          <div className="relative max-w-full max-h-full" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setPhotoModal(null)}
              className="absolute -top-3 -right-3 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center z-10"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#374151" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
            <img
              src={photoModal}
              alt="Meter reading"
              className="max-w-full max-h-[80vh] rounded-xl object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
