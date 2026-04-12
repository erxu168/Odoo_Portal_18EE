'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { Property, Room, UtilityProvider, MeterReading, RecyclingContainer } from '@/types/rentals';

type TabKey = 'overview' | 'rooms' | 'utilities' | 'meters';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'rooms', label: 'Rooms' },
  { key: 'utilities', label: 'Utilities' },
  { key: 'meters', label: 'Meters' },
];

function typeLabel(t: string): string {
  switch (t) {
    case 'apartment_wg': return 'Apartment (WG)';
    case 'house': return 'House';
    case 'studio': return 'Studio';
    default: return 'Other';
  }
}

function statusBadge(status: string) {
  switch (status) {
    case 'occupied':
      return { bg: '#DCFCE7', text: '#166534', label: 'Occupied' };
    case 'vacant':
      return { bg: '#DBEAFE', text: '#1E3A8A', label: 'Vacant' };
    case 'reserved':
      return { bg: '#FEF3C7', text: '#92400E', label: 'Reserved' };
    case 'maintenance':
      return { bg: '#FEE2E2', text: '#991B1B', label: 'Maintenance' };
    default:
      return { bg: '#F3F4F6', text: '#374151', label: status };
  }
}

function eur(n: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

export default function PropertyDetail() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;

  const [property, setProperty] = useState<Property | null>(null);
  const [rooms, setRooms] = useState<(Room & { active_tenancy_id?: number; active_tenant_name?: string })[]>([]);
  const [utilities, setUtilities] = useState<UtilityProvider[]>([]);
  const [meters, setMeters] = useState<MeterReading[]>([]);
  const [recycling, setRecycling] = useState<RecyclingContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>('overview');
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/rentals/properties/${id}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/rentals/properties');
      } else {
        const data = await res.json();
        alert(data.error || 'Delete failed');
        setDeleting(false);
      }
    } catch (err) {
      console.error('[rentals] delete property failed:', err);
      alert('Network error');
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`/api/rentals/properties/${id}`).then(r => r.json()),
      fetch(`/api/rentals/rooms?property_id=${id}`).then(r => r.json()),
    ])
      .then(([propData, roomsData]) => {
        setProperty(propData.property || null);
        setRooms(roomsData.rooms || []);
        setUtilities(propData.utilities || []);
        setMeters(propData.meters || []);
        setRecycling(propData.recycling || []);
      })
      .catch(err => console.error('[rentals] property detail load failed:', err))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Property" showBack onBack={() => router.push('/rentals/properties')} />
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!property) {
    return (
      <div className="min-h-screen bg-[#F6F7F9]">
        <AppHeader title="Not Found" showBack onBack={() => router.push('/rentals/properties')} />
        <div className="flex flex-col items-center justify-center py-16 text-center px-6">
          <div className="text-4xl mb-3">🏠</div>
          <div className="text-[15px] font-semibold text-[#1F2933] mb-1">Property not found</div>
        </div>
      </div>
    );
  }

  const occupiedCount = rooms.filter(r => r.status === 'occupied').length;
  const totalIncome = rooms.reduce((s, r) => s + (r.status === 'occupied' ? r.base_kaltmiete + r.utility_share : 0), 0);
  const totalCosts = utilities.reduce((s, u) => s + u.monthly_cost, 0);

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader
        title={property.street}
        subtitle={`${property.plz} ${property.city}`}
        supertitle={typeLabel(property.type)}
        showBack
        onBack={() => router.push('/rentals/properties')}
      />

      {/* Stats bar */}
      <div className="px-4 pt-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
          <div className="grid grid-cols-4 divide-x divide-gray-100">
            <div className="text-center px-1">
              <div className="text-lg font-bold text-[#1F2933]">{rooms.length}</div>
              <div className="text-[10px] font-semibold tracking-wider uppercase text-gray-400">Rooms</div>
            </div>
            <div className="text-center px-1">
              <div className="text-lg font-bold text-[#1F2933]">{occupiedCount}</div>
              <div className="text-[10px] font-semibold tracking-wider uppercase text-gray-400">Occupied</div>
            </div>
            <div className="text-center px-1">
              <div className="text-lg font-bold text-[#16A34A] tabular-nums">{eur(totalIncome)}</div>
              <div className="text-[10px] font-semibold tracking-wider uppercase text-gray-400">Income</div>
            </div>
            <div className="text-center px-1">
              <div className="text-lg font-bold text-[#DC2626] tabular-nums">{eur(totalCosts)}</div>
              <div className="text-[10px] font-semibold tracking-wider uppercase text-gray-400">Costs</div>
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
            {t.key === 'rooms' && ` (${rooms.length})`}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-4 pb-6">
        {tab === 'overview' && (
          <OverviewTab property={property} />
        )}
        {tab === 'rooms' && (
          <RoomsTab rooms={rooms} propertyId={property.id} />
        )}
        {tab === 'utilities' && (
          <UtilitiesTab utilities={utilities} recycling={recycling} />
        )}
        {tab === 'meters' && (
          <MetersTab meters={meters} />
        )}
      </div>

      {/* Delete property */}
      <div className="px-4 pb-8">
        <button
          onClick={() => setShowDelete(true)}
          className="w-full bg-red-50 border border-red-100 text-red-700 font-semibold rounded-xl py-3.5 text-[14px] active:bg-red-100 transition-colors"
        >
          Delete Property
        </button>
      </div>

      {showDelete && (
        <ConfirmDialog
          title="Delete this property?"
          message={`This will permanently delete "${property.street}" and all its rooms, tenancies, utilities, and related data. This cannot be undone.`}
          confirmLabel={deleting ? 'Deleting...' : 'Delete'}
          cancelLabel="Cancel"
          variant="danger"
          onConfirm={handleDelete}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}

// ─── Overview Tab ───
function OverviewTab({ property }: { property: Property }) {
  const fields = [
    { label: 'Address', value: `${property.street}, ${property.plz} ${property.city}` },
    { label: 'Floor / Unit', value: property.floor_unit || '\u2014' },
    { label: 'Type', value: typeLabel(property.type) },
    { label: 'Total Size', value: property.total_size_sqm ? `${property.total_size_sqm} m\u00b2` : '\u2014' },
    { label: 'Owner', value: property.owner || '\u2014' },
    { label: 'Hausverwaltung', value: property.hausverwaltung || '\u2014' },
    { label: 'Mietspiegel', value: property.mietspiegel_eur_per_sqm ? `${property.mietspiegel_eur_per_sqm.toFixed(2)} \u20ac/m\u00b2` : '\u2014' },
  ];

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)]">
        {fields.map((f, i) => (
          <div key={f.label} className={`flex items-center justify-between px-4 py-3 ${i < fields.length - 1 ? 'border-b border-gray-100' : ''}`}>
            <span className="text-[12px] text-gray-500">{f.label}</span>
            <span className="text-[13px] font-semibold text-[#1F2933] text-right max-w-[60%] truncate">{f.value}</span>
          </div>
        ))}
      </div>
      {property.notes && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
          <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-2">Notes</div>
          <p className="text-[13px] text-gray-700 whitespace-pre-wrap">{property.notes}</p>
        </div>
      )}
    </div>
  );
}

