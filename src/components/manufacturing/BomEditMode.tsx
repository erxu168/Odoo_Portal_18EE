'use client';

import React from 'react';
import { BomIngredientListEdit } from './BomIngredientList';
import { BomOperationListEdit } from './BomOperationList';
import type { EditLine } from './BomIngredientList';
import type { EditOp } from './BomOperationList';

export interface BomEditModeProps {
  uom: string;
  editBomQty: string;
  setEditBomQty: (v: string) => void;

  // Ingredients
  editLines: EditLine[];
  updateLineQty: (lineId: number, newQty: string) => void;
  removeLine: (lineId: number) => void;
  showAddSearch: boolean;
  setShowAddSearch: (v: boolean) => void;
  searchQuery: string;
  handleSearchChange: (q: string) => void;
  searching: boolean;
  searchResults: any[];
  addIngredient: (product: any) => void;
  setSearchQuery: (q: string) => void;
  setSearchResults: (r: any[]) => void;

  // Operations
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

  // Save / Cancel
  saving: boolean;
  saveError: string | null;
  handleSave: () => void;
  cancelEditing: () => void;
}

export default function BomEditMode({
  uom,
  editBomQty,
  setEditBomQty,
  editLines,
  updateLineQty,
  removeLine,
  showAddSearch,
  setShowAddSearch,
  searchQuery,
  handleSearchChange,
  searching,
  searchResults,
  addIngredient,
  setSearchQuery,
  setSearchResults,
  editOps,
  setEditOps,
  removedOpIds,
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
  saving,
  saveError,
  handleSave,
  cancelEditing,
}: BomEditModeProps) {
  return (
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
      <BomIngredientListEdit
        editLines={editLines}
        updateLineQty={updateLineQty}
        removeLine={removeLine}
        showAddSearch={showAddSearch}
        setShowAddSearch={setShowAddSearch}
        searchQuery={searchQuery}
        handleSearchChange={handleSearchChange}
        searching={searching}
        searchResults={searchResults}
        addIngredient={addIngredient}
        setSearchQuery={setSearchQuery}
        setSearchResults={setSearchResults}
      />

      {/* Work order steps */}
      <BomOperationListEdit
        editOps={editOps}
        setEditOps={setEditOps}
        removedOpIds={removedOpIds}
        setRemovedOpIds={setRemovedOpIds}
        editingOpId={editingOpId}
        setEditingOpId={setEditingOpId}
        workcenters={workcenters}
        showAddOp={showAddOp}
        setShowAddOp={setShowAddOp}
        newOp={newOp}
        setNewOp={setNewOp}
        updateEditOp={updateEditOp}
        handlePdfUpload={handlePdfUpload}
      />

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
  );
}
