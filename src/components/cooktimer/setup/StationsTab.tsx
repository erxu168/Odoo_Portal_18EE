'use client';
import { useState } from 'react';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CookStationAdmin } from '@/types/cooktimer';
import { stationDot } from './utils';
import Toggle from './Toggle';

/** Stations tab — drag to reorder, add, rename inline, toggle on/off, delete
 *  (blocked while a station has profiles or a running timer). */
export default function StationsTab({
  stations, onReorder, onAdd, onRename, onToggle, onDelete,
}: {
  stations: CookStationAdmin[];
  onReorder: (orderedIds: number[]) => void;
  onAdd: (name: string) => void;
  onRename: (id: number, name: string) => void;
  onToggle: (id: number, active: boolean) => void;
  onDelete: (s: CookStationAdmin) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = stations.findIndex(s => s.id === active.id);
    const to = stations.findIndex(s => s.id === over.id);
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(stations, from, to).map(s => s.id));
  }

  function submitAdd() {
    const n = newName.trim();
    if (!n) return;
    onAdd(n);
    setNewName('');
    setAdding(false);
  }

  return (
    <div className="px-4 py-4">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-extrabold text-gray-900">Stations</h2>
        <span className="text-xs text-gray-400 font-semibold">{stations.length}</span>
        <div className="flex-1" />
        <button onClick={() => setAdding(a => !a)} className="rounded-xl border border-green-600 text-green-700 font-bold text-sm px-4 py-2.5 active:bg-green-50">＋ Add station</button>
      </div>

      {adding && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-3 mb-3 flex items-center gap-2">
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submitAdd(); if (e.key === 'Escape') { setAdding(false); setNewName(''); } }}
            placeholder="Station name (e.g. Salamander)"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-[15px] focus:outline-none focus:border-sky-400" />
          <button onClick={() => { setAdding(false); setNewName(''); }} className="text-sm font-semibold text-gray-500 px-2">Cancel</button>
          <button onClick={submitAdd} className="rounded-lg bg-green-600 text-white font-bold text-sm px-3 py-2 active:brightness-110">Add</button>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={stations.map(s => s.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2.5">
            {stations.map((s, i) => (
              <StationRow key={s.id} station={s} index={i}
                onRename={name => onRename(s.id, name)} onToggle={v => onToggle(s.id, v)} onDelete={() => onDelete(s)} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <p className="text-xs text-gray-400 leading-relaxed mt-4 bg-white border border-gray-200 rounded-xl p-3">
        Each tablet chooses which stations it shows (in its own Settings). Turning a station <b>off</b> hides it and its products everywhere without deleting anything.
      </p>
    </div>
  );
}

function StationRow({
  station, index, onRename, onToggle, onDelete,
}: {
  station: CookStationAdmin;
  index: number;
  onRename: (name: string) => void;
  onToggle: (v: boolean) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: station.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  } as React.CSSProperties;

  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(station.name);
  const canDelete = station.profileCount === 0 && !station.hasRunningTimer;

  function save() {
    const n = val.trim();
    if (n && n !== station.name) onRename(n);
    setEditing(false);
  }

  return (
    <div ref={setNodeRef} style={style} className={`bg-white rounded-xl border border-gray-200 shadow-sm p-3 flex items-center gap-3 ${station.active ? '' : 'opacity-60'}`}>
      <button type="button" {...attributes} {...listeners} aria-label="Drag to reorder station"
        className="px-1 text-gray-400 cursor-grab active:cursor-grabbing touch-none select-none" style={{ touchAction: 'none' }}>
        <GripIcon />
      </button>
      <span className={`w-4 h-4 rounded-full flex-shrink-0 ${stationDot(index)}`} />
      {editing ? (
        <input autoFocus value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setVal(station.name); } }}
          onBlur={save}
          className="flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-[15px] focus:outline-none focus:border-sky-400" />
      ) : (
        <span className="flex-1 font-bold text-[15px] text-gray-900 truncate">{station.name}</span>
      )}
      <span className="text-[11px] text-gray-400 font-semibold flex-shrink-0">{station.profileCount} profile{station.profileCount === 1 ? '' : 's'}</span>
      <Toggle on={station.active} onChange={onToggle} label={`${station.name} active`} />
      {!editing && (
        <button onClick={() => { setVal(station.name); setEditing(true); }} aria-label={`Rename ${station.name}`} className="w-8 h-8 rounded-lg text-gray-400 hover:text-gray-700 active:bg-gray-100 flex items-center justify-center flex-shrink-0">✎</button>
      )}
      <button onClick={onDelete} disabled={!canDelete}
        title={canDelete ? 'Delete station' : 'Move its profiles off first'}
        aria-label={`Delete ${station.name}`}
        className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${canDelete ? 'text-gray-300 hover:text-red-500 active:bg-red-50' : 'text-gray-200 cursor-default'}`}>🗑</button>
    </div>
  );
}

function GripIcon() {
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true">
      {[3, 9, 15].map(y => (
        <g key={y}>
          <circle cx="4" cy={y} r="1.6" /><circle cx="10" cy={y} r="1.6" />
        </g>
      ))}
    </svg>
  );
}
