'use client';

/**
 * What a Jerk — Drinks scanner.
 *
 * Scan a drink barcode with the hardware scanner, then either attach it to an
 * existing What a Jerk POS drink or create a new one. Built for a tablet at the
 * counter: big touch targets, scanner-first, running log of what's been added.
 */
import React, { useEffect, useRef, useState } from 'react';
import AppHeader from '@/components/ui/AppHeader';
import { useHardwareScanner } from '@/hooks/useHardwareScanner';

type Match = { id: number; name: string; barcode: string | null; price: number };
type LogEntry = { name: string; barcode: string; price: number; mode: 'attached' | 'created' };
type Phase = 'idle' | 'looking' | 'choose' | 'saving';

const eur = (n: number) => `€${(n ?? 0).toFixed(2)}`;

export default function PosDrinksPage() {
  const [role, setRole] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [barcode, setBarcode] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [toast, setToast] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [manualBarcode, setManualBarcode] = useState('');

  const searchRef = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.json()).then((d) => setRole(d.user?.role ?? 'none')).catch(() => setRole('none'));
  }, []);

  const canManage = role === 'manager' || role === 'admin';

  function flash(kind: 'ok' | 'warn' | 'err', text: string) {
    setToast({ kind, text });
    window.setTimeout(() => setToast((t) => (t && t.text === text ? null : t)), 3500);
  }

  function reset() {
    setPhase('idle');
    setBarcode('');
    setMatches([]);
    setSearch('');
    setNewName('');
    setNewPrice('');
    (document.activeElement as HTMLElement | null)?.blur();
  }

  // Core entry point: a barcode arrives (scanner or manual).
  async function handleBarcode(code: string) {
    const trimmed = code.trim();
    if (!trimmed || phase === 'looking' || phase === 'saving') return;
    setPhase('looking');
    setBarcode(trimmed);
    try {
      const res = await fetch(`/api/pos-drinks?barcode=${encodeURIComponent(trimmed)}`).then((r) => r.json());
      if (res.found) {
        flash('warn', `Already linked → ${res.product.name}`);
        reset();
        return;
      }
      setPhase('choose');
      runSearch('');
      setTimeout(() => searchRef.current?.focus(), 50);
    } catch {
      flash('err', 'Lookup failed — check connection');
      reset();
    }
  }

  // Hardware scanner is only live when we're idle (waiting for the next bottle).
  useHardwareScanner({ enabled: phase === 'idle' && canManage, onScan: handleBarcode });

  async function runSearch(term: string) {
    const seq = ++searchSeq.current;
    try {
      const res = await fetch(`/api/pos-drinks?q=${encodeURIComponent(term)}`).then((r) => r.json());
      if (seq === searchSeq.current) setMatches(res.results ?? []);
    } catch { /* keep previous matches */ }
  }

  function onSearchChange(v: string) {
    setSearch(v);
    if (!newName) setNewName(v); // mirror into the "create new" name until edited
    runSearch(v);
  }

  async function attach(m: Match) {
    setPhase('saving');
    try {
      const res = await fetch('/api/pos-drinks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'attach', product_id: m.id, barcode }),
      }).then((r) => r.json());
      if (!res.success) throw new Error(res.error || 'Failed');
      setLog((l) => [{ name: res.product.name, barcode, price: res.product.price, mode: 'attached' }, ...l]);
      flash('ok', `Barcode added → ${res.product.name}`);
      reset();
    } catch (e: any) {
      flash('err', e.message || 'Could not attach');
      setPhase('choose');
    }
  }

  async function createNew() {
    const price = parseFloat(newPrice.replace(',', '.'));
    if (!newName.trim()) return flash('err', 'Enter a drink name');
    if (!Number.isFinite(price) || price < 0) return flash('err', 'Enter a valid price');
    setPhase('saving');
    try {
      const res = await fetch('/api/pos-drinks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', barcode, name: newName.trim(), list_price: price }),
      }).then((r) => r.json());
      if (!res.success) throw new Error(res.error || 'Failed');
      setLog((l) => [{ name: res.product.name, barcode, price: res.product.price, mode: 'created' }, ...l]);
      flash('ok', `Created → ${res.product.name}`);
      reset();
    } catch (e: any) {
      flash('err', e.message || 'Could not create');
      setPhase('choose');
    }
  }

  if (role === null) {
    return <div className="min-h-screen grid place-items-center text-gray-400">Loading…</div>;
  }
  if (!canManage) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AppHeader supertitle="WHAT A JERK" title="Drinks Scanner" />
        <div className="p-6 text-center text-gray-600 mt-10">
          Only managers can add drinks. Ask a manager to sign in.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <AppHeader supertitle="WHAT A JERK" title="Drinks Scanner" subtitle={`${log.length} added this session`} />

      {/* Toast */}
      {toast && (
        <div
          className={`mx-4 mt-4 rounded-xl px-4 py-3 text-sm font-medium ${
            toast.kind === 'ok' ? 'bg-green-100 text-green-800'
            : toast.kind === 'warn' ? 'bg-amber-100 text-amber-800'
            : 'bg-red-100 text-red-800'
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Scan prompt (idle) */}
      {phase !== 'choose' && (
        <div className="mx-4 mt-5 rounded-2xl bg-white border border-gray-200 p-6 text-center shadow-sm">
          <div className="text-5xl mb-2">🥤</div>
          <div className="text-lg font-semibold text-gray-800">
            {phase === 'looking' ? 'Looking up…' : phase === 'saving' ? 'Saving…' : 'Scan a drink'}
          </div>
          <div className="text-sm text-gray-500 mt-1">Point the scanner at the bottle or can barcode.</div>
          <div className="mt-4 flex gap-2">
            <input
              value={manualBarcode}
              onChange={(e) => setManualBarcode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && manualBarcode.trim()) { handleBarcode(manualBarcode.trim()); setManualBarcode(''); }
              }}
              placeholder="…or type a barcode + Enter"
              inputMode="numeric"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}

      {/* Match-or-create (choose) */}
      {phase === 'choose' && (
        <div className="mx-4 mt-5 space-y-4">
          <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-wide text-blue-500">Scanned barcode</div>
              <div className="font-mono text-lg text-blue-900">{barcode}</div>
            </div>
            <button onClick={reset} className="text-sm text-gray-500 underline">Cancel</button>
          </div>

          <div className="rounded-2xl bg-white border border-gray-200 p-4 shadow-sm">
            <div className="text-sm font-semibold text-gray-700 mb-2">Is this drink already on the menu?</div>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search WAJ drinks (e.g. Pepsi, Ting)…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm mb-3"
            />
            <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
              {matches.length === 0 && (
                <div className="text-sm text-gray-400 py-4 text-center">No matching drinks — create it below.</div>
              )}
              {matches.map((m) => (
                <button
                  key={m.id}
                  onClick={() => attach(m)}
                  disabled={phase !== 'choose' || !!m.barcode}
                  className="w-full flex items-center justify-between py-3 text-left disabled:opacity-50"
                >
                  <div>
                    <div className="font-medium text-gray-800">{m.name}</div>
                    <div className="text-xs text-gray-400">
                      {eur(m.price)}{m.barcode ? ` · already has barcode ${m.barcode}` : ''}
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-blue-600">{m.barcode ? '—' : 'Attach →'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white border border-gray-200 p-4 shadow-sm">
            <div className="text-sm font-semibold text-gray-700 mb-2">Or create a new drink</div>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Drink name"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm mb-2"
            />
            <div className="flex gap-2 items-center">
              <span className="text-gray-500">€</span>
              <input
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createNew(); }}
                placeholder="Price"
                inputMode="decimal"
                className="w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                onClick={createNew}
                disabled={phase !== 'choose'}
                className="ml-auto rounded-lg bg-[#2563EB] text-white px-5 py-2 text-sm font-semibold active:bg-blue-700 disabled:opacity-50"
              >
                Create drink
              </button>
            </div>
            <div className="text-xs text-gray-400 mt-2">New drinks: 19% incl. tax, POS category “WAJ Drinks”, sellable at the till.</div>
          </div>
        </div>
      )}

      {/* Session log */}
      {log.length > 0 && (
        <div className="mx-4 mt-6">
          <div className="text-xs uppercase tracking-wide text-gray-400 mb-2">Added this session</div>
          <div className="rounded-2xl bg-white border border-gray-200 divide-y divide-gray-100 shadow-sm">
            {log.map((e, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="font-medium text-gray-800">{e.name}</div>
                  <div className="text-xs text-gray-400 font-mono">{e.barcode}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-700">{eur(e.price)}</div>
                  <div className={`text-xs ${e.mode === 'created' ? 'text-purple-500' : 'text-green-600'}`}>
                    {e.mode === 'created' ? 'new' : 'barcode added'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
