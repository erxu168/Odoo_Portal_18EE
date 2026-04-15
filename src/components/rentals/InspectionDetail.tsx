'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { Inspection, InspectionItem, MeterReading, Tenant, Room, Property, ItemCondition } from '@/types/rentals';

const CONDITION_OPTIONS: { value: ItemCondition; label: string; color: string; bg: string }[] = [
  { value: 'neuwertig', label: 'Neuwertig', color: '#166534', bg: '#DCFCE7' },
  { value: 'gut', label: 'Gut', color: '#1E3A8A', bg: '#DBEAFE' },
  { value: 'gebrauchsspuren', label: 'Gebrauchsspuren', color: '#92400E', bg: '#FEF3C7' },
  { value: 'beschaedigt', label: 'Besch\u00e4digt', color: '#991B1B', bg: '#FEE2E2' },
];

const CATEGORY_LABELS: Record<string, string> = {
  walls_ceiling: 'W\u00e4nde & Decke',
  floors: 'B\u00f6den & Sockelleisten',
  windows_blinds: 'Fenster & Rolll\u00e4den',
  bathroom: 'Bad & Sanit\u00e4r',
  kitchen: 'K\u00fcche',
  keys_handover: 'Schl\u00fcssel\u00fcbergabe',
};

interface Summary {
  neuwertig: number;
  gut: number;
  gebrauchsspuren: number;
  beschaedigt: number;
  pending: number;
}

