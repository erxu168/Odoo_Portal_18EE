'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';

interface PropertyOption {
  id: number;
  street: string;
  plz: string;
  city: string;
}

export default function AddRoom() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedProperty = searchParams?.get('property_id') || '';

  const [saving, setSaving] = useState(false);
  const [properties, setProperties] = useState<PropertyOption[]>([]);

  const [propertyId, setPropertyId] = useState(preselectedProperty);
  const [roomCode, setRoomCode] = useState('');
  const [roomName, setRoomName] = useState('');
  const [sizeSqm, setSizeSqm] = useState('');
  const [baseKaltmiete, setBaseKaltmiete] = useState('');
  const [utilityShare, setUtilityShare] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    fetch('/api/rentals/properties')
      .then(r => r.json())
      .then(data => setProperties((data.properties || []).map((p: any) => ({ id: p.id, street: p.street, plz: p.plz, city: p.city }))))
      .catch(err => console.error('[rentals] properties load failed:', err));
  }, []);

  const isValid = propertyId && roomCode.trim() && sizeSqm;

  async function handleSave() {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/rentals/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: Number(propertyId),
          room_code: roomCode.trim(),
          room_name: roomName.trim() || null,
          size_sqm: Number(sizeSqm),
          base_kaltmiete: Number(baseKaltmiete) || 0,
          utility_share: Number(utilityShare) || 0,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        router.push(`/rentals/rooms/${data.id}`);
      } else {
        alert(data.error || 'Failed to save');
        setSaving(false);
      }
    } catch (err) {
      console.error('[rentals] add room failed:', err);
      alert('Network error');
      setSaving(false);
    }
  }

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 transition-colors';
  const labelCls = 'block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5';

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader title="Add Room" supertitle="RENTALS" showBack onBack={() => router.back()} />

      <div className="px-4 py-5 space-y-4">
        <div>
          <label className={labelCls}>Property *</label>
          <select className={inputCls} value={propertyId} onChange={e => setPropertyId(e.target.value)}>
            <option value="">Select property...</option>
            {properties.map(p => (
              <option key={p.id} value={p.id}>{p.street}, {p.plz} {p.city}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Room Code *</label>
            <input className={inputCls} value={roomCode} onChange={e => setRoomCode(e.target.value)} placeholder="A1" />
          </div>
          <div>
            <label className={labelCls}>Room Name</label>
            <input className={inputCls} value={roomName} onChange={e => setRoomName(e.target.value)} placeholder="Front room" />
          </div>
        </div>

        <div>
          <label className={labelCls}>Size (m{'\u00b2'}) *</label>
          <input className={inputCls} value={sizeSqm} onChange={e => setSizeSqm(e.target.value)} placeholder="18" inputMode="decimal" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Base Kaltmiete ({'\u20ac'})</label>
            <input className={inputCls} value={baseKaltmiete} onChange={e => setBaseKaltmiete(e.target.value)} placeholder="450" inputMode="decimal" />
          </div>
          <div>
            <label className={labelCls}>Utility Share ({'\u20ac'})</label>
            <input className={inputCls} value={utilityShare} onChange={e => setUtilityShare(e.target.value)} placeholder="150" inputMode="decimal" />
          </div>
        </div>

        <div>
          <label className={labelCls}>Notes</label>
          <textarea
            className={`${inputCls} min-h-[80px] resize-none`}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Additional notes..."
          />
        </div>

        <button
          onClick={handleSave}
          disabled={!isValid || saving}
          className={`w-full font-semibold rounded-xl py-3.5 text-[14px] transition-colors shadow-lg ${
            isValid && !saving
              ? 'bg-green-600 text-white active:bg-green-700 shadow-green-600/30'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
          }`}
        >
          {saving ? 'Saving...' : 'Save Room'}
        </button>
      </div>
    </div>
  );
}
