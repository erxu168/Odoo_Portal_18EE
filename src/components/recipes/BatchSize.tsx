'use client';

import React, { useState } from 'react';

interface BomIngredient {
  id: number;
  name: string;
  qty: number;
  uom: string;
}

interface Props {
  mode: 'cooking' | 'production';
  recipeName: string;
  baseBatch: number;
  bomIngredients?: BomIngredient[];
  onBack: () => void;
  onHome: () => void;
  onConfirm: (batch: number, multiplier: number) => void;
}

export default function BatchSize({ mode, recipeName, baseBatch, bomIngredients, onBack, onHome, onConfirm }: Props) {
  const unit = mode === 'cooking' ? 'servings' : 'kg';
  const presets = mode === 'cooking' ? [1, 2, 10, 20] : [5, 10, 20, 50];
  const [batch, setBatch] = useState(mode === 'cooking' ? 1 : 10);
  const [showNumpad, setShowNumpad] = useState(false);
  const [numpadVal, setNumpadVal] = useState('');
  const [sqcOn, setSqcOn] = useState(false);
  const [sqcIngIdx, setSqcIngIdx] = useState(0);
  const [sqcQty, setSqcQty] = useState('');

  const accentBg = mode === 'cooking' ? 'bg-green-600' : 'bg-purple-600';
  const accentActive = mode === 'cooking' ? 'active:bg-green-700' : 'active:bg-purple-700';

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

  function sqcCalc(ingIdx: number, qty: string) {
    setSqcIngIdx(ingIdx);
    setSqcQty(qty);
    if (!bomIngredients || !qty) return;
    const ing = bomIngredients[ingIdx];
    if (!ing || ing.qty <= 0) return;
    const val = parseFloat(qty);
    if (val > 0) {
      const outputKg = Math.round((val / ing.qty) * baseBatch * 100) / 100;
      setBatch(Math.round(outputKg));
    }
  }

  const sqcResult = (() => {
    if (!bomIngredients || !sqcQty) return null;
    const ing = bomIngredients[sqcIngIdx];
    if (!ing || ing.qty <= 0) return null;
    const val = parseFloat(sqcQty);
    if (!val || val <= 0) return null;
    const outputKg = Math.round((val / ing.qty) * baseBatch * 100) / 100;
    const ratio = Math.round((val / ing.qty) * 100) / 100;
    return { outputKg, ratio, ingName: ing.name, inputQty: val };
  })();

  const multiplier = batch / baseBatch;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#1A1F2E] px-5 pt-14 pb-5 relative overflow-hidden">
        <div className="flex items-center gap-3 relative">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Batch Size</h1>
            <p className="text-[12px] text-white/50 mt-0.5">{recipeName}</p>
          </div>
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
        </div>
      </div>
      <div className="px-5 pt-6 pb-28 flex-1">
        <div className="text-center mb-6">
          <h2 className="text-[18px] font-bold text-gray-900">{mode === 'cooking' ? 'How many servings?' : 'Batch quantity'}</h2>
          <p className="text-[13px] text-gray-500 mt-1">
            {mode === 'cooking' ? 'Ingredients scale automatically' : `BoM base: ${baseBatch} kg`}
          </p>
        </div>
        {mode === 'production' && bomIngredients && bomIngredients.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4">
            <button onClick={() => setSqcOn(!sqcOn)} className="w-full flex items-center justify-between">
              <div className="text-left">
                <div className="text-[13px] font-semibold text-gray-900">Set by ingredient</div>
                <div className="text-[11px] text-gray-500">Calculate batch from what you have</div>
              </div>
              <div className={`w-11 h-6 rounded-full transition-colors relative ${sqcOn ? 'bg-purple-600' : 'bg-gray-300'}`}>
                <div className={`w-5 h-5 rounded-full bg-white shadow absolute top-0.5 transition-transform ${sqcOn ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </div>
            </button>
            {sqcOn && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Driving ingredient</div>
                <select value={sqcIngIdx} onChange={(e) => { const idx = parseInt(e.target.value); sqcCalc(idx, sqcQty); }}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-[13px] text-gray-800 bg-white mb-3">
                  {bomIngredients.map((ing, i) => (
                    <option key={i} value={i}>{ing.name} ({ing.qty} {ing.uom}/batch)</option>
                  ))}
                </select>
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">How much do you have?</div>
                <div className="flex items-center gap-2">
                  <input type="number" inputMode="decimal" placeholder="e.g. 5" value={sqcQty}
                    onChange={(e) => sqcCalc(sqcIngIdx, e.target.value)}
                    className="flex-1 px-3 py-2.5 rounded-xl border border-gray-200 text-[14px] font-mono" />
                  <div className="text-[13px] text-gray-500 font-mono">{bomIngredients[sqcIngIdx]?.uom || 'kg'}</div>
                </div>
                <div className="mt-3 text-[13px] text-gray-600 bg-purple-50 rounded-xl px-3 py-2.5">
                  {sqcResult
                    ? <span><b>{sqcResult.inputQty} {bomIngredients[sqcIngIdx]?.uom}</b> {sqcResult.ingName} {'\u2192'} <b>{sqcResult.outputKg} kg</b> output ({sqcResult.ratio}x batch)</span>
                    : 'Enter a quantity to calculate batch size'}
                </div>
              </div>
            )}
          </div>
        )}
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
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-5 py-4 max-w-lg mx-auto">
        <button onClick={() => onConfirm(batch, multiplier)}
          className={`w-full py-4 rounded-2xl text-[16px] font-bold text-white ${accentBg} ${accentActive} shadow-lg`}>
          Confirm {'\u2192'} Ingredients
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
                  {key === 'del' ? '\u232b' : key}
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
