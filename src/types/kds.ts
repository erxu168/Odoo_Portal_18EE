// =============================================================================
// KDS (Kitchen Display System) Types
// Phase 1: Mock data, no Odoo integration
// =============================================================================

// -- Source stations --

export type SourceStation = 'grill' | 'drawer' | 'pot' | 'fryer' | 'cold';

export interface SourceInfo {
  source: SourceStation;
  label: string;
  color: string;
  bg: string;
}

export const SOURCES: Record<string, SourceInfo> = {
  'Jerk Chicken':   { source: 'grill',  label: 'GRILL',  color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  'Jerk Pork':      { source: 'grill',  label: 'GRILL',  color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  'Fried Chicken':  { source: 'drawer', label: 'DRAWER', color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  'Festival':       { source: 'drawer', label: 'DRAWER', color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  'Plantain':       { source: 'fryer',  label: 'FRY',    color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  'Curry Goat':     { source: 'pot',    label: 'POT',    color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
  'Oxtail':         { source: 'pot',    label: 'POT',    color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
  'Rice & Peas':    { source: 'pot',    label: 'POT',    color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
  'Coleslaw':       { source: 'cold',   label: 'COLD',   color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  'Beef Patties':   { source: 'fryer',  label: 'FRY',    color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
};

// -- Order and item types --

export interface KdsItem {
  id: string;
  name: string;
  qty: number;
  note?: string;
  done: boolean;
}

export type OrderType = 'Dine-in' | 'Takeaway';
export type OrderStage = 'prep' | 'ready' | 'done';

export interface KdsOrder {
  id: number;
  table: string;
  type: OrderType;
  waitMin: number;
  status: OrderStage;
  readyAt: number | null;
  doneAt: number | null;
  items: KdsItem[];
}

// -- Settings --

export interface KdsSettings {
  locationId: number;
  takeawayBoost: number;
  dineWarn: number;
  dineUrg: number;
  taWarn: number;
  taUrg: number;
  passWarn: number;
  passCrit: number;
  sndNewOrder: boolean;
  sndNewOrderMode: 'always' | 'roundIdle';
  sndNewOrderVol: number;
  sndPass: boolean;
  sndPassMode: 'once' | 'repeat';
  sndPassVol: number;
  sndRound: boolean;
  sndRoundVol: number;
}

export const DEFAULT_SETTINGS: KdsSettings = {
  locationId: 99,
  takeawayBoost: 4,
  dineWarn: 5,
  dineUrg: 10,
  taWarn: 3,
  taUrg: 6,
  passWarn: 2,
  passCrit: 5,
  sndNewOrder: true,
  sndNewOrderMode: 'always',
  sndNewOrderVol: 0.7,
  sndPass: true,
  sndPassMode: 'repeat',
  sndPassVol: 0.8,
  sndRound: true,
  sndRoundVol: 0.6,
};

// -- UI state types --

export type KdsTab = 'prep' | 'pipeline' | 'ready' | 'done';
export type RoundState = 'idle' | 'active';
export type TimerTier = 'green' | 'orange' | 'red';
export type KdsMode = 'smart' | 'classic';

// -- Task grouping (production view) --

export interface TaskEntry {
  ticketId: number;
  itemId: string;
  qty: number;
  table: string;
  type: OrderType;
  note: string | null;
  done: boolean;
  waitMin: number;
  effectiveWait: number;
}

export interface TaskGroup {
  name: string;
  entries: TaskEntry[];
  totalQty: number;
  servedQty: number;
  remainQty: number;
  allDone: boolean;
  priority: number;
}

// -- Constants --

export const KDS_LOCATION_ID = 99; // Placeholder for Phase 1
export const KDS_COMPANY_ID = 5;   // What a Jerk
