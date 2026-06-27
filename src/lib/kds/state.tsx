'use client';

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import type { KdsOrder, KdsTab, RoundState, KdsSettings, KdsMode, ProductConfig } from '@/types/kds';
import { DEFAULT_SETTINGS } from '@/types/kds';
import { createSeedOrders, generateRandomOrder } from './mockData';

interface KdsState {
  orders: KdsOrder[];
  roundState: RoundState;
  firedOrderIds: number[];
  currentTab: KdsTab;
  mode: KdsMode;
  settings: KdsSettings;
  muted: boolean;
  settingsOpen: boolean;
  nextId: number;
  productConfig: ProductConfig[];
  connected: boolean;
}

interface KdsActions {
  fireRound: () => void;
  nextRound: () => void;
  toggleItem: (itemId: string, ticketId: number) => void;
  markReady: (ticketId: number) => void;
  pickup: (ticketId: number) => void;
  recall: (ticketId: number) => void;
  setTab: (tab: KdsTab) => void;
  toggleMute: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  updateSettings: (s: KdsSettings) => void;
  addOrder: (order: KdsOrder) => void;
  setMode: (m: KdsMode) => void;
}

interface KdsContextType extends KdsState, KdsActions {}

const KdsContext = createContext<KdsContextType | null>(null);

export function useKds(): KdsContextType {
  const ctx = useContext(KdsContext);
  if (!ctx) throw new Error('useKds must be used within KdsProvider');
  return ctx;
}

