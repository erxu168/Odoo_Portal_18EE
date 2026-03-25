'use client';

import React, { useState, useRef, useCallback } from 'react';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Toast from '@/components/ui/Toast';

export interface RecordedIngredient {
  id: string;            // local ID for UI tracking
  productId: number;     // Odoo product.product ID
  name: string;          // product name
  qty: number;           // quantity
  uomId: number | null;  // Odoo uom.uom ID
  uomName: string;       // UoM display name
}

export interface RecordedStep {
  id: string;
  step_type: 'prep' | 'cook' | 'plate';
  instruction: string;
  timer_seconds: number;
  tip: string;
  photos: string[];
  ingredientIds: string[];  // references RecordedIngredient.id
}

const LS_KEY = 'kw_recording_steps';
const MAX_PHOTO_MB = 5;
const MAX_PHOTO_BYTES = MAX_PHOTO_MB * 1024 * 1024;

function loadSavedSteps(recipeName: string): RecordedStep[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data.recipeName === recipeName && Array.isArray(data.steps)) return data.steps;
  } catch (_e) { /* */ }
  return [];
}

function saveStepsToStorage(recipeName: string, steps: RecordedStep[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ recipeName, steps, savedAt: Date.now() }));
  } catch (_e) { /* */ }
}

export function clearRecordingStorage() {
  try { localStorage.removeItem(LS_KEY); } catch (_e) { /* */ }
}

interface Props {
  recipeName: string;
  mode: 'cooking' | 'production';
  initialSteps?: RecordedStep[];
  ingredients: RecordedIngredient[];
  onIngredientsChange: (ingredients: RecordedIngredient[]) => void;
  onFinish: (steps: RecordedStep[]) => void;
  onBack: () => void;
  onHome: () => void;
}

