# Product Duplicate Audit — Design

**Date:** 2026-04-19
**Environment:** Odoo 18 EE staging (`krawings` database, 89.167.124.0:15069)
**Mutations:** None — read-only report

## Goal

Produce a CSV of suspected duplicate products across all active `product.template`
records in all 5 companies, ranked by name similarity. Output is for human review;
no records are archived, deleted, or merged in this audit.

## Approach

Single SQL query against the `krawings` Postgres DB using the `pg_trgm` extension's
`similarity()` function. Run via `psql` over SSH on the Hetzner staging host.

### Why pg_trgm and not Python/rapidfuzz

- Already installed and used by Odoo for name search.
- Trigram similarity handles punctuation, casing, and word-order robustly.
- One query, no Python dependencies, no JSON-RPC round trips.

### Why report-only

Odoo products are referenced by purchase orders, sale orders, stock moves, BOMs,
manufacturing orders, and pricelists. "Removing" a duplicate has cascading effects
that vary per record. The safe path is: report → human triage → explicit merge or
archive as a separate task using Odoo's built-in tooling.

## Query

```sql
SELECT
  a.id          AS a_id,
  a.name        AS a_name,
  a.default_code AS a_sku,
  a.barcode     AS a_barcode,
  a.company_id  AS a_company_id,
  a.create_date AS a_created,
  b.id          AS b_id,
  b.name        AS b_name,
  b.default_code AS b_sku,
  b.barcode     AS b_barcode,
  b.company_id  AS b_company_id,
  b.create_date AS b_created,
  similarity(a.name, b.name) AS score,
  (a.default_code IS NOT NULL AND a.default_code = b.default_code) AS sku_match,
  (a.barcode IS NOT NULL AND a.barcode = b.barcode) AS barcode_match
FROM product_template a
JOIN product_template b
  ON a.id < b.id
 AND a.active AND b.active
 AND similarity(a.name, b.name) >= :threshold
ORDER BY score DESC, a.name;
```

`a.id < b.id` avoids reporting `(X, Y)` and `(Y, X)` as separate pairs.

## Threshold tuning

Start at `0.6`. Before exporting the full CSV, run a count at three thresholds
(`0.5`, `0.6`, `0.7`) so we can pick a level that yields a manageable but
useful list:

```sql
SELECT 0.5 AS t, COUNT(*) FROM product_template a JOIN product_template b
  ON a.id < b.id AND a.active AND b.active
 AND similarity(a.name, b.name) >= 0.5
UNION ALL ...
```

## Output

- File: `duplicates_2026-04-19.csv` on the staging host
- Copy locally to `/Users/ethan/Odoo_Portal_18EE/tmp/duplicates_2026-04-19.csv`
  (gitignored — it's data, not code)
- Columns map 1:1 to the SELECT list above, plus a derived `company_a_name` /
  `company_b_name` joined from `res_company`

Sort/filter in Excel. High-confidence duplicates (`sku_match` or `barcode_match`
true) are the first batch to review.

## Out of scope

- Archiving, deleting, or merging any product
- Re-pointing references (POs, SOs, stock moves) from one product to another
- Modifying production database (128.140.12.188)
- Variants (`product.product`) — only templates are compared
- Cross-database deduplication

## Risks

- **False positives:** trigram similarity will match e.g. `"Coca-Cola 330ml"` and
  `"Coca-Cola 500ml"`. Mitigated by reporting score and SKU/barcode flags so
  reviewer can distinguish.
- **False negatives:** very short names or non-Latin characters score poorly.
  Acceptable for a first pass; can layer barcode/SKU exact match in a follow-up
  if needed.
- **DB load:** self-join on `product_template` is O(n²) over rows passing the
  threshold. Krawings catalog is small enough that this is not a concern.

## Verification

- Confirm `pg_trgm` extension exists: `SELECT extname FROM pg_extension WHERE extname='pg_trgm';`
- Sanity-check one known duplicate by hand
- Confirm row count matches across the count query and the export
