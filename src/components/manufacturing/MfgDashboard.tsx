'use client';

import React, { useState, useEffect } from 'react';
import { useCompany } from '@/lib/company-context';
import { KpiRow, KpiChip } from '@/components/ui/KpiChip';
import { ActionGrid, ActionCard } from '@/components/ui/ActionCard';

interface MfgDashboardProps {
  onNavigate: (screen: string) => void;
}

export default function MfgDashboard({ onNavigate }: MfgDashboardProps) {
  const { companyId } = useCompany();
  const [stats, setStats] = useState({ active: 0, confirmed: 0, inProgress: 0, done: 0, bomCount: 0, pickListCount: 0 });
  const [loading, setLoading] = useState(true);
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user?.preferences?.manufacturing_tile_order) setSavedOrder(d.user.preferences.manufacturing_tile_order); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    (async () => {
      try {
        const cq = `company_id=${companyId}`;
        const [moRes, bomRes, pickRes] = await Promise.all([
          fetch(`/api/manufacturing-orders?limit=200&${cq}`).then(r => r.json()),
          fetch(`/api/boms?${cq}`).then(r => r.json()),
          fetch(`/api/manufacturing-orders/pick-list?${cq}`).then(r => r.json()).catch(() => ({ total_components: 0 })),
        ]);
        const mos = moRes.orders || [];
        const active = mos.filter((m: any) => m.state === 'confirmed' || m.state === 'progress').length;
        const confirmed = mos.filter((m: any) => m.state === 'confirmed').length;
        const inProgress = mos.filter((m: any) => m.state === 'progress').length;
        const done = mos.filter((m: any) => m.state === 'done').length;
        setStats({ active, confirmed, inProgress, done, bomCount: bomRes.total || 0, pickListCount: pickRes.total_components || 0 });
      } catch (e) { void e; }
      finally { setLoading(false); }
    })();
  }, [companyId]);

  const tiles = [
    { key: 'orders', label: 'Manufacturing', sublabel: 'Active orders', emoji: '🏭', badge: stats.active },
    { key: 'pick-list', label: 'Pick List', sublabel: 'Collect ingredients', emoji: '📋', badge: stats.pickListCount },
    { key: 'recipes', label: 'Recipes', sublabel: 'Bills of materials', emoji: '📖', badge: stats.bomCount },
    { key: 'completed', label: 'Completed', sublabel: 'Finished orders', emoji: '✔️', badge: stats.done },
    { key: 'label-print', label: 'Label Print', sublabel: 'Print recipe or custom labels', emoji: '🏷️', badge: 0 },
  ];

  return (
    <div className="px-4 py-5">
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          <KpiRow columns={4} className="mb-4">
            <KpiChip value={stats.active} label="Active" />
            <KpiChip value={stats.pickListCount} label="Pick" />
            <KpiChip value={stats.bomCount} label="Recipes" />
            <KpiChip value={stats.done} label="Done" />
          </KpiRow>
          <ActionGrid
            items={tiles}
            getItemId={(t) => t.key}
            sortable={{ storageKey: 'manufacturing_tile_order', savedOrder }}
            renderItem={(tile) => (
              <ActionCard
                emoji={tile.emoji}
                label={tile.label}
                subtitle={tile.sublabel}
                onClick={() => onNavigate(tile.key)}
                badge={tile.badge ? { value: tile.badge, ariaLabel: `${tile.badge}` } : undefined}
              />
            )}
          />
        </>
      )}
    </div>
  );
}
