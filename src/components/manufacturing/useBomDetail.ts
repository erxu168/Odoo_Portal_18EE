'use client';

import { useState, useEffect, useRef } from 'react';
import type { ComponentAvailability } from '@/types/manufacturing';
import type { EditLine } from './BomIngredientList';
import type { EditOp } from './BomOperationList';

/**
 * All state and logic for BomDetail extracted into a custom hook.
 * BomDetail.tsx becomes a thin rendering wrapper.
 */
export function useBomDetail(bomId: number) {
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

  useEffect(() => { fetchBomDetail(); }, [bomId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Data fetching ──

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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load recipe details');
    } finally {
      setLoading(false);
    }
  }

  // ── Edit mode lifecycle ──

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

  // ── Ingredient manipulation ──

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

  // ── Operation manipulation ──

  function updateEditOp(opId: number, updates: Partial<EditOp>) {
    setEditOps(prev => prev.map(op => op.id === opId ? { ...op, ...updates } : op));
  }

  function handlePdfUpload(opId: number, file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1] || '';
      updateEditOp(opId, { _newPdfBase64: base64, worksheet_type: 'pdf' });
    };
    reader.readAsDataURL(file);
  }

  // ── Save ──

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
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  // ── Utilities ──

  function toggleSubBom(productId: number) {
    setExpandedSubBoms((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId); else next.add(productId);
      return next;
    });
  }

  const fmt = (n: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 }).format(n);

  return {
    // Data
    bom,
    components,
    canMakeQty,
    loading,
    error,
    operations,
    expandedSubBoms,

    // Edit state
    editing,
    editLines,
    editBomQty,
    setEditBomQty,
    saving,
    saveError,

    // Workcenters / operations edit
    workcenters,
    editOps,
    setEditOps,
    removedOpIds,
    setRemovedOpIds,
    editingOpId,
    setEditingOpId,
    showAddOp,
    setShowAddOp,
    newOp,
    setNewOp,

    // Add ingredient
    showAddSearch,
    setShowAddSearch,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    searching,

    // Actions
    fetchBomDetail,
    startEditing,
    cancelEditing,
    updateLineQty,
    removeLine,
    handleSearchChange,
    addIngredient,
    updateEditOp,
    handlePdfUpload,
    handleSave,
    toggleSubBom,
    fmt,
  };
}
