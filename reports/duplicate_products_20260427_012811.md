# Duplicate Products Audit

_Generated 2026-04-27 01:28 — staging (krawings)_

- 884 active products scanned
- 0 exact-match duplicate groups
- 3 near-match duplicate groups (similarity ≥ 0.9)

**Winner = product most-used in BOMs** (tie-break: shortest name, lowest id).
Form/color/qualifier tokens (whole/ground/fresh/red/yellow/fine/...) split groups so different forms never collide.

## Exact-match duplicate groups

_None._

## Near-match duplicate groups

### CHUNGJUNGWON Mirin Ginger and Plum Matsul (alt) (and similar)  →  winner id=1475
```
  WINNER  id= 1475  bom_uses=  0  uom=Units     'CHUNGJUNGWON Mirin Ginger and Plum Matsul'
          id= 1476  bom_uses=  0  uom=Units     'CHUNGJUNGWON Mirin Ginger and Plum Matsul (alt)'
```
### Disposable Gloves,Latex Size M (and similar)  →  winner id=1327
```
  WINNER  id= 1327  bom_uses=  0  uom=Units     'Disposable Gloves,Latex Size M'
          id= 1355  bom_uses=  0  uom=Units     'Disposable Gloves, Latex Size S'
```
### Nitrilhandschuhe, puderfrei - L- black (and similar)  →  winner id=1337
```
  WINNER  id= 1337  bom_uses=  0  uom=L         'Nitrilhandschuhe, puderfrei - L- black'
          id= 1338  bom_uses=  0  uom=Units     'Nitrilhandschuhe, puderfrei - M- black'
```

## Notes

- This is **read-only**. No products or BOMs were modified.
- Review each group manually. False positives are likely for items that differ in pack size, vendor, or grade.
- Once approved, run a merge script that rewrites mrp.bom.line.product_id and archives losers (do **not** delete — preserves history).