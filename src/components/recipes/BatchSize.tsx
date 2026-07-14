'use client';

import React, { useState, useMemo } from 'react';
import AppHeader from '@/components/ui/AppHeader';

/** One driving-ingredient option: an ingredient with its base amount for one base batch. */
export interface ScaleIngredient {
  id: number;
  name: string;
  baseQty: number;   // amount used at the recipe's base batch
  uom: string;
}

interface Props {
  mode: 'cooking' | 'production';
  recipeName: string;
  baseBatch: number;
  /** Aggregated recipe ingredients (both modes). Only entries with baseQty > 0 enable "set by ingredient". */
  ingredients?: ScaleIngredient[];
  onBack: () => void;
  onHome?: () => void;
  onConfirm: (batch: number, multiplier: number) => void;
}

export default function BatchSize({ mode, recipeName, baseBatch, ingredients, onBack, onHome, onConfirm }: Props) {
  const unit = mode === 'cooking' ? 'servings' : 'kg';
  const presets = mode === 'cooking' ? [1, 2, 10, 20] : [5, 10, 20, 50];
  const [batch, setBatch] = useState(mode === 'cooking' ? 1 : 10);
  const [showNumpad, setShowNumpad] = useState(false);
  const [numpadVal, setNumpadVal] = useState('');

  // "Set by ingredient" state
  const scaleIngredients = useMemo(
    () => (ingredients || []).filter(i => i.baseQty > 0),
    [ingredients],
  );
  const canSetByIngredient = scaleIngredients.length > 0;
  const [sqcOn, setSqcOn] = useState(false);
  const [drivingIdx, setDrivingIdx] = useState(0);
  const [drivingQty, setDrivingQty] = useState('');

  const accentBg = mode === 'cooking' ? 'bg-green-600' : 'bg-blue-600';
  const accentActive = mode === 'cooking' ? 'active:bg-green-700' : 'active:bg-blue-700';

  // When driving by an ingredient, the multiplier is exact (entered / base); the batch figure is derived.
  const driving = scaleIngredients[drivingIdx];
  const sqcMultiplier = useMemo(() => {
    if (!sqcOn || !driving || driving.baseQty <= 0) return null;
    const entered = parseFloat(drivingQty);
    if (!entered || entered <= 0) return null;
    return entered / driving.baseQty;
  }, [sqcOn, driving, drivingQty]);

  // Effective values passed to cooking.
  const effectiveMultiplier = sqcMultiplier != null ? sqcMultiplier : (baseBatch > 0 ? batch / baseBatch : 1);
  const derivedBatch = Math.max(1, Math.round(baseBatch * effectiveMultiplier));
  const effectiveBatch = sqcMultiplier != null ? derivedBatch : batch;

  function handleNumpadKey(key: string) {
    if (key === 'C') { setNumpadVal(''); return; }
    if (key === 'del') { setNumpadVal(v => v.slice(0, -1)); return; }
    if (key === 'done') {
      const val = parseFloat(numpadVal);
      if (val > 0) setBatch(val);
      setShowNumpad(false); setNumpadVal(''); return;
    }
    if (key === '.' && numpadVal.includes('.')) return;
    if (numpadVal.length >= 6) return;
    setNumpadVal(v => v + key);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppHeader title="Batch Size" subtitle={recipeName} showBack onBack={onBack} />
      <div className="px-5 pt-6 pb-8 flex-1">
        <div className="text-center mb-6">
          <h2 className="text-[18px] font-bold text-gray-900">{mode === 'cooking' ? 'How much are we making?' : 'Batch quantity'}</h2>
          <p className="text-[13px] text-gray-500 mt-1">
            {sqcOn ? 'Everything scales to the amount you have' : (mode === 'cooking' ? 'Ingredients scale automatically' : `Base recipe: ${baseBatch} kg`)}
          </p>
        </div>

        {/* Set by ingredient — available whenever the recipe has ingredient amounts (both guides) */}
        {canSetByIngredient && (
          <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4">
            <button onClick={() => { setSqcOn(!sqcOn); if (sqcOn) setDrivingQty(''); }} className="w-full flex items-center justify-between">
              <div className="text-left">
                <div className="text-[13px] font-semibold text-gray-900">Set by ingredient</div>
                <div className="text-[11px] text-gray-500">Enter what you have &mdash; the rest follows</div>
              </div>
              <div className={`w-11 h-6 rounded-full transition-colors relative flex-shrink-0 ${sqcOn ? accentBg : 'bg-gray-300'}`}>
                <div className={`w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${sqcOn ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
            </button>
            {sqcOn && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Driving ingredient</div>
                <select
                  value={drivingIdx}
                  onChange={(e) => { setDrivingIdx(parseInt(e.target.value) || 0); }}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-[13px] font-semibold text-gray-800 bg-white mb-3"
                >
                  {scaleIngredients.map((ing, i) => (
                    <option key={ing.id} value={i}>{ing.name} ({ing.baseQty} {ing.uom}/batch)</option>
                  ))}
                </select>
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">How much {driving?.name} do you have?</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number" inputMode="decimal" placeholder={`e.g. ${driving?.baseQty ?? ''}`}
                    value={drivingQty}
                    onChange={(e) => setDrivingQty(e.target.value)}
                    className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 text-[16px] font-bold font-mono"
                  />
                  <div className="text-[13px] text-gray-500 font-mono">{driving?.uom || 'kg'}</div>
                </div>
                <div className={`mt-3 text-[13px] text-gray-600 ${mode === 'cooking' ? 'bg-green-50' : 'bg-blue-50'} rounded-xl px-3 py-2.5`}>
                  {sqcMultiplier != null
                    ? <span><b>{drivingQty} {driving?.uom}</b> {driving?.name} {'→'} <b>{effectiveBatch} {unit}</b> ({(sqcMultiplier).toFixed(2)}x recipe)</span>
                    : 'Enter a quantity to calculate the batch'}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Manual servings / kg picker (default) */}
        {!sqcOn && (
          <div className="text-center">
            <div className="flex items-center justify-center gap-4 mb-4">
              <button onClick={() => setBatch(Math.max(1, batch - (mode === 'cooking' ? 1 : 5)))}
                className="w-14 h-14 rounded-2xl bg-white border border-gray-200 flex items-center justify-center text-[24px] font-bold text-gray-600 active:bg-gray-100 shadow-sm">-</button>
              <button onClick={() => { setNumpadVal(String(batch)); setShowNumpad(true); }}
                className="w-24 h-14 rounded-2xl bg-white border border-gray-200 flex items-center justify-center text-[28px] font-bold text-gray-900 font-mono active:bg-gray-50 shadow-sm">{batch}</button>
              <button onClick={() => setBatch(batch + (mode === 'cooking' ? 1 : 5))}
                className="w-14 h-14 rounded-2xl bg-white border border-gray-200 flex items-center justify-center text-[24px] font-bold text-gray-600 active:bg-gray-100 shadow-sm">+</button>
            </div>
            <div className="text-[14px] text-gray-500 font-medium mb-4">{unit}</div>
            <div className="flex justify-center gap-2">
              {presets.map(p => (
                <button key={p} onClick={() => setBatch(p)}
                  className={`px-4 py-2 rounded-full text-[13px] font-bold border transition-colors ${
                    batch === p ? `${accentBg} text-white border-transparent` : 'bg-white text-gray-600 border-gray-200 active:bg-gray-50'
                  }`}>{mode === 'production' ? `${p} kg` : p}</button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="px-5 py-4">
        <button
          onClick={() => onConfirm(effectiveBatch, effectiveMultiplier)}
          disabled={sqcOn && sqcMultiplier == null}
          className={`w-full py-4 rounded-2xl text-[16px] font-bold text-white shadow-lg transition-all ${
            sqcOn && sqcMultiplier == null ? 'bg-gray-300 cursor-not-allowed' : `${accentBg} ${accentActive}`
          }`}>
          Confirm {'→'} Ingredients
        </button>
      </div>
      {showNumpad && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setShowNumpad(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full bg-white rounded-t-3xl px-5 pt-5 pb-8" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Enter {unit}</span>
              <div className="text-[32px] font-bold text-gray-900 font-mono h-10 mt-1">{numpadVal || '0'}</div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['1','2','3','4','5','6','7','8','9','.','0','del'].map(key => (
                <button key={key} onClick={() => handleNumpadKey(key)}
                  className="h-14 rounded-xl bg-gray-100 text-[20px] font-bold text-gray-800 active:bg-gray-200 flex items-center justify-center">
                  {key === 'del' ? '⌫' : key}
                </button>
              ))}
            </div>
            <button onClick={() => handleNumpadKey('done')} className={`w-full mt-3 py-4 rounded-2xl text-[16px] font-bold text-white ${accentBg} ${accentActive}`}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
