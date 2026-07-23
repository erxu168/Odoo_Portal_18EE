'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { KpiRow, KpiChip } from '@/components/ui/KpiChip';
import { ActionGrid, ActionCard } from '@/components/ui/ActionCard';

interface InventoryDashboardProps {
  userRole: string;
  capabilities: string[];   // single source: the parent page's (seeded with staff defaults)
  onNavigate: (screen: string) => void;
  onHome: () => void;
}

export default function InventoryDashboard({ userRole, capabilities, onNavigate, onHome }: InventoryDashboardProps) {
  const [stats, setStats] = useState({ pending: 0, submitted: 0, quickPending: 0, templates: 0 });
  const [loading, setLoading] = useState(true);
  const [savedOrder, setSavedOrder] = useState<string[] | null>(null);

  const router = useRouter();
  const canManage = userRole === 'manager' || userRole === 'admin';
  const can = (k: string) => capabilities.includes(k);

  useEffect(() => {
    fetchStats();
  }, [canManage]);

  useEffect(() => {
    // Tile-order preference only — capabilities come from the parent so the
    // tiles and the screen router can never disagree.
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user?.preferences?.inventory_tile_order) setSavedOrder(d.user.preferences.inventory_tile_order);
    }).catch(() => {});
  }, []);

  async function fetchStats() {
    setLoading(true);
    try {
      const [sessRes, quickRes, tmplRes] = await Promise.all([
        fetch('/api/inventory/sessions'),
        canManage ? fetch('/api/inventory/quick-count') : null,
        canManage ? fetch('/api/inventory/templates') : null,
      ]);
      const sessData = await sessRes.json();
      const sessions = sessData.sessions || [];
      const pending = sessions.filter((s: any) => s.status === 'pending' || s.status === 'in_progress').length;
      const submitted = sessions.filter((s: any) => s.status === 'submitted').length;

      let quickPending = 0;
      if (quickRes) {
        const quickData = await quickRes.json();
        quickPending = (quickData.counts || []).filter((c: any) => c.status === 'pending').length;
      }

      let templates = 0;
      if (tmplRes) {
        const tmplData = await tmplRes.json();
        templates = (tmplData.templates || []).length;
      }

      setStats({ pending, submitted, quickPending, templates });
    } catch (err) {
      console.error('Failed to load inventory stats:', err);
    } finally {
      setLoading(false);
    }
  }

  const reviewCount = stats.submitted + stats.quickPending;
  const tiles = [
    { id: 'my-lists', label: 'My Lists', emoji: '📋', sublabel: stats.pending > 0 ? `${stats.pending} pending` : 'Assigned counts', badge: stats.pending },
    { id: 'quick-count', label: 'Quick Count', emoji: '🔍', sublabel: 'Search + count any item', badge: 0 },
    ...(can('inventory.moingredients.view') ? [{ id: 'mo-ingredients', label: 'MO Ingredients', emoji: '🧾', sublabel: 'Confirmed MO needs', badge: 0 }] : []),
    { id: 'goods-received', label: 'Goods received', emoji: '📥', sublabel: 'Log deliveries in', badge: 0 },
    ...(can('inventory.template.manage') ? [{ id: 'manage', label: 'Manage Lists', emoji: '🗂️', sublabel: stats.templates > 0 ? `${stats.templates} templates` : 'Create templates', badge: 0 }] : []),
    ...(can('inventory.productsettings.manage') ? [{ id: 'products', href: '/products', label: 'Products', emoji: '📦', sublabel: 'Edit names, units, prices…', badge: 0 }] : []),
    ...(can('inventory.consumption.view') ? [{ id: 'consumption', label: 'Consumption', emoji: '📉', sublabel: 'Usage by period', badge: 0 }] : []),
    ...(can('inventory.review.approve') ? [{ id: 'review', label: 'Review', emoji: '✅', sublabel: reviewCount > 0 ? `${reviewCount} to review` : 'Approve counts', badge: reviewCount }] : []),
    ...(can('inventory.drinks.manage') ? [{ id: 'drinks-scanner', label: 'Drinks Scanner', emoji: '🥤', sublabel: 'Barcode WAJ drinks', badge: 0 }] : []),
    ...(can('inventory.drinks.manage') ? [{ id: 'drinks-editor', label: 'Edit Drinks', emoji: '✏️', sublabel: 'Name, price, tax, unit', badge: 0 }] : []),
    ...(can('inventory.location.manage') ? [{ id: 'locations', label: 'Locations', emoji: '📍', sublabel: 'Map, shelves, photos', badge: 0 }] : []),
    // Portal-only Shift Handover submodule (its own /shift-handover route).
    ...(can('handover.view') ? [{ id: 'shift-handover', href: '/shift-handover', label: 'Shift Handover', emoji: '🔄', sublabel: 'Notes & photos for the next shift', badge: 0 }] : []),
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        title="Inventory"
        subtitle={loading ? 'Loading...' : stats.pending > 0 ? `${stats.pending} lists waiting` : 'Stock counting'}
      />

      <div className="px-4 pt-4">
        <KpiRow columns={3} className="mb-4">
          <KpiChip value={stats.pending} label="Waiting" />
          <KpiChip value={reviewCount} label="To review" />
          <KpiChip value={stats.templates} label="Lists" />
        </KpiRow>
        <ActionGrid
          items={tiles}
          getItemId={(tile) => tile.id}
          sortable={{ storageKey: 'inventory_tile_order', savedOrder }}
          renderItem={(tile) => (
            <ActionCard
              emoji={tile.emoji}
              label={tile.label}
              subtitle={tile.sublabel}
              onClick={() => ((tile as any).href ? router.push((tile as any).href) : onNavigate(tile.id))}
              badge={tile.badge > 0 ? { value: tile.badge, tone: (tile as any).danger ? 'danger' : 'count', ariaLabel: `${tile.badge}` } : undefined}
            />
          )}
        />
      </div>
    </div>
  );
}
