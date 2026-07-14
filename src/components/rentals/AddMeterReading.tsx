'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';

interface MeterInfo {
  id: number;
  meter_type: string;
  meter_no: string;
  location: string | null;
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

const DEFAULT_UNITS: Record<string, string> = {
  electricity: 'kWh',
  gas: 'm\u00B3',
  water_cold: 'm\u00B3',
  water_hot: 'm\u00B3',
  heating: 'MWh',
};

const UNIT_OPTIONS = ['kWh', 'm\u00B3', 'MWh'];

function todayISO(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export default function AddMeterReading() {
  const router = useRouter();
  const params = useParams();
  const meterId = params?.id as string;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [meter, setMeter] = useState<MeterInfo | null>(null);

  const [readingValue, setReadingValue] = useState('');
  const [readingUnit, setReadingUnit] = useState('kWh');
  const [readingDate, setReadingDate] = useState(todayISO());
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!meterId) return;
    fetch(`/api/rentals/meters/${meterId}`)
      .then(r => r.json())
      .then(data => {
        const m = data.meter;
        if (m) {
          setMeter(m);
          setReadingUnit(DEFAULT_UNITS[m.meter_type] || 'kWh');
        }
      })
      .catch(err => console.error('[rentals] fetch meter failed:', err))
      .finally(() => setLoading(false));
  }, [meterId]);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    setPhoto(file);
    if (photoPreview) {
      URL.revokeObjectURL(photoPreview);
    }
    if (file) {
      setPhotoPreview(URL.createObjectURL(file));
    } else {
      setPhotoPreview(null);
    }
  }

  function removePhoto() {
    setPhoto(null);
    if (photoPreview) {
      URL.revokeObjectURL(photoPreview);
      setPhotoPreview(null);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  useEffect(() => {
    return () => {
      if (photoPreview) {
        URL.revokeObjectURL(photoPreview);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isValid = readingValue.trim() && readingDate;

  async function handleSave() {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append('reading_value', readingValue.trim());
      formData.append('reading_unit', readingUnit);
      formData.append('reading_date', readingDate);
      if (notes.trim()) formData.append('notes', notes.trim());
      if (photo) formData.append('photo', photo);

      const res = await fetch(`/api/rentals/meters/${meterId}/readings`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/rentals/meters/${meterId}`);
      } else {
        alert(data.error || 'Failed to save');
        setSaving(false);
      }
    } catch (err) {
      console.error('[rentals] add reading failed:', err);
      alert('Network error');
      setSaving(false);
    }
  }

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 transition-colors';
  const labelCls = 'block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Add Reading" supertitle="METER" showBack onBack={() => router.back()} />
        <div className="flex items-center justify-center py-20">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  const icon = meter ? (METER_ICONS[meter.meter_type] || '\uD83D\uDD0C') : '\uD83D\uDD0C';
  const typeLabel = meter ? (METER_LABELS[meter.meter_type] || meter.meter_type) : 'Meter';

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title="Add Reading"
        subtitle={meter ? `${icon} ${typeLabel} #${meter.meter_no}` : undefined}
        supertitle="METER READING"
        showBack
        onBack={() => router.back()}
      />

      <div className="px-4 py-5 space-y-4">
        {/* Meter info chip */}
        {meter && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-3 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
              <span className="text-[18px]">{icon}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-[#1F2933]">{typeLabel}</div>
              <div className="text-[11px] text-gray-500 font-mono">#{meter.meter_no}</div>
              {meter.location && <div className="text-[11px] text-gray-400">{meter.location}</div>}
            </div>
          </div>
        )}

        {/* Reading Value */}
        <div>
          <label className={labelCls}>Reading Value *</label>
          <input
            className={inputCls}
            value={readingValue}
            onChange={e => setReadingValue(e.target.value)}
            placeholder="12345.67"
            inputMode="decimal"
          />
        </div>

        {/* Unit */}
        <div>
          <label className={labelCls}>Unit *</label>
          <div className="grid grid-cols-3 gap-2">
            {UNIT_OPTIONS.map(u => (
              <button
                key={u}
                onClick={() => setReadingUnit(u)}
                className={`px-3 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors ${
                  readingUnit === u
                    ? 'bg-green-50 border-green-500 text-green-700'
                    : 'bg-white border-gray-200 text-gray-600 active:bg-gray-50'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>

        {/* Date */}
        <div>
          <label className={labelCls}>Date *</label>
          <input
            type="date"
            className={inputCls}
            value={readingDate}
            onChange={e => setReadingDate(e.target.value)}
          />
        </div>

        {/* Photo */}
        <div>
          <label className={labelCls}>Photo</label>
          {photoPreview ? (
            <div className="relative inline-block">
              <img
                src={photoPreview}
                alt="Reading preview"
                className="max-h-[200px] rounded-xl border border-gray-200 object-contain"
              />
              <button
                onClick={removePhoto}
                className="absolute -top-2 -right-2 w-7 h-7 bg-white rounded-full shadow-md flex items-center justify-center border border-gray-200"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full bg-white border-2 border-dashed border-gray-300 rounded-xl py-6 flex flex-col items-center gap-2 active:bg-gray-50 transition-colors"
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              <span className="text-[13px] text-gray-500">Tap to take or select photo</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoChange}
            className="hidden"
          />
        </div>

        {/* Notes */}
        <div>
          <label className={labelCls}>Notes</label>
          <textarea
            className={`${inputCls} min-h-[80px] resize-none`}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Additional notes..."
          />
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={!isValid || saving}
          className={`w-full font-semibold rounded-xl py-3.5 text-[14px] transition-colors shadow-lg ${
            isValid && !saving
              ? 'bg-green-600 text-white active:bg-green-700 shadow-green-600/30'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
          }`}
        >
          {saving ? 'Saving...' : 'Save Reading'}
        </button>
      </div>
    </div>
  );
}
