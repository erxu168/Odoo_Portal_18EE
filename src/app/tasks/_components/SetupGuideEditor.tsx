'use client';

import { useEffect, useState } from 'react';
import PinnableImage from '@/components/ui/PinnableImage';

export interface GuidePin {
  id?: number;
  name: string;
  pin_x: number;
  pin_y: number;
  item_id?: number | null;
}

interface StationItem { id: number; name: string; }

interface Props {
  departmentId: number;
  pins: GuidePin[];
  onPinsChange: (pins: GuidePin[]) => void;
  /** Preview source: an existing served URL, or a local object/data URL for a freshly-picked photo. */
  photoUrl: string | null;
  onPickPhoto: (file: File) => void;
  onRemovePhoto: () => void;
}

/**
 * Manager editor for a setup guide: one reference photo, numbered pins placed on
 * it, each labelled from the per-department item catalog (add-new on the fly).
 * The pins ARE the line's subtasks — the parent modal owns the pin array and
 * sends it as `subtasks` on save.
 */
export default function SetupGuideEditor({
  departmentId, pins, onPinsChange, photoUrl, onPickPhoto, onRemovePhoto,
}: Props) {
  const [items, setItems] = useState<StationItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    if (!departmentId) return;
    setLoadingItems(true);
    fetch(`/api/tasks/departments/${departmentId}/station-items`)
      .then(r => r.json())
      .then(d => setItems(d.items || []))
      .catch(() => {})
      .finally(() => setLoadingItems(false));
  }, [departmentId]);

  function placePinFromItem(item: StationItem) {
    if (!pending) return;
    onPinsChange([...pins, { name: item.name, pin_x: pending.x, pin_y: pending.y, item_id: item.id }]);
    setPending(null);
    setNewName('');
  }

  async function addNewItem() {
    const name = newName.trim();
    if (!name || !pending) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/tasks/departments/${departmentId}/station-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || 'Failed to add item');
      // Merge into the catalog (idempotent add may return an existing item).
      setItems(prev => prev.some(i => i.id === body.item.id) ? prev : [...prev, body.item].sort((a, b) => a.name.localeCompare(b.name)));
      placePinFromItem(body.item);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to add item');
    } finally {
      setAdding(false);
    }
  }

  function removePin(index: number) {
    onPinsChange(pins.filter((_, i) => i !== index));
    setActiveIndex(null);
  }

  const filtered = newName.trim()
    ? items.filter(i => i.name.toLowerCase().includes(newName.trim().toLowerCase()))
    : items;
  const exactMatch = items.some(i => i.name.toLowerCase() === newName.trim().toLowerCase());

  return (
    <div className="rounded-xl border border-orange-200 bg-orange-50/40 p-3 space-y-3">
      <p className="text-[11px] text-gray-600 leading-snug">
        📍 Upload one clear photo of the finished station, then tap the photo to drop a numbered
        pin for each item — drag a pin to move it. Staff check off each pin as they set it up.
      </p>

      {!photoUrl ? (
        <label className="flex flex-col items-center justify-center gap-1 px-3 py-6 bg-white border-2 border-dashed border-orange-400 rounded-lg text-xs font-semibold text-orange-700 cursor-pointer hover:bg-orange-100">
          <span className="text-2xl">📷</span>
          Tap to add the reference photo
          <input
            type="file"
            className="hidden"
            accept="image/*"
            onChange={e => { const f = e.target.files?.[0]; if (f) onPickPhoto(f); e.target.value = ''; }}
          />
        </label>
      ) : (
        <div className="space-y-2">
          {imgError ? (
            <div className="px-3 py-6 bg-white border border-red-200 rounded-lg text-xs text-red-600 text-center">
              Couldn&apos;t load the reference photo. Replace it below.
            </div>
          ) : (
            <div className="flex justify-center bg-white rounded-lg p-1">
              <PinnableImage
                src={photoUrl}
                pins={pins}
                mode="edit"
                activeIndex={activeIndex}
                onPlace={(x, y) => { setPending({ x, y }); setNewName(''); }}
                onPinMove={(i, x, y) => onPinsChange(pins.map((p, idx) => idx === i ? { ...p, pin_x: x, pin_y: y } : p))}
                onPinClick={(i) => setActiveIndex(a => a === i ? null : i)}
                onImageError={() => setImgError(true)}
              />
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">{pins.length} pin{pins.length === 1 ? '' : 's'} placed</span>
            <div className="flex items-center gap-3">
              <label className="text-[11px] font-semibold text-orange-600 cursor-pointer hover:text-orange-700">
                Replace photo
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={e => { const f = e.target.files?.[0]; if (f) { setImgError(false); onPickPhoto(f); } e.target.value = ''; }}
                />
              </label>
              <button
                type="button"
                onClick={() => { if (confirm('Remove the reference photo and all pins?')) { setImgError(false); onRemovePhoto(); } }}
                className="text-[11px] font-semibold text-red-500 hover:text-red-600"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Placed-pin list */}
      {pins.length > 0 && (
        <ul className="space-y-1">
          {pins.map((p, i) => (
            <li
              key={p.id ?? `new-${i}`}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs border ${activeIndex === i ? 'bg-orange-100 border-orange-300' : 'bg-white border-gray-200'}`}
            >
              <span className="w-5 h-5 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold flex-shrink-0">{i + 1}</span>
              <span className="flex-1 min-w-0 truncate text-gray-800">{p.name}</span>
              <button type="button" onClick={() => removePin(i)} className="text-[11px] text-red-500 hover:text-red-600 flex-shrink-0">Remove</button>
            </li>
          ))}
        </ul>
      )}

      {/* Item picker sheet — appears after tapping the photo */}
      {pending && (
        <div className="rounded-lg border border-orange-300 bg-white p-2.5 space-y-2">
          <p className="text-[11px] font-bold text-gray-600 uppercase tracking-wide">Label this pin</p>
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Search or type a new item…"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
          <div className="max-h-40 overflow-y-auto space-y-1">
            {loadingItems && <p className="text-[11px] text-gray-400 px-1">Loading items…</p>}
            {filtered.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => placePinFromItem(item)}
                className="w-full text-left px-3 py-1.5 rounded-lg text-sm text-gray-800 hover:bg-orange-50 border border-transparent hover:border-orange-200"
              >
                {item.name}
              </button>
            ))}
            {newName.trim() && !exactMatch && (
              <button
                type="button"
                onClick={addNewItem}
                disabled={adding}
                className="w-full text-left px-3 py-1.5 rounded-lg text-sm font-semibold text-orange-700 bg-orange-50 border border-orange-200 hover:bg-orange-100 disabled:opacity-50"
              >
                {adding ? 'Adding…' : `+ Add "${newName.trim()}"`}
              </button>
            )}
            {!loadingItems && filtered.length === 0 && !newName.trim() && (
              <p className="text-[11px] text-gray-400 px-1">No items yet — type one above to create it.</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => { setPending(null); setNewName(''); }}
            className="text-[11px] text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
