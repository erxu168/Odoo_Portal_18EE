# Krawings Portal — Design Guide

> Single source of truth for all visual decisions.
> Every component, screen, and mock must follow these rules.
> When in doubt, remove color.

---

## The Standard (approved 2026-07-21)

> **Reference implementation: the Shift Handover module** (`src/components/shift-handover/`).
> Its home screen is the normative example every module home should look like.
> Spec: `docs/superpowers/specs/2026-07-21-portal-design-standard-design.md`.

### Screen recipe (module home) — top to bottom

1. **Header card** — `ui/AppHeader`: blue `#2563EB`, `rounded-b-[28px]`, uppercase
   overline (module name) + bold white title + white/45 subtitle (usually the date),
   a 44px+ white/10 home/back square, and a right-side **action slot** carrying the
   **company pill** (`ui/CompanyPill`).
2. **KPI stat chips** — `ui/KpiRow` + `ui/KpiChip`, up to 4: white, bordered,
   `rounded-xl`, big number + 10px uppercase gray label. Number is red **only** when
   the stat is an actionable problem (overdue / blocked). Red always means "look here".
3. **Action cards** — `ui/ActionGrid` + `ui/ActionCard`, 2 columns: **white**
   `rounded-2xl` cards, emoji in a 44px `#F1F3F5` square, bold title, gray subtitle,
   optional corner count badge (green, or red when it needs attention),
   `active:scale-[0.97]`.
4. Page background `bg-gray-50`, content `px-4`, flat cards (no shadows).

### The two rules that matter most

- **White cards. No pastel tile colors.** Color appears only when it carries
  information (a badge, a warning, a status). A calm surface is what makes a red
  badge impossible to miss.
- **Color is information.** Blue `#2563EB` = headers. Green `#16A34A` = the one
  interactive color (buttons, selections, focus). Red/amber = problems/warnings.
  Everything else is gray. The brand is **not** orange (`#F5800A` is legacy-only).

### Symbols — two jobs, two styles

- **Emoji tell staff _what_** — on action cards and module tiles. Same concept =
  same emoji in every module (dictionary below). No module invents its own.
- **Line icons run the _machinery_** — home, back, close, chevrons, checkmarks come
  from the one thin-line set `ui/ChromeIcons` (stroke-2, `currentColor`, aria-hidden).
  Never emoji for chrome, never a second icon style.
- **Status is never symbol- or color-only** — always word + tinted badge.

#### Emoji dictionary (extend here; never improvise per-module)

| Concept | Emoji | | Concept | Emoji |
|---|---|---|---|---|
| Manufacturing / production | 🏭 | | Tasks / approve | ✅ |
| Chef / cooking guide | 👨‍🍳 | | Recipes / BOM | 📖 |
| Production guide (sauces/prep) | 🥫 | | Pick list / lists | 📋 |
| Inventory | 📦 | | Quick count / search | 🔍 |
| Purchase / place order | 🛒 | | Ingredients (MO needs) | 🧾 |
| Cart | 🛒 | | Goods received / receive | 📥 |
| HR / profile | 👤 | | Completed / finished | ✔️ |
| Planning / shifts | 📅 | | Label print | 🏷️ |
| Prep planner | 📊 | | Storage / cold | 🧊 |
| Sales / revenue | 📈 | | Shift handover | 🔄 |
| Rentals | 🏠 | | Settings | ⚙️ |
| Supplier logins | 🔑 | | Record / create | ⏺️ |
| Shared tablets | 📱 | | Edit | ✏️ |
| Stats / reports | 📊 | | Locations | 📍 |

### Shared building blocks (import from `@/components/ui/`)

`AppHeader`, `CompanyPill`, `KpiRow`/`KpiChip`, `ActionGrid`/`ActionCard`,
`BottomSheet`, `OptionGrid`, `PrimaryButton`, `Chip`, `Field`, `Select`,
`ChromeIcons`. **Never hand-roll a bottom sheet, KPI chip, or action card again.**

```tsx
<AppHeader supertitle="INVENTORY" title="Stock counting" subtitle={date}
  action={<CompanyPill onSwitched={() => location.reload()} />} />
<KpiRow columns={3}>
  <KpiChip value={3} label="Waiting" tone="danger" />
  <KpiChip value={2} label="To review" />
  <KpiChip value={12} label="Lists" />
</KpiRow>
<ActionGrid items={tiles} getItemId={t => t.id} sortable={{ storageKey: 'inventory_tile_order', savedOrder }}
  renderItem={t => <ActionCard emoji={t.emoji} label={t.label} subtitle={t.sub}
    onClick={() => go(t.id)} badge={t.count ? { value: t.count } : undefined} />} />
```

