'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import PinnableImage from '@/components/ui/PinnableImage';

export interface GuidePin {
  id?: number;
  name: string;
  pin_x: number;
  pin_y: number;
  /** Sequence of the photo this pin sits on. */
  pin_photo_seq: number;
  item_id?: number | null;
}

/** One reference photo as the editor sees it — a server photo or a pending upload. */
export interface EditorPhoto {
  /** Local seq: for existing photos this is the server sequence; for a NEW photo
   * it is a provisional value the server may reassign on append (then remapped). */
  seq: number;
  /** Display source: server route URL, or a local data URL while pending. */
  url: string;
  /** Set while the photo hasn't been uploaded yet (uploaded on save). */
  pendingBase64?: string;
  /** True for a photo added this session (server allocates its real seq on append). */
  isNew?: boolean;
}

interface StationItem { id: number; name: string; }

interface Props {
  departmentId: number;
  pins: GuidePin[];
  onPinsChange: (pins: GuidePin[]) => void;
  photos: EditorPhoto[];
  onAddPhoto: (file: File) => void;
  onReplacePhoto: (seq: number, file: File) => void;
  onRemovePhoto: (seq: number) => void;
  /** Freeze photo add/replace/remove while a save is in flight (the submit loop
   * iterates a photos snapshot; mutating mid-save would orphan an upload). */
  disabled?: boolean;
}

/**
 * Manager editor for a setup guide: one or more reference photos, numbered pins
 * placed on them (drag to move), each labelled from the per-department item
 * catalog (add-new on the fly). Pins ARE the line's subtasks — the parent modal
 * owns both arrays and persists them on save. Pin numbers are GLOBAL across
 * photos (the order of the pins array).
 */
