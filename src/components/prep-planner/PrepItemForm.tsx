'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';

export interface PrepItemFormValues {
  name: string;
  station: string;
  prep_type: 'advance' | 'batch' | 'ondemand' | '';
  prep_time_min: string;
  max_holding_min: string;
  batch_size: string;
  unit: string;
  notes: string;
  active: boolean;
}

export const EMPTY_FORM: PrepItemFormValues = {
  name: '',
  station: '',
  prep_type: '',
  prep_time_min: '',
  max_holding_min: '',
  batch_size: '',
  unit: 'portion',
  notes: '',
  active: true,
};

const STATIONS = ['grill', 'drawer', 'pot', 'fryer', 'cold', 'oven', 'sauté', 'other'];
const UNITS = ['portion', 'kg', 'g', 'l', 'ml', 'piece', 'tray'];

interface PrepItemFormProps {
  mode: 'create' | 'edit';
  companyId: number;
  itemId?: number;
  initial?: PrepItemFormValues;
  onSaved?: () => void;
}

export default function PrepItemForm({ mode, companyId, itemId, initial, onSaved }: PrepItemFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<PrepItemFormValues>(initial || EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function field<K extends keyof PrepItemFormValues>(key: K, value: PrepItemFormValues[K]) {
    setValues(prev => ({ ...prev, [key]: value }));
  }

  function toNumOrNull(v: string): number | null {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!values.name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError(null);

    const body: Record<string, unknown> = {
      company_id: companyId,
      name: values.name.trim(),
      station: values.station || null,
      prep_type: values.prep_type || null,
      prep_time_min: toNumOrNull(values.prep_time_min),
      max_holding_min: toNumOrNull(values.max_holding_min),
      batch_size: toNumOrNull(values.batch_size),
      unit: values.unit || 'portion',
      notes: values.notes.trim() || null,
    };
    if (mode === 'edit') body.active = values.active ? 1 : 0;

    try {
      const url = mode === 'create'
        ? '/api/prep-planner/items'
        : `/api/prep-planner/items/${itemId}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Save failed');
      }

      if (onSaved) {
        onSaved();
      } else if (mode === 'create') {
        router.push(`/prep-planner/items/${data.id}?companyId=${companyId}`);
      } else {
        router.push(`/prep-planner/items/${itemId}?companyId=${companyId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F6F7F9] pb-24">
      <AppHeader
        supertitle={mode === 'create' ? 'NEW PREP ITEM' : 'EDIT'}
        title={mode === 'create' ? 'Add prep item' : values.name || 'Edit item'}
        showBack
        onBack={() => router.back()}
      />

      <form onSubmit={handleSubmit} className="px-4 py-4 space-y-4">
        <FormCard title="Basics">
          <FieldText label="Name" placeholder="e.g. Rice, Kimchi, Bulgogi Marinade" required value={values.name} onChange={v => field('name', v)} />
          <FieldSelect label="Station" value={values.station} onChange={v => field('station', v)} options={[['', 'Not set'], ...STATIONS.map(s => [s, s] as [string, string])]} />
          <FieldSelect
            label="Prep type"
            value={values.prep_type}
            onChange={v => field('prep_type', v as PrepItemFormValues['prep_type'])}
            options={[
              ['', 'Not set'],
              ['ondemand', 'Start now \u2014 cook fresh, bottleneck'],
              ['batch', 'Batch \u2014 cook together in groups'],
              ['advance', 'Plate \u2014 already prepped, just plate'],
            ]}
          />
          <FieldSelect label="Unit" value={values.unit} onChange={v => field('unit', v)} options={UNITS.map(u => [u, u] as [string, string])} />
        </FormCard>

        <FormCard title="Timing">
          <FieldNumber label="Prep time (min)" value={values.prep_time_min} onChange={v => field('prep_time_min', v)} hint="How long to cook a batch from scratch" />
          <FieldNumber label="Max holding (min)" value={values.max_holding_min} onChange={v => field('max_holding_min', v)} hint="How long the food stays good after prep" />
          <FieldNumber label="Batch size" value={values.batch_size} onChange={v => field('batch_size', v)} hint="Portions per batch" />
        </FormCard>

        <FormCard title="Notes">
          <textarea
            value={values.notes}
            onChange={e => field('notes', e.target.value)}
            placeholder="Optional recipe notes\u2026"
            rows={3}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-[14px] resize-none"
          />
        </FormCard>

        {mode === 'edit' && (
          <FormCard title="Status">
            <label className="flex items-center justify-between">
              <span className="text-[14px] text-gray-700">Active</span>
              <input
                type="checkbox"
                checked={values.active}
                onChange={e => field('active', e.target.checked)}
                className="w-5 h-5"
              />
            </label>
            <div className="text-[11px] text-gray-500 -mt-1">Inactive items are excluded from forecasts.</div>
          </FormCard>
        )}

        {error && (
          <div className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-800">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full h-12 rounded-xl bg-cyan-600 text-white font-bold text-[15px] shadow-lg shadow-cyan-600/30 active:scale-[0.98] transition-transform disabled:opacity-50"
        >
          {saving ? 'Saving\u2026' : mode === 'create' ? 'Create item' : 'Save changes'}
        </button>
      </form>
    </div>
  );
}

function FormCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 space-y-3">
      <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400">{title}</div>
      {children}
    </div>
  );
}

function FieldText({ label, value, onChange, placeholder, required }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold text-gray-600 mb-1">{label}{required && <span className="text-red-500"> *</span>}</span>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full h-11 px-3 rounded-lg border border-gray-200 bg-white text-[14px]"
      />
    </label>
  );
}

function FieldNumber({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold text-gray-600 mb-1">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full h-11 px-3 rounded-lg border border-gray-200 bg-white text-[14px]"
      />
      {hint && <div className="text-[11px] text-gray-500 mt-1">{hint}</div>}
    </label>
  );
}

function FieldSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold text-gray-600 mb-1">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full h-11 px-3 rounded-lg border border-gray-200 bg-white text-[14px]"
      >
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
