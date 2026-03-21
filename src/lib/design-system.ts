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
 *   - See DESIGN_GUIDE.md for full visual rules.
 *
 * COLOR PHILOSOPHY:
 *   Color MUST carry meaning. If it doesn't, use gray.
 *   Only 5 semantic colors + brand green + gray.
 *   No purple. No random pastels. No decorative colors.
 */

'use client';

// ─────────────────────────────────────────────
// COLOURS — semantic only
// ─────────────────────────────────────────────
export const colors = {
  // Brand — Krawings forest green (primary accent)
  brand:       '#16A34A',
  brandDark:   '#15803D',
  brandLight:  '#F0FDF4',
  brandBorder: '#BBF7D0',

  // Neutrals
  text1:   '#1F2933',  // primary text, headings
  text2:   '#374151',  // body text
  text3:   '#6B7280',  // secondary text, icons default
  text4:   '#9CA3AF',  // placeholder, disabled
  text5:   '#D1D5DB',  // hint, tertiary
  border:  '#E5E7EB',  // borders
  surface: '#F3F4F6',  // input backgrounds, neutral badges
  pageBg:  '#F6F7F9',  // page background
  white:   '#FFFFFF',  // card background

  // Dark mode surfaces
  dark950: '#030712',
  dark900: '#111827',
  dark800: '#1F2937',
  dark700: '#374151',

  // Header
  headerBg: '#1A1F2E',
  headerGlow: 'rgba(22,163,74,0.08)',  // reduced from 0.15

  // Semantic — the ONLY allowed status colors
  error:        '#DC2626',   // overdue, damage, rejected
  errorBg:      '#FEE2E2',
  errorText:    '#991B1B',

  warning:      '#F59E0B',   // due soon, pending approval
  warningBg:    '#FEF3C7',
  warningText:  '#92400E',

  info:         '#2563EB',   // informational, counts, active
  infoBg:       '#DBEAFE',
  infoText:     '#1E3A8A',

  success:      '#16A34A',   // done, confirmed, received
  successBg:    '#DCFCE7',
  successText:  '#166534',

  // Tile / icon defaults
  tileBg:       '#F1F3F5',   // ALL tiles same bg
  iconDefault:  '#6B7280',   // default icon color
  iconActive:   '#2563EB',   // active/info icon
} as const;