export function KdsProvider({ children }: { children: React.ReactNode }) {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [roundState, setRoundState] = useState<RoundState>('idle');
  const [firedOrderIds, setFiredOrderIds] = useState<number[]>([]);
  const [currentTab, setCurrentTab] = useState<KdsTab>('prep');
  const [mode, setModeState] = useState<KdsMode>('smart');
  const [settings, setSettings] = useState<KdsSettings>(DEFAULT_SETTINGS);
  const [muted, setMuted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [productConfig, setProductConfig] = useState<ProductConfig[]>([]);
  const [connected, setConnected] = useState(true);
  const nextIdRef = useRef(8);
  // Track locally checked items so they survive poll refreshes
  const checkedItemsRef = useRef<Set<string>>(new Set());
  // Orders recalled to prep locally; ignore stale server stage for a few seconds
  const recallProtectRef = useRef<Map<number, number>>(new Map());

  // Load settings, product config, and persisted checks from API on mount
  useEffect(() => {
    fetch('/api/kds/settings')
      .then(r => r.json())
      .then(data => {
        if (data.locationId) setSettings(data);
        // If no POS config, load mock data
        if (!data.posConfigId) setOrders(createSeedOrders());
      })
      .catch(() => { setOrders(createSeedOrders()); });

    fetch('/api/kds/product-config')
      .then(r => r.json())
      .then(data => {
        if (data.config) setProductConfig(data.config);
      })
      .catch(() => {});

    // Hydrate previously-checked items so a tablet reboot mid-shift doesn't
    // lose the cook's progress on the current ticket.
    fetch('/api/kds/order-checks')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.checks)) {
          for (const c of data.checks) {
            checkedItemsRef.current.add(`${c.order_id}:${c.item_id}`);
          }
          setOrders(prev => prev.map(o => ({
            ...o,
            items: o.items.map(i => ({
              ...i,
              done: checkedItemsRef.current.has(`${o.id}:${i.id}`),
            })),
          })));
        }
      })
      .catch(() => {});
  }, []);

  // Poll Odoo for orders when posConfigId is set
  useEffect(() => {
    if (!settings.posConfigId) return;

    let active = true;

    async function poll() {
      try {
        const res = await fetch(`/api/kds/orders?configId=${settings.posConfigId}`);
        const data = await res.json();
        if (active) setConnected(true); // reached the server
        if (!active || !data.orders) return;

        const odooOrders: KdsOrder[] = data.orders.map((o: KdsOrder) => ({
          ...o,
          items: o.items.map(item => ({
            ...item,
            done: checkedItemsRef.current.has(`${o.id}:${item.id}`),
          })),
        }));

        setOrders(prev => {
          // Server status (from kds_completed_orders) is authoritative, with two
          // client-side overlays:
          //  1. Optimistic local moves ahead of the server (ready/done tapped but
          //     the persist call has not landed in a poll response yet).
          //  2. Recall protection: an order recalled to prep stays prep for a few
          //     seconds even if a stale poll still reports it as ready/done.
          const RANK: Record<string, number> = { prep: 0, ready: 1, done: 2 };
          const prevById = new Map(prev.map(o => [o.id, o]));
          const now = Date.now();
          recallProtectRef.current.forEach((ts, id) => {
            if (now - ts > 15000) recallProtectRef.current.delete(id);
          });
          return odooOrders.map(o => {
            if (recallProtectRef.current.has(o.id)) {
              return { ...o, status: 'prep' as const, readyAt: null, doneAt: null };
            }
            const local = prevById.get(o.id);
            if (local && (RANK[local.status] ?? 0) > (RANK[o.status] ?? 0)) {
              return { ...o, status: local.status, readyAt: local.readyAt, doneAt: local.doneAt };
            }
            return o;
          });
        });
      } catch (err) {
        console.error('[KDS] poll error:', err);
        if (active) setConnected(false); // server unreachable — internet/down
      }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [settings.posConfigId]);

  // Immediate offline feedback from the device's own network status.
  useEffect(() => {
    const onOffline = () => setConnected(false);
    window.addEventListener('offline', onOffline);
    return () => window.removeEventListener('offline', onOffline);
  }, []);

  // Mock: simulate new orders in dev when no POS config
  useEffect(() => {
    if (settings.posConfigId) return;
    if (process.env.NODE_ENV !== 'development') return;
    const interval = setInterval(() => {
      const newOrder = generateRandomOrder(nextIdRef.current++);
      setOrders(prev => [...prev, newOrder]);
    }, 25000);
    return () => clearInterval(interval);
  }, [settings.posConfigId]);

  // Mock: increment wait times when using mock data
  useEffect(() => {
    if (settings.posConfigId) return;
    const interval = setInterval(() => {
      setOrders(prev => prev.map(o => ({ ...o, waitMin: o.waitMin + 1 })));
    }, 30000);
    return () => clearInterval(interval);
  }, [settings.posConfigId]);

  const fireRound = useCallback(() => {
    setOrders(prev => {
      const prepIds = prev.filter(o => o.status === 'prep').map(o => o.id);
      if (prepIds.length === 0) return prev;
      setFiredOrderIds(prepIds);
      setRoundState('active');
      return prev;
    });
  }, []);

  const nextRound = useCallback(() => {
    setRoundState('idle');
    setFiredOrderIds([]);
  }, []);

  const toggleItem = useCallback((itemId: string, ticketId: number) => {
    let newDone = false;
    setOrders(prev => prev.map(o => {
      if (o.id !== ticketId) return o;
      return { ...o, items: o.items.map(i => {
        if (i.id !== itemId) return i;
        newDone = !i.done;
        const key = `${ticketId}:${itemId}`;
        if (newDone) checkedItemsRef.current.add(key);
        else checkedItemsRef.current.delete(key);
        return { ...i, done: newDone };
      })};
    }));
    fetch('/api/kds/order-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: ticketId, itemId, checked: newDone }),
    }).catch(err => console.error('[KDS] persist check error:', err));
  }, []);

  const markReady = useCallback((ticketId: number) => {
    setOrders(prev => prev.map(o =>
      o.id === ticketId ? { ...o, status: 'ready' as const, readyAt: Date.now() } : o
    ));
    setFiredOrderIds(prev => prev.filter(id => id !== ticketId));
    // Clear checked items for this order
    checkedItemsRef.current.forEach(key => {
      if (key.startsWith(`${ticketId}:`)) checkedItemsRef.current.delete(key);
    });
    fetch('/api/kds/order-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearOrder: ticketId }),
    }).catch(() => {});
    // Persist the ready stage in the portal DB (never written to Odoo)
    if (settings.posConfigId) {
      fetch('/api/kds/orders/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: ticketId, stage: 'ready' }),
      }).catch(err => console.error('[KDS] persist ready error:', err));
    }
  }, [settings.posConfigId]);

  const pickup = useCallback((ticketId: number) => {
    setOrders(prev => prev.map(o =>
      o.id === ticketId ? { ...o, status: 'done' as const, doneAt: Date.now() } : o
    ));
    if (settings.posConfigId) {
      fetch('/api/kds/orders/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: ticketId, stage: 'done' }),
      }).catch(err => console.error('[KDS] persist done error:', err));
    }
  }, [settings.posConfigId]);

  const recall = useCallback((ticketId: number) => {
    recallProtectRef.current.set(ticketId, Date.now());
    setOrders(prev => prev.map(o => {
      if (o.id !== ticketId) return o;
      return {
        ...o,
        status: 'prep' as const,
        readyAt: null,
        doneAt: null,
        items: o.items.map(i => ({ ...i, done: false })),
      };
    }));
    checkedItemsRef.current.forEach(key => {
      if (key.startsWith(`${ticketId}:`)) checkedItemsRef.current.delete(key);
    });
    fetch('/api/kds/order-checks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearOrder: ticketId }),
    }).catch(() => {});
    if (settings.posConfigId) {
      fetch('/api/kds/orders/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: ticketId, stage: 'clear' }),
      }).catch(() => {});
    }
    setCurrentTab('prep');
  }, [settings.posConfigId]);

  const setTab = useCallback((tab: KdsTab) => setCurrentTab(tab), []);
  const toggleMute = useCallback(() => setMuted(prev => !prev), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const updateSettings = useCallback((s: KdsSettings) => {
    setSettings(s);
    fetch('/api/kds/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    }).catch(() => {});
  }, []);
  const addOrder = useCallback((order: KdsOrder) => {
    setOrders(prev => [...prev, order]);
  }, []);
  const setMode = useCallback((m: KdsMode) => setModeState(m), []);

  // Auto-advance: once every fired order has been marked Ready (none of the
  // round's orders are still in prep), end the round automatically instead of
  // making the cook tap "Start next orders".
  useEffect(() => {
    if (roundState !== 'active') return;
    const stillCooking = orders.some(o => firedOrderIds.includes(o.id) && o.status === 'prep');
    if (!stillCooking) nextRound();
  }, [roundState, firedOrderIds, orders, nextRound]);

  const value: KdsContextType = {
    orders, roundState, firedOrderIds, currentTab, mode, settings, muted, settingsOpen,
    nextId: nextIdRef.current, productConfig, connected,
    fireRound, nextRound, toggleItem, markReady, pickup, recall,
    setTab, toggleMute, openSettings, closeSettings, updateSettings, addOrder, setMode,
  };

  return <KdsContext.Provider value={value}>{children}</KdsContext.Provider>;
}