### Migration ratchet

New screens MUST use the standard and these primitives. Any legacy screen touched
for other reasons migrates the components it touches. No big-bang restyles outside
the planned waves.

### Migration status by screen

| Wave | Screens | Status |
|---|---|---|
| 0 | Shared primitives + governance | ✅ migrated |
| 0 | Shift Handover (reference) | ✅ migrated |
| 1 | Personal home, Station home | ✅ migrated |
| 2 | Tasks, Inventory, Purchase, Manufacturing, Chef Guide | ✅ migrated |
| 3 | Planning, HR, Prep Planner, Rentals, Reports, Terminations, Sales, Admin | ⏳ pending |
| 4 | KDS, cook-timer, kiosk (dark ops — typography/touch/status only) | ⏳ pending |

---

## 0. Navigation — EVERY page must have a way home

**This is non-negotiable.** Every module page must always show a button to return to the dashboard.

### Pattern:
- **Main module screen** (top-level, e.g. supplier list): left header button = **home icon** → navigates to `/`
- **Sub-screen** (detail view, e.g. order guide): left = **back arrow**, right = **home icon**
- **Confirmation screens** (e.g. order sent): include a **"Back to dashboard"** text button
- **Bottom tab bars**: do NOT count as navigation home — always add a header home button

### Home icon SVG:
```html
<svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
  <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
  <polyline points="9 22 9 12 15 12 15 22"/>
</svg>
```

---

## 1. Color system — semantic only

Color MUST carry meaning. If it doesn't, use gray.

### Allowed colors

| Purpose | Hex | Usage |
|---------|-----|-------|
| Overdue / error | `#DC2626` (red-600) | Overdue badges, error states, damage reports |
| Due soon / warning | `#F59E0B` (amber-500) | Due soon badges, pending approval, low stock |
| Info / active | `#2563EB` (blue-600) | Informational badges, counts, active states |
| Completed / success | `#16A34A` (green-600) | Done badges, confirmed, received, approved |
| Header | `#2563EB` (blue-600) | The module header (`ui/AppHeader`) only |
| Action | `#16A34A` (green-600) | Primary buttons, selected states, focus rings |
| Neutral | `#6B7280` (gray-500) | Everything else — default icons, labels, borders |

> The action color is **green**, not orange. `#F5800A` orange is **legacy-only** —
> do not use it or the `krawings-*` Tailwind scale in new code.

### Tinted backgrounds (for badges and cards)

| Semantic | Background | Text |
|----------|------------|------|
| Overdue / error | `#FEE2E2` | `#991B1B` |
| Due soon / warning | `#FEF3C7` | `#92400E` |
| Info / active | `#DBEAFE` | `#1E3A8A` |
| Completed / success | `#DCFCE7` | `#166534` |
| Neutral / draft | `#F3F4F6` | `#374151` |
| Brand (approval, pending) | `#FFF7ED` | `#C2410C` |

### Banned

- NO purple elements anywhere
- NO random pastel backgrounds on app tiles
- NO non-semantic decorative colors
- NO solid-color badges (always tinted bg + dark text)
- NO more than 4 colors visible on any single screen

---

## 2. Visual hierarchy (priority order)

1. **Overdue** (red) — highest visual weight
2. **Due soon** (amber/orange) — second priority
3. **Active / info** (blue) — third
4. **Completed** (green, low emphasis) — fourth
5. **Neutral** (gray) — everything else

If something doesn't fit this hierarchy, remove its color.

---

## 3. Badge system — one style, color changes only

All badges MUST use identical structure:

```
padding: 2px 8px
border-radius: 6px
font-size: 10px
font-weight: 700
```

Only the background and text color change based on semantic meaning.

### Badge mappings

| State | Background | Text | Example |
|-------|------------|------|---------|
| Overdue | `#FEE2E2` | `#991B1B` | "15m overdue" |
| Due soon | `#FEF3C7` | `#92400E` | "Due 19:00" |
| Upcoming / info | `#DBEAFE` | `#1E3A8A` | "20:00" |
| Done / delivered | `#DCFCE7` | `#166534` | "Done" |
| Draft / neutral | `#F3F4F6` | `#374151` | "Draft" |
| Pending / approval | `#FFF7ED` | `#C2410C` | "Pending" |
| Sent | `#DBEAFE` | `#1E3A8A` | "Sent" |
| Rejected / issue | `#FEE2E2` | `#991B1B` | "Issue" |
| Staff role | `#DBEAFE` | `#1E3A8A` | "Staff" |
| Manager role | `#FFF7ED` | `#C2410C` | "Manager" |
| Admin role | `#FEE2E2` | `#991B1B` | "Admin" |

---

