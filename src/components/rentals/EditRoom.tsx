'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';

export default function EditRoom() {
  const router = useRouter();
  const params = useParams();
  const roomId = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [propertyLabel, setPropertyLabel] = useState('');

  const [roomCode, setRoomCode] = useState('');
  const [roomName, setRoomName] = useState('');
  const [sizeSqm, setSizeSqm] = useState('');
  const [baseKaltmiete, setBaseKaltmiete] = useState('');
  const [utilityShare, setUtilityShare] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!roomId) return;
    fetch(`/api/rentals/rooms/${roomId}`)
      .then(r => r.json())
      .then(data => {
        const room = data.room;
        if (!room) {
          alert('Room not found');
          router.push('/rentals/rooms');
          return;
        }
        setRoomCode(room.room_code || '');
        setRoomName(room.room_name || '');
        setSizeSqm(room.size_sqm != null ? String(room.size_sqm) : '');
        setBaseKaltmiete(room.base_kaltmiete != null ? String(room.base_kaltmiete) : '');
        setUtilityShare(room.utility_share != null ? String(room.utility_share) : '');
        setNotes(room.notes || '');
        // Build property label from room data
        const parts = [room.property_street, room.property_plz, room.property_city].filter(Boolean);
        setPropertyLabel(parts.length > 0 ? parts.join(', ') : `Property #${room.property_id}`);
        setLoading(false);
      })
      .catch(err => {
        console.error('[rentals] load room failed:', err);
        alert('Failed to load room');
        router.push('/rentals/rooms');
      });
  }, [roomId, router]);

  const isValid = roomCode.trim() && sizeSqm;

  async function handleSave() {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/rentals/rooms/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_code: roomCode.trim(),
          room_name: roomName.trim() || null,
          size_sqm: Number(sizeSqm),
          base_kaltmiete: Number(baseKaltmiete) || 0,
          utility_share: Number(utilityShare) || 0,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/rentals/rooms/${roomId}`);
      } else {
        alert(data.error || 'Failed to save');
        setSaving(false);
      }
    } catch (err) {
      console.error('[rentals] edit room failed:', err);
      alert('Network error');
      setSaving(false);
    }
  }

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 transition-colors';
  const labelCls = 'block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Edit Room" supertitle="RENTALS" showBack onBack={() => router.push(`/rentals/rooms/${roomId}`)} />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-3 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader title="Edit Room" supertitle="RENTALS" showBack onBack={() => router.push(`/rentals/rooms/${roomId}`)} />

      <div className="px-4 py-5 space-y-4">
        <div>
          <label className={labelCls}>Property</label>
          <div className={`${inputCls} bg-gray-100 text-gray-500 cursor-not-allowed`}>
            {propertyLabel}
          </div>
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
