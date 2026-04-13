'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { Tenancy, Tenant, Room, Property, TenancyRentStep, Payment } from '@/types/rentals';

type TabKey = 'info' | 'payments' | 'rent';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'info', label: 'Contract' },
  { key: 'payments', label: 'Payments' },
  { key: 'rent', label: 'Rent Steps' },
];

function eur(n: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

function tenancyBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    pending:   { bg: '#FEF3C7', text: '#92400E', label: 'Pending' },
    active:    { bg: '#DCFCE7', text: '#166534', label: 'Active' },
    ending:    { bg: '#FEE2E2', text: '#991B1B', label: 'Ending' },
    ended:     { bg: '#F3F4F6', text: '#374151', label: 'Ended' },
    cancelled: { bg: '#F3F4F6', text: '#374151', label: 'Cancelled' },
  };
  return map[status] || { bg: '#F3F4F6', text: '#374151', label: status };
}

function paymentBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    expected: { bg: '#DBEAFE', text: '#1E3A8A', label: 'Expected' },
    matched:  { bg: '#DCFCE7', text: '#166534', label: 'Paid' },
    partial:  { bg: '#FEF3C7', text: '#92400E', label: 'Partial' },
    missing:  { bg: '#FEE2E2', text: '#991B1B', label: 'Missing' },
    waived:   { bg: '#F3F4F6', text: '#374151', label: 'Waived' },
    carried:  { bg: '#F3F4F6', text: '#374151', label: 'Carried' },
    deducted_from_kaution: { bg: '#FEF3C7', text: '#92400E', label: 'From Kaution' },
  };
  return map[status] || { bg: '#F3F4F6', text: '#374151', label: status };
}

function contractTypeLabel(t: string): string {
  switch (t) {
    case 'standard': return 'Standard';
    case 'staffel': return 'Staffelmiete';
    case 'index': return 'Indexmiete';
    default: return t;
  }
}

interface InspectionRow {
  id: number;
  type: string;
  inspection_date: string;
  status: string;
  pdf_path: string | null;
}

