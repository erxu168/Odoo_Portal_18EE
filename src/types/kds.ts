// =============================================================================
// KDS (Kitchen Display System) Types
// Live Odoo POS integration. Product station/prep config loaded from DB.
// =============================================================================

// -- Source stations --

export type SourceStation = 'grill' | 'drawer' | 'pot' | 'fryer' | 'cold';

export interface SourceInfo {
  source: SourceStation;
  label: string;
  color: string;
  bg: string;
}

export const STATION_META: Record<SourceStation, Omit<SourceInfo, 'source'>> = {
  grill:  { label: 'GRILL',  color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  drawer: { label: 'DRAWER', color: '#f97316', bg: 'rgba(249,115,22,0.12)' },
  fryer:  { label: 'FRY',    color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  pot:    { label: 'POT',    color: '#eab308', bg: 'rgba(234,179,8,0.12)' },
  cold:   { label: 'COLD',   color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
};

/**
 * Look up source-station metadata for a dish by name.
 * Source of truth: the productConfig synced from Odoo POS.
 */
export function lookupSource(name: string, productConfig: ProductConfig[]): SourceInfo | null {
  const pc = productConfig.find(p => p.productName === name);
  if (!pc) return null;
  const station = pc.sourceStation;
  const meta = STATION_META[station];
  if (!meta) return null;
  return { source: station, ...meta };
}

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
  autoScrollSec: number; // 0 = disabled, otherwise seconds of inactivity before auto-scroll
  posConfigId: number;   // Odoo pos.config ID (0 = use mock data)
  taskDepartmentIds: number[]; // hr.department IDs whose tasks show on this screen (empty = all)
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
  autoScrollSec: 10,
  posConfigId: 0,
  taskDepartmentIds: [],
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

// -- Fire plan types --

export type PrepType = 'ondemand' | 'batch' | 'advance';

export interface ProductConfig {
  odooProductId: number | null;
  productName: string;
  sourceStation: SourceStation;
  prepType: PrepType;
}

export interface FireTask {
  name: string;
  totalQty: number;
  doneQty: number;
  tables: string[];
  entries: TaskEntry[];
  sourceStation: SourceStation;
  prepType: PrepType;
}

export interface FireLane {
  prepType: PrepType;
  label: string;
  emoji: string;
  tasks: FireTask[];
}

export const PREP_TYPE_ORDER: PrepType[] = ['ondemand', 'batch', 'advance'];

export const PREP_TYPE_META: Record<PrepType, { label: string; emoji: string; description: string }> = {
  ondemand: { label: 'START NOW', emoji: '\u{1F534}', description: 'Cook fresh \u2014 bottleneck' },
  batch:    { label: 'BATCH',     emoji: '\u{1F7E1}', description: 'Cook together in groups' },
  advance:  { label: 'PLATE',     emoji: '\u{1F7E2}', description: 'Already prepped \u2014 just plate' },
};

// -- Constants --

export const KDS_LOCATION_ID = 99;