## 4. Card status indicators

DO NOT use thick colored borders or full colored outlines.

### Allowed indicators (pick ONE per card):

**Option A: Small colored dot** (preferred for cleaner UI)
- 8px circle, positioned left of the card title
- Color follows semantic system

**Option B: 4px left border bar**
- Only when dot is not sufficient

### Status mapping:

| Status | Indicator |
|--------|-----------|
| Overdue | Red dot `#DC2626` |
| Due soon | Amber dot `#F59E0B` |
| Normal / active | No indicator OR subtle blue dot |
| Completed | No indicator — show green checkmark icon instead |

---

## 5. Header styling

- **Use `ui/AppHeader`** — the standard blue `#2563EB` header with `rounded-b-[28px]`.
- Keep the faint orange radial glow subtle (`rgba(245,128,10,0.08)`), no bright hotspot.
- Header should NOT compete with content below it.
- **Always include a home button** (see rule 0).
- Dark navy `#1A1F2E` chrome is for the full-screen **ops tools only** (kiosk, KDS,
  cook-timer) — never for a normal module header.

---

## 6. Card contrast

- Page background: `#F6F7F9`
- Card background: `#FFFFFF`
- Card shadow: `0 1px 2px rgba(0,0,0,0.04), 0 4px 8px rgba(0,0,0,0.06)`
- Card border: `1px solid #E5E7EB`

---

## 7. App tiles (dashboard) → use `ui/ActionCard`

All action cards use the SAME style (see "The Standard" above):
- Card: **white** `#FFFFFF`, `rounded-2xl`, 1px `#E5E7EB` border, no shadow
- Icon: an **emoji** in a 44px `#F1F3F5` rounded square (from the emoji dictionary)
- Only the corner count badge carries meaning (green for counts, red for attention)

NO per-tile pastel backgrounds. NO colored icon backgrounds. NO blue SVG tile icons.

---

## 8. Icon colors

| Context | Color |
|---------|-------|
| Default / neutral | `#6B7280` |
| Active / info | `#2563EB` |
| Success | `#16A34A` |
| Error | `#DC2626` |
| Brand accent (nav active) | `#F5800A` |

No random colored icons. Every icon color must have semantic meaning.

---

## 9. Saturation rules

- High saturation: ONLY for overdue (red) and urgent signals
- Everything else: use tinted/soft backgrounds
- When in doubt, reduce saturation

---

## 10. Text contrast

| Role | Color | Weight |
|------|-------|--------|
| Primary text / headings | `#1F2933` | 700 |
| Body text | `#374151` | 400-500 |
| Secondary / meta | `#6B7280` | 400 |
| Placeholder / disabled | `#9CA3AF` | 400 |
| Hint / tertiary | `#D1D5DB` | 400 |

---

## 11. Sanity check (run after every screen)

- [ ] Can I scan urgency in <1 second?
- [ ] Are there more than 4 colors on screen? (if yes, fix)
- [ ] Does anything colorful lack meaning? (remove it)
- [ ] Do ALL badges look identical structurally?
- [ ] Is the header competing with the content? (reduce if yes)
- [ ] Are cards clearly separated from background?
- [ ] **Can the user get back to the dashboard from this screen?**

---

## Quick reference: Tailwind classes

```
// Badges
badge-overdue:   bg-red-100 text-red-800
badge-warning:   bg-amber-100 text-amber-800
badge-info:      bg-blue-100 text-blue-800
badge-success:   bg-green-100 text-green-800
badge-neutral:   bg-gray-100 text-gray-700
badge-pending:   bg-orange-50 text-orange-800

// Status dots (8px)
dot-overdue:     w-2 h-2 rounded-full bg-red-500
dot-warning:     w-2 h-2 rounded-full bg-amber-500
dot-info:        w-2 h-2 rounded-full bg-blue-500
dot-success:     w-2 h-2 rounded-full bg-green-500

// Cards
card:            bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)]
page-bg:         bg-[#F6F7F9]
```

---

## 12. Responsive Typography System (MANDATORY)

> **This is the binding standard for ALL portal modules.**
> The manufacturing module is the reference implementation.
> Every new or modified component MUST use these tokens.

### CSS Custom Properties (defined in globals.css)

All font sizes use `clamp()` — they scale smoothly from iPhone SE (375px) to tablet.

| Token | Range | Purpose |
|-------|-------|---------|
| `--fs-xxl` | 18–22px | Stat values, product names in lists, large numbers |
| `--fs-xl` | 16–20px | Page titles, profile names, record headings |
| `--fs-lg` | 15–18px | Section headers, modal titles, recipe/BOM names |
| `--fs-md` | 14–17px | Tile labels, document names, form input text, step names |
| `--fs-base` | 13–16px | Search inputs, default body text |
| `--fs-sm` | 12–14px | Detail text, field labels, field values, button text, UOM |
| `--fs-xs` | 11–13px | Section overlines, badges, meta text, timestamps |

