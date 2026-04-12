'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { Room, Tenancy, Tenant, Payment, TenancyRentStep, RoomFurniture } from '@/types/rentals';

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
  const [furniture, setFurniture] = useState<RoomFurniture[]>([]);
  const [loading, setLoading] = useState(true);
  const [newItem, setNewItem] = useState('');
  const [addingItem, setAddingItem] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadFurniture = useCallback(() => {
    if (!id) return;
    fetch(`/api/rentals/rooms/${id}/furniture`)
      .then(r => r.json())
      .then(data => setFurniture(data.furniture || []))
      .catch(err => console.error('[rentals] furniture load failed:', err));
  }, [id]);

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
    loadFurniture();
  }, [id, loadFurniture]);

  async function toggleFurnished() {
    if (!room) return;
    const newVal = room.furnished ? 0 : 1;
    try {
      await fetch(`/api/rentals/rooms/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ furnished: newVal }),
      });
      setRoom({ ...room, furnished: newVal as 0 | 1 });
    } catch (err) {
      console.error('[rentals] toggle furnished failed:', err);
    }
  }

  async function toggleChecked(itemId: number, current: 0 | 1) {
    try {
      await fetch(`/api/rentals/rooms/${id}/furniture`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ id: itemId, checked: current ? 0 : 1 }] }),
      });
      setFurniture(prev => prev.map(f => f.id === itemId ? { ...f, checked: (current ? 0 : 1) as 0 | 1 } : f));
    } catch (err) {
      console.error('[rentals] toggle checked failed:', err);
    }
  }

  async function addFurnitureItem() {
    if (!newItem.trim() || addingItem) return;
    setAddingItem(true);
    try {
      const res = await fetch(`/api/rentals/rooms/${id}/furniture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_name: newItem.trim() }),
      });
      if (res.ok) {
        setNewItem('');
        loadFurniture();
      }
    } catch (err) {
      console.error('[rentals] add furniture failed:', err);
    } finally {
      setAddingItem(false);
    }
  }

  async function handleDeleteRoom() {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/rentals/rooms/${id}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/rentals/rooms');
      } else {
        const data = await res.json();
        alert(data.error || 'Delete failed');
        setDeleting(false);
      }
    } catch (err) {
      console.error('[rentals] delete room failed:', err);
      alert('Network error');
      setDeleting(false);
    }
  }

  async function deleteFurnitureItem(furnitureId: number) {
    try {
      await fetch(`/api/rentals/rooms/${id}/furniture`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ furniture_id: furnitureId }),
      });
      setFurniture(prev => prev.filter(f => f.id !== furnitureId));
    } catch (err) {
      console.error('[rentals] delete furniture failed:', err);
    }
  }

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

          {/* Furnished toggle */}
          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-[#1F2933]">Furnished</span>
            <button
              onClick={toggleFurnished}
              className={`relative w-11 h-[26px] rounded-full transition-colors ${room.furnished ? 'bg-green-500' : 'bg-gray-300'}`}
            >
              <div className={`absolute top-[3px] w-5 h-5 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-transform ${room.furnished ? 'left-[23px]' : 'left-[3px]'}`} />
            </button>
          </div>
        </div>

        {/* Furniture items */}
        {room.furnished ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400">
                Furniture ({furniture.filter(f => f.checked).length}/{furniture.length})
              </div>
            </div>

            {furniture.length > 0 && (
              <div className="space-y-1 mb-3">
                {furniture.map(item => (
                  <div key={item.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                    <button
                      onClick={() => toggleChecked(item.id, item.checked)}
                      className={`w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                        item.checked
                          ? 'bg-green-500 border-green-500'
                          : 'border-gray-300 bg-white'
                      }`}
                    >
                      {item.checked ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                      ) : null}
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className={`text-[13px] ${item.checked ? 'line-through text-gray-400' : 'text-[#1F2933] font-medium'}`}>
                        {item.item_name}
                      </span>
                      {item.quantity > 1 && (
                        <span className="text-[11px] text-gray-400 ml-1">{'\u00d7'}{item.quantity}</span>
                      )}
                    </div>
                    <button
                      onClick={() => deleteFurnitureItem(item.id)}
                      className="w-7 h-7 rounded-md flex items-center justify-center text-gray-300 active:text-red-500 active:bg-red-50 transition-colors"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add item */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newItem}
                onChange={e => setNewItem(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addFurnitureItem(); }}
                placeholder="Add furniture item..."
                className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] text-gray-900 placeholder-gray-400 outline-none focus:border-green-600 transition-colors"
              />
              <button
                onClick={addFurnitureItem}
                disabled={!newItem.trim() || addingItem}
                className={`px-3 py-2 rounded-lg text-[12px] font-semibold transition-colors ${
                  newItem.trim() && !addingItem
                    ? 'bg-green-600 text-white active:bg-green-700'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                Add
              </button>
            </div>
          </div>
        ) : null}

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

        {/* Delete room */}
        <button
          onClick={() => setShowDelete(true)}
          className="w-full bg-red-50 border border-red-100 text-red-700 font-semibold rounded-xl py-3.5 text-[14px] active:bg-red-100 transition-colors"
        >
          Delete Room
        </button>
      </div>

      {showDelete && (
        <ConfirmDialog
          title="Delete this room?"
          message={`This will permanently delete "${room.room_name || `Room ${room.room_code}`}" and all associated data. This cannot be undone.`}
          confirmLabel={deleting ? 'Deleting...' : 'Delete'}
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={handleDeleteRoom}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}