export default function ActiveRecording({ recipeName, mode, initialSteps, ingredients, onIngredientsChange, onFinish, onBack, onHome }: Props) {
  const [steps, setSteps] = useState<RecordedStep[]>(() => {
    if (initialSteps && initialSteps.length > 0) return initialSteps;
    return loadSavedSteps(recipeName);
  });
  const [instruction, setInstruction] = useState('');
  const [stepType, setStepType] = useState<'prep' | 'cook' | 'plate'>('prep');
  const [timerSec, setTimerSec] = useState(0);
  const [tip, setTip] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [selectedIngIds, setSelectedIngIds] = useState<string[]>([]);
  const [showIngredientManager, setShowIngredientManager] = useState(false);
  const [productQuery, setProductQuery] = useState('');
  const [productResults, setProductResults] = useState<{ id: number; name: string; uom_id: number | null; uom_name: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [newIngQty, setNewIngQty] = useState('');
  const [uoms, setUoms] = useState<{ id: number; name: string; category: string }[]>([]);
  const [selectedUomId, setSelectedUomId] = useState<number | null>(null);
  const [showUomPicker, setShowUomPicker] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState(true);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  React.useEffect(() => {
    if (!recording) return;
    timerRef.current = setInterval(() => setElapsed(p => p + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [recording]);

  // P9: Auto-save steps to localStorage whenever they change
  const updateSteps = useCallback((newSteps: RecordedStep[]) => {
    setSteps(newSteps);
    saveStepsToStorage(recipeName, newSteps);
  }, [recipeName]);

  function formatElapsed(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  function formatTimerDisplay(sec: number): string {
    if (sec === 0) return '0s';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s}s`;
    if (s === 0) return `${m}m`;
    return `${m}m ${s}s`;
  }

  // P8: Validate photo size before adding
  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setToast({ msg: `Photo too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max ${MAX_PHOTO_MB}MB.`, type: 'error' });
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPhotos(prev => [...prev, reader.result as string]);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  function buildCurrentStep(): RecordedStep | null {
    if (!instruction.trim()) return null;
    return {
      id: `step_${Date.now()}`, step_type: stepType,
      instruction: instruction.trim(), timer_seconds: timerSec,
      tip: tip.trim(), photos: [...photos],
      ingredientIds: [...selectedIngIds],
    };
  }

  function saveStep() {
    const newStep = buildCurrentStep();
    if (!newStep) return;
    const newSteps = [...stepsRef.current, newStep];
    updateSteps(newSteps);
    setInstruction(''); setTimerSec(0); setTip(''); setPhotos([]); setSelectedIngIds([]);
    setToast({ msg: `Step ${newSteps.length} saved`, type: 'success' });
  }

  function handleFinishRecording() {
    setRecording(false);
    const currentStep = buildCurrentStep();
    const finalSteps = currentStep
      ? [...stepsRef.current, currentStep]
      : [...stepsRef.current];
    clearRecordingStorage();
    onFinish(finalSteps);
  }

  // P6: Replace confirm() with ConfirmDialog
  function handleExit() {
    setShowExitConfirm(true);
  }

  function confirmExit() {
    setShowExitConfirm(false);
    const currentStep = buildCurrentStep();
    const finalSteps = currentStep
      ? [...stepsRef.current, currentStep]
      : [...stepsRef.current];
    setRecording(false);
    clearRecordingStorage();
    onFinish(finalSteps);
  }

  // P7: Timer increment helpers (seconds precision)
  function addTimerSeconds(sec: number) {
    setTimerSec(prev => Math.max(0, prev + sec));
  }

  function searchProducts(q: string) {
    setProductQuery(q);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (q.trim().length < 1) { setProductResults([]); return; }
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/products/search?q=${encodeURIComponent(q.trim())}&limit=10`);
        if (res.ok) {
          const data = await res.json();
          setProductResults(data.products || []);
        }
      } catch (_e) { /* */ }
      setSearching(false);
    }, 300);
  }

  function addIngredientFromProduct(product: { id: number; name: string; uom_id: number | null; uom_name: string }) {
    // Don't add duplicates
    if (ingredients.some(i => i.productId === product.id)) {
      setToast({ msg: `${product.name} already added`, type: 'info' });
      return;
    }
    const ing: RecordedIngredient = {
      id: `ing_${Date.now()}`,
      productId: product.id,
      name: product.name,
      qty: parseFloat(newIngQty) || 0,
      uomId: selectedUomId || product.uom_id,
      uomName: selectedUomId ? (uoms.find(u => u.id === selectedUomId)?.name || product.uom_name) : product.uom_name,
    };
    onIngredientsChange([...ingredients, ing]);
    setProductQuery(''); setProductResults([]); setNewIngQty(''); setSelectedUomId(null);
  }

  function removeIngredient(id: string) {
    onIngredientsChange(ingredients.filter(i => i.id !== id));
    setSelectedIngIds(prev => prev.filter(sid => sid !== id));
  }

  function toggleIngForStep(id: string) {
    setSelectedIngIds(prev => prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]);
  }

  async function loadUoms() {
    if (uoms.length > 0) return;
    try {
      const res = await fetch('/api/uom');
      if (res.ok) {
        const data = await res.json();
        setUoms(data.uoms || []);
      }
    } catch (_e) { /* */ }
  }

  const hasContent = instruction.trim().length > 0;

  return (
    <div className="min-h-screen bg-[#1C1C1E] flex flex-col">
      {/* Toast */}
      {toast && <Toast message={toast.msg} type={toast.type} visible={true} onDismiss={() => setToast(null)} duration={2000} />}

      {/* P6: ConfirmDialog for exit */}
      {showExitConfirm && (
        <ConfirmDialog
          title="End recording?"
          message="Your saved steps will be kept. You can still review and submit them."
          confirmLabel="End and review"
          cancelLabel="Keep recording"
          variant="danger"
          onConfirm={confirmExit}
          onCancel={() => setShowExitConfirm(false)}
        />
      )}

      {/* Ingredient Manager Overlay */}
      {showIngredientManager && (
        <div className="fixed inset-0 z-[50] bg-[#1C1C1E] flex flex-col">
          <div className="px-5 pt-14 pb-3 flex items-center gap-3">
            <button onClick={() => setShowIngredientManager(false)} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
            <div className="flex-1">
              <div className="text-[18px] font-bold text-white">Ingredients</div>
              <div className="text-[11px] text-zinc-400">{recipeName}</div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-3">
            {/* Search for Odoo products */}
            <div className="mb-4 p-3 rounded-xl bg-zinc-800 border border-zinc-700">
              <div className="text-[12px] text-zinc-400 font-semibold mb-2">Search ingredient</div>
              <input type="text" value={productQuery} onChange={(e) => searchProducts(e.target.value)}
                placeholder="Type to search products..." maxLength={100}
                className="w-full px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-[14px] text-white placeholder-white/30 mb-2" />

              {/* Qty + UoM row */}
              <div className="flex gap-2 mb-2">
                <input type="text" value={newIngQty} onChange={(e) => setNewIngQty(e.target.value)}
                  placeholder="Qty" maxLength={10} inputMode="decimal"
                  className="w-20 px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-[14px] text-white placeholder-white/30" />
                <button onClick={() => { loadUoms(); setShowUomPicker(!showUomPicker); }}
                  className="flex-1 px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-[14px] text-left text-zinc-300 active:bg-zinc-700">
                  {selectedUomId ? uoms.find(u => u.id === selectedUomId)?.name || 'Unit' : 'Select unit...'}
                </button>
              </div>

              {/* UoM picker */}
              {showUomPicker && uoms.length > 0 && (
                <div className="mb-2 max-h-40 overflow-y-auto rounded-lg border border-zinc-700 bg-[#1a1a1a]">
                  {uoms.map(u => (
                    <button key={u.id} onClick={() => { setSelectedUomId(u.id); setShowUomPicker(false); }}
                      className={`w-full text-left px-3 py-2 text-[13px] border-b border-white/5 active:bg-zinc-700 ${
                        selectedUomId === u.id ? 'text-green-400 bg-green-500/10' : 'text-white/70'
                      }`}>
                      {u.name} <span className="text-zinc-400 text-[11px]">{u.category}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Search results */}
              {searching && <div className="text-[12px] text-zinc-400 py-2">Searching...</div>}
              {productResults.length > 0 && (
                <div className="space-y-1">
                  {productResults.map(p => {
                    const alreadyAdded = ingredients.some(i => i.productId === p.id);
                    return (
                      <button key={p.id} onClick={() => !alreadyAdded && addIngredientFromProduct(p)}
                        disabled={alreadyAdded}
                        className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition-colors ${
                          alreadyAdded ? 'bg-white/[0.02] opacity-40' : 'bg-white/[0.04] active:bg-zinc-700'
                        }`}>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-white truncate">{p.name}</div>
                          <div className="text-[11px] text-zinc-400">{p.uom_name}{alreadyAdded ? ' \u00b7 already added' : ''}</div>
                        </div>
                        {!alreadyAdded && (
                          <div className="w-7 h-7 rounded-lg bg-green-500/20 flex items-center justify-center flex-shrink-0">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {productQuery.length > 0 && !searching && productResults.length === 0 && (
                <div className="text-[12px] text-zinc-400 py-2">No products found for &ldquo;{productQuery}&rdquo;</div>
              )}
            </div>

            {/* Current ingredients list */}
            {ingredients.length === 0 ? (
              <div className="text-center py-10">
                <div className="text-4xl mb-3">{<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 21h10M12 21V11"/><circle cx="12" cy="7" r="4"/><circle cx="7" cy="9" r="3"/><circle cx="17" cy="9" r="3"/></svg>}</div>
                <div className="text-[14px] text-zinc-400">No ingredients yet</div>
                <div className="text-[12px] text-white/25 mt-1">Search and add ingredients above</div>
              </div>
            ) : (
              <div className="space-y-2">
                {ingredients.map((ing) => (
                  <div key={ing.id} className="flex items-center gap-3 px-3 py-3 rounded-xl bg-zinc-800/80 border border-zinc-700">
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold text-white truncate">{ing.name}</div>
                      <div className="text-[12px] text-zinc-400 font-mono">
                        {ing.qty > 0 ? ing.qty : ''}{ing.uomName ? ` ${ing.uomName}` : ''}
                      </div>
                    </div>
                    <button onClick={() => removeIngredient(ing.id)}
                      className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center active:bg-red-500/20">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="px-5 py-4">
            <button onClick={() => { setShowIngredientManager(false); setProductQuery(''); setProductResults([]); setShowUomPicker(false); }}
              className="w-full py-3.5 rounded-2xl text-[15px] font-bold text-white bg-green-600 active:bg-green-700">
              Done ({ingredients.length} ingredient{ingredients.length !== 1 ? 's' : ''})
            </button>
          </div>
        </div>
      )}

      <div className="px-5 pt-14 pb-3 flex items-center gap-3">
        <button onClick={handleExit} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <div className="flex-1 flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-[14px] font-bold text-white font-mono">{formatElapsed(elapsed)}</span>
          <span className="text-[12px] text-zinc-400 bg-zinc-700 px-2 py-0.5 rounded">{steps.length} steps</span>
        </div>
        <button onClick={handleFinishRecording} className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-[13px] font-bold text-red-400 active:bg-red-500/30">End</button>
        <button onClick={onHome} className="w-9 h-9 rounded-xl bg-zinc-700 border border-zinc-700 flex items-center justify-center active:bg-zinc-600">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
        </button>
      </div>
      <div className="px-5 py-2">
        <div className="text-[11px] text-zinc-400 font-semibold">{recipeName} {'\u00b7'} {mode === 'cooking' ? 'Cooking' : 'Production'}</div>
      </div>
      <div className="px-5 mb-3">
        <button onClick={() => fileRef.current?.click()}
          className="w-full h-32 rounded-2xl bg-zinc-800 border border-zinc-700 border-dashed flex flex-col items-center justify-center active:bg-zinc-700">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/>
          </svg>
          <span className="text-[12px] text-zinc-400 mt-2">Tap to take photo</span>
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFileChange} className="hidden" />
      </div>
      {photos.length > 0 && (
        <div className="px-5 mb-3 flex gap-2 overflow-x-auto no-scrollbar">
          {photos.map((p, i) => (
            <div key={i} className="w-16 h-16 rounded-xl bg-zinc-700 flex-shrink-0 relative overflow-hidden">
              <img src={p} alt="" className="w-full h-full object-cover" />
              <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))}
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="px-5 flex-1">
        <div className="mb-3">
          <div className="flex gap-1.5 mb-2">
            {(['prep', 'cook', 'plate'] as const).map(t => (
              <button key={t} onClick={() => setStepType(t)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-bold capitalize transition-colors ${
                  stepType === t ? 'bg-zinc-600 text-white' : 'bg-zinc-800 text-zinc-400'
                }`}>{t}</button>
            ))}
          </div>
          <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)}
            placeholder="Describe this step..." rows={3} maxLength={2000}
            className="w-full px-4 py-3 rounded-xl bg-zinc-800 border border-zinc-700 text-[14px] text-white placeholder-white/30 resize-none" />
        </div>

        {/* P7: Timer with seconds precision */}
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[12px] text-zinc-400 font-semibold">Timer</span>
            <span className="text-[14px] font-bold text-white font-mono">{formatTimerDisplay(timerSec)}</span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <button onClick={() => addTimerSeconds(30)} className="px-3 py-1.5 rounded-lg bg-zinc-700 text-[12px] text-zinc-300 active:bg-zinc-600 font-mono">+30s</button>
            <button onClick={() => addTimerSeconds(60)} className="px-3 py-1.5 rounded-lg bg-zinc-700 text-[12px] text-zinc-300 active:bg-zinc-600 font-mono">+1m</button>
            <button onClick={() => addTimerSeconds(300)} className="px-3 py-1.5 rounded-lg bg-zinc-700 text-[12px] text-zinc-300 active:bg-zinc-600 font-mono">+5m</button>
            <button onClick={() => addTimerSeconds(600)} className="px-3 py-1.5 rounded-lg bg-zinc-700 text-[12px] text-zinc-300 active:bg-zinc-600 font-mono">+10m</button>
            {timerSec > 0 && (
              <button onClick={() => setTimerSec(0)} className="px-3 py-1.5 rounded-lg bg-red-500/15 text-[12px] text-red-400 active:bg-red-500/20 font-semibold">Clear</button>
            )}
          </div>
        </div>

        <input type="text" value={tip} onChange={(e) => setTip(e.target.value)}
          placeholder="Chef tip (optional)" maxLength={500}
          className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-[13px] text-white placeholder-white/30 mb-3" />

        {/* Ingredients for this step */}
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[12px] text-zinc-400 font-semibold">Ingredients</span>
            <button onClick={() => setShowIngredientManager(true)}
              className="px-2.5 py-1 rounded-lg bg-zinc-700 text-[11px] text-zinc-300 font-semibold active:bg-zinc-600">
              {ingredients.length > 0 ? `Manage (${ingredients.length})` : '+ Add ingredients'}
            </button>
          </div>
          {ingredients.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {ingredients.map(ing => {
                const isSelected = selectedIngIds.includes(ing.id);
                return (
                  <button key={ing.id} onClick={() => toggleIngForStep(ing.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-[12px] font-medium border transition-colors ${
                      isSelected
                        ? 'border-green-500 bg-green-500/15 text-green-400'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-400'
                    }`}>
                    {ing.qty > 0 && <span className="font-mono mr-1">{ing.qty}{ing.uomName ? ` ${ing.uomName}` : ''}</span>}
                    {ing.name}
                  </button>
                );
              })}
            </div>
          )}
          {ingredients.length > 0 && selectedIngIds.length === 0 && (
            <p className="text-[11px] text-zinc-400 mt-1.5">Tap ingredients used in this step</p>
          )}
        </div>
      </div>
      <div className="px-5 py-4 flex gap-3">
        <button onClick={saveStep} disabled={!hasContent}
          className={`flex-1 py-3.5 rounded-2xl text-[15px] font-bold transition-all ${
            hasContent ? 'bg-green-600 text-white active:bg-green-700' : 'bg-zinc-700 text-zinc-400'
          }`}>Save step +</button>
        <button onClick={handleFinishRecording}
          className="px-6 py-3.5 rounded-2xl text-[15px] font-bold text-amber-400 border border-amber-400/30 bg-amber-400/10 active:bg-amber-400/20">Finish</button>
      </div>
    </div>
  );
}