### Usage in Tailwind

Always use CSS var syntax in Tailwind arbitrary values:

```tsx
// ✅ CORRECT — responsive, scales with viewport
<div className="text-[var(--fs-md)] font-bold">Tile Label</div>
<span className="text-[var(--fs-xs)] text-gray-400">Section header</span>

// ❌ WRONG — hardcoded, does NOT scale
<div className="text-[14px] font-semibold">Tile Label</div>
<span className="text-[11px] text-gray-400">Section header</span>
```

### Font Weight Hierarchy

| Weight | Usage |
|--------|-------|
| `font-extrabold` (800) | Stat values in dashboard cards only |
| `font-bold` (700) | Tile labels, card titles, section headers, primary buttons, employee names |
| `font-semibold` (600) | Secondary buttons, form labels, filter pills, meta labels |
| `font-medium` (500) | Field values, body text |
| `font-normal` (400) | Long-form text, descriptions, legal text |

### Component Sizing Standards

| Element | Size | Token |
|---------|------|-------|
| Dashboard tile label | `text-[var(--fs-md)] font-bold` | fs-md |
| Dashboard tile subtitle | `text-[var(--fs-xs)] text-gray-500` | fs-xs |
| List card primary text | `text-[var(--fs-xxl)] font-bold` | fs-xxl |
| List card meta | `text-[var(--fs-sm)] text-gray-500` | fs-sm |

### Compact List Spacing (MANDATORY)

All lists must use compact spacing to minimize scrolling:

| Element | Class | Value |
|---------|-------|-------|
| List container gap | `gap-1` | 4px between items |
| List item vertical padding | `py-2` (edit/view rows) or `py-2.5` (cards with more content) | 8–10px |
| Category section margin | `mb-2` to `mb-3` | 8–12px below each category |
| Category header padding-bottom | `pb-1` to `pb-1.5` | 4–6px |
| Between-item margin (when not using gap) | `mb-1` | 4px |

Do NOT use `gap-2`, `gap-3`, `py-3`, or `py-4` on list items — these create excessive scroll distance.
| Section overline | `text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400` | fs-xs |
| Filter pill (active) | `px-4 py-3 rounded-full text-[var(--fs-sm)] font-bold bg-green-600 text-white` | fs-sm |
| Filter pill (inactive) | `px-4 py-3 rounded-full text-[var(--fs-sm)] font-bold border bg-white text-gray-500` | fs-sm |
| Primary button | `py-3.5 text-[var(--fs-sm)] font-bold rounded-xl` | fs-sm |
| Secondary button | `py-3.5 text-[var(--fs-sm)] font-bold rounded-xl border` | fs-sm |
| Form input text | `text-[var(--fs-md)]` via `.form-input` class | fs-md |
| Search input text | `text-[var(--fs-base)]` | fs-base |
| Field label (profile) | `text-[var(--fs-sm)] text-gray-500` | fs-sm |
| Field value (profile) | `text-[var(--fs-sm)] font-medium` | fs-sm |
| Card border-radius | `rounded-2xl` (list cards, tiles) or `rounded-xl` (compact cards) | — |
| Card padding | `p-4` (standard) or `p-3` (compact stat boxes) | — |

### Exceptions (allowed hardcoded sizes)

These specific cases MAY use hardcoded pixel sizes:

- **8–10px**: Thumbnail overlay labels (filename, "PDF" badge, photo counter)
- **9px**: Compact stat box sub-labels in dense review screens
- **10px**: Legal reference codes, tiny inline status badges
- **Emoji/icon wrappers**: Fixed size matching SVG dimensions (e.g. `text-[24px]` for emoji icons)

Everything else MUST use `var(--fs-*)` tokens.

### Compliance Checklist

Before committing any component change:

- [ ] All font sizes use `var(--fs-*)` tokens (no hardcoded `text-[Npx]` except allowed exceptions)
- [ ] Font weights follow the hierarchy (800/700/600/500/400)
- [ ] Buttons use `py-3.5` minimum and `font-bold`
- [ ] Filter pills use `px-4 py-3` (44px+ touch target)
- [ ] List cards use `rounded-2xl` with compact padding (`py-2` to `py-2.5`, not `py-3` or `py-4`)
- [ ] List container gaps use `gap-1` (not `gap-2` or `gap-1.5`)
- [ ] Section headers use `text-[var(--fs-xs)] font-bold tracking-widest uppercase text-gray-400`
