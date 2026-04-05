'use client';

import React from 'react';

// ── Shared types ──

export interface EditOp {
  id: number;
  name: string;
  workcenter_id: number | [number, string];
  time_cycle_manual: number;
  sequence: number;
  note: string;
  worksheet_type: string | false;
  worksheet_google_slide: string;
  /** base64 PDF data — only set when user uploads a new file */
  _newPdfBase64?: string;
  /** true if the op already had a PDF worksheet in Odoo */
  _hadPdf?: boolean;
}

// ── Helpers ──

function wcNumId(wcId: number | [number, string]): number {
  return Array.isArray(wcId) ? wcId[0] : wcId;
}

// ── Operation form (shared between add & edit) ──

interface OpFormProps {
  op: EditOp;
  workcenters: { id: number; name: string }[];
  onChange: (updates: Partial<EditOp>) => void;
  onPdfUpload: (file: File | null) => void;
}

function OpForm({ op, workcenters, onChange, onPdfUpload }: OpFormProps) {
  const wsType = op.worksheet_type || '';
  return (
    <>
      <div className="mb-3">
        <label className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 block mb-1">Step name</label>
        <input type="text" value={op.name} onChange={e => onChange({ name: e.target.value })} placeholder="e.g. Mix ingredients"
          className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-[var(--fs-sm)] outline-none focus:border-green-600" />
      </div>
      <div className="mb-3">
        <label className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 block mb-1">Workcenter</label>
        <select value={wcNumId(op.workcenter_id)} onChange={e => onChange({ workcenter_id: parseInt(e.target.value) })}
          className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-[var(--fs-sm)] outline-none focus:border-green-600 appearance-none bg-white">
          <option value={0}>Select workcenter...</option>
          {workcenters.map(wc => <option key={wc.id} value={wc.id}>{wc.name}</option>)}
        </select>
      </div>
      <div className="mb-3">
        <label className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 block mb-1">Duration (minutes)</label>
        <input type="number" inputMode="decimal" value={op.time_cycle_manual || ''} onChange={e => onChange({ time_cycle_manual: parseFloat(e.target.value) || 0 })} placeholder="e.g. 30"
          className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-[var(--fs-sm)] outline-none focus:border-green-600" />
      </div>
      <div className="mb-3">
        <label className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 block mb-1">Instructions</label>
        <textarea value={op.note?.replace(/<[^>]*>/g, '') || ''} onChange={e => onChange({ note: e.target.value })} placeholder="Step-by-step instructions..."
          rows={3} className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-[var(--fs-sm)] outline-none focus:border-green-600 resize-none" />
      </div>
      {/* Worksheet type */}
      <div className="mb-3">
        <label className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 block mb-1">Worksheet</label>
        <div className="flex gap-1.5 mb-2">
          {([
            { value: '', label: 'None' },
            { value: 'pdf', label: 'PDF' },
            { value: 'google_slide', label: 'Google Slide' },
          ] as const).map(opt => (
            <button key={opt.value} type="button"
              onClick={() => onChange({ worksheet_type: opt.value || false, ...(opt.value !== 'google_slide' ? { worksheet_google_slide: '' } : {}), ...(opt.value !== 'pdf' ? { _newPdfBase64: undefined } : {}) })}
              className={`flex-1 py-2 rounded-lg text-[var(--fs-xs)] font-bold transition-colors ${
                wsType === opt.value
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-500 active:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {wsType === 'pdf' && (
          <div>
            {(op._hadPdf && !op._newPdfBase64) && (
              <div className="text-[var(--fs-xs)] text-green-600 font-semibold mb-1.5 flex items-center gap-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Existing PDF attached
              </div>
            )}
            {op._newPdfBase64 && (
              <div className="text-[var(--fs-xs)] text-green-600 font-semibold mb-1.5 flex items-center gap-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                New PDF selected
              </div>
            )}
            <label className="block w-full py-2.5 rounded-lg border border-dashed border-gray-300 text-center text-[var(--fs-xs)] font-semibold text-gray-500 active:bg-gray-50 cursor-pointer">
              {op._newPdfBase64 ? 'Replace PDF' : 'Upload PDF'}
              <input type="file" accept="application/pdf" className="hidden" onChange={e => onPdfUpload(e.target.files?.[0] || null)} />
            </label>
          </div>
        )}
        {wsType === 'google_slide' && (
          <input type="url" value={op.worksheet_google_slide || ''} onChange={e => onChange({ worksheet_google_slide: e.target.value })}
            placeholder="https://docs.google.com/presentation/d/..."
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-[var(--fs-xs)] outline-none focus:border-green-600" />
        )}
      </div>
    </>
  );
}

// ── View-mode props ──

export interface BomOperationListViewProps {
  operations: any[];
}

/** Read-only work order steps list */
export function BomOperationListView({ operations }: BomOperationListViewProps) {
  if (operations.length === 0) return null;

  return (
    <div className="px-4 pb-4">
      <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">
        Work order steps ({operations.length})
      </div>
      <div className="flex flex-col gap-1.5">
        {operations.map((op, i) => (
          <div key={op.id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-[var(--fs-xs)] font-bold text-amber-700 flex-shrink-0">{i + 1}</div>
            <div className="flex-1 min-w-0">
              <div className="text-[var(--fs-sm)] font-bold text-gray-900">{op.name}</div>
              <div className="text-[var(--fs-xs)] text-gray-400">{op.workcenter_id?.[1] || ''}{op.time_cycle_manual > 0 ? ` \u00b7 ${op.time_cycle_manual} min` : ''}</div>
              {op.note && <div className="text-[var(--fs-xs)] text-gray-500 mt-1" dangerouslySetInnerHTML={{ __html: op.note }} />}
              {/* Worksheet indicators */}
              {op.worksheet_type === 'pdf' && (
                <button
                  onClick={async () => {
                    const res = await fetch(`/api/boms/operations?id=${op.id}`);
                    const data = await res.json();
                    if (data.ok) {
                      const blob = new Blob([Uint8Array.from(atob(data.data_base64), c => c.charCodeAt(0))], { type: 'application/pdf' });
                      window.open(URL.createObjectURL(blob), '_blank');
                    }
                  }}
                  className="mt-1.5 flex items-center gap-1.5 text-[var(--fs-xs)] font-semibold text-blue-600 active:text-blue-800"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  View worksheet PDF
                </button>
              )}
              {op.worksheet_type === 'google_slide' && op.worksheet_google_slide && (
                <a
                  href={op.worksheet_google_slide}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 flex items-center gap-1.5 text-[var(--fs-xs)] font-semibold text-blue-600 active:text-blue-800"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                  Open Google Slides
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Edit-mode props ──

export interface BomOperationListEditProps {
  editOps: EditOp[];
  setEditOps: React.Dispatch<React.SetStateAction<EditOp[]>>;
  removedOpIds: number[];
  setRemovedOpIds: React.Dispatch<React.SetStateAction<number[]>>;
  editingOpId: number | null;
  setEditingOpId: (id: number | null) => void;
  workcenters: { id: number; name: string }[];
  showAddOp: boolean;
  setShowAddOp: (v: boolean) => void;
  newOp: EditOp;
  setNewOp: React.Dispatch<React.SetStateAction<EditOp>>;
  updateEditOp: (opId: number, updates: Partial<EditOp>) => void;
  handlePdfUpload: (opId: number, file: File | null) => void;
}

/** Resolve workcenter display name from ID or tuple */
function wcName(wcId: number | [number, string], workcenters: { id: number; name: string }[]): string {
  if (Array.isArray(wcId)) return wcId[1] || '';
  return workcenters.find(w => w.id === wcId)?.name || '';
}

/** Editable operations list with expand/collapse, add new, and remove */
export function BomOperationListEdit({
  editOps,
  setEditOps,
  removedOpIds: _removedOpIds,
  setRemovedOpIds,
  editingOpId,
  setEditingOpId,
  workcenters,
  showAddOp,
  setShowAddOp,
  newOp,
  setNewOp,
  updateEditOp,
  handlePdfUpload,
}: BomOperationListEditProps) {

  function resetNewOp() {
    setNewOp({ id: 0, name: '', workcenter_id: 0, time_cycle_manual: 0, sequence: 0, note: '', worksheet_type: false, worksheet_google_slide: '' });
    setShowAddOp(false);
  }

  function addNewOp() {
    if (!newOp.name || !newOp.workcenter_id) return;
    const _wcId = typeof newOp.workcenter_id === 'number' ? newOp.workcenter_id : (newOp.workcenter_id as [number, string])[0];
    setEditOps(prev => [...prev, {
      ...newOp,
      id: -(Date.now()),
      workcenter_id: _wcId,
      sequence: (prev.length + 1) * 10,
    }]);
    resetNewOp();
  }

  return (
    <>
      <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2 mt-4">
        Work order steps ({editOps.length})
      </div>
      <div className="flex flex-col gap-2 mb-4">
        {editOps.map((op, i) => {
          const isExpanded = editingOpId === op.id;
          return (
            <div key={op.id} className={`bg-white border rounded-xl overflow-hidden ${isExpanded ? 'border-amber-300' : 'border-gray-200'}`}>
              {/* Collapsed header — tap to expand */}
              <div
                className="px-4 py-3 flex items-center gap-3 cursor-pointer active:bg-gray-50"
                onClick={() => setEditingOpId(isExpanded ? null : op.id)}
              >
                <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-[var(--fs-xs)] font-bold text-amber-700 flex-shrink-0">{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[var(--fs-sm)] font-bold text-gray-900 truncate">{op.name || '(untitled)'}</div>
                  <div className="text-[var(--fs-xs)] text-gray-400">
                    {wcName(op.workcenter_id, workcenters)}
                    {op.time_cycle_manual > 0 ? ` \u00b7 ${op.time_cycle_manual} min` : ''}
                    {op.worksheet_type ? ` \u00b7 ${op.worksheet_type === 'pdf' ? 'PDF' : op.worksheet_type === 'google_slide' ? 'Slides' : ''}` : ''}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                    className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  <button
                    onClick={(e) => { e.stopPropagation(); if (op.id > 0) setRemovedOpIds(prev => [...prev, op.id]); setEditOps(prev => prev.filter(o => o.id !== op.id)); if (editingOpId === op.id) setEditingOpId(null); }}
                    className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center active:bg-red-100"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-red-500"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                  </button>
                </div>
              </div>
              {/* Expanded edit form */}
              {isExpanded && (
                <div className="px-4 pb-4 border-t border-gray-100 pt-3">
                  <OpForm
                    op={op}
                    workcenters={workcenters}
                    onChange={(updates) => updateEditOp(op.id, updates)}
                    onPdfUpload={(file) => handlePdfUpload(op.id, file)}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add new operation */}
      {showAddOp ? (
        <div className="bg-white border border-amber-200 rounded-xl p-4 mb-4">
          <OpForm
            op={newOp}
            workcenters={workcenters}
            onChange={(updates) => setNewOp(prev => ({ ...prev, ...updates }))}
            onPdfUpload={(file) => {
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                const base64 = (reader.result as string).split(',')[1] || '';
                setNewOp(prev => ({ ...prev, _newPdfBase64: base64, worksheet_type: 'pdf' }));
              };
              reader.readAsDataURL(file);
            }}
          />
          <div className="flex gap-2">
            <button onClick={resetNewOp}
              className="flex-1 py-2.5 rounded-lg bg-gray-100 text-gray-600 text-[var(--fs-sm)] font-bold active:bg-gray-200">Cancel</button>
            <button onClick={addNewOp} disabled={!newOp.name || !newOp.workcenter_id}
              className="flex-1 py-2.5 rounded-lg bg-green-600 text-white text-[var(--fs-sm)] font-bold active:bg-green-700 disabled:opacity-50">Add step</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAddOp(true)}
          className="w-full py-3 rounded-xl border-[1.5px] border-dashed border-amber-300 text-[var(--fs-sm)] font-semibold text-amber-600 flex items-center justify-center gap-2 active:bg-amber-50 mb-4">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
          Add work order step
        </button>
      )}
    </>
  );
}
