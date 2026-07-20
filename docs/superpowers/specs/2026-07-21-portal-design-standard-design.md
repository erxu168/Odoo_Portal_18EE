# Portal Design Standard — approved 2026-07-21

**Status:** Approved by Ethan (owner) on 2026-07-21 via the sign-off board
(artifact: https://claude.ai/code/artifact/c9c9a47a-e336-426d-a63c-a0e43ce68f9d).
**Reference implementation:** the Shift Handover module (`src/components/shift-handover/`)
as shipped to staging 2026-07-20/21. Its home screen is the normative example.

This spec records WHAT was approved. The wave-by-wave implementation gets its own
plans under `docs/superpowers/plans/`.

---

## 1. Why

The portal's written design rules had drifted into four contradicting sources
(DESIGN_GUIDE.md said orange brand + dark `#1A1F2E` header; PORTAL.md described the
color migration backwards; `src/lib/design-system.ts` says green; `tailwind.config.ts`
still ships an orange palette; the mandated `src/lib/ux-rules.ts` never existed).
Meanwhile the actual code converged on the Shift Handover look. The owner approved
that look as the portal-wide standard.

## 2. The approved standard

### Screen recipe (module home)

Top to bottom, exactly as the Shift Handover dashboard:

1. **Header card** — `ui/AppHeader`: `bg-[#2563EB]`, `rounded-b-[28px]`, 10px/700
   uppercase overline (module name), 20px/700 white title, 12px `white/45` subtitle
   (usually the date), 44px+ `white/10` home/back squares, right-side action slot
   carrying the **company pill** (quiet label when the account sees one company;
   `white/15` pill + bottom-sheet picker when several).
2. **KPI stat chips** — up to 4, `grid gap-2`: white, `border-gray-200`,
   `rounded-xl`, `py-2.5`, centered `--fs-xl` bold number + 10px uppercase
   `gray-400` label. Number turns `red-600` only when the stat is a problem
   (overdue/blocked). Red always means "look here".
3. **Action cards** — `grid grid-cols-2 gap-3`: **white** `rounded-2xl`
   `border-gray-200` cards, `p-4`, `min-h-[104px]`, `active:scale-[0.97]`.
   Emoji in a 44px `#F1F3F5` `rounded-xl` square, `--fs-base` bold title,
   `--fs-xs` `gray-400` subtitle, optional corner count badge
   (`bg-green-600`, or `bg-red-500` when attention is needed).
4. Page background `bg-gray-50`, content `px-4`, flat cards (no shadows).

### Decisions locked by the owner (2026-07-21)

| Decision | Choice |
|---|---|
| Card style | **White cards everywhere.** No pastel per-tile colors. Color appears only when it carries information (badges, alerts, status). |
| Symbols | **Emoji on action cards** + **one thin-line SVG icon set** (stroke-2, Feather-style, matching AppHeader's existing icons) for interface machinery: home, back, close, chevrons, checkmarks. Same concept = same emoji in every module (dictionary in DESIGN_GUIDE.md). Emoji cross-platform rendering differences accepted. |
| Rollout | **Full makeover in waves** (see §5). Every wave: mock → owner sign-off → implementation → Playwright real-browser verification on staging. |
| Header color | Stays `#2563EB` (the blue already used by 141 screens). Not a rebrand. |
| Action color | Green `#16A34A` family stays the one interactive color (buttons, selected states, focus borders). |
| Dark ops tools | KDS, cooking timer, kiosk/time-clock keep their dark high-contrast layouts; they adopt only typography (`--fs-*`), touch sizes, and semantic status colors. |

### Color roles (unchanged semantics, now single-sourced)

- `#2563EB` headers (and info badges `#DBEAFE`/`#1E3A8A`)
- `#16A34A` actions/selections (success badges `#DCFCE7`/`#166534`)
- `#DC2626`/`#EF4444` problems only (badges `#FEE2E2`/`#991B1B`)
- amber warnings (`#FEF3C7`/`#92400E`), gray neutral (`#F3F4F6`/`#374151`)
- Canvas `#F9FAFB` (gray-50), cards white + `#E5E7EB` border, dividers `#F3F4F6`
- Text ramp: gray-900 / gray-700 / gray-500 / gray-400 / gray-300
- **Banned:** decorative color, pastel tile backgrounds, orange `#F5800A` as brand
  (legacy only), solid-color badges, color- or symbol-only status.

### Typography, shape, touch

- Font sizes: the existing `--fs-xs`…`--fs-xxl` clamp() tokens (globals.css) remain
  mandatory; weights 800 (stat values) / 700 (titles) / 600 (buttons, labels) /
  500 / 400.
- Radius tiers: 28px header bottom, 16px cards/tiles/sheets, 12px controls/inputs,
  pill for chips/badges/company pill.
- Touch: 44px minimum targets, `h-12` inputs, press feedback via
  `active:scale-[0.97–0.99]` or darkening — no hover-dependent styling.

### Shared primitives (wave 0 promotes these to `src/components/ui/`)

BottomSheet, KpiRow/KpiChip, ActionCard/ActionGrid (composable with the existing
`SortableTileGrid` ordering), CompanyPill (from shift-handover), OptionGrid,
PrimaryButton, Chip (badge), Field/Select. Screens own content and business logic;
primitives own structure, states, and accessibility.

## 3. Governance fixes (wave 0)

1. Rewrite `DESIGN_GUIDE.md` around this standard (keep the good parts: semantic
   colors, badge system, home-button rule, typography section). Add the screen
   recipe, the emoji dictionary, and a per-module migration status table.
2. Fix `PORTAL.md` §6–7 (wrong brand color, reversed migration claims) and the
   repo `CLAUDE.md` "big orange button" line.
3. Create `src/lib/ux-rules.ts` from PORTAL.md §7 prose so the mandated file exists.
4. Mark the `krawings` orange palette in `tailwind.config.ts` deprecated (do not
   remove yet — 2 legacy usages).
5. Fix `design-system.ts` leftover (`bg-green-50 text-orange-800`).
6. Outside this repo: scope the Odoo-19 mobile design section of
   `/Users/ethan/CLAUDE.md` to that dormant project so it stops contradicting
   portal work.

## 4. Migration rule (the ratchet)

New screens MUST use the standard and its primitives. Any legacy screen touched for
other reasons migrates the components it touches. No big-bang restyles outside the
planned waves. No screen may hand-roll a bottom sheet, KPI chip, or action card
again.

## 5. Waves

- **Wave 0** — foundation: primitives + governance fixes (no visual change).
- **Wave 1** — `DashboardHome` (personal home) + `StationHome` (shared tablet):
  stat chips, white emoji cards, company pill. Data fetching/permissions unchanged.
- **Wave 2** — everyday staff modules: Tasks staff landing (currently flat orange
  header), Inventory, Purchase, Manufacturing, Chef Guide dashboards.
- **Wave 3** — manager/admin: Planning, HR, Prep Planner, Rentals, Reports
  (adopt the orphaned `ReportsHome.tsx` approach), Terminations, Sales, admin pages
  (+ a proper admin landing screen — none exists today).
- **Wave 4** — dark ops alignment only: KDS, cooking timer, kiosk.

Each wave ships separately on `main` with its own mock sign-off and staging
Playwright verification.

## 6. Verification requirements (every wave)

- `npm run build` clean.
- Deterministic Playwright screenshots of the changed screens (mock the data,
  freeze time) at 375×667 and 768×1024, staff + manager roles, one-company and
  multi-company accounts.
- Real-browser smoke on staging (portal.krawings.de) before calling it done.
