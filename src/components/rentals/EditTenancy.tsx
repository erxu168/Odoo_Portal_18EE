'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';

function eur(n: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

export default function EditTenancy() {
  const router = useRouter();
  const params = useParams();
  const tenancyId = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Read-only context
  const [tenantName, setTenantName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [propertyAddress, setPropertyAddress] = useState('');

  // Editable fields
  const [contractType, setContractType] = useState<'standard' | 'staffel' | 'index'>('standard');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [kaltmiete, setKaltmiete] = useState('');
  const [nebenkosten, setNebenkosten] = useState('');
  const [kaution, setKaution] = useState('');
  const [kautionReceived, setKautionReceived] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (!tenancyId) return;
    fetch(`/api/rentals/tenancies/${tenancyId}`)
      .then(r => r.json())
      .then(data => {
        const t = data.tenancy;
        if (!t) {
          alert('Tenancy not found');
          router.push('/rentals/tenancies');
          return;
        }
        // Read-only context
        setTenantName(data.tenant?.full_name || 'Unknown Tenant');
        setRoomCode(data.room?.room_code || '');
        const parts = [data.property?.street, data.property?.plz, data.property?.city].filter(Boolean);
        setPropertyAddress(parts.length > 0 ? parts.join(', ') : '');

        // Editable fields
        setContractType(t.contract_type || 'standard');
        setStartDate(t.start_date || '');
        setEndDate(t.end_date || '');
        setKaltmiete(t.kaltmiete != null ? String(t.kaltmiete) : '');
        setNebenkosten(t.nebenkosten != null ? String(t.nebenkosten) : '');
        setKaution(t.kaution != null ? String(t.kaution) : '');
        setKautionReceived(t.kaution_received != null ? String(t.kaution_received) : '');
        setNotes(t.notes || '');
        setLoading(false);
      })
      .catch(err => {
        console.error('[rentals] load tenancy failed:', err);
        alert('Failed to load tenancy');
        router.push('/rentals/tenancies');
      });
  }, [tenancyId, router]);

  const warmmiete = (Number(kaltmiete) || 0) + (Number(nebenkosten) || 0);

  const isValid = startDate && kaltmiete;

  async function handleSave() {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/rentals/tenancies/${tenancyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contract_type: contractType,
          start_date: startDate,
          end_date: endDate || null,
          kaltmiete: Number(kaltmiete),
          nebenkosten: Number(nebenkosten) || 0,
          kaution: Number(kaution) || 0,
          kaution_received: Number(kautionReceived) || 0,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        router.push(`/rentals/tenancies/${tenancyId}`);
      } else {
        alert(data.error || 'Failed to save');
        setSaving(false);
      }
    } catch (err) {
      console.error('[rentals] edit tenancy failed:', err);
      alert('Network error');
      setSaving(false);
    }
  }

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 transition-colors';
  const labelCls = 'block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5';

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Edit Tenancy" supertitle="RENTALS" showBack onBack={() => router.push(`/rentals/tenancies/${tenancyId}`)} />
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-3 border-green-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader title="Edit Tenancy" supertitle="RENTALS" showBack onBack={() => router.push(`/rentals/tenancies/${tenancyId}`)} />

      <div className="px-4 py-5 space-y-4">
        {/* Section 1: Tenant Info (read-only) */}
        <div className="bg-white rounded-xl border border-gray-200 px-4 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-2">Tenant</div>
          <div className="text-[16px] font-bold text-gray-900">{tenantName}</div>
          {(roomCode || propertyAddress) && (
            <div className="text-[12px] text-gray-500 mt-1">
              {roomCode}{roomCode && propertyAddress ? ' \u2014 ' : ''}{propertyAddress}
            </div>
          )}
        </div>

        {/* Section 2: Contract Terms (editable) */}
        <div>
          <label className={labelCls}>Contract Type</label>
          <div className="grid grid-cols-3 gap-2">
            {(['standard', 'staffel', 'index'] as const).map(ct => (
              <button
                key={ct}
                onClick={() => setContractType(ct)}
                className={`px-3 py-2.5 rounded-xl text-[12px] font-semibold border capitalize transition-colors ${
                  contractType === ct
                    ? 'bg-green-50 border-green-500 text-green-700'
                    : 'bg-white border-gray-200 text-gray-600 active:bg-gray-50'
                }`}
              >
                {ct === 'staffel' ? 'Staffel' : ct === 'index' ? 'Index' : 'Standard'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Start Date *</label>
            <input className={inputCls} value={startDate} onChange={e => setStartDate(e.target.value)} type="date" />
          </div>
          <div>
            <label className={labelCls}>End Date</label>
            <input className={inputCls} value={endDate} onChange={e => setEndDate(e.target.value)} type="date" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Kaltmiete ({'\u20ac'}) *</label>
            <input className={inputCls} value={kaltmiete} onChange={e => setKaltmiete(e.target.value)} placeholder="450" inputMode="decimal" />
          </div>
          <div>
            <label className={labelCls}>Nebenkosten ({'\u20ac'})</label>
            <input className={inputCls} value={nebenkosten} onChange={e => setNebenkosten(e.target.value)} placeholder="150" inputMode="decimal" />
          </div>
        </div>

        <div className="bg-green-50 rounded-xl p-3 flex items-center justify-between">
          <span className="text-[12px] font-semibold text-green-800">Warmmiete (total)</span>
          <span className="text-[16px] font-bold text-green-700 tabular-nums">{eur(warmmiete)}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Kaution ({'\u20ac'})</label>
            <input className={inputCls} value={kaution} onChange={e => setKaution(e.target.value)} placeholder="1350" inputMode="decimal" />
          </div>
          <div>
            <label className={labelCls}>Kaution Received ({'\u20ac'})</label>
            <input className={inputCls} value={kautionReceived} onChange={e => setKautionReceived(e.target.value)} placeholder="0" inputMode="decimal" />
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
          {saving ? 'Saving...' : 'Save Tenancy'}
        </button>
      </div>
    </div>
  );
}
