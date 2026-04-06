'use client';

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import type { KdsOrder, KdsTab, RoundState, KdsSettings, KdsMode } from '@/types/kds';
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
  const [orders, setOrders] = useState<KdsOrder[]>(() => createSeedOrders());
  const [roundState, setRoundState] = useState<RoundState>('idle');
  const [firedOrderIds, setFiredOrderIds] = useState<number[]>([]);
  const [currentTab, setCurrentTab] = useState<KdsTab>('prep');
  const [mode, setModeState] = useState<KdsMode>('smart');
  const [settings, setSettings] = useState<KdsSettings>(DEFAULT_SETTINGS);
  const [muted, setMuted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const nextIdRef = useRef(8);

  // Load settings from API on mount
  useEffect(() => {
    fetch('/api/kds/settings')
      .then(r => r.json())
      .then(data => { if (data.locationId) setSettings(data); })
      .catch(() => {});
  }, []);

  // Simulate new orders every 25s in development
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const interval = setInterval(() => {
      const newOrder = generateRandomOrder(nextIdRef.current++);
      setOrders(prev => [...prev, newOrder]);
    }, 25000);
    return () => clearInterval(interval);
  }, []);

  // Increment wait times every 30s (simulates real time passing)
  useEffect(() => {
    const interval = setInterval(() => {
      setOrders(prev => prev.map(o => ({ ...o, waitMin: o.waitMin + 1 })));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

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
      return { ...o, items: o.items.map(i => i.id === itemId ? { ...i, done: !i.done } : i) };
    }));
  }, []);

  const markReady = useCallback((ticketId: number) => {
    setOrders(prev => prev.map(o =>
      o.id === ticketId ? { ...o, status: 'ready' as const, readyAt: Date.now() } : o
    ));
    setFiredOrderIds(prev => prev.filter(id => id !== ticketId));
  }, []);

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
    nextId: nextIdRef.current,
    fireRound, nextRound, toggleItem, markReady, pickup, recall,
    setTab, toggleMute, openSettings, closeSettings, updateSettings, addOrder, setMode,
  };

  return <KdsContext.Provider value={value}>{children}</KdsContext.Provider>;
}
