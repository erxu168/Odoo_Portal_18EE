'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import SortableTileGrid from '@/components/ui/SortableTileGrid';

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

  const tiles = [
    {
      id: 'my-lists',
      label: 'My Lists',
      color: 'bg-blue-50 border-blue-200', iconBg: 'bg-blue-100', iconColor: 'text-blue-600',
      sublabel: stats.pending > 0 ? `${stats.pending} pending` : 'Assigned counts',
      badge: stats.pending,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="3"/>
          <path d="M7 8h10M7 12h10M7 16h6" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      id: 'quick-count',
      label: 'Quick Count',
      color: 'bg-teal-50 border-teal-200', iconBg: 'bg-teal-100', iconColor: 'text-teal-600',
      sublabel: 'Search + count any item',
      badge: 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="7"/>
          <path d="M16.5 16.5L21 21" strokeLinecap="round"/>
          <path d="M8 11h6M11 8v6" strokeLinecap="round"/>
        </svg>
      ),
    },
    ...(can('inventory.moingredients.view') ? [{
      id: 'mo-ingredients',
      label: 'MO Ingredients',
      color: 'bg-orange-50 border-orange-200', iconBg: 'bg-orange-100', iconColor: 'text-orange-600',
      sublabel: 'Confirmed MO needs',
      badge: 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round"/>
          <circle cx="7" cy="6" r="1.5" fill="currentColor" stroke="none"/>
          <circle cx="7" cy="12" r="1.5" fill="currentColor" stroke="none"/>
          <circle cx="7" cy="18" r="1.5" fill="currentColor" stroke="none"/>
        </svg>
      ),
    }] : []),
    {
      id: 'goods-received',
      label: 'Goods received',
      color: 'bg-emerald-50 border-emerald-200', iconBg: 'bg-emerald-100', iconColor: 'text-emerald-600',
      sublabel: 'Log deliveries in',
      badge: 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 8v13H3V8"/>
          <path d="M1 3h22v5H1z"/>
          <path d="M12 12v6M9 15l3 3 3-3"/>
        </svg>
      ),
    },
    ...(can('inventory.template.manage') ? [{
      id: 'manage',
      label: 'Manage Lists',
      color: 'bg-purple-50 border-purple-200', iconBg: 'bg-purple-100', iconColor: 'text-purple-600',
      sublabel: stats.templates > 0 ? `${stats.templates} templates` : 'Create templates',
      badge: 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round"/>
          <circle cx="19" cy="18" r="3"/>
        </svg>
      ),
    }] : []),
    ...(can('inventory.consumption.view') ? [{
      id: 'consumption',
      label: 'Consumption',
      color: 'bg-green-50 border-green-200', iconBg: 'bg-green-100', iconColor: 'text-green-600',
      sublabel: 'Usage by period',
      badge: 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>
        </svg>
      ),
    }] : []),
    ...(can('inventory.review.approve') ? [{
      id: 'review',
      label: 'Review',
      color: 'bg-amber-50 border-amber-200', iconBg: 'bg-amber-100', iconColor: 'text-amber-600',
      sublabel: (stats.submitted + stats.quickPending) > 0 ? `${stats.submitted + stats.quickPending} to review` : 'Approve counts',
      badge: stats.submitted + stats.quickPending,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 12l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"/>
        </svg>
      ),
    }] : []),
    ...(can('inventory.drinks.manage') ? [{
      id: 'drinks-scanner',
      label: 'Drinks Scanner',
      color: 'bg-pink-50 border-pink-200', iconBg: 'bg-pink-100', iconColor: 'text-pink-600',
      sublabel: 'Barcode WAJ drinks',
      badge: 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12"/>
          <path d="M4 8h16"/>
          <path d="M9 8V5a1 1 0 011-1h4a1 1 0 011 1v3"/>
          <path d="M10 13h4"/>
        </svg>
      ),
    }] : []),
    ...(can('inventory.drinks.manage') ? [{
      id: 'drinks-editor',
      label: 'Edit Drinks',
      color: 'bg-rose-50 border-rose-200', iconBg: 'bg-rose-100', iconColor: 'text-rose-600',
      sublabel: 'Name, price, tax, unit',
      badge: 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
        </svg>
      ),
    }] : []),
    ...(can('inventory.productsettings.manage') ? [{
      id: 'product-settings',
      label: 'Product settings',
      color: 'bg-white border-gray-200', iconBg: 'bg-blue-50', iconColor: 'text-blue-600',
      sublabel: 'Photo rules, per product',
      badge: 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
        </svg>
      ),
    }] : []),
    ...(can('inventory.location.manage') ? [{
      id: 'locations',
      label: 'Locations',
      color: 'bg-indigo-50 border-indigo-200', iconBg: 'bg-indigo-100', iconColor: 'text-indigo-600',
      sublabel: 'Map, shelves, photos',
      badge: 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 10c0 7-9 12-9 12s-9-5-9-12a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
        </svg>
      ),
    }] : []),
    // Portal-only Shift Handover submodule (its own /shift-handover route).
    ...(can('handover.view') ? [{
      id: 'shift-handover',
      href: '/shift-handover',
      label: 'Shift Handover',
      color: 'bg-green-50 border-green-200', iconBg: 'bg-green-100', iconColor: 'text-green-600',
      sublabel: 'Per-container handover',
      badge: 0,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
        </svg>
      ),
    }] : []),
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        title="Inventory"
        subtitle={loading ? 'Loading...' : stats.pending > 0 ? `${stats.pending} lists waiting` : 'Stock counting'}
      />

      <div className="px-4 pt-4">
        <SortableTileGrid
          items={tiles}
          getItemId={(tile) => tile.id}
          storageKey="inventory_tile_order"
          savedOrder={savedOrder}
          renderItem={(tile) => (
            <button onClick={() => ((tile as any).href ? router.push((tile as any).href) : onNavigate(tile.id))}
              className={`w-full relative p-4 rounded-2xl border ${(tile as any).color || 'bg-white border-gray-200'} text-left active:scale-[0.97] transition-transform shadow-sm`}>
              {tile.badge > 0 && (
                <span className="absolute top-3 right-3 min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-[var(--fs-xs)] font-bold font-mono leading-[22px] text-center">
                  {tile.badge}
                </span>
              )}
              <div className={`w-11 h-11 rounded-xl ${(tile as any).iconBg || 'bg-gray-100'} ${(tile as any).iconColor || ''} flex items-center justify-center mb-3`}>
                {tile.icon}
              </div>
              <div className="text-[var(--fs-lg)] font-bold text-gray-900">{tile.label}</div>
              <div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{tile.sublabel}</div>
            </button>
          )}
        />

      </div>
    </div>
  );
}
