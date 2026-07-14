'use client';

import React, { useState, useEffect } from 'react';
import { Stepper, leafCategory } from './ui';
import NumpadModal from './NumpadModal';
import { crateTotal, baseIsMeasure, pluralizePack } from '@/lib/crate-units';

/**
 * Full-screen count sheet for a product counted in a "pack" unit
 * (crate / bunch / piece / tray…) that converts to the product's base unit.
 *
 * Two shapes, chosen by the base UoM:
 *  - COUNT base (e.g. bottles/Units): full packs + loose base units (2 steppers).
 *  - MEASURE base (e.g. kg/L): count whole packs only → converts to weight by an
 *    average (1 stepper), because staff can't weigh a partial on the floor.
 *
 * The parent stores the base-unit total in Odoo; this sheet captures the split.
 */
interface CrateCountSheetProps {
  open: boolean;
  product: { id: number; name: string; categ_id?: [number, string]; uom_id?: [number, string] } | null;
  unitsPerCrate: number;
  uom: string;
  packLabel: string;
  initialCrates: number;
  initialLoose: number;
  showSystemQty: boolean;
  systemQty: number | null;
  locationName: string;
  onSave: (crates: number, loose: number) => void;
  onClose: () => void;
}

export default function CrateCountSheet({
  open, product, unitsPerCrate, uom, packLabel, initialCrates, initialLoose,
  showSystemQty, systemQty, locationName, onSave, onClose,
}: CrateCountSheetProps) {
  const [crates, setCrates] = useState(0);
  const [loose, setLoose] = useState(0);
  const [pad, setPad] = useState<null | 'crates' | 'loose'>(null);

  useEffect(() => {
    if (open) {
      setCrates(initialCrates || 0);
      setLoose(initialLoose || 0);
      setPad(null);
    }
  }, [open, initialCrates, initialLoose]);

  if (!open || !product) return null;

  const unit = uom || 'Units';
  const label = packLabel || 'pack';
  const measure = baseIsMeasure(unit);          // weight/volume base → count whole packs only
  const looseVal = measure ? 0 : loose;
  const total = crateTotal(crates, looseVal, unitsPerCrate);
  const catLeaf = leafCategory(product.categ_id?.[1] || '');

  function step(which: 'crates' | 'loose', delta: number) {
    if (which === 'crates') setCrates((c) => Math.max(0, c + delta));
    else setLoose((l) => Math.max(0, l + delta));
  }

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-gray-50" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      {/* Header */}
      <div className="bg-white px-5 pt-4 pb-3 border-b border-gray-200">
        <div className="flex items-center justify-between mb-1">
          <button onClick={onClose} className="flex items-center gap-1 text-green-700 text-[var(--fs-base)] font-semibold active:opacity-70">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M15 19l-7-7 7-7"/></svg>
            Back
          </button>
          {locationName && <span className="text-[var(--fs-xs)] font-semibold px-2.5 py-0.5 rounded-md bg-green-50 text-green-700">{locationName}</span>}
        </div>
      </div>

      {/* Product info */}
      <div className="text-center py-4 px-4">
        <div className="text-[var(--fs-xxl)] font-bold text-gray-900">{product.name}</div>
        <div className="text-[var(--fs-sm)] text-gray-500 mt-1.5">
          {catLeaf ? `${catLeaf} · ` : ''}
          <span className="font-semibold text-blue-800 bg-blue-50 px-2 py-0.5 rounded-md">
            1 {label} {measure ? '≈' : '='} {unitsPerCrate} {unit}
          </span>
        </div>
        {showSystemQty && (
          <div className="text-[var(--fs-sm)] text-gray-400 mt-2">
            System qty: <span className="font-mono font-medium text-gray-500">{systemQty ?? '--'}</span> {unit}
          </div>
        )}
      </div>

      {/* Pack stepper */}
      <div className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-3.5 mx-[18px] mt-1">
        <div>
          <div className="text-[var(--fs-md)] font-bold text-gray-900">{measure ? 'Whole' : 'Full'} {pluralizePack(label, 2)}</div>
          <div className="text-[var(--fs-xs)] text-gray-500 font-semibold mt-0.5">{measure ? '≈' : '×'} {unitsPerCrate} {unit} each</div>
        </div>
        <Stepper value={crates} uom={pluralizePack(label, crates)}
          onMinus={() => step('crates', -1)} onPlus={() => step('crates', 1)} onTap={() => setPad('crates')} />
      </div>

      {/* Loose stepper — only for a countable base unit */}
      {!measure && (
        <div className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-2xl px-4 py-3.5 mx-[18px] mt-2.5">
          <div>
            <div className="text-[var(--fs-md)] font-bold text-gray-900">Loose {unit}</div>
            <div className="text-[var(--fs-xs)] text-gray-500 font-semibold mt-0.5">from opened {pluralizePack(label, 2)}</div>
          </div>
          <Stepper value={loose} uom={unit}
            onMinus={() => step('loose', -1)} onPlus={() => step('loose', 1)} onTap={() => setPad('loose')} />
        </div>
      )}

      {/* Live total */}
      <div className="mx-[18px] mt-4 bg-green-50 border border-green-200 rounded-2xl p-4 text-center">
        <div className="text-[var(--fs-sm)] text-green-700 font-mono font-semibold">
          {measure
            ? `${crates} × ${unitsPerCrate}`
            : `(${crates} × ${unitsPerCrate}) + ${loose}`}
        </div>
        <div className="text-[40px] leading-none font-extrabold font-mono text-green-700 mt-1.5">{total}</div>
        <div className="text-[var(--fs-sm)] text-green-700 font-bold mt-1">{unit} total{measure ? ' (avg)' : ''}</div>
      </div>

      {/* Note */}
      <div className="flex gap-2 items-start mx-[18px] mt-3.5 text-[var(--fs-xs)] text-gray-500 leading-snug">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" className="flex-shrink-0 mt-0.5"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
        <span>
          {measure
            ? `Count whole ${pluralizePack(label, 2)} — the ${unit} is an average, not weighed.`
            : `Count full ${pluralizePack(label, 2)} first, then any loose ${unit} from opened ones.`}
        </span>
      </div>

      {/* Save */}
      <div className="mt-auto px-[18px] pt-4 pb-6">
        <button onClick={() => onSave(crates, looseVal)}
          className="w-full h-14 rounded-xl bg-green-600 text-white text-[var(--fs-lg)] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.98] transition-all">
          Save count
        </button>
      </div>

      {/* Direct-entry numpad for whichever field was tapped */}
      <NumpadModal
        open={pad !== null}
        productName={pad === 'crates' ? `Whole ${pluralizePack(label, 2)}` : `Loose ${unit}`}
        category=""
        uom={pad === 'crates' ? pluralizePack(label, 2) : unit}
        initialValue={pad === 'crates' ? crates : loose}
        showSystemQty={false}
        systemQty={null}
        locationName={locationName}
        onSave={(v) => {
          const n = Math.max(0, v ?? 0);
          if (pad === 'crates') setCrates(n); else setLoose(n);
          setPad(null);
        }}
        onClose={() => setPad(null)}
      />
    </div>
  );
}
