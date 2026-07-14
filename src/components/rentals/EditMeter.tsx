'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

type MeterType = 'electricity' | 'gas' | 'water_cold' | 'water_hot' | 'heating';

const TYPE_OPTIONS: { value: MeterType; label: string; icon: string }[] = [
  { value: 'electricity', label: 'Electricity', icon: '\u26A1' },
  { value: 'gas', label: 'Gas', icon: '\uD83D\uDD25' },
  { value: 'water_cold', label: 'Cold Water', icon: '\uD83D\uDCA7' },
  { value: 'water_hot', label: 'Hot Water', icon: '\uD83C\uDF21\uFE0F' },
  { value: 'heating', label: 'Heating', icon: '\uD83C\uDF21\uFE0F' },
];

export default function EditMeter() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [meterType, setMeterType] = useState<MeterType>('electricity');
  const [meterNo, setMeterNo] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    async function fetchMeter() {
      try {
        const res = await fetch(`/api/rentals/meters/${id}`);
        if (!res.ok) throw new Error('Failed to fetch meter');
        const data = await res.json();
        const m = data.meter;
        setMeterType(m.meter_type || 'electricity');
        setMeterNo(m.meter_no || '');
        setLocation(m.location || '');
        setNotes(m.notes || '');
      } catch (err) {
        console.error('[rentals] fetch meter failed:', err);
        alert('Failed to load meter');
        router.push(`/rentals/meters/${id}`);
      } finally {
        setLoading(false);
      }
    }
    fetchMeter();
  }, [id, router]);

  const isValid = meterNo.trim();

  async function handleSave() {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/rentals/meters/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meter_type: meterType,
          meter_no: meterNo.trim(),
          location: location.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/rentals/meters/${id}`);
      } else {
        alert(data.error || 'Failed to save');
        setSaving(false);
      }
    } catch (err) {
      console.error('[rentals] edit meter failed:', err);
      alert('Network error');
      setSaving(false);
    }
  }

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 transition-colors';
  const labelCls = 'block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Edit Meter" supertitle="RENTALS" showBack onBack={() => router.push(`/rentals/meters/${id}`)} />
        <div className="flex items-center justify-center py-20">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title="Edit Meter"
        supertitle="RENTALS"
        showBack
        onBack={() => {
          if (meterNo) {
            setShowConfirm(true);
          } else {
            router.push(`/rentals/meters/${id}`);
          }
        }}
      />

      <div className="px-4 py-5 space-y-4">
        {/* Meter Type */}
        <div>
          <label className={labelCls}>Meter Type *</label>
          <div className="grid grid-cols-2 gap-2">
            {TYPE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setMeterType(opt.value)}
                className={`px-3 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors ${
                  meterType === opt.value
                    ? 'bg-green-50 border-green-500 text-green-700'
                    : 'bg-white border-gray-200 text-gray-600 active:bg-gray-50'
                }`}
              >
                {opt.icon} {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Meter Number */}
        <div>
          <label className={labelCls}>Meter Number *</label>
          <input
            className={inputCls}
            value={meterNo}
            onChange={e => setMeterNo(e.target.value)}
            placeholder="e.g. 1ESY1234567890"
          />
        </div>

        {/* Location */}
        <div>
          <label className={labelCls}>Location</label>
          <input
            className={inputCls}
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder="e.g. Keller, Flur"
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
          {saving ? 'Saving...' : 'Save Meter'}
        </button>
      </div>

      {showConfirm && (
        <ConfirmDialog
          title="Discard changes?"
          message="You have unsaved changes. Are you sure you want to go back?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          variant="danger"
          onConfirm={() => router.push(`/rentals/meters/${id}`)}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