// ─────────────────────────────────────────────
// TAILWIND CLASS STRINGS
// ─────────────────────────────────────────────
export const ds = {

  // ── Page layout ──
  page:       'min-h-screen bg-[#F6F7F9] text-gray-900 dark:bg-gray-950 dark:text-white',
  pageInner:  'max-w-lg mx-auto flex flex-col min-h-screen',
  scrollArea: 'flex-1 overflow-y-auto pb-20',

  // ── Top bar ──
  topbar:      'bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-4 h-14 flex items-center justify-between sticky top-0 z-50',
  topbarTitle: 'text-base font-bold text-[#1F2933] dark:text-white',
  topbarSub:   'text-[11px] text-gray-500',

  // ── Bottom nav ──
  bottomNav:      'fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex max-w-lg mx-auto h-16',
  navBtn:         'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 transition-colors active:opacity-70',
  navBtnActive:   'flex-1 flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold text-green-600 transition-colors',

  // ── Cards (with subtle shadow) ──
  card:        'bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)]',
  cardBody:    'p-4',
  cardHeader:  'px-4 pt-4 pb-2 border-b border-gray-100 dark:border-gray-800',
  cardHover:   'bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] active:bg-gray-50 dark:active:bg-gray-800 cursor-pointer transition-colors',

  // ── Section header ──
  sectionLabel: 'text-[11px] font-semibold tracking-wider uppercase text-gray-400 dark:text-gray-500',

  // ── List rows ──
  listRow:   'flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-gray-800 last:border-0 active:bg-gray-50 dark:active:bg-gray-800 cursor-pointer',
  listTitle: 'text-[13px] font-semibold text-[#1F2933] dark:text-white',
  listSub:   'text-[11px] text-gray-500 mt-0.5',

  // ── Stat boxes ──
  statBox:   'flex-1 text-center py-3',
  statVal:   'text-xl font-bold',
  statLabel: 'text-[11px] font-semibold tracking-wider uppercase text-gray-400 mt-0.5',

  // ── Filter / tab pills ──
  filterBar:         'flex gap-2 overflow-x-auto px-4 py-2.5 scrollbar-hide',
  filterTabActive:   'px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap bg-green-600 text-white shadow-sm',
  filterTabInactive: 'px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap border bg-white border-gray-200 text-gray-500 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-400',

  // ── Buttons ──
  btnPrimary:   'w-full bg-green-600 hover:bg-green-700 active:bg-orange-700 text-white font-semibold rounded-xl py-3.5 text-[14px] transition-colors shadow-lg shadow-green-600/30',
  btnSecondary: 'w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-semibold rounded-xl py-3.5 text-[14px] active:bg-gray-50',
  btnGhost:     'text-[13px] font-semibold text-green-700 active:opacity-70',
  btnBack:      'flex items-center gap-1 text-[13px] font-semibold text-green-700 active:opacity-70',
  btnDanger:    'w-full bg-red-50 border border-red-100 text-red-700 font-semibold rounded-xl py-3.5 text-[14px] active:bg-red-100',
  btnIcon:      'w-9 h-9 flex items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 active:bg-gray-200',

  // ── Input / Form ──
  input:     'w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-[14px] text-gray-900 dark:text-white placeholder-gray-400 outline-none focus:border-green-600 focus:ring-2 focus:ring-green-100 transition-colors',
  label:     'block text-[11px] font-semibold tracking-wide uppercase text-gray-500 mb-1.5',
  fieldRow:  'mb-4',

  // ── Numpad drawer ──
  numpadDrawer:  'fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-2xl border-t border-gray-200 dark:border-gray-800 shadow-2xl max-w-lg mx-auto',
  numpadKey:     'flex items-center justify-center h-14 rounded-xl bg-gray-100 dark:bg-gray-800 text-xl font-semibold text-gray-900 dark:text-white active:bg-gray-200 dark:active:bg-gray-700 transition-colors select-none',
  numpadKeySpec: 'flex items-center justify-center h-14 rounded-xl bg-gray-200 dark:bg-gray-700 text-[13px] font-semibold text-gray-600 dark:text-gray-300 active:bg-gray-300 select-none',

  // ── Empty state ──
  emptyState: 'flex flex-col items-center justify-center py-16 text-center px-6',
  emptyIcon:  'text-4xl mb-3',
  emptyTitle: 'text-[15px] font-semibold text-[#1F2933] dark:text-white mb-1',
  emptyBody:  'text-[13px] text-gray-500 max-w-[220px] leading-relaxed',

  // ── Divider ──
  divider: 'border-t border-gray-100 dark:border-gray-800',

  // ── Loading skeleton ──
  skeleton: 'animate-pulse bg-gray-200 dark:bg-gray-800 rounded-lg',

  // ── Status dot (8px circle) ──
  dotOverdue: 'w-2 h-2 rounded-full bg-red-500 flex-shrink-0',
  dotWarning: 'w-2 h-2 rounded-full bg-amber-500 flex-shrink-0',
  dotInfo:    'w-2 h-2 rounded-full bg-blue-500 flex-shrink-0',
  dotSuccess: 'w-2 h-2 rounded-full bg-green-500 flex-shrink-0',

} as const;

