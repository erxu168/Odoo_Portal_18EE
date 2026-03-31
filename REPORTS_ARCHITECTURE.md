# Krawings Report Builder — Architecture

## Overview

Mobile-first report dashboard for Krawings restaurant group. Reads POS and accounting data from Odoo 18 EE, computes KPIs, detects anomalies, and presents them in the portal.

**Version:** v1.0.0
**Mock:** `krawings_report_builder_v1.0.0.html` (9 screens)

## Screens

1. **Dashboard** — Today/week/month/YTD KPIs, last month, daily chart
2. **Daily** — Day-by-day breakdown table with YoY comparison
3. **Compare** — Side-by-side period comparison
4. **Records** — Best days/weeks/months, averages
5. **P&L** — Profit & loss with 12 ratio tiles + line items
6. **Operations** — Payment methods, hourly heatmap, cashier perf, tips, fraud detection, RevPASH
7. **Menu** — Drink-to-food ratio, top sellers, category mix
8. **Locations** — Side-by-side location comparison
9. **Owner Report** — Single-page summary with alerts and health scores

## Access

- Admin: Full access
- Manager: All except P&L net profit details and owner alerts
- Staff: No access

## Data Sources (standard Odoo models, no custom module)

- `pos.order` — Sales, tips, guest count, table, employee, state, edit tracking
- `pos.order.line` — Product qty, revenue, discount
- `pos.payment` — Payment method, amount
- `pos.session` — Cash register difference, order count
- `account.move.line` — P&L journal entries
- `restaurant.table` — Seat count for RevPASH
- `pos.config` — Location mapping

## File Structure

```
src/types/reports.ts          # TypeScript interfaces
src/lib/report-queries.ts     # Odoo JSON-RPC queries
src/lib/report-cache.ts       # In-memory TTL cache
src/lib/report-compute.ts     # Aggregation & KPI computation
src/app/api/reports/           # API routes
src/app/reports/page.tsx       # Frontend (tab-based SPA)
src/components/reports/        # Shared report components
```

## Location Mapping

| Config ID | Name | Company ID | Type |
|-----------|------|------------|------|
| 7 | Gogi Boss M38 | 2 | counter |
| 8 | Ssam Korean BBQ KD | 3 | sitdown |
| 2 | Ssam Warschauerstr (closed) | 1 | sitdown |

## Caching (in-memory TTL)

- Dashboard today: 5 min
- Dashboard period: 15 min
- Daily/Compare/Operations: 30 min
- Records/P&L/Menu/Summary: 60 min

## Key Formulas

- Prime Cost = (COGS + Labor) / Revenue
- Gross Margin = (Revenue - COGS) / Revenue
- Net Margin = Net Profit / Revenue
- RevPASH = Revenue / (Seats x Days x Hours)
- Tip Gap = Card Tip% - Cash Tip% (>3pp = flagged)
- Benford Expected = log10(1 + 1/d) x 100
