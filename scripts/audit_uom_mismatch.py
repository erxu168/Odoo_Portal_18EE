#!/usr/bin/env python3
"""
Audit UoM mismatches across all BOM components on staging.

For every product used as a component in an active BOM, compare:
- stock UoM (product.uom_id) — how the BOM consumes it
- purchase UoM (product.uom_po_id) — how it's bought
- last actual purchase UoM (from purchase.order.line, if any)

Flag products where stock UoM and purchase UoM live in different categories
(e.g. soy sauce: stock kg vs purchase L). Propose a density bucket per
liquid based on name keywords so we can plan the per-product UoM-category
setup without touching anything yet.

Read-only. Writes a CSV report to reports/.
"""

from __future__ import annotations

import csv
import os
import sys
import xmlrpc.client
from collections import defaultdict
from datetime import datetime

ODOO_URL = "https://test18ee.krawings.de"
ODOO_DB = "krawings"
ODOO_USER = "biz@krawings.de"
ODOO_PASSWORD = "exEV3M<v3."

DENSITY_BUCKETS = [
    # (bucket_name, kg_per_litre, keyword list — lowercase substring match)
    ("oil_0.92",     0.92, ["oil"]),
    ("syrup_1.40",   1.40, ["honey", "syrup", "molasses", "agave", "treacle"]),
    ("sauce_1.15",   1.15, ["soy", "sauce", "ketchup", "worcester", "hp ", "tamari", "fish sauce", "oyster sauce"]),
    ("vinegar_1.05", 1.05, ["vinegar", "mirin", "sake", "wine"]),
    ("dairy_1.03",   1.03, ["milk", "cream", "yogurt", "yoghurt", "buttermilk"]),
    ("water_1.00",   1.00, ["water", "stock", "broth", "juice", "beer", "soda"]),
]


def propose_bucket(name: str) -> tuple[str, float] | tuple[str, None]:
    n = (name or "").lower()
    for bucket, factor, kws in DENSITY_BUCKETS:
        for kw in kws:
            if kw in n:
                return bucket, factor
    return "review", None


def connect():
    common = xmlrpc.client.ServerProxy(
        f"{ODOO_URL}/xmlrpc/2/common", allow_none=True
    )
    uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_PASSWORD, {})
    if not uid:
        raise SystemExit("auth failed")
    models = xmlrpc.client.ServerProxy(
        f"{ODOO_URL}/xmlrpc/2/object", allow_none=True
    )
    return uid, models


def call(models, uid, model, method, args, kwargs=None):
    return models.execute_kw(
        ODOO_DB, uid, ODOO_PASSWORD, model, method, args, kwargs or {}
    )


