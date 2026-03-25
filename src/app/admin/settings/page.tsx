'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface BomTolerance {
  bom_id: number;
  tolerance_pct: number;
  updated_at: string;
}

interface Bom {
  id: number;
  product_tmpl_id: [number, string];
  product_qty: number;
  company_id: [number, string] | false;
  component_count: number;
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [globalTolerance, setGlobalTolerance] = useState('5');
  const [originalGlobal, setOriginalGlobal] = useState('5');

  const [overrides, setOverrides] = useState<BomTolerance[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [showBomPicker, setShowBomPicker] = useState(false);
  const [bomSearch, setBomSearch] = useState('');
  const [editingBom, setEditingBom] = useState<{ id: number; name: string; pct: string } | null>(null);

  useEffect(() => { fetchAll(); }, []);

  useEffect(() => {
    if (success) { const t = setTimeout(() => setSuccess(null), 3000); return () => clearTimeout(t); }
  }, [success]);

  useEffect(() => {
    if (error) { const t = setTimeout(() => setError(null), 5000); return () => clearTimeout(t); }
  }, [error]);

  async function fetchAll() {
    setLoading(true);
    try {
      const [settingsRes, tolRes, bomsRes] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/bom-tolerance'),
        fetch('/api/boms'),
      ]);
      const settingsData = await settingsRes.json();
      const tolData = await tolRes.json();
      const bomsData = await bomsRes.json();

      const gTol = settingsData.settings?.default_tolerance_pct || '5';
      setGlobalTolerance(gTol);
      setOriginalGlobal(gTol);
      setOverrides(tolData.overrides || []);
      setBoms(bomsData.boms || []);
    } catch {
      setError('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  async function saveGlobal() {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_tolerance_pct: globalTolerance }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setOriginalGlobal(globalTolerance);
      setSuccess('Global tolerance updated');
    } catch {
      setError('Failed to save global tolerance');
    } finally {
      setSaving(false);
    }
  }

