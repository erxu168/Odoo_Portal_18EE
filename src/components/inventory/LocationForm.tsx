'use client';

import React, { useState } from 'react';
import FilePicker from '@/components/ui/FilePicker';
import type { CountLocation } from '@/types/inventory';

/**
 * LocationForm — the ONE form for a count location's fields (name, "where to
 * stand" note, photo). Used everywhere a location is created or edited: the
 * Locations manager (create + edit) AND the canonical /inventory/location/[id]
 * page. Per the single-canonical-form rule, there is no second location form.
 *
 * A location is just a NAME (+ optional note/photo). There is no "type" — a
 * restaurant's storage is Unit -> optional spot, found by name + photo + label.
 */

/** Read a picked image and downscale it on-device to a small JPEG data URL. */
export function downscale(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 900; let w = img.width, h = img.height;
        if (w > max || h > max) { if (w > h) { h = Math.round(h * max / w); w = max; } else { w = Math.round(w * max / h); h = max; } }
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d')?.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL('image/jpeg', 0.7));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function LocationForm({ initial, onCancel, onSave, onDelete, saving, error, baseZ = 100 }: {
  initial: Partial<CountLocation>;
  onCancel: () => void;
  onSave: (loc: Partial<CountLocation>) => void;
  onDelete?: () => void;
  saving?: boolean;
  error?: string | null;
  baseZ?: number;
}) {
  const [name, setName] = useState(initial.name || '');
  // A spot is a slot INSIDE a unit (a drawer, rack, shelf) — it has a parent.
  // A top-level location is a unit/zone. Neither has a "type": a location is
  // just a name (+ optional note/photo).
  const isSpot = initial.parent_id != null;
  const [description, setDescription] = useState(initial.description || '');
  const [photo, setPhoto] = useState<string | null>(initial.photo || null);
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end" style={{ zIndex: baseZ }}>
      <div className="bg-white w-full max-w-lg mx-auto rounded-t-2xl p-5 pb-8 max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-3">{initial.id ? 'Edit' : 'New'} {isSpot ? 'spot' : 'location'}</h3>
        <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={isSpot ? 'e.g. Left Drawer, Rack 1' : 'e.g. Walk-in Fridge'}
               className="w-full border-2 border-gray-200 rounded-xl px-3 py-3 mb-3 bg-gray-50" />
        <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">Notes (optional)</label>
        <input value={description || ''} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Back-left wall, top two shelves"
               className="w-full border-2 border-gray-200 rounded-xl px-3 py-3 mb-3 bg-gray-50" />
        <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-1">Photo (optional)</label>
        {photo ? (
          <div className="relative mb-3">
            <img src={photo} alt="" className="w-full rounded-xl border border-gray-200" />
            <button onClick={() => setPhoto(null)} aria-label="Remove photo"
                    className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-8 h-8">×</button>
          </div>
        ) : (
          <FilePicker accept="image/*" onFile={async (f: File) => setPhoto(await downscale(f))}
                      label="Add a photo"
                      className="w-full py-4 rounded-xl border-2 border-dashed border-gray-300 text-gray-500 font-semibold mb-3" />
        )}
        {error && <p className="text-[12px] font-semibold text-red-600 mb-2">{error}</p>}
        <div className="flex gap-3 mt-2">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl bg-gray-100 font-bold">Cancel</button>
          <button onClick={() => name.trim() && onSave({ ...initial, name: name.trim(), description, photo })}
                  disabled={!name.trim() || !!saving}
                  className="flex-1 py-3 rounded-xl bg-green-600 text-white font-bold disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
        </div>
        {onDelete && <button onClick={onDelete} className="w-full mt-3 py-2.5 text-red-600 font-semibold text-sm">Remove this location</button>}
      </div>
    </div>
  );
}
