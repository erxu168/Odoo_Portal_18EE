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
  const nextIdRef = useRef(8);
  // Track locally checked items so they survive poll refreshes
  const checkedItemsRef = useRef<Set<string>>(new Set());

  // Load settings and product config from API on mount
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
  }, []);

  // Poll Odoo for orders when posConfigId is set
  useEffect(() => {
    if (!settings.posConfigId) return;

    let active = true;

    async function poll() {
      try {
        const res = await fetch(`/api/kds/orders?configId=${settings.posConfigId}`);
        const data = await res.json();
        if (!active || !data.orders) return;

        const odooOrders: KdsOrder[] = data.orders.map((o: KdsOrder) => ({
          ...o,
          items: o.items.map(item => ({
            ...item,
            done: checkedItemsRef.current.has(`${o.id}:${item.id}`),
          })),
        }));

        setOrders(prev => {
          // Keep orders locally moved to ready/done (Odoo no longer returns them as paid)
          const odooIds = new Set(odooOrders.map(o => o.id));
          const localReadyDone = prev.filter(o =>
            (o.status === 'ready' || o.status === 'done') && !odooIds.has(o.id)
          );
          // Keep orders the cook already moved to ready/done locally (don't overwrite with prep)
          const localMovedIds = new Set(
            prev.filter(o => o.status === 'ready' || o.status === 'done').map(o => o.id)
          );
          const newPrep = odooOrders.filter(o => !localMovedIds.has(o.id));
          return [...newPrep, ...localReadyDone];
        });
      } catch (err) {
        console.error('[KDS] poll error:', err);
      }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [settings.posConfigId]);

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
    setOrders(prev => prev.map(o => {
      if (o.id !== ticketId) return o;
      return { ...o, items: o.items.map(i => {
        if (i.id !== itemId) return i;
        const newDone = !i.done;
        const key = `${ticketId}:${itemId}`;
        if (newDone) checkedItemsRef.current.add(key);
        else checkedItemsRef.current.delete(key);
        return { ...i, done: newDone };
      })};
    }));
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
    // Notify Odoo (fire and forget)
    if (settings.posConfigId) {
      fetch('/api/kds/orders/done', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: ticketId }),
      }).catch(err => console.error('[KDS] mark done error:', err));
    }
  }, [settings.posConfigId]);

  const pickup = useCallback((ticketId: number) => {
    setOrders(prev => prev.map(o =>
      o.id === ticketId ? { ...o, status: 'done' as const, doneAt: Date.now() } : o
    ));
  }, []);

  const recall = useCallback((ticketId: number) => {
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
    setCurrentTab('prep');
  }, []);

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

  const value: KdsContextType = {
    orders, roundState, firedOrderIds, currentTab, mode, settings, muted, settingsOpen,
    nextId: nextIdRef.current, productConfig,
    fireRound, nextRound, toggleItem, markReady, pickup, recall,
    setTab, toggleMute, openSettings, closeSettings, updateSettings, addOrder, setMode,
  };

  return <KdsContext.Provider value={value}>{children}</KdsContext.Provider>;
}
