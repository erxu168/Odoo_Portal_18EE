'use client';

import React, { useState, useEffect, useRef } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { StatusDot } from './ui';
import type { ComponentAvailability } from '@/types/manufacturing';

interface BomDetailProps {
  bomId: number;
  onBack: () => void;
  onCreateMo: (bomId: number) => void;
}

interface EditLine {
  line_id: number;
  product_id: number;
  product_name: string;
  product_qty: number;
  uom: string;
  uom_id: number;
}

interface EditOp {
  id: number;
  name: string;
  workcenter_id: number | [number, string];
  time_cycle_manual: number;
  sequence: number;
  note: string;
  worksheet_type: string | false;
  worksheet_google_slide: string;
  /** base64 PDF data \u2014 only set when user uploads a new file */
  _newPdfBase64?: string;
  /** true if the op already had a PDF worksheet in Odoo */
  _hadPdf?: boolean;
}

export default function BomDetail({ bomId, onBack, onCreateMo }: BomDetailProps) {
  const [bom, setBom] = useState<any>(null);
  const [components, setComponents] = useState<ComponentAvailability[]>([]);
  const [canMakeQty, setCanMakeQty] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSubBoms, setExpandedSubBoms] = useState<Set<number>>(new Set());

  // Operations
  const [operations, setOperations] = useState<any[]>([]);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [editBomQty, setEditBomQty] = useState('');
  const [removedLineIds, setRemovedLineIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Workcenters for edit mode
  const [workcenters, setWorkcenters] = useState<{id: number; name: string}[]>([]);
  const [editOps, setEditOps] = useState<EditOp[]>([]);
  const [removedOpIds, setRemovedOpIds] = useState<number[]>([]);
  const [editingOpId, setEditingOpId] = useState<number | null>(null);

  // Add new operation
  const [showAddOp, setShowAddOp] = useState(false);
  const [newOp, setNewOp] = useState<EditOp>({ id: 0, name: '', workcenter_id: 0, time_cycle_manual: 0, sequence: 0, note: '', worksheet_type: false, worksheet_google_slide: '' });

  // Add ingredient
  const [showAddSearch, setShowAddSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // BOM line IDs (fetched separately for editing)
  const [rawLines, setRawLines] = useState<any[]>([]);

  useEffect(() => { fetchBomDetail(); }, [bomId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchBomDetail() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/boms/${bomId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBom(data.bom);
      setComponents(data.components || []);
      setCanMakeQty(data.can_make_qty || 0);
      setOperations(data.operations || []);
      setRawLines(data.bom?.bom_line_ids || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load recipe details');
    } finally {
      setLoading(false);
    }
  }

  function startEditing() {
    fetchEditLines();
    if (workcenters.length === 0) {
      fetch('/api/workcenters').then(r => r.json()).then(d => setWorkcenters(d.workcenters || [])).catch(() => {});
    }
  }

  async function fetchEditLines() {
    try {
      const res = await fetch(`/api/boms/${bomId}`);
      const data = await res.json();
      if (!data.bom) return;

      const lineIds = data.bom.bom_line_ids || [];
      if (!lineIds.length) {
        setEditLines([]);
        setEditBomQty(String(data.bom.product_qty));
        setEditing(true);
        return;
      }

      const linesRes = await fetch(`/api/boms/${bomId}?include_lines=1`);
      const linesData = await linesRes.json();

      const lines: EditLine[] = (linesData.components || data.components || []).map((c: any, i: number) => ({
        line_id: lineIds[i] || 0,
        product_id: c.product_id,
        product_name: c.product_name,
        product_qty: c.required_qty,
        uom: c.uom,
        uom_id: 0,
      }));

      setEditLines(lines);
      setEditBomQty(String(data.bom.product_qty));
      setRemovedLineIds([]);
      // Map operations to EditOp shape
      const ops: EditOp[] = (data.operations || operations).map((op: any) => ({
        id: op.id,
        name: op.name,
        workcenter_id: op.workcenter_id,
        time_cycle_manual: op.time_cycle_manual || 0,
        sequence: op.sequence || 0,
        note: op.note || '',
        worksheet_type: op.worksheet_type || false,
        worksheet_google_slide: op.worksheet_google_slide || '',
        _hadPdf: op.worksheet_type === 'pdf',
      }));
      setEditOps(ops);
      setRemovedOpIds([]);
      setEditingOpId(null);
      setEditing(true);
    } catch (_e) {
      console.error('Failed to load edit lines');
    }
  }

  function cancelEditing() {
    setEditing(false);
    setEditLines([]);
    setRemovedLineIds([]);
    setEditOps([]);
    setRemovedOpIds([]);
    setEditingOpId(null);
    setSaveError(null);
    setShowAddSearch(false);
    setShowAddOp(false);
  }

  function updateLineQty(lineId: number, newQty: string) {
    setEditLines(prev => prev.map(l =>
      l.line_id === lineId ? { ...l, product_qty: parseFloat(newQty) || 0 } : l
    ));
  }

  function removeLine(lineId: number) {
    if (lineId > 0) {
      setRemovedLineIds(prev => [...prev, lineId]);
    }
    setEditLines(prev => prev.filter(l => l.line_id !== lineId));
  }

  function handleSearchChange(q: string) {
    setSearchQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.length < 2) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q)}&limit=15`);
        const data = await res.json();
        setSearchResults(data.products || []);
      } catch (_e) {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  function addIngredient(product: any) {
    if (editLines.some(l => l.product_id === product.id)) return;
    setEditLines(prev => [...prev, {
      line_id: -(Date.now()),
      product_id: product.id,
      product_name: product.name,
      product_qty: 1,
      uom: product.uom_name,
      uom_id: product.uom_id,
    }]);
    setShowAddSearch(false);
    setSearchQuery('');
    setSearchResults([]);
  }

  /** Update a field on an editOp by id */
  function updateEditOp(opId: number, updates: Partial<EditOp>) {
    setEditOps(prev => prev.map(op => op.id === opId ? { ...op, ...updates } : op));
  }

  /** Handle PDF file selection for an operation */
  function handlePdfUpload(opId: number, file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1] || '';
      updateEditOp(opId, { _newPdfBase64: base64, worksheet_type: 'pdf' });
    };
    reader.readAsDataURL(file);
  }

  function resetNewOp() {
    setNewOp({ id: 0, name: '', workcenter_id: 0, time_cycle_manual: 0, sequence: 0, note: '', worksheet_type: false, worksheet_google_slide: '' });
    setShowAddOp(false);
  }

  function addNewOp() {
    if (!newOp.name || !newOp.workcenter_id) return;
    const wcId = typeof newOp.workcenter_id === 'number' ? newOp.workcenter_id : (newOp.workcenter_id as [number, string])[0];
    setEditOps(prev => [...prev, {
      ...newOp,
      id: -(Date.now()),
      workcenter_id: wcId,
      sequence: (prev.length + 1) * 10,
    }]);
    resetNewOp();
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const body: any = {};

      const newBomQty = parseFloat(editBomQty);
      if (newBomQty > 0 && newBomQty !== bom.product_qty) {
        body.product_qty = newBomQty;
      }

      const updates = editLines
        .filter(l => l.line_id > 0)
        .map(l => ({ line_id: l.line_id, product_qty: l.product_qty }));
      if (updates.length) body.update_lines = updates;

      const adds = editLines
        .filter(l => l.line_id < 0)
        .map(l => ({ product_id: l.product_id, product_qty: l.product_qty, product_uom_id: l.uom_id }));
      if (adds.length) body.add_lines = adds;

      if (removedLineIds.length) body.remove_lines = removedLineIds;

      // Update existing operations (id > 0)
      const opUpdates = editOps.filter(op => op.id > 0).map(op => {
        const wcId = Array.isArray(op.workcenter_id) ? op.workcenter_id[0] : op.workcenter_id;
        const result: any = {
          operation_id: op.id,
          name: op.name,
          workcenter_id: wcId,
          time_cycle_manual: op.time_cycle_manual,
          note: op.note || '',
          worksheet_type: op.worksheet_type || false,
          worksheet_google_slide: op.worksheet_google_slide || false,
        };
        if (op._newPdfBase64) {
          result.worksheet = op._newPdfBase64;
        }
        return result;
      });
      if (opUpdates.length) body.update_operations = opUpdates;

      // Add new operations (id < 0)
      const newOps = editOps.filter(op => op.id < 0).map((op, i) => {
        const wcId = Array.isArray(op.workcenter_id) ? op.workcenter_id[0] : op.workcenter_id;
        const result: any = {
          name: op.name,
          workcenter_id: wcId,
          time_cycle_manual: op.time_cycle_manual,
          sequence: (i + 1) * 10,
          note: op.note || '',
          worksheet_type: op.worksheet_type || false,
          worksheet_google_slide: op.worksheet_google_slide || false,
        };
        if (op._newPdfBase64) {
          result.worksheet = op._newPdfBase64;
        }
        return result;
      });
      if (newOps.length) body.add_operations = newOps;

      if (removedOpIds.length) body.remove_operations = removedOpIds;

      const res = await fetch(`/api/boms/${bomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Save failed');

      setEditing(false);
      setEditingOpId(null);
      await fetchBomDetail();
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function toggleSubBom(productId: number) {
    setExpandedSubBoms((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId); else next.add(productId);
      return next;
    });
  }

  const fmt = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 }).format(n);

  /** Resolve workcenter display name from ID or tuple */
  function wcName(wcId: number | [number, string]): string {
    if (Array.isArray(wcId)) return wcId[1] || '';
    return workcenters.find(w => w.id === wcId)?.name || '';
  }
  function wcNumId(wcId: number | [number, string]): number {
    return Array.isArray(wcId) ? wcId[0] : wcId;
  }

  // \u2500\u2500 Operation form (shared between add & edit) \u2500\u2500
  function renderOpForm(op: EditOp, onChange: (updates: Partial<EditOp>) => void, onPdfUpload: (file: File | null) => void) {
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !bom) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
        <div className="text-center">
          <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load recipe</p>
          <p className="text-[var(--fs-xs)] text-gray-500 mb-5">{error || 'Recipe not found'}</p>
          <button onClick={fetchBomDetail} className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl">Retry</button>
        </div>
      </div>
    );
  }

  const productName = bom.product_tmpl_id[1];
  const uom = bom.product_uom_id[1];

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        title={productName}
        subtitle={`${fmt(bom.product_qty)} ${uom} per batch`}
        showBack
        onBack={onBack}
        action={
          !editing ? (
            <button
              onClick={startEditing}
              className="px-3 py-1.5 rounded-lg bg-white/15 border border-white/20 text-white text-[var(--fs-xs)] font-bold active:bg-white/25"
            >
              Edit
            </button>
          ) : undefined
        }
      />

      {/* Stats */}
      <div className="px-4 py-3">
        <div className="flex bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex-1 text-center py-3 border-r border-gray-100">
            <div className="text-[var(--fs-xs)] text-gray-400 font-semibold tracking-wider">INGREDIENTS</div>
            <div className="text-lg font-bold text-green-600 mt-0.5 font-mono">{components.length}</div>
          </div>
          <div className="flex-1 text-center py-3">
            <div className="text-[var(--fs-xs)] text-gray-400 font-semibold tracking-wider">CAN MAKE</div>
            <div className="text-lg font-bold text-green-500 mt-0.5 font-mono">{fmt(canMakeQty)} {uom}</div>
          </div>
        </div>
      </div>

      {/* Edit mode */}
      {editing ? (
        <div className="px-4 pb-8">
          {/* BOM output qty */}
          <div className="mb-4">
            <label className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 block mb-1.5">Output quantity ({uom})</label>
            <input
              type="number"
              inputMode="decimal"
              value={editBomQty}
              onChange={e => setEditBomQty(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 bg-white text-[var(--fs-xxl)] font-bold text-gray-900 outline-none focus:border-green-600"
            />
          </div>

          {/* Editable ingredient list */}
          <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2">
            Ingredients ({editLines.length})
          </div>

          <div className="flex flex-col gap-2 mb-4">
            {editLines.map(line => (
              <div key={line.line_id} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[var(--fs-sm)] font-bold text-gray-900 truncate">{line.product_name}</div>
                  <div className="text-[var(--fs-xs)] text-gray-400">{line.uom}</div>
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  value={line.product_qty || ''}
                  onChange={e => updateLineQty(line.line_id, e.target.value)}
                  className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-[var(--fs-md)] font-bold font-mono text-right text-gray-900 outline-none focus:border-green-600"
                />
                <button
                  onClick={() => removeLine(line.line_id)}
                  className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center active:bg-red-100 flex-shrink-0"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-red-500">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Add ingredient */}
          {showAddSearch ? (
            <div className="bg-white border border-green-200 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="text"
                  placeholder="Search products..."
                  value={searchQuery}
                  onChange={e => handleSearchChange(e.target.value)}
                  autoFocus
                  className="flex-1 px-3 py-2.5 rounded-lg border border-gray-200 text-[var(--fs-sm)] outline-none focus:border-green-600"
                />
                <button onClick={() => { setShowAddSearch(false); setSearchQuery(''); setSearchResults([]); }}
                  className="text-[var(--fs-xs)] font-semibold text-gray-500 px-2">Cancel</button>
              </div>
              {searching && <div className="text-center py-3"><div className="w-5 h-5 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin mx-auto" /></div>}
              {searchResults.length > 0 && (
                <div className="max-h-48 overflow-y-auto">
                  {searchResults.map(p => {
                    const alreadyAdded = editLines.some(l => l.product_id === p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => !alreadyAdded && addIngredient(p)}
                        disabled={alreadyAdded}
                        className="w-full text-left px-3 py-2.5 border-b border-gray-100 last:border-0 active:bg-green-50 disabled:opacity-40"
                      >
                        <div className="text-[var(--fs-sm)] font-semibold text-gray-900">{p.name}</div>
                        <div className="text-[var(--fs-xs)] text-gray-400">{p.uom_name} {alreadyAdded ? '(already added)' : ''}</div>
                      </button>
                    );
                  })}
                </div>
              )}
              {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
                <div className="text-[var(--fs-xs)] text-gray-400 text-center py-3">No products found</div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowAddSearch(true)}
              className="w-full py-3 rounded-xl border-[1.5px] border-dashed border-gray-300 text-[var(--fs-sm)] font-semibold text-gray-500 flex items-center justify-center gap-2 active:bg-gray-50 mb-4"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Add ingredient
            </button>
          )}

          {/* Work order steps */}
          <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2 mt-4">
            Work order steps ({editOps.length})
          </div>
          <div className="flex flex-col gap-2 mb-4">
            {editOps.map((op, i) => {
              const isExpanded = editingOpId === op.id;
              return (
                <div key={op.id} className={`bg-white border rounded-xl overflow-hidden ${isExpanded ? 'border-amber-300' : 'border-gray-200'}`}>
                  {/* Collapsed header \u2014 tap to expand */}
                  <div
                    className="px-4 py-3 flex items-center gap-3 cursor-pointer active:bg-gray-50"
                    onClick={() => setEditingOpId(isExpanded ? null : op.id)}
                  >
                    <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-[var(--fs-xs)] font-bold text-amber-700 flex-shrink-0">{i + 1}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[var(--fs-sm)] font-bold text-gray-900 truncate">{op.name || '(untitled)'}</div>
                      <div className="text-[var(--fs-xs)] text-gray-400">
                        {wcName(op.workcenter_id)}
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
                      {renderOpForm(
                        op,
                        (updates) => updateEditOp(op.id, updates),
                        (file) => handlePdfUpload(op.id, file),
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Add new operation */}
          {showAddOp ? (
            <div className="bg-white border border-amber-200 rounded-xl p-4 mb-4">
              {renderOpForm(
                newOp,
                (updates) => setNewOp(prev => ({ ...prev, ...updates })),
                (file) => {
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const base64 = (reader.result as string).split(',')[1] || '';
                    setNewOp(prev => ({ ...prev, _newPdfBase64: base64, worksheet_type: 'pdf' }));
                  };
                  reader.readAsDataURL(file);
                },
              )}
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

          {saveError && (
            <div className="mb-3 px-3 py-2.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[var(--fs-xs)]">{saveError}</div>
          )}

          {/* Save / Cancel buttons */}
          <div className="flex gap-2">
            <button onClick={cancelEditing} disabled={saving}
              className="flex-1 py-4 rounded-xl bg-white border border-gray-200 text-gray-700 font-bold text-[var(--fs-sm)] active:bg-gray-50 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-4 rounded-xl bg-green-600 text-white font-bold text-[var(--fs-sm)] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-transform disabled:opacity-50">
              {saving ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Output quantity (read-only) */}
          <div className="px-4 pb-2">
            <div className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-1.5">Output quantity ({uom})</div>
            <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
              <span className="text-[var(--fs-xxl)] font-bold text-gray-900 font-mono">{fmt(bom.product_qty)}</span>
            </div>
          </div>

          {/* Read-only ingredient list */}
          <div className="px-5 pt-3 pb-2">
            <p className="text-[var(--fs-xs)] font-bold text-gray-400 tracking-widest uppercase">Ingredients</p>
          </div>

          <div className="px-4 pb-8 flex flex-col gap-1.5">
            {(() => {
              const cats = Array.from(new Set(components.map((c: any) => c.category || 'Other')));
              return cats.map(cat => {
                const catComps = components.filter((c: any) => (c.category || 'Other') === cat);
                return (
                  <div key={cat} className="mb-4">
                    <div className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 pb-2 flex justify-between">
                      <span>{cat}</span>
                      <span className="font-mono text-gray-300">{catComps.length}</span>
                    </div>
                    {catComps.map((comp) => (
                      <React.Fragment key={comp.product_id}>
                        <button
                          onClick={() => comp.is_sub_bom && toggleSubBom(comp.product_id)}
                          className={`bg-white border rounded-xl px-4 py-3 flex justify-between items-center text-left w-full mb-1.5 ${
                            comp.is_sub_bom ? 'border-green-200 active:scale-[0.98] transition-transform' : 'border-gray-200'
                          }`}>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <StatusDot status={comp.status} />
                            <div className="min-w-0">
                              <div className="text-[var(--fs-md)] font-bold text-gray-900 truncate">
                                {comp.product_name}
                                {comp.is_sub_bom && <span className="ml-2 text-[var(--fs-xs)] px-2 py-0.5 rounded-md bg-green-50 text-green-800 font-semibold">Sub-recipe</span>}
                              </div>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0 ml-3">
                            <div className="text-[var(--fs-md)] font-bold text-gray-900 tabular-nums font-mono">
                              {fmt(comp.required_qty)} {comp.uom}
                            </div>
                            <div className={`text-[var(--fs-xs)] mt-0.5 ${
                              comp.status === 'ok' ? 'text-green-600' : comp.status === 'low' ? 'text-amber-600' : 'text-red-600'
                            }`}>
                              {fmt(comp.on_hand_qty)} {comp.uom} on hand
                            </div>
                          </div>
                        </button>

                        {comp.is_sub_bom && expandedSubBoms.has(comp.product_id) && comp.sub_bom_lines && (
                          <div className="ml-5 border-l-2 border-green-200 mb-1.5">
                            <div className="ml-3 bg-white border border-green-200 rounded-xl overflow-hidden">
                              <div className="divide-y divide-gray-100">
                                {comp.sub_bom_lines.map((sub) => (
                                  <div key={sub.product_id} className="px-3.5 py-2.5 flex justify-between items-center">
                                    <span className="text-[var(--fs-sm)] text-gray-900 flex items-center gap-1.5">
                                      <StatusDot status={sub.status} />{sub.product_name}
                                    </span>
                                    <span className="text-[var(--fs-sm)] font-bold text-gray-700 font-mono">
                                      {fmt(sub.required_qty)} {sub.uom}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                );
              });
            })()}
          </div>

          {/* Work order steps (read-only) */}
          {operations.length > 0 && (
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
          )}

          {/* Bottom actions */}
          <div className="px-4 pb-8">
            <button onClick={() => onCreateMo(bomId)}
              className="w-full py-4 rounded-xl bg-green-600 text-white font-bold text-[var(--fs-sm)] shadow-lg shadow-green-600/30 active:scale-[0.975] transition-transform">
              Create manufacturing order
            </button>
          </div>
        </>
      )}
    </div>
  );
}