export default function TenancyDetail() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [tenancy, setTenancy] = useState<Tenancy | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [rentSteps, setRentSteps] = useState<TenancyRentStep[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [inspections, setInspections] = useState<InspectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('info');
  const [showEnd, setShowEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleEndTenancy() {
    if (ending) return;
    setEnding(true);
    try {
      const res = await fetch(`/api/rentals/tenancies/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ended' }),
      });
      if (res.ok) {
        // Reload data to reflect the new status
        const data = await fetch(`/api/rentals/tenancies/${id}`).then(r => r.json());
        setTenancy(data.tenancy || null);
        setTenant(data.tenant || null);
        setRoom(data.room || null);
        setProperty(data.property || null);
        setRentSteps(data.rentSteps || []);
        setPayments(data.payments || []);
        setInspections(data.inspections || []);
        setShowEnd(false);
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to end tenancy');
      }
    } catch (err) {
      console.error('[rentals] end tenancy failed:', err);
      alert('Network error');
    } finally {
      setEnding(false);
    }
  }

  async function handleDeleteTenancy() {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/rentals/tenancies/${id}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/rentals/tenancies');
      } else {
        const data = await res.json();
        alert(data.error || 'Delete failed');
        setDeleting(false);
      }
    } catch (err) {
      console.error('[rentals] delete tenancy failed:', err);
      alert('Network error');
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    fetch(`/api/rentals/tenancies/${id}`)
      .then(r => r.json())
      .then(data => {
        setTenancy(data.tenancy || null);
        setTenant(data.tenant || null);
        setRoom(data.room || null);
        setProperty(data.property || null);
        setRentSteps(data.rentSteps || []);
        setPayments(data.payments || []);
        setInspections(data.inspections || []);
      })
      .catch(err => console.error('[rentals] tenancy detail load failed:', err))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Tenancy" showBack onBack={() => router.push('/rentals/tenancies')} />
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!tenancy || !tenant) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Not Found" showBack onBack={() => router.push('/rentals/tenancies')} />
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-4xl mb-3">{'\ud83d\udcdd'}</div>
          <div className="text-[15px] font-semibold text-[#1F2933]">Tenancy not found</div>
        </div>
      </div>
    );
  }

  const badge = tenancyBadge(tenancy.status);
  const kautionPct = tenancy.kaution > 0 ? Math.round((tenancy.kaution_received / tenancy.kaution) * 100) : 100;

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title={tenant.full_name}
        subtitle={room ? `${room.room_code} \u00b7 ${property?.street || ''}` : ''}
        supertitle="TENANCY"
        showBack
        onBack={() => router.push('/rentals/tenancies')}
        action={
          <button
            onClick={() => router.push(`/rentals/tenancies/${id}/edit`)}
            className="w-[clamp(44px,12vw,55px)] h-[clamp(44px,12vw,55px)] rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors"
            title="Edit Tenancy"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        }
      />

      {/* Summary card */}
      <div className="px-4 pt-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-semibold text-[#1F2933]">{contractTypeLabel(tenancy.contract_type)}</span>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ backgroundColor: badge.bg, color: badge.text }}>
              {badge.label}
            </span>
          </div>
          <div className="grid grid-cols-3 divide-x divide-gray-100">
            <div className="text-center px-1">
              <div className="text-lg font-bold text-[#1F2933] tabular-nums">{eur(tenancy.kaltmiete)}</div>
              <div className="text-[10px] font-semibold tracking-wider uppercase text-gray-400">Cold</div>
            </div>
            <div className="text-center px-1">
              <div className="text-lg font-bold text-[#1F2933] tabular-nums">{eur(tenancy.nebenkosten)}</div>
              <div className="text-[10px] font-semibold tracking-wider uppercase text-gray-400">Utilities</div>
            </div>
            <div className="text-center px-1">
              <div className="text-lg font-bold text-[#16A34A] tabular-nums">{eur(tenancy.warmmiete)}</div>
              <div className="text-[10px] font-semibold tracking-wider uppercase text-gray-400">Total</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto px-4 py-3 scrollbar-hide">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap transition-colors ${
              tab === t.key
                ? 'bg-green-600 text-white shadow-sm'
                : 'border bg-white border-gray-200 text-gray-500'
            }`}
          >
            {t.label}
            {t.key === 'payments' && payments.length > 0 ? ` (${payments.length})` : ''}
            {t.key === 'rent' && rentSteps.length > 0 ? ` (${rentSteps.length})` : ''}
          </button>
        ))}
      </div>

      <div className="px-4 pb-6">
        {tab === 'info' && (
          <ContractInfoTab tenancy={tenancy} tenant={tenant} room={room} property={property} kautionPct={kautionPct} inspections={inspections} />
        )}
        {tab === 'payments' && (
          <PaymentsTab payments={payments} />
        )}
        {tab === 'rent' && (
          <RentStepsTab steps={rentSteps} />
        )}
      </div>

      {/* End / Delete tenancy */}
      <div className="px-4 pb-8 space-y-3">
        {(tenancy.status === 'active' || tenancy.status === 'ending') && (
          <button
            onClick={() => setShowEnd(true)}
            className="w-full bg-red-50 border border-red-100 text-red-700 font-semibold rounded-xl py-3.5 text-[14px] active:bg-red-100 transition-colors"
          >
            End Tenancy
          </button>
        )}
        <button
          onClick={() => setShowDelete(true)}
          className="w-full bg-red-50 border border-red-100 text-red-700 font-semibold rounded-xl py-3.5 text-[14px] active:bg-red-100 transition-colors"
        >
          Delete Tenancy
        </button>
      </div>

      {showEnd && (
        <ConfirmDialog
          title="End this tenancy?"
          message={`This will mark ${tenant.full_name}\u2019s tenancy as ended and set the room to vacant. Are you sure?`}
          confirmLabel={ending ? 'Ending...' : 'End Tenancy'}
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={handleEndTenancy}
          onCancel={() => setShowEnd(false)}
        />
      )}

      {showDelete && (
        <ConfirmDialog
          title="Delete this tenancy?"
          message={`This will permanently delete ${tenant.full_name}\u2019s tenancy record and all associated payments, rent steps, and inspections. This cannot be undone.`}
          confirmLabel={deleting ? 'Deleting...' : 'Delete'}
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={handleDeleteTenancy}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}

// ─── Contract Info Tab ───
function ContractInfoTab({ tenancy, tenant, room, property, kautionPct, inspections }: {
  tenancy: Tenancy; tenant: Tenant; room: Room | null; property: Property | null;
  kautionPct: number; inspections: InspectionRow[];
}) {
  const fields = [
    { label: 'Tenant', value: tenant.full_name },
    { label: 'Email', value: tenant.email || '\u2014' },
    { label: 'Phone', value: tenant.phone || '\u2014' },
    { label: 'Start Date', value: tenancy.start_date },
    { label: 'End Date', value: tenancy.end_date || 'Open-ended' },
    { label: 'Contract Type', value: contractTypeLabel(tenancy.contract_type) },
    { label: 'Property', value: property ? `${property.street}, ${property.plz}` : '\u2014' },
    { label: 'Room', value: room ? `${room.room_code} (${room.size_sqm} m\u00b2)` : '\u2014' },
  ];

  return (
    <div className="space-y-3">
      {/* Details */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)]">
        {fields.map((f, i) => (
          <div key={f.label} className={`flex items-center justify-between px-4 py-3 ${i < fields.length - 1 ? 'border-b border-gray-100' : ''}`}>
            <span className="text-[12px] text-gray-500">{f.label}</span>
            <span className="text-[13px] font-semibold text-[#1F2933] text-right max-w-[55%] truncate">{f.value}</span>
          </div>
        ))}
      </div>

      {/* Kaution */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold tracking-wider uppercase text-gray-400">Kaution</span>
          <span className="text-[12px] font-bold text-[#1F2933] tabular-nums">
            {eur(tenancy.kaution_received)} / {eur(tenancy.kaution)}
          </span>
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${kautionPct >= 100 ? 'bg-green-500' : kautionPct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${Math.min(kautionPct, 100)}%` }}
          />
        </div>
      </div>

      {/* Inspections */}
      {inspections.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-2">Inspections</div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)]">
            {inspections.map((insp, i) => (
              <div key={insp.id} className={`flex items-center justify-between px-4 py-3 ${i < inspections.length - 1 ? 'border-b border-gray-100' : ''}`}>
                <div>
                  <div className="text-[12px] font-semibold text-[#1F2933] capitalize">{insp.type.replace('_', ' ')}</div>
                  <div className="text-[11px] text-gray-500">{insp.inspection_date}</div>
                </div>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#F3F4F6] text-[#374151] capitalize">{insp.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {tenancy.notes && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-2">Notes</div>
          <p className="text-[13px] text-gray-700 whitespace-pre-wrap">{tenancy.notes}</p>
        </div>
      )}
    </div>
  );
}

// ─── Payments Tab ───
function PaymentsTab({ payments }: { payments: Payment[] }) {
  if (payments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="text-3xl mb-2">{'\ud83d\udcb3'}</div>
        <div className="text-[14px] font-semibold text-[#1F2933] mb-1">No payments yet</div>
        <div className="text-[12px] text-gray-500">Payment records will appear after SEPA imports</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {payments.map(p => {
        const badge = paymentBadge(p.status);
        return (
          <div key={p.id} className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13px] font-semibold text-[#1F2933]">{p.expected_date}</div>
                <div className="text-[11px] text-gray-500 mt-0.5 tabular-nums">
                  Expected: {eur(p.expected_amount)}
                </div>
              </div>
              <div className="text-right">
                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ backgroundColor: badge.bg, color: badge.text }}>
                  {badge.label}
                </span>
                {p.received_amount > 0 && (
                  <div className="text-[12px] font-bold text-[#16A34A] tabular-nums mt-1">{eur(p.received_amount)}</div>
                )}
              </div>
            </div>
            {p.shortfall > 0 && (
              <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
                <span className="text-[11px] text-red-600 font-semibold">Shortfall</span>
                <span className="text-[12px] font-bold text-red-600 tabular-nums">{eur(p.shortfall)}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Rent Steps Tab ───
function RentStepsTab({ steps }: { steps: TenancyRentStep[] }) {
  if (steps.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="text-3xl mb-2">{'\ud83d\udcc8'}</div>
        <div className="text-[14px] font-semibold text-[#1F2933] mb-1">No rent steps</div>
        <div className="text-[12px] text-gray-500">Standard contracts have no scheduled adjustments</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {steps.map(step => (
        <div key={step.id} className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-semibold text-[#1F2933]">{step.effective_date}</div>
              <div className="text-[11px] text-gray-500 mt-0.5 capitalize">{step.type}{step.reason ? ` \u2014 ${step.reason}` : ''}</div>
            </div>
            <div className="text-right">
              <div className="text-[14px] font-bold text-[#1F2933] tabular-nums">{eur(step.new_kaltmiete)}</div>
              <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold mt-1 ${
                step.applied ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-[#FEF3C7] text-[#92400E]'
              }`}>
                {step.applied ? 'Applied' : 'Pending'}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