export default function SetupGuideEditor({
  departmentId, pins, onPinsChange, photos, onAddPhoto, onReplacePhoto, onRemovePhoto, disabled = false,
}: Props) {
  const [items, setItems] = useState<StationItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  // A tapped-but-not-yet-labelled pin. The photo seq is captured at TAP time so
  // switching/removing photos while the label sheet is open can't mis-assign it.
  const [pending, setPending] = useState<{ x: number; y: number; seq: number } | null>(null);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [activeGlobal, setActiveGlobal] = useState<number | null>(null);
  const [activeSeq, setActiveSeq] = useState<number | null>(photos[0]?.seq ?? null);
  const [imgError, setImgError] = useState<Set<number>>(new Set());
  // Mirrors `disabled` so ASYNC callbacks read the CURRENT value at resolve time,
  // not the (stale, still-enabled) value captured when they were kicked off —
  // e.g. an addNewItem() POST that resolves after Save froze the editor.
  const disabledRef = useRef(disabled);
  useEffect(() => { disabledRef.current = disabled; }, [disabled]);

  // Keep the active photo valid as photos come and go.
  useEffect(() => {
    if (activeSeq === null || !photos.some(p => p.seq === activeSeq)) {
      setActiveSeq(photos[0]?.seq ?? null);
    }
  }, [photos, activeSeq]);

  useEffect(() => {
    if (!departmentId) return;
    setLoadingItems(true);
    fetch(`/api/tasks/departments/${departmentId}/station-items`)
      .then(r => r.json())
      .then(d => setItems(d.items || []))
      .catch(() => {})
      .finally(() => setLoadingItems(false));
  }, [departmentId]);

  const activePhoto = photos.find(p => p.seq === activeSeq) || null;
  // Pins of the active photo, keeping their GLOBAL index for numbering.
  const activePins = useMemo(
    () => pins.map((p, gi) => ({ ...p, gi })).filter(p => p.pin_photo_seq === activeSeq),
    [pins, activeSeq],
  );

  function placePinFromItem(item: StationItem) {
    if (!pending) return;
    // A save may have started (editor frozen) while an addNewItem() POST was in
    // flight — dropping a pin now would mutate pins AFTER submit snapshotted them
    // (silently lost on success, or clobbering remapped seqs on failure).
    if (disabledRef.current) { setPending(null); setNewName(''); return; }
    // The target photo may have been removed while the label sheet was open.
    if (!photos.some(p => p.seq === pending.seq)) { setPending(null); setNewName(''); return; }
    onPinsChange([...pins, {
      name: item.name, pin_x: pending.x, pin_y: pending.y,
      pin_photo_seq: pending.seq, item_id: item.id,
    }]);
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
      setItems(prev => prev.some(i => i.id === body.item.id) ? prev : [...prev, body.item].sort((a, b) => a.name.localeCompare(b.name)));
      placePinFromItem(body.item);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to add item');
    } finally {
      setAdding(false);
    }
  }

  function removePinGlobal(gi: number) {
    onPinsChange(pins.filter((_, i) => i !== gi));
    setActiveGlobal(null);
  }

  const filtered = newName.trim()
    ? items.filter(i => i.name.toLowerCase().includes(newName.trim().toLowerCase()))
    : items;
  const exactMatch = items.some(i => i.name.toLowerCase() === newName.trim().toLowerCase());
  const photoNo = (seq: number) => photos.findIndex(p => p.seq === seq) + 1;

  return (
    // pointer-events-none blocks mouse/touch; the interactive controls below also
    // get `disabled={disabled}` so a KEYBOARD-focused file input or button can't
    // fire and mutate photos while a save is in flight.
    <div className={`rounded-xl border border-orange-200 bg-orange-50/40 p-3 space-y-3 ${disabled ? 'pointer-events-none opacity-60' : ''}`}>
      <p className="text-[11px] text-gray-600 leading-snug">
        📍 Add one or more photos of the finished station, then tap a photo to drop a numbered
        pin for each item — drag a pin to move it. Staff check off each pin as they set it up.
      </p>

      {/* Photo strip */}
      {photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map(p => (
            <button
              key={p.seq}
              type="button"
              onClick={() => setActiveSeq(p.seq)}
              className={`relative flex-shrink-0 rounded-lg overflow-hidden border-2 ${
                p.seq === activeSeq ? 'border-orange-500 ring-2 ring-orange-200' : 'border-gray-200'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Photo ${photoNo(p.seq)}`} className="h-14 w-20 object-cover" />
              <span className="absolute bottom-0.5 left-1 text-[10px] font-bold text-white drop-shadow">
                {photoNo(p.seq)}
              </span>
              {p.pendingBase64 && (
                <span className="absolute top-0.5 right-1 text-[9px] font-bold text-amber-200 drop-shadow">●</span>
              )}
            </button>
          ))}
          <label className="flex-shrink-0 h-14 w-20 rounded-lg border-2 border-dashed border-orange-400 bg-white flex items-center justify-center text-orange-600 text-xl font-bold cursor-pointer hover:bg-orange-50">
            +
            <input
              type="file" className="hidden" accept="image/*" disabled={disabled}
              onChange={e => { const f = e.target.files?.[0]; if (f) onAddPhoto(f); e.target.value = ''; }}
            />
          </label>
        </div>
      )}

      {photos.length === 0 ? (
        <label className="flex flex-col items-center justify-center gap-1 px-3 py-6 bg-white border-2 border-dashed border-orange-400 rounded-lg text-xs font-semibold text-orange-700 cursor-pointer hover:bg-orange-100">
          <span className="text-2xl">📷</span>
          Tap to add the reference photo
          <input
            type="file" className="hidden" accept="image/*"
            onChange={e => { const f = e.target.files?.[0]; if (f) onAddPhoto(f); e.target.value = ''; }}
          />
        </label>
      ) : activePhoto && (
        <div className="space-y-2">
          {imgError.has(activePhoto.seq) ? (
            <div className="px-3 py-6 bg-white border border-red-200 rounded-lg text-xs text-red-600 text-center">
              Couldn&apos;t load this photo. Replace or remove it below.
            </div>
          ) : (
            <div className="flex justify-center bg-white rounded-lg p-1">
              <PinnableImage
                src={activePhoto.url}
                pins={activePins.map(p => ({ pin_x: p.pin_x, pin_y: p.pin_y, label: p.name, number: p.gi + 1 }))}
                mode="edit"
                activeIndex={activeGlobal !== null ? activePins.findIndex(p => p.gi === activeGlobal) : null}
                onPlace={(x, y) => {
                  if (activeSeq === null) return;
                  setPending({ x, y, seq: activeSeq });
                  setNewName('');
                }}
                onPinMove={(i, x, y) => {
                  const gi = activePins[i]?.gi;
                  if (gi === undefined) return;
                  onPinsChange(pins.map((p, idx) => idx === gi ? { ...p, pin_x: x, pin_y: y } : p));
                }}
                onPinClick={(i) => {
                  const gi = activePins[i]?.gi;
                  setActiveGlobal(a => a === gi ? null : gi ?? null);
                }}
                onImageError={() => setImgError(prev => new Set(prev).add(activePhoto.seq))}
              />
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-gray-500">
              {photos.length > 1 ? `Photo ${photoNo(activePhoto.seq)} of ${photos.length} · ` : ''}
              {pins.length} pin{pins.length === 1 ? '' : 's'} total
            </span>
            <div className="flex items-center gap-3">
              <label className="text-[11px] font-semibold text-orange-600 cursor-pointer hover:text-orange-700">
                Replace photo
                <input
                  type="file" className="hidden" accept="image/*" disabled={disabled}
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) { setImgError(prev => { const n = new Set(prev); n.delete(activePhoto.seq); return n; }); onReplacePhoto(activePhoto.seq, f); }
                    e.target.value = '';
                  }}
                />
              </label>
              <button
                type="button"
                disabled={disabled}
                onClick={() => { if (confirm('Remove this photo and its pins?')) onRemovePhoto(activePhoto.seq); }}
                className="text-[11px] font-semibold text-red-500 hover:text-red-600 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Placed-pin list (all photos, global numbering) */}
      {pins.length > 0 && (
        <ul className="space-y-1">
          {pins.map((p, gi) => (
            <li
              key={p.id ?? `new-${gi}`}
              onMouseEnter={() => setActiveGlobal(gi)}
              onMouseLeave={() => setActiveGlobal(null)}
              onClick={() => { if (p.pin_photo_seq !== activeSeq) setActiveSeq(p.pin_photo_seq); }}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs border ${activeGlobal === gi ? 'bg-orange-100 border-orange-300' : 'bg-white border-gray-200'}`}
            >
              <span className="w-5 h-5 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold flex-shrink-0">{gi + 1}</span>
              <span className="flex-1 min-w-0 truncate text-gray-800">{p.name}</span>
              {photos.length > 1 && (
                <span className="text-[10px] font-semibold text-gray-400 flex-shrink-0">📷 {photoNo(p.pin_photo_seq)}</span>
              )}
              <button type="button" disabled={disabled} onClick={(e) => { e.stopPropagation(); removePinGlobal(gi); }} className="text-[11px] text-red-500 hover:text-red-600 flex-shrink-0 disabled:opacity-50">Remove</button>
            </li>
          ))}
        </ul>
      )}

      {/* Item picker sheet — appears after tapping the photo */}
      {pending && !disabled && (
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
