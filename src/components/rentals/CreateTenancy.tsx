'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

type Step = 'tenant' | 'terms' | 'review';

const STEPS: { key: Step; label: string }[] = [
  { key: 'tenant', label: 'Tenant' },
  { key: 'terms', label: 'Terms' },
  { key: 'review', label: 'Review' },
];

function eur(n: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

interface RoomOption {
  id: number;
  room_code: string;
  room_name: string | null;
  size_sqm: number;
  base_kaltmiete: number;
  utility_share: number;
  status: string;
  property_id: number;
  active_tenant_name?: string;
}

export default function CreateTenancy() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedRoom = searchParams?.get('room_id');

  const [step, setStep] = useState<Step>('tenant');
  const [saving, setSaving] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [rooms, setRooms] = useState<RoomOption[]>([]);

  // Tenant fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');

  // Terms fields
  const [roomId, setRoomId] = useState(preselectedRoom || '');
  const [contractType, setContractType] = useState<'standard' | 'staffel' | 'index'>('standard');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [kaltmiete, setKaltmiete] = useState('');
  const [nebenkosten, setNebenkosten] = useState('');
  const [kaution, setKaution] = useState('');

  // Staffel steps
  const [staffelSteps, setStaffelSteps] = useState<{ effective_date: string; new_kaltmiete: string }[]>([]);

  useEffect(() => {
    fetch('/api/rentals/rooms')
      .then(r => r.json())
      .then(data => {
        const allRooms = (data.rooms || []) as RoomOption[];
        setRooms(allRooms);
        // Pre-fill rent from selected room
        if (preselectedRoom) {
          const rm = allRooms.find((r: RoomOption) => r.id === Number(preselectedRoom));
          if (rm) {
            setKaltmiete(String(rm.base_kaltmiete));
            setNebenkosten(String(rm.utility_share));
          }
        }
      })
      .catch(err => console.error('[rentals] rooms load failed:', err));
  }, [preselectedRoom]);

  function handleRoomChange(rid: string) {
    setRoomId(rid);
    const rm = rooms.find(r => r.id === Number(rid));
    if (rm) {
      setKaltmiete(String(rm.base_kaltmiete));
      setNebenkosten(String(rm.utility_share));
      setKaution(String(rm.base_kaltmiete * 3));
    }
  }

  const warmmiete = (Number(kaltmiete) || 0) + (Number(nebenkosten) || 0);

  const tenantValid = fullName.trim();
  const termsValid = roomId && startDate && kaltmiete;

  async function handleSubmit() {
    if (saving) return;
    setSaving(true);
    try {
      // Create tenant first
      const tenantRes = await fetch('/api/rentals/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          dob: dob || null,
        }),
      });
      const tenantData = await tenantRes.json();
      if (!tenantRes.ok) throw new Error(tenantData.error || 'Tenant creation failed');

      // Create tenancy
      const tenancyRes = await fetch('/api/rentals/tenancies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_id: Number(roomId),
          tenant_id: tenantData.id,
          contract_type: contractType,
          start_date: startDate,
          end_date: endDate || null,
          kaltmiete: Number(kaltmiete),
          nebenkosten: Number(nebenkosten) || 0,
          kaution: Number(kaution) || 0,
          staffel_steps: contractType === 'staffel' ? staffelSteps.map(s => ({
            effective_date: s.effective_date,
            new_kaltmiete: Number(s.new_kaltmiete),
          })) : undefined,
        }),
      });
      const tenancyData = await tenancyRes.json();
      if (!tenancyRes.ok) throw new Error(tenancyData.error || 'Tenancy creation failed');

      router.push(`/rentals/tenancies/${tenancyData.id}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      alert(msg);
      setSaving(false);
    }
  }

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 transition-colors';
  const labelCls = 'block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5';

  const stepIdx = STEPS.findIndex(s => s.key === step);

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title="New Tenancy"
        supertitle="RENTALS"
        showBack
        onBack={() => {
          if (fullName || email) setShowDiscard(true);
          else router.push('/rentals/tenancies');
        }}
      />

      {/* Step indicator */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <React.Fragment key={s.key}>
              <button
                onClick={() => {
                  if (i <= stepIdx) setStep(s.key);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
                  step === s.key
                    ? 'bg-green-600 text-white'
                    : i < stepIdx
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-400'
                }`}
              >
                <span>{i + 1}</span>
                <span>{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <div className="flex-1 h-px bg-gray-200" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="px-4 py-4">
        {/* Step 1: Tenant */}
        {step === 'tenant' && (
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Full Name *</label>
              <input className={inputCls} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Max Mustermann" />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input className={inputCls} value={email} onChange={e => setEmail(e.target.value)} placeholder="max@example.com" type="email" />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input className={inputCls} value={phone} onChange={e => setPhone(e.target.value)} placeholder="+49 170 1234567" type="tel" />
            </div>
            <div>
              <label className={labelCls}>Date of Birth</label>
              <input className={inputCls} value={dob} onChange={e => setDob(e.target.value)} type="date" />
            </div>
            <button
              onClick={() => setStep('terms')}
              disabled={!tenantValid}
              className={`w-full font-semibold rounded-xl py-3.5 text-[14px] transition-colors ${
                tenantValid
                  ? 'bg-green-600 text-white active:bg-green-700 shadow-lg shadow-green-600/30'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              Next: Contract Terms
            </button>
          </div>
        )}

        {/* Step 2: Terms */}
        {step === 'terms' && (
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Room *</label>
              <select
                className={inputCls}
                value={roomId}
                onChange={e => handleRoomChange(e.target.value)}
              >
                <option value="">Select a room...</option>
                {rooms.filter(r => r.status === 'vacant' || r.id === Number(roomId)).map(r => (
                  <option key={r.id} value={r.id}>
                    {r.room_code} {r.room_name ? `\u2014 ${r.room_name}` : ''} ({r.size_sqm}m{'\u00b2'})
                    {r.status !== 'vacant' ? ` [${r.status}]` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Contract Type *</label>
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

            <div>
              <label className={labelCls}>Kaution ({'\u20ac'})</label>
              <input className={inputCls} value={kaution} onChange={e => setKaution(e.target.value)} placeholder="1350" inputMode="decimal" />
            </div>

            {/* Staffel steps */}
            {contractType === 'staffel' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className={labelCls}>Staffelmiete Steps</label>
                  <button
                    onClick={() => setStaffelSteps(prev => [...prev, { effective_date: '', new_kaltmiete: '' }])}
                    className="text-[12px] font-semibold text-green-700 active:opacity-70"
                  >
                    + Add Step
                  </button>
                </div>
                {staffelSteps.map((s, i) => (
                  <div key={i} className="grid grid-cols-5 gap-2 mb-2">
                    <div className="col-span-3">
                      <input
                        className={inputCls}
                        value={s.effective_date}
                        onChange={e => {
                          const updated = [...staffelSteps];
                          updated[i] = { ...updated[i], effective_date: e.target.value };
                          setStaffelSteps(updated);
                        }}
                        type="date"
                        placeholder="Date"
                      />
                    </div>
                    <div className="col-span-1">
                      <input
                        className={inputCls}
                        value={s.new_kaltmiete}
                        onChange={e => {
                          const updated = [...staffelSteps];
                          updated[i] = { ...updated[i], new_kaltmiete: e.target.value };
                          setStaffelSteps(updated);
                        }}
                        placeholder={'\u20ac'}
                        inputMode="decimal"
                      />
                    </div>
                    <button
                      onClick={() => setStaffelSteps(prev => prev.filter((_, idx) => idx !== i))}
                      className="w-full h-[48px] rounded-xl bg-red-50 text-red-600 flex items-center justify-center active:bg-red-100"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setStep('review')}
              disabled={!termsValid}
              className={`w-full font-semibold rounded-xl py-3.5 text-[14px] transition-colors ${
                termsValid
                  ? 'bg-green-600 text-white active:bg-green-700 shadow-lg shadow-green-600/30'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              Next: Review
            </button>
          </div>
        )}

        {/* Step 3: Review */}
        {step === 'review' && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)]">
              <div className="px-4 pt-4 pb-2 border-b border-gray-100">
                <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400">Tenant</div>
              </div>
              {[
                { label: 'Name', value: fullName },
                { label: 'Email', value: email },
                { label: 'Phone', value: phone || '\u2014' },
                { label: 'DOB', value: dob || '\u2014' },
              ].map((f, i) => (
                <div key={f.label} className={`flex items-center justify-between px-4 py-2.5 ${i < 3 ? 'border-b border-gray-100' : ''}`}>
                  <span className="text-[12px] text-gray-500">{f.label}</span>
                  <span className="text-[13px] font-semibold text-[#1F2933]">{f.value}</span>
                </div>
              ))}
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)]">
              <div className="px-4 pt-4 pb-2 border-b border-gray-100">
                <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400">Contract Terms</div>
              </div>
              {[
                { label: 'Room', value: rooms.find(r => r.id === Number(roomId))?.room_code || roomId },
                { label: 'Contract', value: contractType === 'staffel' ? 'Staffelmiete' : contractType === 'index' ? 'Indexmiete' : 'Standard' },
                { label: 'Start', value: startDate },
                { label: 'End', value: endDate || 'Open-ended' },
                { label: 'Kaltmiete', value: eur(Number(kaltmiete) || 0) },
                { label: 'Nebenkosten', value: eur(Number(nebenkosten) || 0) },
                { label: 'Warmmiete', value: eur(warmmiete) },
                { label: 'Kaution', value: eur(Number(kaution) || 0) },
              ].map((f, i) => (
                <div key={f.label} className={`flex items-center justify-between px-4 py-2.5 ${i < 7 ? 'border-b border-gray-100' : ''}`}>
                  <span className="text-[12px] text-gray-500">{f.label}</span>
                  <span className="text-[13px] font-semibold text-[#1F2933]">{f.value}</span>
                </div>
              ))}
            </div>

            {staffelSteps.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)]">
                <div className="px-4 pt-4 pb-2 border-b border-gray-100">
                  <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400">Staffel Steps</div>
                </div>
                {staffelSteps.map((s, i) => (
                  <div key={i} className={`flex items-center justify-between px-4 py-2.5 ${i < staffelSteps.length - 1 ? 'border-b border-gray-100' : ''}`}>
                    <span className="text-[12px] text-gray-500">{s.effective_date}</span>
                    <span className="text-[13px] font-bold text-[#1F2933] tabular-nums">{eur(Number(s.new_kaltmiete) || 0)}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <button
                onClick={handleSubmit}
                disabled={saving}
                className={`w-full font-semibold rounded-xl py-3.5 text-[14px] transition-colors ${
                  saving
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-green-600 text-white active:bg-green-700 shadow-lg shadow-green-600/30'
                }`}
              >
                {saving ? 'Creating...' : 'Create Tenancy'}
              </button>
              <button
                onClick={() => setStep('terms')}
                className="w-full bg-white border border-gray-200 text-gray-700 font-semibold rounded-xl py-3.5 text-[14px] active:bg-gray-50"
              >
                Back to Edit
              </button>
            </div>
          </div>
        )}
      </div>

      {showDiscard && (
        <ConfirmDialog
          title="Discard changes?"
          message="You have unsaved data. Are you sure you want to leave?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          variant="danger"
          onConfirm={() => router.push('/rentals/tenancies')}
          onCancel={() => setShowDiscard(false)}
        />
      )}
    </div>
  );
}
