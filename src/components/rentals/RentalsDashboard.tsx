'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { ActionGrid, ActionCard } from '@/components/ui/ActionCard';
import { KpiRow, KpiChip } from '@/components/ui/KpiChip';

interface DashboardStats {
  properties: number;
  rooms: number;
  occupiedRooms: number;
  tenancies: number;
  activeAlerts: number;
  monthlyIncome: number;
}

const DEFAULT_STATS: DashboardStats = {
  properties: 0,
  rooms: 0,
  occupiedRooms: 0,
  tenancies: 0,
  activeAlerts: 0,
  monthlyIncome: 0,
};

interface Tile {
  id: string;
  emoji: string;
  label: string;
  sub: string;
  badge?: string;
  onClick: () => void;
}

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
        });
      } catch (err) {
        console.error('[rentals] dashboard load failed:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const occupancyPct = stats.rooms > 0 ? Math.round((stats.occupiedRooms / stats.rooms) * 100) : 0;
  const income = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(stats.monthlyIncome);

  const tiles: Tile[] = [
    { id: 'properties', emoji: '\u{1F3E0}', label: 'Properties', sub: `${stats.properties} properties · ${stats.rooms} rooms`, onClick: () => router.push('/rentals/properties') },
    { id: 'tenancies', emoji: '\u{1F465}', label: 'Tenancies', sub: `${stats.tenancies} active`, onClick: () => router.push('/rentals/tenancies') },
    { id: 'alerts', emoji: '\u{1F514}', label: 'Alerts', sub: stats.activeAlerts > 0 ? `${stats.activeAlerts} active` : 'All clear', badge: stats.activeAlerts > 0 ? String(stats.activeAlerts) : undefined, onClick: () => router.push('/rentals/alerts') },
    { id: 'payments', emoji: '\u{1F4B6}', label: 'Payments', sub: 'SEPA & reconciliation', onClick: () => router.push('/rentals/payments') },
    { id: 'add', emoji: '⏺️', label: 'Add Property', sub: 'Register a new property', onClick: () => router.push('/rentals/properties/new') },
    { id: 'inspections', emoji: '\u{1F4CB}', label: 'Inspections', sub: 'Move-in / move-out', onClick: () => router.push('/rentals/inspections') },
    { id: 'vault', emoji: '\u{1F511}', label: 'Credential Vault', sub: 'Provider logins', onClick: () => router.push('/rentals/vault') },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="Rentals" subtitle="Properties & tenancies" />

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="px-5 py-5 space-y-5">
          {/* Summary stat chips */}
          <KpiRow columns={4}>
            <KpiChip value={`${occupancyPct}%`} label="Occupancy" />
            <KpiChip value={income} label="Monthly" />
            <KpiChip value={`${stats.occupiedRooms}/${stats.rooms}`} label="Rooms" />
            <KpiChip value={stats.activeAlerts} label="Alerts" tone={stats.activeAlerts > 0 ? 'danger' : 'default'} />
          </KpiRow>

          {/* Tiles */}
          <ActionGrid<Tile>
            items={tiles}
            getItemId={(t) => t.id}
            renderItem={(t) => (
              <ActionCard
                emoji={t.emoji}
                label={t.label}
                subtitle={t.sub}
                badge={t.badge ? { value: t.badge, tone: 'danger', ariaLabel: `${t.badge} alerts` } : undefined}
                onClick={t.onClick}
              />
            )}
          />
        </div>
      )}
    </div>
  );
}
