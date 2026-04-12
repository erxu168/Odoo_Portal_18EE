'use client';

import React, { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

type Category = 'electricity' | 'gas' | 'water' | 'internet' | 'insurance' | 'recycling' | 'other';
type Frequency = 'monthly' | 'quarterly' | 'annual' | 'one_time';

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'electricity', label: 'Electricity' },
  { value: 'gas', label: 'Gas' },
  { value: 'water', label: 'Water' },
  { value: 'internet', label: 'Internet' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'recycling', label: 'Recycling' },
  { value: 'other', label: 'Other' },
];

const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
  { value: 'one_time', label: 'One-time' },
];

function AddUtilityInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const propertyId = searchParams?.get('property_id') || '';

  const [saving, setSaving] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [category, setCategory] = useState<Category>('electricity');
  const [customLabel, setCustomLabel] = useState('');
  const [providerName, setProviderName] = useState('');
  const [accountNo, setAccountNo] = useState('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');

  const showDueDate = frequency === 'quarterly' || frequency === 'annual' || frequency === 'one_time';
  const showCustomLabel = category === 'other';

  const isValid =
    propertyId &&
    category &&
    providerName.trim() &&
    amount.trim() &&
    (category !== 'other' || customLabel.trim());

  async function handleSave() {
    if (!isValid || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/rentals/utilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: Number(propertyId),
          category,
          custom_label: showCustomLabel ? customLabel.trim() : null,
          provider_name: providerName.trim(),
          account_no: accountNo.trim() || null,
          monthly_cost: Number(amount),
          frequency,
          due_date: showDueDate && dueDate ? dueDate : null,
          notes: notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        router.push(`/rentals/properties/${propertyId}`);
      } else {
        alert(data.error || 'Failed to save');
        setSaving(false);
      }
    } catch (err) {
      console.error('[rentals] add utility failed:', err);
      alert('Network error');
      setSaving(false);
    }
  }

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 transition-colors';
  const labelCls = 'block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5';

  const backPath = propertyId ? `/rentals/properties/${propertyId}` : '/rentals/properties';

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title="Add Cost"
        supertitle="RENTALS"
        showBack
        onBack={() => {
          if (providerName || amount || notes) {
            setShowConfirm(true);
          } else {
            router.push(backPath);
          }
        }}
      />

      <div className="px-4 py-5 space-y-4">
        {/* Category */}
        <div>
          <label className={labelCls}>Category *</label>
          <select className={inputCls} value={category} onChange={e => setCategory(e.target.value as Category)}>
            {CATEGORY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Custom Label — only when category is 'other' */}
        {showCustomLabel && (
          <div>
            <label className={labelCls}>Custom Label *</label>
            <input className={inputCls} value={customLabel} onChange={e => setCustomLabel(e.target.value)} placeholder="e.g. Chimney Inspection, Heating Oil" />
          </div>
        )}

        {/* Provider Name */}
        <div>
          <label className={labelCls}>Provider Name *</label>
          <input className={inputCls} value={providerName} onChange={e => setProviderName(e.target.value)} placeholder="Company name" />
        </div>

        {/* Account No */}
        <div>
          <label className={labelCls}>Account No</label>
          <input className={inputCls} value={accountNo} onChange={e => setAccountNo(e.target.value)} placeholder="Contract/account number" />
        </div>

        {/* Amount */}
        <div>
          <label className={labelCls}>Amount ({'\u20ac'}) *</label>
          <input className={inputCls} value={amount} onChange={e => setAmount(e.target.value)} placeholder="120.00" inputMode="decimal" />
        </div>

        {/* Frequency */}
        <div>
          <label className={labelCls}>Frequency *</label>
          <select className={inputCls} value={frequency} onChange={e => setFrequency(e.target.value as Frequency)}>
            {FREQUENCY_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Due Date — only for quarterly/annual/one_time */}
        {showDueDate && (
          <div>
            <label className={labelCls}>Due Date</label>
            <input className={inputCls} type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
        )}

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
          {saving ? 'Saving...' : 'Save Cost'}
        </button>
      </div>

      {showConfirm && (
        <ConfirmDialog
          title="Discard changes?"
          message="You have unsaved changes. Are you sure you want to go back?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          variant="danger"
          onConfirm={() => router.push(backPath)}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}

export default function AddUtility() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#F6F7F9] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
      </div>
    }>
      <AddUtilityInner />
    </Suspense>
  );
}
