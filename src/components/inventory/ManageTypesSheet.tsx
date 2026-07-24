'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Spinner } from './ui';
import { LOCATION_TYPES } from '@/lib/location-types';
import type { CustomKindRow } from '@/lib/use-location-types';

/**
 * "Manage location types" — add / rename / delete a company's CUSTOM location
 * types, each with its own emoji. The 8 built-in types (Area, Fridge, Freezer,
 * Countertop fridge/freezer, …) are the always-available base and are shown here
 * as a locked reference. Deleting a type in use is refused by the API with a
 * clear message ("Still used by N locations"), so it can never break a location.
 *
 * Opened from the "Edit types" link in the location form and from the "Location
 * types" card in Inventory settings; both pass the company. Manager-gated (the
 * openers gate on inventory.location.manage; the API enforces it too).
 */
const EMOJI_CHOICES = ['📍', '🏢', '🚪', '❄️', '🧊', '🥶', '📦', '🗄️', '🧺', '🔥', '🍸', '🔪', '🧯', '🚰', '🗑️', '🛒', '🏷️', '🧂', '🥫', '🍶'];

function EmojiPick({ value, onPick }: { value: string; onPick: (e: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {EMOJI_CHOICES.map((e) => (
        <button key={e} type="button" onClick={() => onPick(e)}
          className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center border-2 active:scale-95 transition ${
            value === e ? 'border-green-600 bg-green-50' : 'border-gray-200 bg-white'}`}>
          {e}
        </button>
      ))}
    </div>
  );
}

export default function ManageTypesSheet({ companyId, onClose, onChanged, baseZ = 130 }: {
  companyId: number;
  onClose: () => void;
  onChanged?: () => void;
  baseZ?: number;
}) {
  const [kinds, setKinds] = useState<CustomKindRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add form
  const [newLabel, setNewLabel] = useState('');
  const [newIcon, setNewIcon] = useState('📍');
  // Inline edit
  const [editId, setEditId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editIcon, setEditIcon] = useState('📍');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/inventory/location-kinds?company_id=${companyId}`);
      if (!r.ok) throw new Error('load');
      setKinds(((await r.json()).kinds || []) as CustomKindRow[]);
    } catch { setError('Could not load your types — close and try again.'); }
    finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  // A custom type that duplicates a built-in would be hidden from the dropdown
  // (deduped) yet still listed here — confusing. Block it up front with a reason.
  function builtinClash(label: string): boolean {
    const l = label.toLowerCase();
    if (LOCATION_TYPES.some((t) => t.label.toLowerCase() === l || t.key.toLowerCase() === l)) {
      setError(`“${label}” is already a built-in type`);
      return true;
    }
    return false;
  }

  async function add() {
    const label = newLabel.trim();
    if (!label || busy) return;
    setError(null);
    if (builtinClash(label)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/inventory/location-kinds', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, label, icon: newIcon }),
      });
      if (!r.ok) { setError((await r.json().catch(() => ({}))).error || 'Could not add that type'); return; }
      setNewLabel(''); setNewIcon('📍');
      await load(); onChanged?.();
    } catch { setError('Network error — not added'); }
    finally { setBusy(false); }
  }

  function startEdit(k: CustomKindRow) { setEditId(k.id); setEditLabel(k.label); setEditIcon(k.icon || '📍'); setError(null); }

  async function saveEdit() {
    const label = editLabel.trim();
    if (!label || editId == null || busy) return;
    setError(null);
    if (builtinClash(label)) return;
    setBusy(true);
    try {
      const r = await fetch('/api/inventory/location-kinds', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editId, company_id: companyId, label, icon: editIcon }),
      });
      if (!r.ok) { setError((await r.json().catch(() => ({}))).error || 'Could not save'); return; }
      setEditId(null);
      await load(); onChanged?.();
    } catch { setError('Network error — not saved'); }
    finally { setBusy(false); }
  }

  async function remove(k: CustomKindRow) {
    if (busy || !confirm(`Remove the “${k.label}” type?`)) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/inventory/location-kinds?id=${k.id}&company_id=${companyId}`, { method: 'DELETE' });
      if (!r.ok) { setError((await r.json().catch(() => ({}))).error || 'Could not remove'); return; }
      await load(); onChanged?.();
    } catch { setError('Network error — not removed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end" style={{ zIndex: baseZ }} role="dialog" aria-modal="true" aria-label="Manage location types">
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-2xl flex flex-col max-h-[92vh]">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Location types</h3>
          <button onClick={onClose} className="text-gray-500 font-semibold active:opacity-70">Done</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {error && <p className="text-[13px] text-red-600 mb-3 font-semibold">{error}</p>}

          {/* Add a new type */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4">
            <div className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 mb-2">Add a type</div>
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value.slice(0, 40))}
              placeholder="e.g. Bar, Hot holding, Prep station"
              className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 mb-2 bg-white text-[var(--fs-base)]" />
            <div className="mb-2"><EmojiPick value={newIcon} onPick={setNewIcon} /></div>
            <button onClick={add} disabled={!newLabel.trim() || busy}
              className="w-full py-2.5 rounded-xl bg-green-600 text-white font-bold disabled:opacity-50 active:bg-green-700">
              {busy ? 'Working…' : `Add ${newIcon} ${newLabel.trim() || 'type'}`}
            </button>
          </div>

          {/* Your custom types */}
          <div className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 mb-2">Your types</div>
          {loading ? <Spinner /> : kinds.length === 0 ? (
            <p className="text-center text-gray-400 py-4 text-[var(--fs-sm)]">None yet — add one above.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 mb-4">
              {kinds.map((k) => (
                <li key={k.id} className="border border-gray-200 rounded-xl">
                  {editId === k.id ? (
                    <div className="p-3">
                      <input value={editLabel} onChange={(e) => setEditLabel(e.target.value.slice(0, 40))}
                        className="w-full border-2 border-gray-200 rounded-xl px-3 py-2.5 mb-2 bg-white text-[var(--fs-base)]" />
                      <div className="mb-2"><EmojiPick value={editIcon} onPick={setEditIcon} /></div>
                      <div className="flex gap-2">
                        <button onClick={() => setEditId(null)} className="flex-1 py-2.5 rounded-xl bg-gray-100 font-bold">Cancel</button>
                        <button onClick={saveEdit} disabled={!editLabel.trim() || busy}
                          className="flex-1 py-2.5 rounded-xl bg-green-600 text-white font-bold disabled:opacity-50">Save</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center px-3 py-2.5">
                      <span className="text-xl mr-2.5 w-7 text-center flex-shrink-0">{k.icon || '📍'}</span>
                      <span className="flex-1 min-w-0 font-semibold text-gray-800 truncate">{k.label}</span>
                      <button onClick={() => startEdit(k)} aria-label={`Edit ${k.label}`} className="px-2.5 py-1.5 text-gray-400 active:text-gray-700">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                      </button>
                      <button onClick={() => remove(k)} aria-label={`Remove ${k.label}`} className="px-2.5 py-1.5 text-red-500 active:text-red-700">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {/* Built-in reference (locked) */}
          <div className="text-[var(--fs-xs)] font-bold uppercase tracking-wide text-gray-400 mb-2">Built-in · always available</div>
          <ul className="flex flex-wrap gap-1.5 mb-2">
            {LOCATION_TYPES.map((t) => (
              <li key={t.key} className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[var(--fs-sm)] text-gray-500">
                <span>{t.icon}</span><span>{t.label}</span>
              </li>
            ))}
          </ul>
          <p className="text-[var(--fs-xs)] text-gray-400">Built-in types can{'’'}t be edited or removed — add your own above for anything they don{'’'}t cover.</p>
        </div>
      </div>
    </div>
  );
}
