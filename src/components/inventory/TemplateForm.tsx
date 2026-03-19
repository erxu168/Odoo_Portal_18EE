'use client';

import React, { useState } from 'react';
import { BackHeader } from './ui';

const FREQUENCIES = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'adhoc', label: 'Ad-hoc' },
];

const ASSIGN_TYPES = [
  { id: 'person', label: 'Person' },
  { id: 'department', label: 'Department' },
  { id: 'shift', label: 'Shift' },
];

interface TemplateFormProps {
  template: any | null;
  locations: any[];
  departments: any[];
  onSave: (data: any) => void;
  onCancel: () => void;
}

export default function TemplateForm({ template, locations, departments, onSave, onCancel }: TemplateFormProps) {
  const [name, setName] = useState(template?.name || '');
  const [frequency, setFrequency] = useState(template?.frequency || 'adhoc');
  const [locationId, setLocationId] = useState<number>(template?.location_id || (locations[0]?.id ?? 0));
  const [assignType, setAssignType] = useState<string | null>(template?.assign_type || null);
  const [assignId, setAssignId] = useState<number | null>(template?.assign_id || null);
  const [active, setActive] = useState(template?.active !== false);
  const [saving, setSaving] = useState(false);

  const isEdit = !!template?.id;

  async function handleSubmit() {
    if (!name.trim() || !locationId) return;
    setSaving(true);
    await onSave({
      ...(isEdit ? { id: template.id } : {}),
      name: name.trim(),
      frequency,
      location_id: locationId,
      category_ids: template?.category_ids || [],
      assign_type: assignType,
      assign_id: assignId,
      active,
    });
    setSaving(false);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <BackHeader onBack={onCancel}
        title={isEdit ? `Edit: ${template.name}` : 'New counting list'}
      />

      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-24">
        {/* Name */}
        <div className="mb-5">
          <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">List name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Daily bar count"
            className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-[14px] text-gray-900 placeholder-gray-400 outline-none focus:border-orange-400 transition-colors" />
        </div>

        {/* Frequency */}
        <div className="mb-5">
          <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Frequency</label>
          <div className="flex gap-2 flex-wrap">
            {FREQUENCIES.map((f) => (
              <button key={f.id} onClick={() => setFrequency(f.id)}
                className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-all ${
                  frequency === f.id
                    ? 'bg-orange-50 border-orange-200 text-orange-700'
                    : 'bg-white border-gray-200 text-gray-500'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Location */}
        <div className="mb-5">
          <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Location</label>
          <div className="flex gap-2 flex-wrap">
            {locations.map((loc: any) => (
              <button key={loc.id} onClick={() => setLocationId(loc.id)}
                className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-all ${
                  locationId === loc.id
                    ? 'bg-orange-50 border-orange-200 text-orange-700'
                    : 'bg-white border-gray-200 text-gray-500'
                }`}>
                {loc.complete_name?.split('/')[0] || loc.name}
              </button>
            ))}
          </div>
        </div>

        {/* Assign to */}
        <div className="mb-5">
          <label className="block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5">Assign to</label>
          <div className="flex gap-2 mb-3">
            <button onClick={() => { setAssignType(null); setAssignId(null); }}
              className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-all flex-1 text-center ${
                !assignType ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-white border-gray-200 text-gray-500'
              }`}>
              Anyone
            </button>
            {ASSIGN_TYPES.map((at) => (
              <button key={at.id} onClick={() => { setAssignType(at.id); setAssignId(null); }}
                className={`px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-all flex-1 text-center ${
                  assignType === at.id ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-white border-gray-200 text-gray-500'
                }`}>
                {at.label}
              </button>
            ))}
          </div>

          {/* Person selector */}
          {assignType === 'person' && (
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <p className="text-[12px] text-gray-400 mb-2">Select a specific staff member</p>
              <select value={assignId || ''} onChange={(e) => setAssignId(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[14px] text-gray-900 outline-none">
                <option value="">Choose person...</option>
              </select>
              <p className="text-[11px] text-gray-400 mt-1">Portal users will be listed here once employees are linked</p>
            </div>
          )}

          {/* Department selector */}
          {assignType === 'department' && (
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <p className="text-[12px] text-gray-400 mb-2">All members of this department will see the list</p>
              <select value={assignId || ''} onChange={(e) => setAssignId(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[14px] text-gray-900 outline-none">
                <option value="">Choose department...</option>
                {departments.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Shift selector */}
          {assignType === 'shift' && (
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <p className="text-[12px] text-gray-400 mb-2">Staff on this shift today (from Planning) will see the list</p>
              <select value={assignId || ''} onChange={(e) => setAssignId(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-[14px] text-gray-900 outline-none">
                <option value="">Choose shift...</option>
              </select>
              <p className="text-[11px] text-gray-400 mt-1">Planning roles will appear here once configured in Odoo</p>
            </div>
          )}
        </div>

        {/* Active toggle */}
        {isEdit && (
          <div className="mb-5">
            <label className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 cursor-pointer">
              <span className="text-[14px] font-semibold text-gray-900">Active</span>
              <div className={`w-11 h-6 rounded-full relative transition-colors ${active ? 'bg-orange-500' : 'bg-gray-300'}`}
                onClick={() => setActive(!active)}>
                <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${active ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
              </div>
            </label>
          </div>
        )}
      </div>

      {/* Save button */}
      <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto px-4 py-3 bg-white border-t border-gray-200 z-40">
        <button onClick={handleSubmit} disabled={saving || !name.trim() || !locationId}
          className="w-full py-4 rounded-xl bg-orange-500 text-white text-[15px] font-bold shadow-lg shadow-orange-500/30 active:bg-orange-600 active:scale-[0.975] transition-all disabled:opacity-50">
          {saving ? 'Saving...' : (isEdit ? 'Update counting list' : 'Create counting list')}
        </button>
      </div>
    </div>
  );
}
