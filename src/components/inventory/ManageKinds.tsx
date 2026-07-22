'use client';

import React, { useState } from 'react';
import type { KindRow } from './LocationForm';

/**
 * The ONE "manage location types" sheet (single-canonical-form rule): add,
 * rename, and delete the company's location types. Reused by the Locations
 * manager AND the spot picker's location form, so the "Type" dropdown is
 * manageable wherever it appears — no dead-end. A type still used by a location
 * can't be deleted (change those locations first); renaming keeps existing
 * locations linked (only the visible label changes).
 */
export default function ManageKinds({ companyId, kinds, locations, onChanged, onClose, baseZ = 110 }: {
  companyId: number;
  kinds: KindRow[];
  /** For the "used by N" count + delete guard — any rows with a `kind` field. */
  locations: { kind?: string | null }[];
  onChanged: () => Promise<void>;
  onClose: () => void;
  baseZ?: number;
}) {
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const usage = (k: KindRow) =>
    locations.filter((l) => (l.kind || '').toLowerCase() === k.kind.toLowerCase()).length;

  async function add() {
    const label = newLabel.trim();
    if (!label || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/inventory/location-kinds', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, label }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Could not add the type — please try again.');
        return;
      }
      setNewLabel('');
      await onChanged();
    } catch {
      alert('Network error — please try again.');
    } finally { setBusy(false); }
  }

  async function saveRename(k: KindRow) {
    const label = editLabel.trim();
    if (!label || busy) return;
    if (label === k.label) { setEditId(null); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/inventory/location-kinds', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: k.id, company_id: companyId, label }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Could not rename the type — please try again.');
        return;
      }
      setEditId(null);
      await onChanged();
    } catch {
      alert('Network error — please try again.');
    } finally { setBusy(false); }
  }

  async function remove(k: KindRow) {
    if (busy) return;
    if (!confirm(`Remove the type “${k.label}”?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/inventory/location-kinds?id=${k.id}&company_id=${companyId}`, { method: 'DELETE' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Could not remove the type — please try again.');
        return;
      }
      await onChanged();
    } catch {
      alert('Network error — please try again.');
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end" style={{ zIndex: baseZ }}>
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-2xl p-5 pb-8 max-h-[85vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-1">Location types</h3>
        <p className="text-xs text-gray-500 mb-3">A type still used by a location can{'’'}t be removed — change those locations first.</p>
        {kinds.map((k) => {
          const n = usage(k);
          const isEditing = editId === k.id;
          return (
            <div key={k.id} className="flex items-center gap-2 py-2.5 border-b border-gray-100">
              {isEditing ? (
                <>
                  <input autoFocus value={editLabel} onChange={(e) => setEditLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveRename(k); if (e.key === 'Escape') setEditId(null); }}
                    maxLength={40} disabled={busy}
                    className="flex-1 min-w-0 border-2 border-gray-200 rounded-lg px-3 py-2 bg-gray-50" />
                  <button onClick={() => saveRename(k)} disabled={busy || !editLabel.trim()}
                    className="text-sm font-bold px-3 py-1.5 rounded-lg bg-green-600 text-white disabled:opacity-50">Save</button>
                  <button onClick={() => setEditId(null)} disabled={busy}
                    className="text-sm font-semibold px-2 py-1.5 rounded-lg text-gray-500">Cancel</button>
                </>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{k.label}</div>
                    {n > 0 && <div className="text-[11px] text-gray-400">used by {n} location{n !== 1 ? 's' : ''}</div>}
                  </div>
                  <button onClick={() => { setEditId(k.id); setEditLabel(k.label); }} disabled={busy}
                    aria-label={`Rename ${k.label}`} className="text-sm font-semibold px-2 py-1 rounded-lg text-blue-600 active:bg-blue-50">Rename</button>
                  <button onClick={() => remove(k)} disabled={busy || n > 0} aria-label={`Remove ${k.label}`}
                    className={`text-sm font-semibold px-2 py-1 rounded-lg ${n > 0 ? 'text-gray-300' : 'text-red-600 active:bg-red-50'}`}>Remove</button>
                </>
              )}
            </div>
          );
        })}
        <div className="flex gap-2 mt-4">
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="New type, e.g. Cellar" maxLength={40}
            className="flex-1 border-2 border-gray-200 rounded-xl px-3 py-3 bg-gray-50" />
          <button onClick={add} disabled={!newLabel.trim() || busy}
            className="px-5 rounded-xl bg-green-600 text-white font-bold disabled:opacity-50">Add</button>
        </div>
        <button onClick={onClose} className="w-full mt-4 py-3 rounded-xl bg-gray-100 font-bold">Done</button>
      </div>
    </div>
  );
}
