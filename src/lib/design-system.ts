/**
 * Krawings Portal — Design System
 * Single source of truth for all PWA modules.
 *
 * USAGE:
 *   import { ds, colors, getBadge } from '@/lib/design-system';
 *   <div className={ds.card}>...</div>
 *   <span style={{ color: colors.brand }}>...</span>
 *
 * RULES:
 *   - Never hardcode colours or sizes in components — always import from here.
 *   - When the design changes, change it here once.
 *   - All new modules must use these tokens from day one.
 */

'use client';

// ─────────────────────────────────────────────
// COLOURS (use in inline styles or CSS vars)
// ─────────────────────────────────────────────
export const colors = {
  // Brand — Krawings orange
  brand:       '#F5800A',
  brandDark:   '#E86000',
  brandLight:  '#FFF4E6',
  brandBorder: '#FDBA74',  // orange-300 equivalent

  // Neutrals
  n7:    '#111827',  // gray-900 — headings, primary text
  n6:    '#374151',  // gray-700 — body text
  n5:    '#6B7280',  // gray-500 — secondary text
  n4:    '#9CA3AF',  // gray-400 — placeholder, disabled
  n3:    '#E5E7EB',  // gray-200 — borders
  n2:    '#F3F4F6',  // gray-100 — input backgrounds
  n1:    '#F9FAFB',  // gray-50  — page background
  white: '#FFFFFF',

  // Dark mode surfaces
  dark950: '#030712',
  dark900: '#111827',
  dark800: '#1F2937',
  dark700: '#374151',

  // Semantic
  success:      '#16A34A',
  successLight: '#F0FDF4',
  warning:      '#D97706',
  warningLight: '#FFFBEB',
  error:        '#DC2626',
  errorLight:   '#FEF2F2',
  info:         '#2563EB',
  infoLight:    '#EFF6FF',
} as const;

// ─────────────────────────────────────────────
// TAILWIND CLASS STRINGS
// Reference these in JSX className props.
// ─────────────────────────────────────────────
export const ds = {

  // ── Page layout ──
  page:       'min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white',
  pageInner:  'max-w-lg mx-auto flex flex-col min-h-screen',
  scrollArea: 'flex-1 overflow-y-auto pb-20',

  // ── Top bar ──
  topbar:      'bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 h-14 flex items-center justify-between sticky top-0 z-50',
  topbarTitle: 'text-base font-bold text-gray-900 dark:text-white',
  topbarSub:   'text-[11px] text-gray-500',

  // ── Bottom nav ──
  bottomNav:      'fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex max-w-lg mx-auto h-16',
  navBtn:         'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 transition-colors active:opacity-70',
  navBtnActive:   'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-krawings-600 transition-colors',

  // ── Cards ──
  card:        'bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800',
  cardBody:    'p-4',
  cardHeader:  'px-4 pt-4 pb-2 border-b border-gray-100 dark:border-gray-800',
  cardHover:   'bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 active:bg-gray-50 dark:active:bg-gray-800 cursor-pointer transition-colors',

  // ── Section header ──
  sectionLabel: 'text-[11px] font-semibold tracking-wider uppercase text-gray-400 dark:text-gray-500',

  // ── List rows ──
  listRow:   'flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0 active:bg-gray-50 dark:active:bg-gray-800 cursor-pointer',
  listTitle: 'text-[13px] font-semibold text-gray-900 dark:text-white',
  listSub:   'text-[11px] text-gray-500 mt-0.5',

  // ── Stat boxes (summary row) ──
  statBox:   'flex-1 text-center py-3',
  statVal:   'text-xl font-bold',
  statLabel: 'text-[11px] font-semibold tracking-wider uppercase text-gray-400 mt-0.5',

  // ── Filter / tab pills ──
  filterBar:         'flex gap-2 overflow-x-auto px-4 py-2.5 scrollbar-hide',
  filterTabActive:   'px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap border bg-orange-50 border-orange-200 text-orange-700',
  filterTabInactive: 'px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap border bg-white border-gray-200 text-gray-500 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-400',

  // ── Buttons ──
  btnPrimary:   'w-full bg-krawings-500 hover:bg-krawings-600 active:bg-krawings-700 text-white font-semibold rounded-xl py-3.5 text-[14px] transition-colors',
  btnSecondary: 'w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-semibold rounded-xl py-3.5 text-[14px] active:bg-gray-50',
  btnGhost:     'text-[13px] font-semibold text-krawings-600 active:opacity-70',
  btnBack:      'flex items-center gap-1 text-[13px] font-semibold text-krawings-600 active:opacity-70',
  btnDanger:    'w-full bg-red-50 border border-red-100 text-red-700 font-semibold rounded-xl py-3.5 text-[14px] active:bg-red-100',
  btnIcon:      'w-9 h-9 flex items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 active:bg-gray-200',

  // ── Input / Form ──
  input:     'w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-[14px] text-gray-900 dark:text-white placeholder-gray-400 outline-none focus:border-krawings-500 focus:ring-2 focus:ring-orange-100 transition-colors',
  label:     'block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5',
  fieldRow:  'mb-4',

  // ── Numpad drawer ──
  numpadDrawer:  'fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-2xl border-t border-gray-200 dark:border-gray-800 shadow-2xl max-w-lg mx-auto',
  numpadKey:     'flex items-center justify-center h-14 rounded-xl bg-gray-100 dark:bg-gray-800 text-xl font-semibold text-gray-900 dark:text-white active:bg-gray-200 dark:active:bg-gray-700 transition-colors select-none',
  numpadKeySpec: 'flex items-center justify-center h-14 rounded-xl bg-gray-200 dark:bg-gray-700 text-[13px] font-semibold text-gray-600 dark:text-gray-300 active:bg-gray-300 select-none',

  // ── Empty state ──
  emptyState: 'flex flex-col items-center justify-center py-16 text-center px-6',
  emptyIcon:  'text-4xl mb-3',
  emptyTitle: 'text-[15px] font-semibold text-gray-900 dark:text-white mb-1',
  emptyBody:  'text-[13px] text-gray-500 max-w-[220px] leading-relaxed',

  // ── Divider ──
  divider: 'border-t border-gray-100 dark:border-gray-800',

  // ── Loading skeleton ──
  skeleton: 'animate-pulse bg-gray-200 dark:bg-gray-800 rounded-lg',

} as const;