  async function saveBomOverride(bomId: number, pct: number) {
    try {
      const res = await fetch('/api/bom-tolerance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bom_id: bomId, tolerance_pct: pct }),
      });
      if (!res.ok) throw new Error('Failed to save');
      setSuccess('BOM tolerance updated');
      setEditingBom(null);
      fetchAll();
    } catch {
      setError('Failed to save BOM tolerance');
    }
  }

  async function removeBomOverride(bomId: number) {
    try {
      const res = await fetch('/api/bom-tolerance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bom_id: bomId, tolerance_pct: null }),
      });
      if (!res.ok) throw new Error('Failed to remove');
      setSuccess('Override removed \u2014 using global default');
      fetchAll();
    } catch {
      setError('Failed to remove override');
    }
  }

  function getBomName(bomId: number): string {
    const bom = boms.find(b => b.id === bomId);
    return bom?.product_tmpl_id?.[1] || `BOM #${bomId}`;
  }

  const globalChanged = globalTolerance !== originalGlobal;
  const overriddenBomIds = new Set(overrides.map(o => o.bom_id));
  const filteredBoms = boms.filter(b =>
    !overriddenBomIds.has(b.id) &&
    b.product_tmpl_id[1].toLowerCase().includes(bomSearch.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#2563EB] px-5 pt-14 pb-5 rounded-b-[28px]">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/')}
            className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Settings</h1>
            <p className="text-[12px] text-white/50 mt-0.5">Portal configuration</p>
          </div>
        </div>
      </div>

      {success && (
        <div className="mx-4 mt-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl text-green-700 text-[13px] font-semibold">
          {success}
        </div>
      )}
      {error && (
        <div className="mx-4 mt-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-[13px]">
          {error}
        </div>
      )}

      <div className="px-4 py-4 pb-24 flex flex-col gap-4">
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-[14px] font-bold text-gray-900">Weight Tolerance</div>
            <div className="text-[12px] text-gray-500 mt-0.5">
              Default allowed deviation when weighing ingredients. Staff cannot confirm if weight is outside this range.
            </div>
          </div>
          <div className="p-4">
            <div className="flex items-center gap-3">
              <label className="text-[13px] text-gray-600 font-semibold flex-shrink-0">Global default</label>
              <div className="flex items-center gap-2 flex-1">
                <button onClick={() => setGlobalTolerance(String(Math.max(0, parseFloat(globalTolerance) - 1)))}
                  className="w-10 h-10 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-600 text-[18px] font-bold active:bg-gray-200">
                  -
                </button>
                <div className="flex-1 relative">
                  <input
                    type="number"
                    value={globalTolerance}
                    onChange={(e) => setGlobalTolerance(e.target.value)}
                    min="0" max="100" step="0.5"
                    className="w-full h-10 px-3 pr-8 rounded-xl bg-gray-50 border border-gray-200 text-center text-[16px] font-mono font-bold text-gray-900 focus:outline-none focus:border-green-500"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-gray-400 font-bold">%</span>
                </div>
                <button onClick={() => setGlobalTolerance(String(Math.min(100, parseFloat(globalTolerance) + 1)))}
                  className="w-10 h-10 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-600 text-[18px] font-bold active:bg-gray-200">
                  +
                </button>
              </div>
            </div>
            {globalChanged && (
              <button onClick={saveGlobal} disabled={saving}
                className="w-full mt-3 py-3 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 disabled:opacity-50">
                {saving ? 'Saving...' : 'Save global tolerance'}
              </button>
            )}
            <div className="mt-3 px-3 py-2 bg-gray-50 rounded-lg text-[11px] text-gray-500">
              Example: at {globalTolerance}%, a recipe needing 1.000 kg allows {(1 * (1 - parseFloat(globalTolerance || '0') / 100)).toFixed(3)} - {(1 * (1 + parseFloat(globalTolerance || '0') / 100)).toFixed(3)} kg
            </div>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div>
              <div className="text-[14px] font-bold text-gray-900">Per-Recipe Overrides</div>
              <div className="text-[12px] text-gray-500 mt-0.5">
                Set custom tolerance for specific recipes
              </div>
            </div>
            <button onClick={() => setShowBomPicker(true)}
              className="w-8 h-8 rounded-lg bg-green-600 flex items-center justify-center active:bg-green-700 shadow-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            </button>
          </div>

          {overrides.length === 0 ? (
            <div className="p-6 text-center">
              <div className="text-[13px] text-gray-400">No overrides \u2014 all recipes use the global default ({globalTolerance}%)</div>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {overrides.map((o) => (
                <div key={o.bom_id} className="px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-gray-900 truncate">{getBomName(o.bom_id)}</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">Override: {o.tolerance_pct}%</div>
                  </div>
                  <button onClick={() => setEditingBom({ id: o.bom_id, name: getBomName(o.bom_id), pct: String(o.tolerance_pct) })}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-[12px] font-semibold text-gray-600 active:bg-gray-50">
                    Edit
                  </button>
                  <button onClick={() => removeBomOverride(o.bom_id)}
                    className="px-3 py-1.5 rounded-lg border border-red-200 text-[12px] font-semibold text-red-600 active:bg-red-50">
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showBomPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => { setShowBomPicker(false); setBomSearch(''); }}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl px-4 pt-4 pb-8 max-h-[80vh] flex flex-col"
            onClick={(e) => e.stopPropagation()} style={{ animation: 'slideUp .25s ease-out' }}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-3" />
            <h3 className="text-[16px] font-bold text-gray-900 px-1 mb-3">Add tolerance override</h3>
            <input
              type="text"
              placeholder="Search recipes..."
              value={bomSearch}
              onChange={(e) => setBomSearch(e.target.value)}
              className="h-10 px-4 rounded-xl bg-gray-50 border border-gray-200 text-[13px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-green-500 mb-2"
              autoFocus
            />
            <div className="flex-1 overflow-auto">
              {filteredBoms.length === 0 ? (
                <div className="text-center py-8 text-[13px] text-gray-400">
                  {bomSearch ? 'No matching recipes' : 'All recipes already have overrides'}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {filteredBoms.map((b) => (
                    <button key={b.id}
                      onClick={() => {
                        setShowBomPicker(false);
                        setBomSearch('');
                        setEditingBom({ id: b.id, name: b.product_tmpl_id[1], pct: globalTolerance });
                      }}
                      className="w-full text-left px-3 py-3 rounded-xl bg-white border border-gray-200 active:bg-gray-50 active:scale-[0.98] transition-all flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-gray-900 truncate">{b.product_tmpl_id[1]}</div>
                        <div className="text-[11px] text-gray-400">{b.component_count} ingredients{b.company_id ? ` \u00b7 ${(b.company_id as [number, string])[1]}` : ''}</div>
                      </div>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {editingBom && (
        <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={() => setEditingBom(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-lg bg-white rounded-t-2xl px-6 pt-6 pb-24"
            onClick={(e) => e.stopPropagation()} style={{ animation: 'slideUp .25s ease-out' }}>
            <div className="w-10 h-1 bg-gray-300 rounded-full mx-auto mb-5" />
            <h3 className="text-[16px] font-bold text-gray-900 mb-1">Set tolerance</h3>
            <p className="text-[13px] text-gray-500 mb-4">{editingBom.name}</p>

            <div className="flex items-center gap-2 mb-4">
              <button onClick={() => setEditingBom({ ...editingBom, pct: String(Math.max(0, parseFloat(editingBom.pct) - 1)) })}
                className="w-12 h-12 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-600 text-[20px] font-bold active:bg-gray-200">
                -
              </button>
              <div className="flex-1 relative">
                <input
                  type="number"
                  value={editingBom.pct}
                  onChange={(e) => setEditingBom({ ...editingBom, pct: e.target.value })}
                  min="0" max="100" step="0.5"
                  className="w-full h-12 px-3 pr-8 rounded-xl bg-gray-50 border border-gray-200 text-center text-[24px] font-mono font-bold text-gray-900 focus:outline-none focus:border-green-500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[16px] text-gray-400 font-bold">%</span>
              </div>
              <button onClick={() => setEditingBom({ ...editingBom, pct: String(Math.min(100, parseFloat(editingBom.pct) + 1)) })}
                className="w-12 h-12 rounded-xl bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-600 text-[20px] font-bold active:bg-gray-200">
                +
              </button>
            </div>

            <div className="px-3 py-2 bg-gray-50 rounded-lg text-[11px] text-gray-500 mb-4">
              Global default is {globalTolerance}%. This recipe will use {editingBom.pct}% instead.
            </div>

            <div className="flex gap-3">
              <button onClick={() => setEditingBom(null)}
                className="flex-1 py-3.5 rounded-xl border border-gray-200 text-gray-600 font-semibold text-[14px] active:bg-gray-50">
                Cancel
              </button>
              <button onClick={() => saveBomOverride(editingBom.id, parseFloat(editingBom.pct))}
                className="flex-1 py-3.5 rounded-xl bg-green-600 text-white font-bold text-[14px] shadow-lg shadow-green-600/30 active:bg-green-700">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  );
}
