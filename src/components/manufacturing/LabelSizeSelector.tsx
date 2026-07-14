'use client';

import { useState, useEffect, useCallback } from 'react';
import { LABEL_SIZE_PRESETS } from '@/types/labeling';
import type { SavedCustomSize, LabelSizePreference } from '@/types/labeling';

interface LabelSizeSelectorProps {
  companyId: number;
  onSizeChange: (widthMm: number, heightMm: number, sizeId: string | null) => void;
}

type SizeSelection =
  | { type: 'preset'; presetId: string }
  | { type: 'saved'; savedId: number }
  | { type: 'custom' };

export default function LabelSizeSelector({ companyId, onSizeChange }: LabelSizeSelectorProps) {
  const [savedSizes, setSavedSizes] = useState<SavedCustomSize[]>([]);
  const [preference, setPreference] = useState<LabelSizePreference | null>(null);
  const [loading, setLoading] = useState(true);

  const [selection, setSelection] = useState<SizeSelection>({ type: 'preset', presetId: '55x75' });
  const [customWidth, setCustomWidth] = useState('55');
  const [customHeight, setCustomHeight] = useState('75');

  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveError, setSaveError] = useState('');
  const [defaultSet, setDefaultSet] = useState(false);

  // Load saved sizes + preference
  const loadData = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    try {
      const res = await fetch(`/api/label-sizes?companyId=${companyId}`);
      if (res.ok) {
        const data = await res.json();
        setSavedSizes(data.savedSizes ?? []);
        setPreference(data.preference ?? null);
        if (data.preference) {
          const pref = data.preference as LabelSizePreference;
          if (pref.size_type === 'preset' && pref.preset_id) {
            setSelection({ type: 'preset', presetId: pref.preset_id });
          } else if (pref.size_type === 'saved' && pref.saved_size_id) {
            setSelection({ type: 'saved', savedId: pref.saved_size_id });
          } else if (pref.size_type === 'custom' && pref.custom_width_mm && pref.custom_height_mm) {
            setSelection({ type: 'custom' });
            setCustomWidth(String(pref.custom_width_mm));
            setCustomHeight(String(pref.custom_height_mm));
          }
        }
      }
    } catch {
      // silent - presets still work
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Emit size changes
  useEffect(() => {
    if (loading) return;
    let w = 55, h = 75;
    let sizeId: string | null = null;
    if (selection.type === 'preset') {
      const preset = LABEL_SIZE_PRESETS.find(p => p.id === selection.presetId);
      if (preset) { w = preset.widthMm; h = preset.heightMm; sizeId = preset.id; }
    } else if (selection.type === 'saved') {
      const saved = savedSizes.find(s => s.id === selection.savedId);
      if (saved) { w = saved.width_mm; h = saved.height_mm; sizeId = `saved-${saved.id}`; }
    } else {
      w = Number(customWidth) || 55;
      h = Number(customHeight) || 75;
      sizeId = 'custom';
    }
    onSizeChange(w, h, sizeId);
  }, [selection, customWidth, customHeight, savedSizes, loading, onSizeChange]);

  const dropdownValue = (() => {
    if (selection.type === 'preset') return `preset:${selection.presetId}`;
    if (selection.type === 'saved') return `saved:${selection.savedId}`;
    return 'custom';
  })();

  const handleDropdownChange = (val: string) => {
    setDefaultSet(false);
    if (val === 'custom') {
      setSelection({ type: 'custom' });
    } else if (val.startsWith('preset:')) {
      setSelection({ type: 'preset', presetId: val.replace('preset:', '') });
    } else if (val.startsWith('saved:')) {
      setSelection({ type: 'saved', savedId: Number(val.replace('saved:', '')) });
    }
  };

  const isCurrentDefault = (() => {
    if (!preference) return false;
    if (selection.type === 'preset' && preference.size_type === 'preset') return selection.presetId === preference.preset_id;
    if (selection.type === 'saved' && preference.size_type === 'saved') return selection.savedId === preference.saved_size_id;
    if (selection.type === 'custom' && preference.size_type === 'custom') {
      return Number(customWidth) === preference.custom_width_mm && Number(customHeight) === preference.custom_height_mm;
    }
    return false;
  })();

  const handleSave = async () => {
    setSaveError('');
    const trimmed = saveName.trim();
    if (!trimmed) { setSaveError('Enter a name'); return; }
    if (!customWidth || !customHeight) { setSaveError('Set width and height'); return; }
    try {
      const res = await fetch('/api/label-sizes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save_size', companyId, name: trimmed, width_mm: Number(customWidth), height_mm: Number(customHeight) }),
      });
      if (!res.ok) { const data = await res.json(); setSaveError(data.error ?? 'Failed to save'); return; }
      const { saved } = await res.json();
      setSavedSizes(prev => [...prev, saved].sort((a, b) => a.name.localeCompare(b.name)));
      setSelection({ type: 'saved', savedId: saved.id });
      setShowSaveDialog(false);
      setSaveName('');
    } catch {
      setSaveError('Network error');
    }
  };

  const handleDeleteSaved = async (sizeId: number) => {
    try {
      await fetch('/api/label-sizes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_size', companyId, sizeId }),
      });
      setSavedSizes(prev => prev.filter(s => s.id !== sizeId));
      if (selection.type === 'saved' && selection.savedId === sizeId) {
        setSelection({ type: 'preset', presetId: '55x75' });
      }
    } catch { /* silent */ }
  };

  const handleSetDefault = async () => {
    const payload: Record<string, unknown> = { action: 'set_default', companyId, sizeType: selection.type };
    if (selection.type === 'preset') payload.presetId = selection.presetId;
    else if (selection.type === 'saved') payload.savedSizeId = selection.savedId;
    else { payload.customWidthMm = Number(customWidth); payload.customHeightMm = Number(customHeight); }
    try {
      const res = await fetch('/api/label-sizes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const { preference: newPref } = await res.json();
        setPreference(newPref);
        setDefaultSet(true);
        setTimeout(() => setDefaultSet(false), 2000);
      }
    } catch { /* silent */ }
  };

  const currentSizeText = (() => {
    if (selection.type === 'preset') {
      const p = LABEL_SIZE_PRESETS.find(p => p.id === selection.presetId);
      return p ? `${p.widthMm} \u00d7 ${p.heightMm} mm` : '';
    }
    if (selection.type === 'saved') {
      const s = savedSizes.find(s => s.id === selection.savedId);
      return s ? `${s.width_mm} \u00d7 ${s.height_mm} mm` : '';
    }
    return `${customWidth} \u00d7 ${customHeight} mm`;
  })();

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 mb-4">
      <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">Label Size</div>

      {/* Dropdown */}
      <select
        value={dropdownValue}
        onChange={e => handleDropdownChange(e.target.value)}
        className="w-full px-3 py-3 bg-white border border-gray-200 rounded-xl text-[var(--fs-sm)] font-semibold text-gray-900 appearance-none focus:border-green-500 outline-none"
        style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.75rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.25rem' }}
      >
        <optgroup label="Presets">
          {LABEL_SIZE_PRESETS.map(p => (
            <option key={p.id} value={`preset:${p.id}`}>
              {p.name} \u2014 {p.description}
            </option>
          ))}
        </optgroup>
        {savedSizes.length > 0 && (
          <optgroup label="Saved Sizes">
            {savedSizes.map(s => (
              <option key={s.id} value={`saved:${s.id}`}>
                {s.name} ({s.width_mm} \u00d7 {s.height_mm} mm)
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Other">
          <option value="custom">Custom size\u2026</option>
        </optgroup>
      </select>

      {/* Size summary + actions */}
      <div className="flex items-center justify-between mt-2 px-1">
        <span className="text-[var(--fs-xs)] text-gray-400 font-mono">{currentSizeText}</span>
        <div className="flex items-center gap-2">
          {isCurrentDefault ? (
            <span className="text-[var(--fs-xs)] text-green-600 font-semibold flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              Default
            </span>
          ) : (
            <button onClick={handleSetDefault}
              className="text-[var(--fs-xs)] text-gray-400 font-semibold active:text-green-600 transition-colors">
              {defaultSet ? (
                <span className="text-green-600 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                  Saved!
                </span>
              ) : 'Set as default'}
            </button>
          )}
          {selection.type === 'saved' && (
            <button
              onClick={() => { if (confirm('Delete this saved size?')) handleDeleteSaved(selection.savedId); }}
              className="text-[var(--fs-xs)] text-red-400 font-semibold active:text-red-600">
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Custom size inputs */}
      {selection.type === 'custom' && (
        <div className="mt-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[var(--fs-xs)] text-gray-400 font-semibold mb-1 block">Width (mm)</label>
              <input type="number" inputMode="decimal" min="20" max="108"
                value={customWidth} onChange={e => setCustomWidth(e.target.value)}
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[var(--fs-sm)] font-mono focus:border-green-500 outline-none" />
            </div>
            <div className="flex-1">
              <label className="text-[var(--fs-xs)] text-gray-400 font-semibold mb-1 block">Height (mm)</label>
              <input type="number" inputMode="decimal" min="25" max="300"
                value={customHeight} onChange={e => setCustomHeight(e.target.value)}
                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[var(--fs-sm)] font-mono focus:border-green-500 outline-none" />
            </div>
          </div>
          {!showSaveDialog ? (
            <button onClick={() => setShowSaveDialog(true)}
              className="mt-3 w-full py-2.5 rounded-xl border border-dashed border-gray-300 text-[var(--fs-sm)] font-semibold text-gray-500 active:bg-gray-50 transition-colors">
              Save this size for reuse
            </button>
          ) : (
            <div className="mt-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
              <label className="text-[var(--fs-xs)] text-gray-400 font-semibold mb-1 block">Size name</label>
              <input type="text" value={saveName} onChange={e => setSaveName(e.target.value)}
                placeholder="e.g. WAJ Barrel, Ssam Deli Box" maxLength={50}
                className="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-xl text-[var(--fs-sm)] focus:border-green-500 outline-none"
                autoFocus />
              {saveError && <div className="text-[var(--fs-xs)] text-red-500 mt-1">{saveError}</div>}
              <div className="flex gap-2 mt-2">
                <button onClick={handleSave}
                  className="flex-1 py-2.5 rounded-xl bg-green-600 text-white text-[var(--fs-sm)] font-semibold active:bg-green-700">
                  Save
                </button>
                <button onClick={() => { setShowSaveDialog(false); setSaveName(''); setSaveError(''); }}
                  className="px-4 py-2.5 rounded-xl bg-gray-200 text-gray-600 text-[var(--fs-sm)] font-semibold active:bg-gray-300">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
