'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import type { Room, Tenancy, Tenant, Payment, TenancyRentStep } from '@/types/rentals';

function eur(n: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

function statusBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    occupied:    { bg: '#DCFCE7', text: '#166534', label: 'Occupied' },
    vacant:      { bg: '#DBEAFE', text: '#1E3A8A', label: 'Vacant' },
    reserved:    { bg: '#FEF3C7', text: '#92400E', label: 'Reserved' },
    maintenance: { bg: '#FEE2E2', text: '#991B1B', label: 'Maintenance' },
  };
  return map[status] || { bg: '#F3F4F6', text: '#374151', label: status };
}

function paymentBadge(status: string) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    expected: { bg: '#DBEAFE', text: '#1E3A8A', label: 'Expected' },
    matched:  { bg: '#DCFCE7', text: '#166534', label: 'Matched' },
    partial:  { bg: '#FEF3C7', text: '#92400E', label: 'Partial' },
    missing:  { bg: '#FEE2E2', text: '#991B1B', label: 'Missing' },
    waived:   { bg: '#F3F4F6', text: '#374151', label: 'Waived' },
    carried:  { bg: '#F3F4F6', text: '#374151', label: 'Carried' },
    deducted_from_kaution: { bg: '#FEF3C7', text: '#92400E', label: 'Deducted' },
  };
  return map[status] || { bg: '#F3F4F6', text: '#374151', label: status };
}

export default function RoomDetail() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [room, setRoom] = useState<Room | null>(null);
  const [tenancy, setTenancy] = useState<Tenancy | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [nextStep, setNextStep] = useState<TenancyRentStep | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/rentals/rooms/${id}`)
      .then(r => r.json())
      .then(data => {
        setRoom(data.room || null);
        setTenancy(data.tenancy || null);
        setTenant(data.tenant || null);
        setNextStep(data.nextStep || null);
        setPayments(data.payments || []);
      })
      .catch(err => console.error('[rentals] room detail load failed:', err))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Room" showBack onBack={() => router.back()} />
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Not Found" showBack onBack={() => router.back()} />
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="text-4xl mb-3">{'\ud83d\udeaa'}</div>
          <div className="text-[15px] font-semibold text-[#1F2933]">Room not found</div>
        </div>
      </div>
    );
  }

  const badge = statusBadge(room.status);

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title={room.room_name || `Room ${room.room_code}`}
        subtitle={`${room.size_sqm} m\u00b2`}
        supertitle={`ROOM ${room.room_code}`}
        showBack
        onBack={() => router.back()}
      />

      <div className="px-4 py-5 space-y-4">
        {/* Status + rent info */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[13px] font-semibold text-[#1F2933]">Status</span>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ backgroundColor: badge.bg, color: badge.text }}>
              {badge.label}
            </span>
          </div>
          <div className="grid grid-cols-3 divide-x divide-gray-100">
            <div className="text-center px-1">
              <div className="text-lg font-bold text-[#1F2933] tabular-nums">{eur(room.base_kaltmiete)}</div>
              <div className="text-[10px] font-semibold tracking-wider uppercase text-gray-400">Kaltmiete</div>
            </div>
            <div className="text-center px-1">
              <div className="text-lg font-bold text-[#1F2933] tabular-nums">{eur(room.utility_share)}</div>
              <div className="text-[10px] font-semibold tracking-wider uppercase text-gray-400">Nebenkosten</div>
            </div>
            <div className="text-center px-1">
              <div className="text-lg font-bold text-[#16A34A] tabular-nums">{eur(room.base_kaltmiete + room.utility_share)}</div>
              <div className="text-[10px] font-semibold tracking-wider uppercase text-gray-400">Warmmiete</div>
            </div>
          </div>
        </div>

        {/* Current tenant */}
        {tenancy && tenant ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
            <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-3">Current Tenant</div>
            <button
              onClick={() => router.push(`/rentals/tenancies/${tenancy.id}`)}
              className="w-full flex items-center gap-3 active:bg-gray-50 transition-colors rounded-lg -mx-1 px-1 py-1"
            >
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <span className="text-green-700 font-bold text-[14px]">{tenant.full_name.charAt(0)}</span>
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="text-[13px] font-semibold text-[#1F2933]">{tenant.full_name}</div>
                <div className="text-[11px] text-gray-500">
                  Since {tenancy.start_date}{tenancy.end_date ? ` \u2014 until ${tenancy.end_date}` : ''}
                </div>
                {tenant.email && <div className="text-[11px] text-gray-400 truncate">{tenant.email}</div>}
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
            </button>

            {/* Next rent step */}
            {nextStep && (
              <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-gray-500">Next rent adjustment</div>
                  <div className="text-[12px] font-semibold text-[#1F2933]">{nextStep.effective_date}</div>
                </div>
                <div className="text-[13px] font-bold text-amber-600 tabular-nums">{eur(nextStep.new_kaltmiete)}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 text-center">
            <div className="text-[13px] text-gray-500 mb-3">No active tenant</div>
            <button
              className="bg-green-600 text-white font-semibold rounded-xl px-5 py-2.5 text-[13px] active:bg-green-700 transition-colors"
              onClick={() => router.push(`/rentals/tenancies/new?room_id=${room.id}`)}
            >
              Create Tenancy
            </button>
          </div>
        )}

        {/* Payment history */}
        {payments.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-2">Recent Payments</div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)]">
              {payments.slice(0, 6).map((p, i) => {
                const pb = paymentBadge(p.status);
                return (
                  <div key={p.id} className={`flex items-center justify-between px-4 py-3 ${i < Math.min(payments.length, 6) - 1 ? 'border-b border-gray-100' : ''}`}>
                    <div>
                      <div className="text-[12px] font-semibold text-[#1F2933]">{p.expected_date}</div>
                      <div className="text-[11px] text-gray-500 tabular-nums">
                        Expected: {eur(p.expected_amount)}
                        {p.received_amount > 0 ? ` \u00b7 Received: ${eur(p.received_amount)}` : ''}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ backgroundColor: pb.bg, color: pb.text }}>
                      {pb.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Notes */}
        {room.notes && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
            <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-2">Notes</div>
            <p className="text-[13px] text-gray-700 whitespace-pre-wrap">{room.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