// ─────────────────────────────────────────────
// BADGE SYSTEM — one structure, color changes only
// All badges: px-2 py-0.5 rounded-md text-[10px] font-bold
// ─────────────────────────────────────────────
const badges = {
  // Overdue / error states
  overdue:     { bg: '#FEE2E2', text: '#991B1B', label: 'Overdue' },
  cancel:      { bg: '#FEE2E2', text: '#991B1B', label: 'Cancelled' },
  refuse:      { bg: '#FEE2E2', text: '#991B1B', label: 'Refused' },
  issue:       { bg: '#FEE2E2', text: '#991B1B', label: 'Issue' },
  rejected:    { bg: '#FEE2E2', text: '#991B1B', label: 'Rejected' },

  // Warning / pending states
  due_soon:    { bg: '#FEF3C7', text: '#92400E', label: 'Due soon' },
  pending:     { bg: '#F0FDF4', text: '#C2410C', label: 'Pending' },
  approval:    { bg: '#FEF3C7', text: '#92400E', label: 'Approval' },
  progress:    { bg: '#FEF3C7', text: '#92400E', label: 'In progress' },
  to_close:    { bg: '#FEF3C7', text: '#92400E', label: 'To close' },
  waiting:     { bg: '#FEF3C7', text: '#92400E', label: 'Waiting' },

  // Info / active states
  confirmed:   { bg: '#DBEAFE', text: '#1E3A8A', label: 'Confirmed' },
  sent:        { bg: '#DBEAFE', text: '#1E3A8A', label: 'Sent' },
  info:        { bg: '#DBEAFE', text: '#1E3A8A', label: 'Info' },
  ready:       { bg: '#DBEAFE', text: '#1E3A8A', label: 'Ready' },
  assigned:    { bg: '#DBEAFE', text: '#1E3A8A', label: 'Available' },
  published:   { bg: '#DBEAFE', text: '#1E3A8A', label: 'Published' },
  staff:       { bg: '#DBEAFE', text: '#1E3A8A', label: 'Staff' },

  // Success states
  done:        { bg: '#DCFCE7', text: '#166534', label: 'Done' },
  delivered:   { bg: '#DCFCE7', text: '#166534', label: 'Delivered' },
  validate:    { bg: '#DCFCE7', text: '#166534', label: 'Approved' },
  active:      { bg: '#DCFCE7', text: '#166534', label: 'Active' },
  received:    { bg: '#DCFCE7', text: '#166534', label: 'Received' },

  // Neutral states
  draft:       { bg: '#F3F4F6', text: '#374151', label: 'Draft' },
  neutral:     { bg: '#F3F4F6', text: '#374151', label: '' },
  draft_plan:  { bg: '#F3F4F6', text: '#374151', label: 'Draft' },

  // Role badges
  manager:     { bg: '#F0FDF4', text: '#C2410C', label: 'Manager' },
  admin:       { bg: '#FEE2E2', text: '#991B1B', label: 'Admin' },
} as const;

export type StateKey = keyof typeof badges;

/**
 * Get badge inline styles. Returns { backgroundColor, color }.
 * Use in: <span style={getBadgeStyle('overdue')}>Overdue</span>
 */
export function getBadgeStyle(state: string): { backgroundColor: string; color: string } {
  const b = (badges as any)[state];
  if (!b) return { backgroundColor: '#F3F4F6', color: '#374151' };
  return { backgroundColor: b.bg, color: b.text };
}

/**
 * Get badge Tailwind className (for backwards compat).
 * Prefer getBadgeStyle() for new code.
 */
export function getBadgeClass(state: string): string {
  const b = (badges as any)[state];
  if (!b) return 'bg-gray-100 text-gray-700';
  // Map hex to closest Tailwind classes
  if (b.bg === '#FEE2E2') return 'bg-red-100 text-red-800';
  if (b.bg === '#FEF3C7') return 'bg-amber-100 text-amber-800';
  if (b.bg === '#DBEAFE') return 'bg-blue-100 text-blue-800';
  if (b.bg === '#DCFCE7') return 'bg-green-100 text-green-800';
  if (b.bg === '#F0FDF4') return 'bg-green-50 text-orange-800';
  return 'bg-gray-100 text-gray-700';
}

export function getBadgeLabel(state: string): string {
  return (badges as any)[state]?.label ?? state;
}

// ─────────────────────────────────────────────
// MODULE IDENTITY
// All tiles use SAME gray background.
// Icon color is blue by default. Only badge carries meaning.
// ─────────────────────────────────────────────
export const moduleIdentity = {
  manufacturing: { label: 'Manufacturing', icon: '⚙️',  tileColor: '#F1F3F5', iconColor: '#2563EB' },
  inventory:     { label: 'Inventory',     icon: '📦',  tileColor: '#F1F3F5', iconColor: '#2563EB' },
  purchase:      { label: 'Purchase',      icon: '🛒',  tileColor: '#F1F3F5', iconColor: '#2563EB' },
  shifts:        { label: 'Shifts',        icon: '📅',  tileColor: '#F1F3F5', iconColor: '#2563EB' },
  tasks:         { label: 'Tasks',         icon: '✅',  tileColor: '#F1F3F5', iconColor: '#2563EB' },
  hr:            { label: 'Staff',         icon: '👤',  tileColor: '#F1F3F5', iconColor: '#2563EB' },
  reports:       { label: 'Reports',       icon: '📊',  tileColor: '#F1F3F5', iconColor: '#2563EB' },
  settings:      { label: 'Settings',      icon: '⚙',   tileColor: '#F1F3F5', iconColor: '#6B7280' },
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
