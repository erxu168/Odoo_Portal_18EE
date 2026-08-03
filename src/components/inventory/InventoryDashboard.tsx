'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/ui/AppHeader';
import { KpiRow, KpiChip } from '@/components/ui/KpiChip';
import { ActionGrid, ActionCard } from '@/components/ui/ActionCard';
import { berlinToday } from '@/lib/berlin-date';
import DueCountCard from './DueCountCard';

interface InventoryDashboardProps {
  userRole: string;
  capabilities: string[];   // single source: the parent page's (seeded with staff defaults)
  onNavigate: (screen: string) => void;
  /** Open today's count. Several due counts open as ONE walk — each location
   *  visited once — while each line still saves to its own count. */
  onOpenSession: (sessionIds: number[]) => void;
  onHome: () => void;
}

export default function InventoryDashboard({ userRole, capabilities, onNavigate, onOpenSession, onHome }: InventoryDashboardProps) {
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
  // TODAY's open count sessions — shown as cards at the top so the count is the
  // first thing staff see, not something behind a tile.
  const [dueToday, setDueToday] = useState<any[]>([]);
  // A failed load must NEVER read as "all caught up" — staff would skip a real
  // count. Only a successful sessions response may show the empty state.
  const [dueLoadFailed, setDueLoadFailed] = useState(false);

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

  // Only the LATEST request may write state: `canManage` flips during auth
  // hydration and fires a second fetch, and a slower older response must not
  // overwrite the newer one (or resurrect a cleared error).
  const fetchSeq = useRef(0);

  async function fetchStats() {
    const token = ++fetchSeq.current;
    setLoading(true);
    setDueLoadFailed(false);
    try {
      const [sessRes, quickRes, tmplRes] = await Promise.all([
        fetch('/api/inventory/sessions'),
        canManage ? fetch('/api/inventory/quick-count') : null,
        canManage ? fetch('/api/inventory/templates') : null,
      ]);
      if (!sessRes.ok) throw new Error(`sessions ${sessRes.status}`);
      const sessData = await sessRes.json();
      if (fetchSeq.current !== token) return;   // a newer request took over
      const sessions = sessData.sessions || [];
      const today = berlinToday();   // the restaurant's day, not UTC's
      const open = sessions.filter((s: any) => s.status === 'pending' || s.status === 'in_progress');
      const todays = open.filter((s: any) => s.scheduled_date === today);
      setDueToday(todays);
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

      // The quick/template json() awaits above are suspension points too — a
      // newer request may have taken over while they parsed.
      if (fetchSeq.current !== token) return;
      setStats({ toCount, countedToday, submitted, quickPending, templates, olderOpen, openWithoutLines: withoutLines });
    } catch (err) {
      console.error('Failed to load inventory stats:', err);
      if (fetchSeq.current === token) {
        setDueLoadFailed(true);
        // Stale cards must not paper over a failed load — staff would trust a
        // list that may no longer be true, and the retry row would never show.
        setDueToday([]);
      }
    } finally {
      if (fetchSeq.current === token) setLoading(false);
    }
  }

  const reviewCount = stats.submitted + stats.quickPending;
  // No "My Lists" tile any more: today's counts are cards at the top of this
  // screen, and past counts stay reachable via the "To count"/"Counted" chips.
  const tiles = [
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
        {/* The pills are NAVIGATION, not decoration: each opens the screen
            where its number gets worked on. "To review" stays a plain number
            for staff — Review itself is manager-gated. */}
        <KpiRow columns={3} className="mb-4">
          <KpiChip value={stats.toCount} label="To count" onClick={() => onNavigate('my-lists')} />
          <KpiChip value={reviewCount} label="To review"
            onClick={can('inventory.review.approve') ? () => onNavigate('review') : undefined} />
          <KpiChip value={stats.countedToday} label="Counted" onClick={() => onNavigate('my-lists')} />
        </KpiRow>

        {/* TODAY'S COUNTS — the reason staff opened this module, so they're the
            first real content: one tappable card per due session, straight into
            the walk. When nothing is due, say so plainly (never "0 to count"). */}
        {!loading && (
          <div className="mb-4">
            <p className="text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400 mb-2 px-1">
              Today&rsquo;s count{dueToday.length > 1 ? 's' : ''}
            </p>
            {dueToday.length > 0 ? (
              <div className="flex flex-col gap-3">
                {/* One card per due count, as today. Combining several into ONE
                    walk is built (CountingSession takes sessionIds) but stays
                    unreachable until the safe grouping lands: only counts of the
                    SAME restaurant + stock location, with frozen product rows,
                    and with no product in common, may share a walk. */}
                {dueToday.map((sess: any) => (
                  <DueCountCard key={sess.id} session={sess} onOpen={(id) => onOpenSession([id])} />
                ))}
              </div>
            ) : dueLoadFailed ? (
              <button type="button" onClick={fetchStats}
                className="w-full bg-red-50 border border-red-200 rounded-2xl px-4 py-3.5 flex items-center gap-2.5 text-left active:bg-red-100">
                <span className="text-red-600 font-bold" aria-hidden="true">!</span>
                <span className="text-[var(--fs-sm)] font-semibold text-red-700">Couldn&rsquo;t load today&rsquo;s counts — tap to retry</span>
              </button>
            ) : (
              <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3.5 flex items-center gap-2.5">
                <span className="text-green-600 font-bold" aria-hidden="true">✓</span>
                <span className="text-[var(--fs-sm)] font-semibold text-gray-600">All caught up — nothing to count today</span>
              </div>
            )}
          </div>
        )}

        {/* Counts from earlier days that were never finished. Stated on its own
            and NOT added into today's number: yesterday's shelf cannot be
            counted today, and merging them is what turned one list into
            "281 products waiting". Untouched ones close themselves overnight,
            so anything showing here has work in it and needs a person. */}
        {!loading && stats.olderOpen > 0 && (() => {
          // The notice tells you to go to Review — so, for anyone who CAN
          // review, it IS the way there. Staff see the same words, unclickable.
          const canReview = can('inventory.review.approve');
          const inner = (
            <>
              <p className="text-[var(--fs-sm)] font-bold text-amber-900">
                {stats.olderOpen} count{stats.olderOpen === 1 ? '' : 's'} from earlier days {stats.olderOpen === 1 ? 'is' : 'are'} still open
              </p>
              <p className="text-[var(--fs-xs)] text-amber-800 mt-0.5">
                Opened on an earlier day and never submitted. The 6:00 tidy-up closes the ones
                nobody touched {'\u2014'} open one to see what is in it.{' '}
                {canReview
                  ? <span className="font-bold underline">Tap to see {stats.olderOpen === 1 ? 'it' : 'them'}.</span>
                  : `A manager can finish ${stats.olderOpen === 1 ? 'it' : 'them'} from Review.`}
              </p>
            </>
          );
          const box = 'px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200';
          return (
            <div className="mx-4 mb-3">
              {canReview ? (
                <button type="button" onClick={() => onNavigate('review-unsubmitted')}
                  className={`${box} block w-full text-left active:bg-amber-100`}>
                  {inner}
                </button>
              ) : (
                <div className={box}>{inner}</div>
              )}
            </div>
          );
        })()}
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
