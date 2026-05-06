'use client';

import { useState } from 'react';
import type { DayPart, ModuleLink } from '@/lib/odoo-tasks';

const DAY_PART_OPTIONS: { value: DayPart; label: string }[] = [
  { value: 'opening', label: 'Opening' },
  { value: 'mid_day', label: 'Mid-day' },
  { value: 'closing', label: 'Closing' },
];

const MODULE_OPTIONS: { value: ModuleLink; label: string }[] = [
  { value: 'none', label: 'No link' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'pos', label: 'Point of Sale' },
  { value: 'manufacturing', label: 'Manufacturing' },
];

export interface AdHocSubmitVals {
  name: string;
  day_part: DayPart;
  deadline_datetime: string | null;
  photo_required: boolean;
  photo_instructions: string | null;
  module_link_type: ModuleLink;
}

interface Props {
  date: string;
  onClose: () => void;
  onSubmit: (vals: AdHocSubmitVals) => Promise<void>;
}

export default function AdHocModal({ date, onClose, onSubmit }: Props) {
  const [name, setName]                       = useState('');
  const [dayPart, setDayPart]                 = useState<DayPart>('opening');
  const [deadline, setDeadline]               = useState('');
  const [photoRequired, setPhotoRequired]     = useState(false);
  const [photoInstructions, setPhotoInstr]    = useState('');
  const [moduleLink, setModuleLink]           = useState<ModuleLink>('none');
  const [submitting, setSubmitting]           = useState(false);
  const [error, setError]                     = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) { setError('Name required'); return; }
    setSubmitting(true); setError(null);
    try {
      let deadlineIso: string | null = null;
      if (deadline) {
        deadlineIso = new Date(`${date}T${deadline}:00`).toISOString();
      }
      await onSubmit({
        name: name.trim(),
        day_part: dayPart,
        deadline_datetime: deadlineIso,
        photo_required: photoRequired,
        photo_instructions: photoRequired && photoInstructions.trim() ? photoInstructions.trim() : null,
        module_link_type: moduleLink,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[90dvh]" onClick={e => e.stopPropagation()}>
        <h2 className="font-bold text-gray-800 text-lg px-5 pt-5 pb-3 flex-shrink-0">Add one-off task</h2>
        <div className="flex-1 overflow-y-auto px-5 space-y-3 min-h-0">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Task name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Deep clean fryer"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Section</label>
              <select value={dayPart} onChange={e => setDayPart(e.target.value as DayPart)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
                {DAY_PART_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Deadline</label>
              <input type="time" value={deadline} onChange={e => setDeadline(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Module link</label>
            <select value={moduleLink} onChange={e => setModuleLink(e.target.value as ModuleLink)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
              {MODULE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={photoRequired} onChange={e => setPhotoRequired(e.target.checked)} />
            Photo required
          </label>
          {photoRequired && (
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Photo instructions (optional)</label>
              <textarea
                value={photoInstructions}
                onChange={e => setPhotoInstr(e.target.value)}
                placeholder="e.g. Take picture of the toilet bowl showing the connectors/screws"
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
          )}
          {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
          <div className="h-2" />
        </div>
        <div className="flex gap-2 px-5 py-4 border-t border-gray-200 flex-shrink-0 bg-white">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} className="flex-1 py-2.5 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 disabled:opacity-50">
            {submitting ? 'Adding…' : 'Add task'}
          </button>
        </div>
      </div>
    </div>
  );
}