def main():
    print("connecting…", flush=True)
    uid, models = connect()

    print("loading active BOM lines…", flush=True)
    bom_line_ids = call(
        models, uid, "mrp.bom.line", "search",
        [[["bom_id.active", "=", True]]],
    )
    print(f"  {len(bom_line_ids)} lines", flush=True)

    bom_lines = []
    CHUNK = 2000
    for i in range(0, len(bom_line_ids), CHUNK):
        bom_lines.extend(call(
            models, uid, "mrp.bom.line", "read",
            [bom_line_ids[i:i + CHUNK]],
            {"fields": ["product_id", "product_uom_id", "bom_id"]},
        ))

    # Map: product_id -> set of BOMs that use it, set of BOM-line UoMs
    bom_usage = defaultdict(set)        # product_id -> {bom_id}
    bom_line_uoms = defaultdict(set)    # product_id -> {uom_id}
    for ln in bom_lines:
        if not ln["product_id"]:
            continue
        pid = ln["product_id"][0]
        bom_usage[pid].add(ln["bom_id"][0])
        if ln["product_uom_id"]:
            bom_line_uoms[pid].add(ln["product_uom_id"][0])

    component_ids = sorted(bom_usage.keys())
    print(f"  {len(component_ids)} unique components", flush=True)

    print("loading components…", flush=True)
    components = []
    for i in range(0, len(component_ids), CHUNK):
        components.extend(call(
            models, uid, "product.product", "read",
            [component_ids[i:i + CHUNK]],
            {"fields": [
                "id", "display_name", "default_code",
                "uom_id", "uom_po_id", "categ_id",
            ]},
        ))
    by_pid = {p["id"]: p for p in components}

    # Look up last actual purchase UoM per product
    print("loading recent purchase order lines…", flush=True)
    pol_ids = call(
        models, uid, "purchase.order.line", "search",
        [[["product_id", "in", component_ids]]],
        {"order": "id desc", "limit": 50000},
    )
    print(f"  {len(pol_ids)} PO lines", flush=True)
    last_pol_uom: dict[int, int] = {}
    last_pol_date: dict[int, str] = {}
    if pol_ids:
        pols = []
        for i in range(0, len(pol_ids), CHUNK):
            pols.extend(call(
                models, uid, "purchase.order.line", "read",
                [pol_ids[i:i + CHUNK]],
                {"fields": ["product_id", "product_uom", "date_order"]},
            ))
        # PO lines came back newest first; keep first seen per product
        for p in pols:
            if not p["product_id"]:
                continue
            pid = p["product_id"][0]
            if pid in last_pol_uom:
                continue
            if p["product_uom"]:
                last_pol_uom[pid] = p["product_uom"][0]
                last_pol_date[pid] = p.get("date_order") or ""

    # Resolve all UoMs we touched
    print("loading UoMs…", flush=True)
    uom_ids = set()
    for p in components:
        if p["uom_id"]:
            uom_ids.add(p["uom_id"][0])
        if p["uom_po_id"]:
            uom_ids.add(p["uom_po_id"][0])
    for s in bom_line_uoms.values():
        uom_ids.update(s)
    uom_ids.update(last_pol_uom.values())
    uoms = call(
        models, uid, "uom.uom", "read",
        [list(uom_ids)],
        {"fields": ["id", "name", "category_id"]},
    )
    uom_by_id = {u["id"]: u for u in uoms}

    def uom_str(uid_):
        u = uom_by_id.get(uid_)
        return u["name"] if u else ""

    def categ_id(uid_):
        u = uom_by_id.get(uid_)
        return u["category_id"][0] if u and u["category_id"] else None

    def categ_str(uid_):
        u = uom_by_id.get(uid_)
        return u["category_id"][1] if u and u["category_id"] else ""

    # Build report rows
    print("computing report…", flush=True)
    rows = []
    for pid in component_ids:
        p = by_pid.get(pid)
        if not p:
            continue
        stock_uom = p["uom_id"][0] if p["uom_id"] else None
        po_uom = p["uom_po_id"][0] if p["uom_po_id"] else None
        bom_uoms = bom_line_uoms.get(pid, set())
        last_pol = last_pol_uom.get(pid)

        stock_categ = categ_id(stock_uom) if stock_uom else None
        po_categ = categ_id(po_uom) if po_uom else None
        last_pol_categ = categ_id(last_pol) if last_pol else None

        flags = []
        if stock_categ and po_categ and stock_categ != po_categ:
            flags.append("stock<>purchase categ")
        if last_pol_categ and stock_categ and last_pol_categ != stock_categ:
            flags.append("last PO<>stock categ")
        # BOM line UoM in different category than product stock UoM
        for buom in bom_uoms:
            bcat = categ_id(buom)
            if bcat and stock_categ and bcat != stock_categ:
                flags.append("bom-line<>stock categ")
                break

        bucket, factor = propose_bucket(p["display_name"])
        # Only suggest a bucket if there is an actual mismatch worth solving,
        # otherwise leave blank to keep the review focused.
        if not flags:
            bucket, factor = "", None

        rows.append({
            "product_id": pid,
            "product_name": p["display_name"],
            "default_code": p["default_code"] or "",
            "category": p["categ_id"][1] if p["categ_id"] else "",
            "stock_uom": uom_str(stock_uom) if stock_uom else "",
            "stock_uom_categ": categ_str(stock_uom) if stock_uom else "",
            "purchase_uom": uom_str(po_uom) if po_uom else "",
            "purchase_uom_categ": categ_str(po_uom) if po_uom else "",
            "last_po_uom": uom_str(last_pol) if last_pol else "",
            "last_po_uom_categ": categ_str(last_pol) if last_pol else "",
            "last_po_date": last_pol_date.get(pid, ""),
            "bom_line_uoms": ", ".join(sorted({uom_str(u) for u in bom_uoms if u})),
            "bom_count": len(bom_usage[pid]),
            "flags": "; ".join(flags),
            "proposed_bucket": bucket,
            "proposed_kg_per_l": factor if factor is not None else "",
        })

    # Mismatches first, then by name
    rows.sort(key=lambda r: (0 if r["flags"] else 1, r["product_name"].lower()))

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out_dir = os.path.join(repo_root, "reports")
    os.makedirs(out_dir, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    out_csv = os.path.join(out_dir, f"uom_mismatch_{stamp}.csv")

    with open(out_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else [])
        w.writeheader()
        w.writerows(rows)

    flagged = [r for r in rows if r["flags"]]
    print(f"\nwrote {out_csv}", flush=True)
    print(f"total components: {len(rows)}", flush=True)
    print(f"flagged mismatches: {len(flagged)}", flush=True)
    by_bucket = defaultdict(int)
    for r in flagged:
        by_bucket[r["proposed_bucket"] or "review"] += 1
    print("\nproposed buckets (flagged only):", flush=True)
    for k, v in sorted(by_bucket.items(), key=lambda kv: -kv[1]):
        print(f"  {k:<14}  {v}", flush=True)


if __name__ == "__main__":
    main()
