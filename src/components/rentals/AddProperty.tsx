'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

type PropertyType = 'apartment_wg' | 'house' | 'studio' | 'other';

const TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: 'apartment_wg', label: 'Apartment (WG)' },
  { value: 'house', label: 'House' },
  { value: 'studio', label: 'Studio' },
  { value: 'other', label: 'Other' },
];

export default function AddProperty() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [street, setStreet] = useState('');
  const [plz, setPlz] = useState('');
  const [city, setCity] = useState('Berlin');
  const [floorUnit, setFloorUnit] = useState('');
  const [type, setType] = useState<PropertyType>('apartment_wg');
  const [totalSize, setTotalSize] = useState('');
  const [owner, setOwner] = useState('');
  const [hausverwaltung, setHausverwaltung] = useState('');
  const [mietspiegel, setMietspiegel] = useState('');
  const [notes, setNotes] = useState('');

  const isValid = street.trim() && plz.trim() && city.trim();

  async function handleSave() {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/rentals/properties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          street: street.trim(),
          plz: plz.trim(),
          city: city.trim(),
          floor_unit: floorUnit.trim() || null,
          type,
          total_size_sqm: totalSize ? Number(totalSize) : null,
          owner: owner.trim() || null,
          hausverwaltung: hausverwaltung.trim() || null,
          mietspiegel_eur_per_sqm: mietspiegel ? Number(mietspiegel) : null,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        router.push(`/rentals/properties/${data.id}`);
      } else {
        alert(data.error || 'Failed to save');
        setSaving(false);
      }
    } catch (err) {
      console.error('[rentals] add property failed:', err);
      alert('Network error');
      setSaving(false);
    }
  }

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 transition-colors';
  const labelCls = 'block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5';

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title="Add Property"
        supertitle="RENTALS"
        showBack
        onBack={() => {
          if (street || plz !== '' || owner) {
            setShowConfirm(true);
          } else {
            router.push('/rentals/properties');
          }
        }}
      />

      <div className="px-4 py-5 space-y-4">
        {/* Street */}
        <div>
          <label className={labelCls}>Street & Number *</label>
          <input className={inputCls} value={street} onChange={e => setStreet(e.target.value)} placeholder="Warschauer Str. 33" />
        </div>

        {/* PLZ + City row */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>PLZ *</label>
            <input className={inputCls} value={plz} onChange={e => setPlz(e.target.value)} placeholder="10243" inputMode="numeric" />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>City *</label>
            <input className={inputCls} value={city} onChange={e => setCity(e.target.value)} placeholder="Berlin" />
          </div>
        </div>

        {/* Floor/Unit */}
        <div>
          <label className={labelCls}>Floor / Unit</label>
          <input className={inputCls} value={floorUnit} onChange={e => setFloorUnit(e.target.value)} placeholder="3. OG links" />
        </div>

        {/* Type */}
        <div>
          <label className={labelCls}>Property Type *</label>
          <div className="grid grid-cols-2 gap-2">
            {TYPE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setType(opt.value)}
                className={`px-3 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors ${
                  type === opt.value
                    ? 'bg-green-50 border-green-500 text-green-700'
                    : 'bg-white border-gray-200 text-gray-600 active:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Size */}
        <div>
          <label className={labelCls}>Total Size (m{'\u00b2'})</label>
          <input className={inputCls} value={totalSize} onChange={e => setTotalSize(e.target.value)} placeholder="85" inputMode="decimal" />
        </div>

        {/* Owner */}
        <div>
          <label className={labelCls}>Owner</label>
          <input className={inputCls} value={owner} onChange={e => setOwner(e.target.value)} placeholder="Property owner name" />
        </div>

        {/* Hausverwaltung */}
        <div>
          <label className={labelCls}>Hausverwaltung</label>
          <input className={inputCls} value={hausverwaltung} onChange={e => setHausverwaltung(e.target.value)} placeholder="Management company" />
        </div>

        {/* Mietspiegel */}
        <div>
          <label className={labelCls}>Mietspiegel ({'\u20ac'}/m{'\u00b2'})</label>
          <input className={inputCls} value={mietspiegel} onChange={e => setMietspiegel(e.target.value)} placeholder="7.50" inputMode="decimal" />
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
          {saving ? 'Saving...' : 'Save Property'}
        </button>
      </div>

      {showConfirm && (
        <ConfirmDialog
          title="Discard changes?"
          message="You have unsaved changes. Are you sure you want to go back?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          variant="danger"
          onConfirm={() => router.push('/rentals/properties')}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