// ─────────────────────────────────────────────
// STATE BADGE SYSTEM
// Covers MO, WO, component, leave, planning states.
// ─────────────────────────────────────────────
const badges = {
  // mrp.production
  draft:       { className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',           label: 'Draft' },
  confirmed:   { className: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',            label: 'Confirmed' },
  progress:    { className: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300',    label: 'In Progress' },
  to_close:    { className: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300',    label: 'To Close' },
  done:        { className: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',        label: 'Done' },
  cancel:      { className: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',                label: 'Cancelled' },
  // mrp.workorder extra
  pending:     { className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',           label: 'Waiting' },
  waiting:     { className: 'bg-yellow-50 text-yellow-600 dark:bg-yellow-950 dark:text-yellow-400',   label: 'Waiting Comps' },
  ready:       { className: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400',            label: 'Ready' },
  // stock.move
  assigned:             { className: 'bg-green-50 text-green-600',  label: 'Available' },
  partially_available:  { className: 'bg-yellow-50 text-yellow-600', label: 'Partial' },
  waiting_move:         { className: 'bg-gray-100 text-gray-500',    label: 'Waiting' },
  // hr.leave
  validate:    { className: 'bg-green-50 text-green-700',            label: 'Approved' },
  refuse:      { className: 'bg-red-50 text-red-600',                label: 'Refused' },
  validate1:   { className: 'bg-yellow-50 text-yellow-600',          label: 'Pending' },
  // planning.slot
  published:   { className: 'bg-blue-50 text-blue-700',              label: 'Published' },
  draft_plan:  { className: 'bg-gray-100 text-gray-500',             label: 'Draft' },
} as const;

export type StateKey = keyof typeof badges;

export function getBadgeClass(state: string): string {
  return (badges as any)[state]?.className ?? badges.draft.className;
}

export function getBadgeLabel(state: string): string {
  return (badges as any)[state]?.label ?? state;
}

// ─────────────────────────────────────────────
// MODULE IDENTITY
// Consistent colour + icon per module for tiles,
// navigation indicators, and breadcrumbs.
// ─────────────────────────────────────────────
export const moduleIdentity = {
  manufacturing: { label: 'Manufacturing', icon: '⚙️',  tileColor: '#EFF6FF', navColor: '#2563EB' },
  inventory:     { label: 'Inventory',     icon: '📦',  tileColor: '#FFFBEB', navColor: '#D97706' },
  purchase:      { label: 'Purchase',      icon: '🛒',  tileColor: '#F0FDF4', navColor: '#16A34A' },
  shifts:        { label: 'Shifts',        icon: '📅',  tileColor: '#FFF7ED', navColor: '#F5800A' },
  tasks:         { label: 'Tasks',         icon: '✅',  tileColor: '#F5F3FF', navColor: '#7C3AED' },
  hr:            { label: 'Staff Portal',  icon: '👤',  tileColor: '#FFF4E6', navColor: '#F5800A' },
  reports:       { label: 'Reports',       icon: '📊',  tileColor: '#FDF4FF', navColor: '#A21CAF' },
  settings:      { label: 'Settings',      icon: '⚙',   tileColor: '#F3F4F6', navColor: '#374151' },
} as const;

// ─────────────────────────────────────────────
// ICON SIZES
// ─────────────────────────────────────────────
export const iconSize = {
  xs:  'w-3.5 h-3.5',
  sm:  'w-4 h-4',
  md:  'w-5 h-5',
  lg:  'w-6 h-6',
  xl:  'w-8 h-8',
  nav: 'w-5 h-5',
} as const;