export default function InspectionDetail() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [byCategory, setByCategory] = useState<Record<string, InspectionItem[]>>({});
  const [meters, setMeters] = useState<MeterReading[]>([]);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [summary, setSummary] = useState<Summary>({ neuwertig: 0, gut: 0, gebrauchsspuren: 0, beschaedigt: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [showSign, setShowSign] = useState(false);
  const [signing, setSigning] = useState(false);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);

  const loadData = useCallback(() => {
    if (!id) return;
    fetch(`/api/rentals/inspections/${id}`)
      .then(r => r.json())
      .then(data => {
        setInspection(data.inspection || null);
        setItems(data.items || []);
        setByCategory(data.byCategory || {});
        setMeters(data.meters || []);
        setTenant(data.tenant || null);
        setRoom(data.room || null);
        setProperty(data.property || null);
        setSummary(data.summary || { neuwertig: 0, gut: 0, gebrauchsspuren: 0, beschaedigt: 0, pending: 0 });
      })
      .catch(err => console.error('[rentals] inspection detail load failed:', err))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { loadData(); }, [loadData]);

  async function updateItem(itemId: number, condition: ItemCondition | null, notes?: string) {
    try {
      const body: Record<string, unknown> = {};
      if (condition !== undefined) body.condition = condition;
      if (notes !== undefined) body.notes = notes;

      await fetch(`/api/rentals/inspections/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      loadData();
    } catch (err) {
      console.error('[rentals] update inspection item failed:', err);
    }
  }

  async function handleSign() {
    if (!inspection || signing) return;
    setSigning(true);
    try {
      await fetch(`/api/rentals/inspections/${id}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          landlord_signature_path: `signed-by-admin-${Date.now()}`,
        }),
      });
      loadData();
      setShowSign(false);
    } catch (err) {
      console.error('[rentals] sign inspection failed:', err);
      alert('Signing failed');
    } finally {
      setSigning(false);
    }
  }

  async function startInspection() {
    try {
      await fetch(`/api/rentals/inspections/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      });
      loadData();
    } catch (err) {
      console.error('[rentals] start inspection failed:', err);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Inspection" showBack onBack={() => router.push('/rentals/inspections')} />
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!inspection) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Not Found" showBack onBack={() => router.push('/rentals/inspections')} />
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-4xl mb-3">{'\u2705'}</div>
          <div className="text-[15px] font-semibold text-[#1F2933]">Inspection not found</div>
        </div>
      </div>
    );
  }

  const totalItems = items.length;
  const completedItems = totalItems - summary.pending;
  const progressPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
  const canSign = inspection.status === 'in_progress' && summary.pending === 0;
  const isSigned = inspection.status === 'signed' || inspection.status === 'archived';
  const categories = Object.keys(byCategory);

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title={inspection.type === 'move_in' ? 'Einzug' : 'Auszug'}
        subtitle={`${property?.street || ''} \u00b7 ${room?.room_code || ''}`}
        supertitle={'\u00dc' + 'BERGABEPROTOKOLL'}
        showBack
        onBack={() => router.push('/rentals/inspections')}
      />

      <div className="px-4 py-5 space-y-4">
        {/* Info card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[13px] font-semibold text-[#1F2933] capitalize">{inspection.type.replace('_', ' ')}</span>
            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
              isSigned ? 'bg-[#DCFCE7] text-[#166534]'
                : inspection.status === 'in_progress' ? 'bg-[#FEF3C7] text-[#92400E]'
                : 'bg-[#F3F4F6] text-[#374151]'
            }`}>
              {inspection.status === 'in_progress' ? 'In Progress' : inspection.status === 'signed' ? 'Signed' : inspection.status}
            </span>
          </div>
          <div className="text-[12px] text-gray-500 space-y-0.5">
            <div>Date: {inspection.inspection_date}</div>
            <div>Inspector: {inspection.inspector_name}</div>
            {tenant && <div>Tenant: {tenant.full_name}</div>}
          </div>
        </div>

        {/* Progress */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold tracking-wider uppercase text-gray-400">Progress</span>
            <span className="text-[12px] font-bold text-[#1F2933] tabular-nums">{completedItems}/{totalItems}</span>
          </div>
          <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden mb-3">
            <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: 'Neuwertig', count: summary.neuwertig, bg: '#DCFCE7', text: '#166534' },
              { label: 'Gut', count: summary.gut, bg: '#DBEAFE', text: '#1E3A8A' },
              { label: 'Spuren', count: summary.gebrauchsspuren, bg: '#FEF3C7', text: '#92400E' },
              { label: 'Besch.', count: summary.beschaedigt, bg: '#FEE2E2', text: '#991B1B' },
            ].map(s => (
              <div key={s.label} className="rounded-lg px-1 py-2" style={{ backgroundColor: s.bg }}>
                <div className="text-[14px] font-bold tabular-nums" style={{ color: s.text }}>{s.count}</div>
                <div className="text-[9px] font-semibold uppercase" style={{ color: s.text }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Start button for draft */}
        {inspection.status === 'draft' && (
          <button
            onClick={startInspection}
            className="w-full bg-green-600 text-white font-semibold rounded-xl py-3.5 text-[14px] active:bg-green-700 shadow-lg shadow-green-600/30 transition-colors"
          >
            Start Inspection
          </button>
        )}

        {/* Category accordion */}
        {(inspection.status === 'in_progress' || isSigned) && (
          <div className="space-y-2">
            {categories.map(cat => {
              const catItems = byCategory[cat] || [];
              const catDone = catItems.filter(i => i.condition !== null).length;
              const isExpanded = expandedCat === cat;
              const label = CATEGORY_LABELS[cat] || cat;

              return (
                <div key={cat} className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] overflow-hidden">
                  <button
                    onClick={() => setExpandedCat(isExpanded ? null : cat)}
                    className="w-full flex items-center justify-between px-4 py-3 active:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-[#1F2933]">{label}</span>
                      <span className="text-[11px] text-gray-400 tabular-nums">{catDone}/{catItems.length}</span>
                    </div>
                    <svg
                      width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"
                      className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    >
                      <path d="M6 9l6 6 6-6"/>
                    </svg>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-gray-100">
                      {catItems.map(item => (
                        <InspectionItemRow
                          key={item.id}
                          item={item}
                          onUpdate={updateItem}
                          readonly={isSigned}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Meter readings */}
        {meters.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-2">Meter Readings</div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)]">
              {meters.map((m, i) => (
                <div key={m.id} className={`flex items-center justify-between px-4 py-3 ${i < meters.length - 1 ? 'border-b border-gray-100' : ''}`}>
                  <div>
                    <div className="text-[12px] font-semibold text-[#1F2933] capitalize">{m.meter_type.replace('_', ' ')}</div>
                    <div className="text-[11px] text-gray-500">#{m.meter_no}</div>
                  </div>
                  <div className="text-[13px] font-bold text-[#1F2933] tabular-nums font-mono">{m.reading_value} {m.reading_unit}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sign button */}
        {canSign && (
          <button
            onClick={() => setShowSign(true)}
            className="w-full bg-green-600 text-white font-semibold rounded-xl py-3.5 text-[14px] active:bg-green-700 shadow-lg shadow-green-600/30 transition-colors"
          >
            Sign & Finalize
          </button>
        )}

        {/* PDF link */}
        {isSigned && inspection.pdf_path && (
          <div className="bg-green-50 rounded-xl border border-green-200 p-4 text-center">
            <div className="text-[13px] font-semibold text-green-800 mb-1">{'\u2705'} Inspection signed</div>
            <div className="text-[12px] text-green-700">PDF generated: {inspection.pdf_path}</div>
          </div>
        )}

        {/* Notes */}
        {inspection.notes && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
            <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-2">Notes</div>
            <p className="text-[13px] text-gray-700 whitespace-pre-wrap">{inspection.notes}</p>
          </div>
        )}
      </div>

      {showSign && (
        <ConfirmDialog
          title="Sign & finalize?"
          message="This will generate the PDF and lock the inspection. This cannot be undone."
          confirmLabel={signing ? 'Signing...' : 'Sign'}
          cancelLabel="Cancel"
          onConfirm={handleSign}
          onCancel={() => setShowSign(false)}
        />
      )}
    </div>
  );
}

// ─── Single inspection item row ───
function InspectionItemRow({ item, onUpdate, readonly }: {
  item: InspectionItem;
  onUpdate: (id: number, condition: ItemCondition | null, notes?: string) => void;
  readonly: boolean;
}) {
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState(item.notes || '');

  return (
    <div className="px-4 py-3 border-b border-gray-50 last:border-0">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[12px] font-semibold text-[#1F2933]">{item.item_label}</span>
        <button
          onClick={() => setShowNotes(!showNotes)}
          className="text-[10px] text-gray-400 active:text-gray-600"
        >
          {item.notes ? '\ud83d\udcdd' : '+'} note
        </button>
      </div>

      {/* Condition buttons */}
      <div className="flex gap-1.5">
        {CONDITION_OPTIONS.map(opt => {
          const isSelected = item.condition === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => {
                if (readonly) return;
                onUpdate(item.id, isSelected ? null : opt.value);
              }}
              disabled={readonly}
              className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                isSelected
                  ? ''
                  : 'bg-gray-100 text-gray-400'
              } ${readonly ? 'opacity-60' : 'active:scale-[0.97]'}`}
              style={isSelected ? { backgroundColor: opt.bg, color: opt.color } : undefined}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Notes */}
      {showNotes && (
        <div className="mt-2">
          <textarea
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[12px] text-gray-900 placeholder-gray-400 outline-none focus:border-green-600 resize-none"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={() => {
              if (notes !== (item.notes || '')) {
                onUpdate(item.id, item.condition, notes);
              }
            }}
            placeholder="Add notes..."
            rows={2}
            readOnly={readonly}
          />
        </div>
      )}
    </div>
  );
}
