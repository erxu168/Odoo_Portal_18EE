#!/usr/bin/env python3
"""
Audit every active mrp.bom on staging — for each BOM, sum the ingredient
line quantities (converting to the BOM's UoM where the UoM category
matches) and compare against the BOM's stored product_qty.

Read-only. Writes a Markdown + CSV report to reports/.

Mirrors the math in odoo-modules/krawings_bom_auto_qty so the audit
matches what the live recompute produces for What a Jerk (company 5).

Usage:
    python3 audit_bom_qty_sums.py
"""

from __future__ import annotations

import csv
import os
import sys
import time
import xmlrpc.client
from collections import defaultdict

ODOO_URL = "https://test18ee.krawings.de"
ODOO_DB = "krawings"
ODOO_USER = "biz@krawings.de"
ODOO_PASSWORD = "exEV3M<v3."

# Match krawings_bom_auto_qty
QTY_TOLERANCE = 1e-4


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

    print("loading BOMs…", flush=True)
    bom_ids = call(
        models, uid, "mrp.bom", "search",
        [[["active", "=", True]]],
        {"order": "id"},
    )
    print(f"  {len(bom_ids)} BOMs", flush=True)

    boms = call(
        models, uid, "mrp.bom", "read",
        [bom_ids],
        {"fields": [
            "id", "display_name", "code", "product_qty", "product_uom_id",
            "product_tmpl_id", "product_id", "company_id", "type",
            "bom_line_ids",
        ]},
    )

    line_ids = []
    for b in boms:
        line_ids.extend(b["bom_line_ids"])
    print(f"loading {len(line_ids)} BOM lines…", flush=True)

    lines = []
    CHUNK = 1000
    for i in range(0, len(line_ids), CHUNK):
        chunk = line_ids[i:i + CHUNK]
        lines.extend(call(
            models, uid, "mrp.bom.line", "read",
            [chunk],
            {"fields": [
                "id", "bom_id", "product_id", "product_qty", "product_uom_id",
            ]},
        ))
    lines_by_bom = defaultdict(list)
    for ln in lines:
        lines_by_bom[ln["bom_id"][0]].append(ln)

    print("loading UoMs…", flush=True)
    uom_ids = set()
    for b in boms:
        if b["product_uom_id"]:
            uom_ids.add(b["product_uom_id"][0])
    for ln in lines:
        if ln["product_uom_id"]:
            uom_ids.add(ln["product_uom_id"][0])
    uoms = call(
        models, uid, "uom.uom", "read",
        [list(uom_ids)],
        {"fields": ["id", "name", "category_id", "factor"]},
    )
    uom_by_id = {u["id"]: u for u in uoms}

    print("computing…", flush=True)
    results = []
    for bom in boms:
        bom_uom = uom_by_id.get(
            bom["product_uom_id"][0] if bom["product_uom_id"] else None
        )
        if not bom_uom:
            results.append({
                "bom_id": bom["id"],
                "bom_name": bom["display_name"],
                "company": bom["company_id"][1] if bom["company_id"] else "",
                "stored_qty": bom["product_qty"],
                "stored_uom": "",
                "computed_qty": None,
                "diff": None,
                "line_count": len(lines_by_bom[bom["id"]]),
                "skipped_lines": 0,
                "status": "no_uom",
                "notes": "BOM has no product_uom_id",
            })
            continue

        bom_uom_categ = bom_uom["category_id"][0] if bom_uom["category_id"] else None
        total = 0.0
        skipped = 0
        skipped_details = []
        bom_lines = lines_by_bom[bom["id"]]
        for ln in bom_lines:
            ln_uom = uom_by_id.get(
                ln["product_uom_id"][0] if ln["product_uom_id"] else None
            )
            if not ln_uom:
                skipped += 1
                skipped_details.append(
                    f"line {ln['id']}: no UoM"
                )
                continue
            ln_categ = ln_uom["category_id"][0] if ln_uom["category_id"] else None
            if ln_categ != bom_uom_categ:
                skipped += 1
                skipped_details.append(
                    f"{ln['product_id'][1] if ln['product_id'] else '?'}: "
                    f"{ln_uom['name']} not convertible to {bom_uom['name']}"
                )
                continue
            if ln_uom["id"] == bom_uom["id"]:
                total += ln["product_qty"]
            else:
                total += ln["product_qty"] * (
                    ln_uom["factor"] / bom_uom["factor"]
                )

        if not bom_lines:
            status = "no_lines"
        else:
            computed = round(total, 4)
            diff = round(computed - bom["product_qty"], 6)
            if skipped == len(bom_lines):
                status = "all_skipped"
            elif abs(diff) <= QTY_TOLERANCE:
                status = "ok"
            else:
                status = "mismatch"

        results.append({
            "bom_id": bom["id"],
            "bom_name": bom["display_name"],
            "company": bom["company_id"][1] if bom["company_id"] else "",
            "stored_qty": bom["product_qty"],
            "stored_uom": bom_uom["name"],
            "computed_qty": round(total, 4) if bom_lines else None,
            "diff": (round(total - bom["product_qty"], 6)
                     if bom_lines else None),
            "line_count": len(bom_lines),
            "skipped_lines": skipped,
            "status": status,
            "notes": "; ".join(skipped_details[:3]),
        })

    # summarise
    by_status = defaultdict(int)
    for r in results:
        by_status[r["status"]] += 1
    print("\nsummary:", flush=True)
    for k, v in sorted(by_status.items()):
        print(f"  {k}: {v}")

    # write reports
    os.makedirs("reports", exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")
    csv_path = f"reports/bom_qty_audit_{ts}.csv"
    md_path = f"reports/bom_qty_audit_{ts}.md"

    with open(csv_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=[
            "bom_id", "bom_name", "company", "stored_qty", "stored_uom",
            "computed_qty", "diff", "line_count", "skipped_lines",
            "status", "notes",
        ])
        w.writeheader()
        for r in results:
            w.writerow(r)

    mismatches = [r for r in results if r["status"] == "mismatch"]
    skipped_some = [r for r in results
                    if r["status"] in ("all_skipped", "no_uom")]
    no_lines = [r for r in results if r["status"] == "no_lines"]

    with open(md_path, "w") as f:
        f.write(f"# BOM qty audit — {ts}\n\n")
        f.write(f"Total BOMs scanned: {len(results)}\n\n")
        f.write("| status | count |\n|---|---|\n")
        for k, v in sorted(by_status.items()):
            f.write(f"| {k} | {v} |\n")
        f.write("\n")

        f.write(f"## Mismatches ({len(mismatches)})\n\n")
        f.write("BOMs where the stored output qty does not equal the "
                "converted sum of ingredient lines.\n\n")
        if mismatches:
            f.write(
                "| id | name | company | stored | computed | diff | "
                "uom | lines | skipped |\n"
                "|---|---|---|---:|---:|---:|---|---:|---:|\n"
            )
            for r in sorted(mismatches,
                            key=lambda x: -abs(x["diff"] or 0)):
                f.write(
                    f"| {r['bom_id']} | {r['bom_name']} | {r['company']} "
                    f"| {r['stored_qty']:.4f} | {r['computed_qty']:.4f} "
                    f"| {r['diff']:+.4f} | {r['stored_uom']} "
                    f"| {r['line_count']} | {r['skipped_lines']} |\n"
                )
        f.write("\n")

        f.write(f"## All lines skipped ({len(skipped_some)})\n\n")
        f.write("BOMs whose ingredient UoMs are not convertible to the "
                "BOM's output UoM (different UoM category) — sum cannot "
                "be computed.\n\n")
        if skipped_some:
            f.write(
                "| id | name | company | stored | uom | lines | notes |\n"
                "|---|---|---|---:|---|---:|---|\n"
            )
            for r in skipped_some:
                f.write(
                    f"| {r['bom_id']} | {r['bom_name']} | {r['company']} "
                    f"| {r['stored_qty']:.4f} | {r['stored_uom']} "
                    f"| {r['line_count']} | {r['notes']} |\n"
                )
        f.write("\n")

        f.write(f"## No lines ({len(no_lines)})\n\n")
        if no_lines:
            f.write(
                "| id | name | company | stored | uom |\n"
                "|---|---|---|---:|---|\n"
            )
            for r in no_lines:
                f.write(
                    f"| {r['bom_id']} | {r['bom_name']} | {r['company']} "
                    f"| {r['stored_qty']:.4f} | {r['stored_uom']} |\n"
                )

    print(f"\nwrote: {csv_path}")
    print(f"wrote: {md_path}")


if __name__ == "__main__":
    sys.exit(main() or 0)
