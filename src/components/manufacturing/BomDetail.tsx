'use client';

import React from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { useBomDetail } from './useBomDetail';
import BomViewMode from './BomViewMode';
import BomEditMode from './BomEditMode';

interface BomDetailProps {
  bomId: number;
  onBack: () => void;
  onCreateMo: (bomId: number) => void;
}

export default function BomDetail({ bomId, onBack, onCreateMo }: BomDetailProps) {
  const h = useBomDetail(bomId);

  // ── Loading ──
  if (h.loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
      </div>
    );
  }

  // ── Error ──
  if (h.error || !h.bom) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
        <div className="text-center">
          <p className="text-[var(--fs-lg)] text-gray-900 font-bold mb-1">Could not load recipe</p>
          <p className="text-[var(--fs-xs)] text-gray-500 mb-5">{h.error || 'Recipe not found'}</p>
          <button onClick={h.fetchBomDetail} className="px-6 py-3 bg-green-600 text-white text-[var(--fs-sm)] font-bold rounded-xl">Retry</button>
        </div>
      </div>
    );
  }

  const productName = h.bom.product_tmpl_id[1];
  const uom = h.bom.product_uom_id[1];

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        title={productName}
        subtitle={`${h.fmt(h.bom.product_qty)} ${uom} per batch`}
        showBack
        onBack={onBack}
        action={
          !h.editing ? (
            <button
              onClick={h.startEditing}
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
            <div className="text-lg font-bold text-green-600 mt-0.5 font-mono">{h.components.length}</div>
          </div>
          <div className="flex-1 text-center py-3">
            <div className="text-[var(--fs-xs)] text-gray-400 font-semibold tracking-wider">CAN MAKE</div>
            <div className="text-lg font-bold text-green-500 mt-0.5 font-mono">{h.fmt(h.canMakeQty)} {uom}</div>
          </div>
        </div>
      </div>

      {/* Edit mode vs View mode */}
      {h.editing ? (
        <BomEditMode
          uom={uom}
          editBomQty={h.editBomQty}
          setEditBomQty={h.setEditBomQty}
          editLines={h.editLines}
          updateLineQty={h.updateLineQty}
          removeLine={h.removeLine}
          showAddSearch={h.showAddSearch}
          setShowAddSearch={h.setShowAddSearch}
          searchQuery={h.searchQuery}
          handleSearchChange={h.handleSearchChange}
          searching={h.searching}
          searchResults={h.searchResults}
          addIngredient={h.addIngredient}
          setSearchQuery={h.setSearchQuery}
          setSearchResults={h.setSearchResults}
          editOps={h.editOps}
          setEditOps={h.setEditOps}
          removedOpIds={h.removedOpIds}
          setRemovedOpIds={h.setRemovedOpIds}
          editingOpId={h.editingOpId}
          setEditingOpId={h.setEditingOpId}
          workcenters={h.workcenters}
          showAddOp={h.showAddOp}
          setShowAddOp={h.setShowAddOp}
          newOp={h.newOp}
          setNewOp={h.setNewOp}
          updateEditOp={h.updateEditOp}
          handlePdfUpload={h.handlePdfUpload}
          saving={h.saving}
          saveError={h.saveError}
          handleSave={h.handleSave}
          cancelEditing={h.cancelEditing}
        />
      ) : (
        <BomViewMode
          bom={h.bom}
          components={h.components}
          operations={h.operations}
          expandedSubBoms={h.expandedSubBoms}
          toggleSubBom={h.toggleSubBom}
          fmt={h.fmt}
          onCreateMo={onCreateMo}
        />
      )}
    </div>
  );
}