// ─── Rooms Tab ───
function RoomsTab({ rooms, propertyId }: { rooms: (Room & { active_tenant_name?: string })[], propertyId: number }) {
  const router = useRouter();

  if (rooms.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="text-3xl mb-2">🚪</div>
        <div className="text-[14px] font-semibold text-[#1F2933] mb-1">No rooms yet</div>
        <div className="text-[12px] text-gray-500 mb-4">Add rooms to track tenancies</div>
        <button
          onClick={() => router.push(`/rentals/rooms/new?property_id=${propertyId}`)}
          className="bg-green-600 text-white font-semibold rounded-xl px-5 py-2.5 text-[13px] active:bg-green-700 transition-colors"
        >
          Add Room
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rooms.map(room => {
        const badge = statusBadge(room.status);
        return (
          <button
            key={room.id}
            onClick={() => router.push(`/rentals/rooms/${room.id}`)}
            className="w-full bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 text-left active:bg-gray-50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center text-[14px] font-bold text-gray-600 flex-shrink-0">
                  {room.room_code}
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-[#1F2933] truncate">
                    {room.room_name || `Room ${room.room_code}`}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {room.size_sqm} m{'\u00b2'} \u00b7 {eur(room.base_kaltmiete)} cold
                  </div>
                  {room.active_tenant_name && (
                    <div className="text-[11px] text-green-700 font-medium mt-0.5">{room.active_tenant_name}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span
                  className="px-2 py-0.5 rounded-md text-[10px] font-bold"
                  style={{ backgroundColor: badge.bg, color: badge.text }}
                >
                  {badge.label}
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Utilities Tab ───
function UtilitiesTab({ utilities, recycling }: { utilities: UtilityProvider[]; recycling: RecyclingContainer[] }) {
  const categoryIcon: Record<string, string> = {
    electricity: '\u26a1', gas: '\ud83d\udd25', water: '\ud83d\udca7',
    internet: '\ud83c\udf10', insurance: '\ud83d\udee1\ufe0f', recycling: '\u267b\ufe0f', other: '\ud83d\udce6',
  };

  if (utilities.length === 0 && recycling.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="text-3xl mb-2">{'\u26a1'}</div>
        <div className="text-[14px] font-semibold text-[#1F2933] mb-1">No utility providers</div>
        <div className="text-[12px] text-gray-500">Add electricity, gas, water, and other providers</div>
      </div>
    );
  }

  const totalMonthlyCost = utilities.reduce((s, u) => s + u.monthly_cost, 0);

  return (
    <div className="space-y-3">
      {/* Total */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4 text-center">
        <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-1">Monthly Utility Costs</div>
        <div className="text-xl font-bold text-[#1F2933] tabular-nums">{eur(totalMonthlyCost)}</div>
      </div>

      {/* Providers */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)]">
        {utilities.map((u, i) => (
          <div key={u.id} className={`flex items-center gap-3 px-4 py-3 ${i < utilities.length - 1 ? 'border-b border-gray-100' : ''}`}>
            <span className="text-xl">{categoryIcon[u.category] || '\ud83d\udce6'}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-[#1F2933]">{u.provider_name}</div>
              <div className="text-[11px] text-gray-500 capitalize">{u.category}{u.account_no ? ` \u00b7 ${u.account_no}` : ''}</div>
            </div>
            <div className="text-[13px] font-bold text-[#1F2933] tabular-nums">{eur(u.monthly_cost)}</div>
          </div>
        ))}
      </div>

      {/* Recycling */}
      {recycling.length > 0 && (
        <>
          <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mt-4 mb-2">Recycling</div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)]">
            {recycling.map((r, i) => (
              <div key={r.id} className={`flex items-center gap-3 px-4 py-3 ${i < recycling.length - 1 ? 'border-b border-gray-100' : ''}`}>
                <span className="text-xl">{'\u267b\ufe0f'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-[#1F2933] capitalize">{r.container_type.replace('_', ' ')}</div>
                  <div className="text-[11px] text-gray-500">
                    {r.company} \u00b7 {r.pickup_day} ({r.frequency})
                  </div>
                </div>
                <div className="text-[12px] text-gray-500 tabular-nums">{r.size_liters ? `${r.size_liters}L` : ''}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Meters Tab ───
function MetersTab({ meters }: { meters: MeterReading[] }) {
  const meterIcon: Record<string, string> = {
    electricity: '\u26a1', gas: '\ud83d\udd25', water_cold: '\ud83d\udca7', water_hot: '\ud83c\udf21\ufe0f', heating: '\ud83c\udf21\ufe0f',
  };

  if (meters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="text-3xl mb-2">{'\ud83d\udccf'}</div>
        <div className="text-[14px] font-semibold text-[#1F2933] mb-1">No meter readings</div>
        <div className="text-[12px] text-gray-500">Readings will appear after inspections</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {meters.map(m => (
        <div key={m.id} className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">{meterIcon[m.meter_type] || '\ud83d\udccf'}</span>
              <div>
                <div className="text-[13px] font-semibold text-[#1F2933] capitalize">{m.meter_type.replace('_', ' ')}</div>
                <div className="text-[11px] text-gray-500">#{m.meter_no}</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[14px] font-bold text-[#1F2933] tabular-nums font-mono">{m.reading_value} {m.reading_unit}</div>
              <div className="text-[10px] text-gray-400">{m.reading_date}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
