'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';

interface DashboardStats {
  properties: number;
  rooms: number;
  occupiedRooms: number;
  tenancies: number;
  activeAlerts: number;
  monthlyIncome: number;
  pendingPayments: number;
}

const DEFAULT_STATS: DashboardStats = {
  properties: 0,
  rooms: 0,
  occupiedRooms: 0,
  tenancies: 0,
  activeAlerts: 0,
  monthlyIncome: 0,
  pendingPayments: 0,
};

export default function RentalsDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [propsRes, tenanciesRes, alertsRes] = await Promise.all([
          fetch('/api/rentals/properties'),
          fetch('/api/rentals/tenancies?status=active'),
          fetch('/api/rentals/alerts?status=active'),
        ]);
        const propsData = await propsRes.json();
        const tenanciesData = await tenanciesRes.json();
        const alertsData = await alertsRes.json();

        const properties = propsData.properties || [];
        const tenancies = tenanciesData.tenancies || [];
        const alerts = alertsData.alerts || [];

        const totalRooms = properties.reduce((s: number, p: any) => s + (p.rooms_total || 0), 0);
        const occupiedRooms = properties.reduce((s: number, p: any) => s + (p.rooms_occupied || 0), 0);
        const monthlyIncome = properties.reduce((s: number, p: any) => s + (p.monthly_income || 0), 0);

        setStats({
          properties: properties.length,
          rooms: totalRooms,
          occupiedRooms,
          tenancies: tenancies.length,
          activeAlerts: alerts.length,
          monthlyIncome,
          pendingPayments: 0,
        });
      } catch (err) {
        console.error('[rentals] dashboard load failed:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const occupancyPct = stats.rooms > 0
    ? Math.round((stats.occupiedRooms / stats.rooms) * 100)
    : 0;

  const tiles = [
    {
      key: 'properties',
      label: 'Properties',
      sublabel: `${stats.properties} properties \u00b7 ${stats.rooms} rooms`,
      href: '/rentals/properties',
      color: 'bg-blue-50 border-blue-200',
      iconBg: 'bg-blue-100',
      iconColor: 'text-blue-600',
      badge: null,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      ),
    },
    {
      key: 'tenancies',
      label: 'Tenancies',
      sublabel: `${stats.tenancies} active`,
      href: '/rentals/tenancies',
      color: 'bg-green-50 border-green-200',
      iconBg: 'bg-green-100',
      iconColor: 'text-green-600',
      badge: null,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 00-3-3.87"/>
          <path d="M16 3.13a4 4 0 010 7.75"/>
        </svg>
      ),
    },
    {
      key: 'alerts',
      label: 'Alerts',
      sublabel: stats.activeAlerts > 0 ? `${stats.activeAlerts} active` : 'All clear',
      href: '/rentals/alerts',
      color: stats.activeAlerts > 0 ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200',
      iconBg: stats.activeAlerts > 0 ? 'bg-red-100' : 'bg-gray-100',
      iconColor: stats.activeAlerts > 0 ? 'text-red-600' : 'text-gray-500',
      badge: stats.activeAlerts > 0 ? stats.activeAlerts : null,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
        </svg>
      ),
    },
    {
      key: 'payments',
      label: 'Payments',
      sublabel: 'SEPA & reconciliation',
      href: '/rentals/payments',
      color: 'bg-amber-50 border-amber-200',
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-600',
      badge: null,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="1" x2="12" y2="23"/>
          <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      <AppHeader title="Rentals" subtitle="Properties & tenancies" />

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="px-4 py-5 space-y-5">
          {/* Summary stats bar */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] p-4">
            <div className="grid grid-cols-3 divide-x divide-gray-100">
              <div className="text-center px-2">
                <div className="text-xl font-bold text-[#1F2933]">{occupancyPct}%</div>
                <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mt-0.5">Occupancy</div>
              </div>
              <div className="text-center px-2">
                <div className="text-xl font-bold text-[#1F2933]">
                  {new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(stats.monthlyIncome)}
                </div>
                <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mt-0.5">Monthly</div>
              </div>
              <div className="text-center px-2">
                <div className="text-xl font-bold text-[#1F2933]">
                  {stats.occupiedRooms}/{stats.rooms}
                </div>
                <div className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mt-0.5">Rooms</div>
              </div>
            </div>
          </div>

          {/* 2x2 tile grid */}
          <div className="grid grid-cols-2 gap-3">
            {tiles.map(tile => (
              <button
                key={tile.key}
                onClick={() => router.push(tile.href)}
                className={`relative rounded-2xl border ${tile.color} shadow-sm p-4 text-left active:scale-[0.97] transition-transform`}
              >
                {tile.badge !== null && (
                  <span className="absolute top-3 right-3 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center">
                    {tile.badge}
                  </span>
                )}
                <div className={`w-11 h-11 rounded-xl ${tile.iconBg} ${tile.iconColor} flex items-center justify-center mb-3`}>
                  {tile.icon}
                </div>
                <div className="text-[14px] font-bold text-gray-900">{tile.label}</div>
                <div className="text-[12px] text-gray-500 mt-0.5">{tile.sublabel}</div>
              </button>
            ))}
          </div>

          {/* Quick links */}
          <div>
            <p className="text-[11px] font-semibold tracking-wider uppercase text-gray-400 mb-3">Quick actions</p>
            <div className="space-y-2">
              <button
                onClick={() => router.push('/rentals/properties/new')}
                className="w-full flex items-center gap-3 bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 active:bg-gray-50 transition-colors"
              >
                <div className="w-9 h-9 rounded-lg bg-green-100 text-green-600 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </div>
                <div className="flex-1 text-left">
                  <div className="text-[13px] font-semibold text-[#1F2933]">Add Property</div>
                  <div className="text-[11px] text-gray-500">Register a new property</div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
              </button>
              <button
                onClick={() => router.push('/rentals/inspections')}
                className="w-full flex items-center gap-3 bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 active:bg-gray-50 transition-colors"
              >
                <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 11l3 3L22 4"/>
                    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                  </svg>
                </div>
                <div className="flex-1 text-left">
                  <div className="text-[13px] font-semibold text-[#1F2933]">{'\u00dc'}bergabeprotokoll</div>
                  <div className="text-[11px] text-gray-500">Move-in / move-out inspections</div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
              </button>
              <button
                onClick={() => router.push('/rentals/vault')}
                className="w-full flex items-center gap-3 bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 active:bg-gray-50 transition-colors"
              >
                <div className="w-9 h-9 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0110 0v4"/>
                  </svg>
                </div>
                <div className="flex-1 text-left">
                  <div className="text-[13px] font-semibold text-[#1F2933]">Credential Vault</div>
                  <div className="text-[11px] text-gray-500">Provider logins & passwords</div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
