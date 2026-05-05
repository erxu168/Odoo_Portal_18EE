#!/usr/bin/env python3
"""
Audit product.product for likely duplicates and rank each group's "winner"
by BOM-line usage count (tie-break: shortest name).

Read-only — produces a Markdown report and a JSON file of candidate merge
operations for human review. Run a separate execute step after approval.

Detection layers:
  1. Exact normalized match — lowercase, punctuation stripped, tokens sorted
     and after dropping noise tokens (the/a/of/etc).
  2. Near-match within the same "form bucket" — similarity >= NEAR_THRESHOLD
     using difflib.SequenceMatcher. We split candidates into buckets by
     form/color/qualifier tokens (whole/ground/fresh/dried/red/green/...) so
     that "Onion, red" and "Onion, yellow" never collide and "Salt, fine"
     never collides with "Salt, coarse".

Output:
  reports/duplicate_products_<timestamp>.md
  reports/duplicate_products_<timestamp>.json

Usage:
    python3 audit_duplicate_products.py
    python3 audit_duplicate_products.py --threshold 0.88
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import xmlrpc.client
from collections import defaultdict
from difflib import SequenceMatcher
from itertools import combinations

ODOO_URL = "https://test18ee.krawings.de"
ODOO_DB = "krawings"
ODOO_USER = "biz@krawings.de"
ODOO_PASSWORD = "exEV3M<v3."

# Tokens that change the *thing* itself — products differing on these
# are NOT duplicates and must never collide.
FORM_TOKENS = {
    "whole", "ground", "powder", "powdered", "crushed", "flakes", "flaked",
    "fresh", "dried", "frozen", "smoked", "raw", "cooked", "roasted", "toasted",
    "paste", "sauce", "syrup", "oil", "vinegar", "juice", "extract",
    "minced", "chopped", "sliced", "diced", "grated",
    "concentrate", "puree", "pureed",
    "filet", "fillet", "boneless", "skinless", "ground", "shredded",
}
COLOR_TOKENS = {"red", "yellow", "green", "white", "black", "brown", "orange", "purple", "pink"}
QUALIFIER_TOKENS = {
    "fine", "coarse", "kosher", "sea", "iodized", "table",
    "light", "dark", "medium",
    "low", "high", "full", "skim", "fat", "free",
    "organic", "raw",
    "sweet", "hot", "spicy", "mild",
    "long", "short", "thin", "thick",
    "small", "medium", "large", "extra",
    "regular", "premium",
}
FLAVOR_TOKENS = {
    "zero", "diet", "light", "lite", "regular", "classic", "original",
    "strawberry", "grape", "grapefruit", "lemon", "lime", "orange", "cherry",
    "apple", "apfel", "peach", "mango", "pineapple", "raspberry",
    "vanilla", "chocolate", "coffee", "mint",
    "decaf", "decaffeinated",
}
BUCKET_TOKENS = FORM_TOKENS | COLOR_TOKENS | QUALIFIER_TOKENS | FLAVOR_TOKENS

DIGIT_RE = re.compile(r"\d")

NOISE_TOKENS = {
    "the", "a", "an", "of", "and", "or", "with", "in", "on", "at", "to",
    "for", "from", "by",
}

PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
WS_RE = re.compile(r"\s+")


def tokenize(name: str) -> list[str]:
    s = PUNCT_RE.sub(" ", name.lower())
    s = WS_RE.sub(" ", s).strip()
    return [t for t in s.split() if t and t not in NOISE_TOKENS]


def is_bucket(t: str) -> bool:
    # Tokens containing any digit (e.g. 0,2l, 350ml, 12x0,25, v1, 2021) split
    # SKUs by size/version/year. Plus our explicit form/color/qualifier/flavor
    # vocabularies.
    return t in BUCKET_TOKENS or bool(DIGIT_RE.search(t))


def signature(tokens: list[str]) -> tuple[str, frozenset[str]]:
    """Return (sorted-content-signature, bucket-token-set)."""
    bucket = frozenset(t for t in tokens if is_bucket(t))
    content = sorted(t for t in tokens if not is_bucket(t))
    return (" ".join(content), bucket)


def connect():
    common = xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/common")
    uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_PASSWORD, {})
    if not uid:
        sys.exit("ERROR: authentication failed")
    return uid, xmlrpc.client.ServerProxy(f"{ODOO_URL}/xmlrpc/2/object")


def call(models, uid, model, method, args, kwargs=None):
    return models.execute_kw(ODOO_DB, uid, ODOO_PASSWORD, model, method, args, kwargs or {})


def fetch_products(models, uid):
    return call(models, uid, "product.product", "search_read",
                [[["active", "=", True]]],
                {"fields": ["id", "name", "default_code", "product_tmpl_id",
                            "uom_id", "company_id"]})


def fetch_bom_usage(models, uid, product_ids):
    """Return {product_id: bom_line_count} for the given product ids."""
    counts = defaultdict(int)
    BATCH = 500
    for i in range(0, len(product_ids), BATCH):
        chunk = product_ids[i:i + BATCH]
        lines = call(models, uid, "mrp.bom.line", "search_read",
                     [[["product_id", "in", chunk]]],
                     {"fields": ["product_id"]})
        for l in lines:
            counts[l["product_id"][0]] += 1
    return counts


def render_group(group, bom_counts):
    """Group is a list of product dicts. Returns (winner_id, lines)."""
    enriched = [(p, bom_counts.get(p["id"], 0)) for p in group]
    enriched.sort(key=lambda pc: (-pc[1], len(pc[0]["name"]), pc[0]["id"]))
    winner = enriched[0][0]
    lines = []
    for p, c in enriched:
        marker = "WINNER" if p["id"] == winner["id"] else "      "
        uom = p["uom_id"][1] if p["uom_id"] else "?"
        lines.append(f"  {marker}  id={p['id']:>5}  bom_uses={c:>3}  uom={uom:<8}  {p['name']!r}")
    return winner["id"], lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=float, default=0.90,
                    help="Near-match similarity threshold (default 0.90)")
    args = ap.parse_args()

    uid, models = connect()
    print("Fetching products…", file=sys.stderr)
    products = fetch_products(models, uid)
    print(f"  {len(products)} active products", file=sys.stderr)

    print("Counting BOM-line usage…", file=sys.stderr)
    bom_counts = fetch_bom_usage(models, uid, [p["id"] for p in products])
    total_with_usage = sum(1 for p in products if bom_counts.get(p["id"]))
    print(f"  {total_with_usage} products are referenced by ≥1 BOM line",
          file=sys.stderr)

    # --- Layer 1: exact normalized match -----------------------------------
    exact_groups = defaultdict(list)
    for p in products:
        toks = tokenize(p["name"])
        sig = signature(toks)
        exact_groups[sig].append(p)
    exact_dups = [g for sig, g in exact_groups.items() if len(g) > 1]

    # --- Layer 2: near-match within identical bucket ----------------------
    bucket_groups = defaultdict(list)
    for p in products:
        toks = tokenize(p["name"])
        content, bucket = signature(toks)
        bucket_groups[bucket].append((p, content))

    near_pairs = []
    seen_pair = set()
    exact_pair_keys = set()
    for grp in exact_dups:
        ids = sorted(p["id"] for p in grp)
        for a, b in combinations(ids, 2):
            exact_pair_keys.add((a, b))

    for bucket, items in bucket_groups.items():
        if len(items) < 2:
            continue
        for (pa, ca), (pb, cb) in combinations(items, 2):
            if not ca or not cb:
                continue
            key = tuple(sorted([pa["id"], pb["id"]]))
            if key in exact_pair_keys or key in seen_pair:
                continue
            ratio = SequenceMatcher(None, ca, cb).ratio()
            if ratio >= args.threshold:
                seen_pair.add(key)
                near_pairs.append((ratio, pa, pb, bucket))

    # Group near-pairs into connected clusters by id
    parent = {}

    def find(x):
        while parent.get(x, x) != x:
            parent[x] = parent.get(parent[x], parent[x])
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for _, pa, pb, _ in near_pairs:
        parent.setdefault(pa["id"], pa["id"])
        parent.setdefault(pb["id"], pb["id"])
        union(pa["id"], pb["id"])

    near_clusters = defaultdict(list)
    by_id = {p["id"]: p for p in products}
    for pid in parent:
        near_clusters[find(pid)].append(by_id[pid])
    near_groups = [g for g in near_clusters.values() if len(g) > 1]

    # --- Output ------------------------------------------------------------
    os.makedirs("reports", exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")
    md_path = f"reports/duplicate_products_{ts}.md"
    json_path = f"reports/duplicate_products_{ts}.json"

    candidates = []
    md = []
    md.append("# Duplicate Products Audit")
    md.append("")
    md.append(f"_Generated {time.strftime('%Y-%m-%d %H:%M')} — staging ({ODOO_DB})_")
    md.append("")
    md.append(f"- {len(products)} active products scanned")
    md.append(f"- {len(exact_dups)} exact-match duplicate groups")
    md.append(f"- {len(near_groups)} near-match duplicate groups (similarity ≥ {args.threshold})")
    md.append("")
    md.append("**Winner = product most-used in BOMs** (tie-break: shortest name, lowest id).")
    md.append("Form/color/qualifier tokens (whole/ground/fresh/red/yellow/fine/...) split groups so different forms never collide.")
    md.append("")

    md.append("## Exact-match duplicate groups")
    md.append("")
    if not exact_dups:
        md.append("_None._")
    for g in sorted(exact_dups, key=lambda x: x[0]["name"].lower()):
        winner_id, lines = render_group(g, bom_counts)
        md.append(f"### {g[0]['name']}  →  winner id={winner_id}")
        md.append("```")
        md.extend(lines)
        md.append("```")
        candidates.append({
            "kind": "exact",
            "winner_id": winner_id,
            "loser_ids": [p["id"] for p in g if p["id"] != winner_id],
            "names": {p["id"]: p["name"] for p in g},
            "bom_uses": {p["id"]: bom_counts.get(p["id"], 0) for p in g},
        })

    md.append("")
    md.append("## Near-match duplicate groups")
    md.append("")
    if not near_groups:
        md.append("_None._")
    for g in sorted(near_groups, key=lambda x: x[0]["name"].lower()):
        winner_id, lines = render_group(g, bom_counts)
        md.append(f"### {g[0]['name']} (and similar)  →  winner id={winner_id}")
        md.append("```")
        md.extend(lines)
        md.append("```")
        candidates.append({
            "kind": "near",
            "winner_id": winner_id,
            "loser_ids": [p["id"] for p in g if p["id"] != winner_id],
            "names": {p["id"]: p["name"] for p in g},
            "bom_uses": {p["id"]: bom_counts.get(p["id"], 0) for p in g},
        })

    md.append("")
    md.append("## Notes")
    md.append("")
    md.append("- This is **read-only**. No products or BOMs were modified.")
    md.append("- Review each group manually. False positives are likely for items that differ in pack size, vendor, or grade.")
    md.append("- Once approved, run a merge script that rewrites mrp.bom.line.product_id and archives losers (do **not** delete — preserves history).")

    with open(md_path, "w") as f:
        f.write("\n".join(md))
    with open(json_path, "w") as f:
        json.dump(candidates, f, indent=2)

    print(f"\nReport: {md_path}")
    print(f"JSON:   {json_path}")
    print(f"Exact-match groups: {len(exact_dups)}")
    print(f"Near-match groups:  {len(near_groups)}")


if __name__ == "__main__":
    main()
