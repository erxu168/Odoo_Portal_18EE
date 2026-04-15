'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

interface TenancyOption {
  id: number;
  tenant_name: string;
  room_code: string;
  room_name: string | null;
  street: string;
  plz: string;
  city: string;
  status: string;
}

type InspectionType = 'move_in' | 'move_out';

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function CreateInspectionInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedTenancy = searchParams?.get('tenancy_id') || '';

  const [saving, setSaving] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [tenancies, setTenancies] = useState<TenancyOption[]>([]);
  const [loadingTenancies, setLoadingTenancies] = useState(true);

  const [tenancyId, setTenancyId] = useState(preselectedTenancy);
  const [type, setType] = useState<InspectionType>('move_in');
  const [inspectionDate, setInspectionDate] = useState(todayISO());
  const [inspectorName, setInspectorName] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    fetch('/api/rentals/tenancies?status=active')
      .then(r => r.json())
      .then(data => {
        const rows = (data.tenancies || []) as TenancyOption[];
        setTenancies(rows);
      })
      .catch(err => console.error('[rentals] tenancies load failed:', err))
      .finally(() => setLoadingTenancies(false));
  }, []);

  const isValid = tenancyId && inspectionDate && inspectorName.trim();
  const isDirty = tenancyId !== preselectedTenancy || inspectorName || notes;

  async function handleSave() {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/rentals/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenancy_id: Number(tenancyId),
          type,
          inspection_date: inspectionDate,
          inspector_name: inspectorName.trim(),
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        router.push(`/rentals/inspections/${data.id}`);
      } else {
        alert(data.error || 'Failed to create inspection');
        setSaving(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error';
      console.error('[rentals] create inspection failed:', err);
      alert(msg);
      setSaving(false);
    }
  }

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 transition-colors';
  const labelCls = 'block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5';

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title="New Inspection"
        supertitle={'\u00dc' + 'BERGABEPROTOKOLL'}
        showBack
        onBack={() => {
          if (isDirty) {
            setShowDiscard(true);
          } else {
            router.push('/rentals/inspections');
          }
        }}
      />

      <div className="px-4 py-5 space-y-4">
        {/* Tenancy selector */}
        <div>
          <label className={labelCls}>Tenancy *</label>
          {loadingTenancies ? (
            <div className={`${inputCls} flex items-center text-gray-400`}>Loading tenancies...</div>
          ) : tenancies.length === 0 ? (
            <div className={`${inputCls} text-gray-400`}>No active tenancies found</div>
          ) : (
            <select
              className={inputCls}
              value={tenancyId}
              onChange={e => setTenancyId(e.target.value)}
            >
              <option value="">Select tenancy...</option>
              {tenancies.map(t => (
                <option key={t.id} value={t.id}>
                  {t.tenant_name} {'\u2014'} {t.room_code}, {t.street}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Inspection type */}
        <div>
          <label className={labelCls}>Type *</label>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: 'move_in' as InspectionType, label: 'Move In' },
              { value: 'move_out' as InspectionType, label: 'Move Out' },
            ]).map(opt => (
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

        {/* Inspection date */}
        <div>
          <label className={labelCls}>Inspection Date *</label>
          <input
            className={inputCls}
            type="date"
            value={inspectionDate}
            onChange={e => setInspectionDate(e.target.value)}
          />
        </div>

        {/* Inspector name */}
        <div>
          <label className={labelCls}>Inspector Name *</label>
          <input
            className={inputCls}
            value={inspectorName}
            onChange={e => setInspectorName(e.target.value)}
            placeholder="Full name of inspector"
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

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={!isValid || saving}
          className={`w-full font-semibold rounded-xl py-3.5 text-[14px] transition-colors shadow-lg ${
            isValid && !saving
              ? 'bg-green-600 text-white active:bg-green-700 shadow-green-600/30'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
          }`}
        >
          {saving ? 'Creating...' : 'Create Inspection'}
        </button>
      </div>

      {showDiscard && (
        <ConfirmDialog
          title="Discard changes?"
          message="You have unsaved data. Are you sure you want to leave?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          variant="danger"
          onConfirm={() => router.push('/rentals/inspections')}
          onCancel={() => setShowDiscard(false)}
        />
      )}
    </div>
  );
}

export default function CreateInspection() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#F6F7F9] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
      </div>
    }>
      <CreateInspectionInner />
    </Suspense>
  );
}
