'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { KpiRow, KpiChip } from '@/components/ui/KpiChip';
import { ActionGrid, ActionCard } from '@/components/ui/ActionCard';
import { berlinToday } from '@/lib/berlin-date';

interface InventoryDashboardProps {
  userRole: string;
  capabilities: string[];   // single source: the parent page's (seeded with staff defaults)
  onNavigate: (screen: string) => void;
  onHome: () => void;
}

export default function InventoryDashboard({ userRole, capabilities, onNavigate, onHome }: InventoryDashboardProps) {
  // What a person actually wants to know: how many PRODUCTS are waiting to be
  // counted today. The old numbers counted counting SESSIONS and called them
  // "lists" — so one list with six unfinished days read as "7 lists waiting",
  // and there was only ever one list.
  const [stats, setStats] = useState({
    toCount: 0,        // products still to count in TODAY's counts
    countedToday: 0,   // products already counted today
    submitted: 0,
    quickPending: 0,
    templates: 0,
    olderOpen: 0,           // counts from EARLIER days still not finished
    openWithoutLines: 0,    // category lists: open, but their size is not known here
  });
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
      const today = berlinToday();   // the restaurant's day, not UTC's
      const open = sessions.filter((s: any) => s.status === 'pending' || s.status === 'in_progress');
      const todays = open.filter((s: any) => s.scheduled_date === today);
      // Products, not counts. Yesterday's shelf cannot be counted today, so
      // older counts are NOT added in — that is how this reached "281 waiting".
      // A list built from CATEGORIES freezes no line rows, so lines_total is 0
      // for it — reporting "0 products to count" there would be a lie. Those
      // sessions are counted as unknown-but-open instead of as zero work.
      const withLines = todays.filter((s: any) => (s.lines_total || 0) > 0);
      const withoutLines = todays.length - withLines.length;
      const toCount = withLines.reduce(
        (n: number, s: any) => n + Math.max(0, (s.lines_total || 0) - (s.lines_done || 0)), 0);
      const countedToday = todays.reduce((n: number, s: any) => n + (s.lines_done || 0), 0);
      // Only EARLIER days. A future-dated ad-hoc count is open but not late.
      const olderOpen = open.filter((s: any) => s.scheduled_date < today).length;
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

      setStats({ toCount, countedToday, submitted, quickPending, templates, olderOpen, openWithoutLines: withoutLines });
    } catch (err) {
      console.error('Failed to load inventory stats:', err);
    } finally {
      setLoading(false);
    }
  }

  const reviewCount = stats.submitted + stats.quickPending;
  const tiles = [
    { id: 'my-lists', label: 'My Lists', emoji: '📋',
      sublabel: stats.toCount > 0 ? `${stats.toCount} product${stats.toCount === 1 ? '' : 's'} to count`
        : stats.countedToday > 0 ? 'All counted today' : 'Assigned counts',
      badge: stats.toCount },
    { id: 'quick-count', label: 'Quick Count', emoji: '🔍', sublabel: 'Search + count any item', badge: 0 },
    ...(can('inventory.moingredients.view') ? [{ id: 'mo-ingredients', label: 'MO Ingredients', emoji: '🧾', sublabel: 'Confirmed MO needs', badge: 0 }] : []),
    { id: 'goods-received', label: 'Goods received', emoji: '📥', sublabel: 'Log deliveries in', badge: 0 },
    ...(can('inventory.template.manage') ? [{ id: 'manage', label: 'Manage Lists', emoji: '🗂️', sublabel: stats.templates > 0 ? `${stats.templates} templates` : 'Create templates', badge: 0 }] : []),
    ...(can('inventory.productsettings.manage') ? [{ id: 'products', href: '/products', label: 'Products', emoji: '📦', sublabel: 'Edit names, units, prices…', badge: 0 }] : []),
    ...(can('inventory.consumption.view') ? [{ id: 'consumption', label: 'Consumption', emoji: '📉', sublabel: 'Usage by period', badge: 0 }] : []),
    ...(can('inventory.review.approve') ? [{ id: 'review', label: 'Review', emoji: '✅', sublabel: reviewCount > 0 ? `${reviewCount} to review` : 'Approve counts', badge: reviewCount }] : []),
    ...(can('inventory.drinks.manage') ? [{ id: 'drinks-scanner', label: 'Drinks Scanner', emoji: '🥤', sublabel: 'Barcode WAJ drinks', badge: 0 }] : []),
    ...(can('inventory.drinks.manage') ? [{ id: 'drinks-editor', label: 'Edit Drinks', emoji: '✏️', sublabel: 'Name, price, tax, unit', badge: 0 }] : []),
    ...(can('inventory.floorplan.view') ? [{ id: 'floorplan', label: 'Floorplan', emoji: '🗺️', sublabel: 'Find anything on the map', badge: 0 }] : []),
    ...(can('inventory.location.manage') ? [{ id: 'locations', label: 'Locations', emoji: '📍', sublabel: 'Map, shelves, photos', badge: 0 }] : []),
    // Shift Handover is now a top-level module on the home dashboard (its own
    // /shift-handover route) — no longer nested here.
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader
        title="Inventory"
        subtitle={loading ? 'Loading…'
          : stats.toCount > 0 ? `${stats.toCount} product${stats.toCount === 1 ? '' : 's'} to count today`
          : stats.openWithoutLines > 0 ? `${stats.openWithoutLines} count${stats.openWithoutLines === 1 ? '' : 's'} open today`
          : stats.countedToday > 0 ? 'Everything counted today'
          : 'Stock counting'}
        action={canManage ? (
          <button onClick={() => onNavigate('settings')} aria-label="Inventory settings" className="text-white/90 active:opacity-70 p-1">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        ) : undefined}
      />

      <div className="px-4 pt-4">
        <KpiRow columns={3} className="mb-4">
          <KpiChip value={stats.toCount} label="To count" />
          <KpiChip value={reviewCount} label="To review" />
          <KpiChip value={stats.countedToday} label="Counted" />
        </KpiRow>

        {/* Counts from earlier days that were never finished. Stated on its own
            and NOT added into today's number: yesterday's shelf cannot be
            counted today, and merging them is what turned one list into
            "281 products waiting". Untouched ones close themselves overnight,
            so anything showing here has work in it and needs a person. */}
        {!loading && stats.olderOpen > 0 && (
          <div className="mx-4 mb-3 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200">
            <p className="text-[var(--fs-sm)] font-bold text-amber-900">
              {stats.olderOpen} count{stats.olderOpen === 1 ? '' : 's'} from earlier days {stats.olderOpen === 1 ? 'was' : 'were'} started and never submitted
            </p>
            <p className="text-[var(--fs-xs)] text-amber-800 mt-0.5">
              Counts nobody touched close themselves overnight, so {stats.olderOpen === 1 ? 'this one has' : 'these have'} work in
              {stats.olderOpen === 1 ? ' it' : ' them'}. A manager can submit or reject {stats.olderOpen === 1 ? 'it' : 'them'} from Review.
            </p>
          </div>
        )}
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
