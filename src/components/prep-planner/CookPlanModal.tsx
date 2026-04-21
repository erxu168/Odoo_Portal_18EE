'use client';

import React, { useState } from 'react';

export interface CookPlanItem {
  prep_item_id: number;
  name: string;
  station: string | null;
  unit: string;
  batch_size: number | null;
  forecast_qty: number;
  peak_hour: number | null;
  my_ack: {
    action: 'confirm' | 'adjust' | 'skip';
    planned_qty: number | null;
    updated_at: string;
  } | null;
}

interface CookPlanModalProps {
  date: string;
  companyId: number;
  items: CookPlanItem[];
  onClose: () => void;
  onAckChange: () => void;
}

type ActionKind = 'confirm' | 'adjust' | 'skip';

export default function CookPlanModal({ date, companyId, items, onClose, onAckChange }: CookPlanModalProps) {
  const totalCount = items.length;
  const doneCount = items.filter(i => i.my_ack).length;
  const allDone = doneCount === totalCount && totalCount > 0;

  function formatDate(iso: string): string {
    try {
      const d = new Date(iso + 'T00:00:00');
      return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    } catch {
      return iso;
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-black/40" onClick={onClose}>
      <div
        className="mt-auto bg-[#F6F7F9] rounded-t-[20px] flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="pt-3 pb-1 flex items-center justify-center relative">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-2 w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center active:bg-gray-50"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/>
            </svg>
          </button>
        </div>

        {/* Header */}
        <div className="px-5 pt-1 pb-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-cyan-700">Today&rsquo;s prep plan</div>
          <div className="text-[20px] font-bold text-gray-900 leading-tight">{formatDate(date)}</div>
          <div className="mt-2 flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-500 rounded-full transition-all"
                style={{ width: totalCount > 0 ? `${(doneCount / totalCount) * 100}%` : '0%' }}
              />
            </div>
            <span className="text-[11px] font-mono font-bold text-gray-500">{doneCount} / {totalCount}</span>
          </div>
        </div>

        {/* Scrollable card list */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
          {items.map(item => (
            <ItemCard
              key={item.prep_item_id}
              item={item}
              date={date}
              companyId={companyId}
              onAckChange={onAckChange}
            />
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="px-4 pt-3 pb-6 bg-white border-t border-gray-100">
          <button
            onClick={onClose}
            className={`w-full h-12 rounded-xl font-bold text-[15px] active:scale-[0.98] transition-transform ${
              allDone
                ? 'bg-green-600 text-white shadow-lg shadow-green-600/30'
                : 'bg-gray-100 text-gray-700'
            }`}
          >
            {allDone ? 'Start shift' : doneCount > 0 ? 'Close — finish later' : 'Close'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ItemCard({ item, date, companyId, onAckChange }: { item: CookPlanItem; date: string; companyId: number; onAckChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [qtyDraft, setQtyDraft] = useState(String(item.my_ack?.planned_qty ?? item.forecast_qty));
  const [busy, setBusy] = useState<ActionKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ack = item.my_ack;
  const isConfirmed = ack?.action === 'confirm';
  const isAdjusted = ack?.action === 'adjust';
  const isSkipped = ack?.action === 'skip';

  async function post(action: ActionKind, plannedQty: number | null) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch('/api/prep-planner/cook-plan/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          date,
          prep_item_id: item.prep_item_id,
          action,
          planned_qty: plannedQty,
          forecast_qty: item.forecast_qty,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setEditing(false);
      onAckChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  const plannedQty = ack?.planned_qty;
  const peakLabel = item.peak_hour !== null ? `peak ${String(item.peak_hour).padStart(2, '0')}:00` : '';
  const batches = item.batch_size && item.batch_size > 0 ? Math.ceil(item.forecast_qty / item.batch_size) : null;

  const cardBg = isSkipped ? 'bg-gray-100 border-gray-200 opacity-70'
    : isConfirmed ? 'bg-green-50 border-green-200'
    : isAdjusted ? 'bg-amber-50 border-amber-200'
    : 'bg-white border-gray-200';

  return (
    <div className={`rounded-xl border shadow-sm p-4 ${cardBg}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-bold text-gray-900 truncate">{item.name}</div>
          <div className="text-[12px] text-gray-500 mt-0.5">
            {item.station || '—'}{peakLabel ? ` · ${peakLabel}` : ''}{batches ? ` · ${batches} batch${batches === 1 ? '' : 'es'}` : ''}
          </div>
        </div>
        {ack && (
          <AckBadge action={ack.action} />
        )}
      </div>

      {!editing && (
        <div className="mt-3 flex items-baseline gap-2">
          <div className="text-[28px] font-bold text-gray-900 leading-none">
            {isSkipped ? '—' : Math.round(plannedQty ?? item.forecast_qty)}
          </div>
          <div className="text-[12px] font-semibold text-gray-500 uppercase tracking-wider">{item.unit}</div>
          {isAdjusted && typeof plannedQty === 'number' && Math.abs(plannedQty - item.forecast_qty) > 0.01 && (
            <div className="text-[11px] text-gray-400 ml-auto">
              forecast was {Math.round(item.forecast_qty)}
            </div>
          )}
        </div>
      )}

      {editing && (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => setQtyDraft(String(Math.max(0, (parseFloat(qtyDraft) || 0) - (item.batch_size || 1))))}
            className="w-10 h-10 rounded-lg border border-gray-200 bg-white text-[18px] font-bold active:bg-gray-50"
            aria-label="Decrease"
          >−</button>
          <input
            type="number"
            inputMode="decimal"
            value={qtyDraft}
            onChange={e => setQtyDraft(e.target.value)}
            className="flex-1 h-10 rounded-lg border border-gray-200 bg-white text-center text-[16px] font-bold"
            autoFocus
          />
          <button
            onClick={() => setQtyDraft(String((parseFloat(qtyDraft) || 0) + (item.batch_size || 1)))}
            className="w-10 h-10 rounded-lg border border-gray-200 bg-white text-[18px] font-bold active:bg-gray-50"
            aria-label="Increase"
          >+</button>
          <span className="text-[12px] font-semibold text-gray-500 uppercase tracking-wider">{item.unit}</span>
        </div>
      )}

      {error && <div className="mt-2 text-[12px] text-red-700">{error}</div>}

      {/* Actions */}
      {!editing ? (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <ActionBtn
            label="Confirm"
            kind="primary"
            busy={busy === 'confirm'}
            active={isConfirmed}
            onClick={() => post('confirm', item.forecast_qty)}
          />
          <ActionBtn
            label={isAdjusted ? 'Edit' : 'Adjust'}
            kind="secondary"
            busy={false}
            active={isAdjusted}
            onClick={() => { setEditing(true); setQtyDraft(String(plannedQty ?? item.forecast_qty)); }}
          />
          <ActionBtn
            label="Skip"
            kind="ghost"
            busy={busy === 'skip'}
            active={isSkipped}
            onClick={() => post('skip', null)}
          />
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => setEditing(false)}
            className="h-11 rounded-lg bg-gray-100 text-gray-600 font-semibold text-[13px] active:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              const qty = parseFloat(qtyDraft);
              if (!Number.isFinite(qty) || qty < 0) { setError('Enter a number'); return; }
              post('adjust', qty);
            }}
            disabled={busy === 'adjust'}
            className="h-11 rounded-lg bg-cyan-600 text-white font-semibold text-[13px] shadow-md shadow-cyan-600/30 active:scale-[0.98] disabled:opacity-60"
          >
            {busy === 'adjust' ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

function ActionBtn({ label, kind, busy, active, onClick }: { label: string; kind: 'primary' | 'secondary' | 'ghost'; busy: boolean; active: boolean; onClick: () => void }) {
  let base = 'h-11 rounded-lg text-[13px] font-semibold active:scale-[0.97] transition-all disabled:opacity-60';
  if (kind === 'primary') {
    base += active
      ? ' bg-green-600 text-white shadow-md shadow-green-600/30'
      : ' bg-cyan-600 text-white shadow-md shadow-cyan-600/30';
  } else if (kind === 'secondary') {
    base += active
      ? ' bg-amber-500 text-white'
      : ' bg-white border border-gray-200 text-gray-700';
  } else {
    base += active
      ? ' bg-gray-400 text-white'
      : ' bg-white border border-gray-200 text-gray-500';
  }
  return (
    <button onClick={onClick} disabled={busy} className={base}>
      {busy ? '…' : label}
    </button>
  );
}

function AckBadge({ action }: { action: ActionKind }) {
  const map = {
    confirm: { label: 'CONFIRMED', bg: 'bg-green-100', text: 'text-green-700' },
    adjust:  { label: 'ADJUSTED',  bg: 'bg-amber-100', text: 'text-amber-700' },
    skip:    { label: 'SKIPPED',   bg: 'bg-gray-200',  text: 'text-gray-600' },
  }[action];
  return (
    <span className={`text-[10px] font-bold tracking-wider px-2 py-1 rounded-full ${map.bg} ${map.text}`}>
      {map.label}
    </span>
  );
}
