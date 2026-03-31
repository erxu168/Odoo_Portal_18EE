---
name: Portal Design System
description: Krawings portal design system — use Recipe Dashboard style as the canonical design language for all modules
type: feedback
---

Use the **Recipe Dashboard / Chef Guide** design system as the canonical design language across all portal modules. Do NOT use the old Dashboard blue-icon style.

**Why:** The user explicitly stated the cooking guide design should be the leading design system. The old dashboard used uniform blue icons on gray backgrounds which looked inconsistent with the rest of the portal.

**How to apply:**

## Canonical Design System (Recipe Dashboard Style)

### Colors
- Page background: `bg-gray-50` (NOT `bg-[#F6F7F9]`)
- Header: `bg-[#2563EB]` (blue-600, bright modern) with `rounded-b-[28px]` — ALL modules must have rounded bottom corners
- Brand accent: `text-green-600` / `bg-green-600` (#16a34a)
- Text primary: `text-gray-900`
- Text secondary: `text-gray-500`
- Text tertiary: `text-gray-400`

### Tile/Card Grid
- Each tile gets its **own semantic color** (NOT uniform blue):
  - `bg-orange-50 border-orange-200` / `iconBg: bg-orange-100`
  - `bg-purple-50 border-purple-200` / `iconBg: bg-purple-100`
  - `bg-red-50 border-red-200` / `iconBg: bg-red-100`
  - `bg-blue-50 border-blue-200` / `iconBg: bg-blue-100`
  - `bg-amber-50 border-amber-200` / `iconBg: bg-amber-100`
  - `bg-teal-50 border-teal-200` / `iconBg: bg-teal-100`
  - `bg-green-50 border-green-200` / `iconBg: bg-green-100`
- Tile shape: `rounded-2xl` rectangular with `p-4`, label + subtitle
- Icon container: `w-11 h-11 rounded-xl` with colored bg, emoji or SVG icon
- Active: `active:scale-[0.97] transition-transform`
- Shadow: `shadow-sm`

### Grid Layout
- 2 columns for dashboard tiles: `grid grid-cols-2 gap-3`
- 3 columns for smaller items (thumbnails): `grid grid-cols-3 gap-2.5`

### Section Headers
- `text-[11px] font-semibold text-gray-400 tracking-widest uppercase mb-3`

### Buttons
- Primary: `bg-green-600 text-white rounded-xl active:opacity-85`
- Secondary: `bg-white border border-gray-200 text-gray-900 rounded-xl`
- Fixed bottom bars: `bottom-16` (clear AppTabBar), `pb-40` for scroll containers

### Cards
- `bg-white rounded-xl border border-gray-200 p-4`
- Elevated: add `shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)]`

### Icons
- ALL icons use **Lucide-style SVG stroke icons** — no emojis, no icon fonts
- Standard: `width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"`
- Small (badges): `width="14" height="14"` same viewBox/strokeWidth
- Inline (16px): `width="16" height="16"` same viewBox/strokeWidth

### Kitchen Dark Mode (CookMode / ActiveRecording)
Optimized for visibility in busy restaurant kitchen — high contrast, WCAG compliant:
- Background: `bg-[#1C1C1E]` (dark zinc, not pure black — reduces OLED smearing)
- Primary text: `text-white` (17:1 contrast)
- Secondary text: `text-zinc-400` (5.5:1 — NOT `text-white/30`)
- Card surfaces: `bg-zinc-800` (NOT `bg-white/8`)
- Borders: `border-zinc-700` (NOT `border-white/10`)
- Interactive: `bg-zinc-700` hover, `bg-zinc-600` active
- Ingredients: `text-green-400` quantities, `text-zinc-200` names
- Tips: `bg-amber-900/40 border-amber-700/50 text-amber-200`
- Timer ring bg: `stroke="rgba(255,255,255,0.15)"`
- Step type badges: `bg-blue-500/25 text-blue-300`, `bg-orange-500/25 text-orange-300`, `bg-emerald-500/25 text-emerald-300`
- Do NOT use any opacity below /25 for backgrounds or /40 for text

### What NOT to do
- ❌ `bg-[#F1F3F5] text-blue-600` uniform icon circles
- ❌ `aspect-square` square tiles for dashboard
- ❌ `bg-[#F6F7F9]` page background
- ❌ `text-[#1F2933]` custom text color (use `text-gray-900`)
- ❌ Emoji icons for tiles/cards/badges — always use Lucide SVGs
- ❌ `white/30`, `white/8`, `white/10` in kitchen dark mode — too low contrast
