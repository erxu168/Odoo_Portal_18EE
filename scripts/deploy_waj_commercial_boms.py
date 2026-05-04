#!/usr/bin/env python3
"""
Deploy WAJ Commercial-style Jerk Dry Mix and Jerk Paste BOMs to Odoo 18 EE staging.

Recipe source: Feed & Tech YouTube channel (commercial Walkerswood/Eaton's-style).
Includes soy sauce, cloves, nutmeg, browning sauce, lager beer, orange juice
plus yellow onion. This is the "modern commercial" Caribbean jerk profile.

Coexists with v2.0 Boston Bay style (deployed 2026-04-26, BOM ids 166, 167)
for side-by-side production testing.

Differences vs v2.0 Boston Bay:
- Adds: cloves, nutmeg, soy sauce, browning sauce, lager beer, orange juice, yellow onion
- Lower allspice/scallion/scotch bonnet/thyme proportions
- Salt level: dry mix 36% salt, paste 6.6% salt (vs v2 6.9%)
- Application: 220g paste/kg chicken = 14.5g salt/kg chicken

Deploy history:
- 2026-04-26: First deployed to staging. BOM ids 168, 169.
  Products: 1576 (Dry Mix), 1577 (Wet Paste).

Credentials: reads ODOO_PASSWORD from .env.local or environment. Never committed.
"""

import argparse
import os
import sys
import xmlrpc.client
from pathlib import Path
from typing import Optional


def load_env_local():
    env_path = Path(__file__).parent / ".env.local"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key not in os.environ:
            os.environ[key] = value


load_env_local()

ODOO_URL = os.environ.get("ODOO_URL", "https://test18ee.krawings.de")
ODOO_DB = os.environ.get("ODOO_DB", "krawings")
ODOO_USER = os.environ.get("ODOO_USER", "biz@krawings.de")
ODOO_PASSWORD = os.environ.get("ODOO_PASSWORD")

if not ODOO_PASSWORD:
    print("ERROR: ODOO_PASSWORD not set in environment or .env.local")
    sys.exit(1)

WAJ_COMPANY_ID = 5

# ----------------------------------------------------------------------------
# COMPONENT INVENTORY - Commercial v1.0
# ----------------------------------------------------------------------------

DRY_MIX_COMPONENTS = [
    {"name": "Pimento berries (allspice), whole", "qty": 2.500},
    {"name": "Cloves, whole", "qty": 0.250},
    {"name": "Black peppercorns, whole", "qty": 0.400},
    {"name": "Nutmeg, whole", "qty": 0.250},
    {"name": "Brown sugar", "qty": 3.000},
    {"name": "Salt, fine", "qty": 3.600},
]

WET_PASTE_COMPONENTS = [
    {"name": "WAJ - Commercial Jerk Dry Mix", "qty": 2.030, "is_subassembly": True},
    {"name": "Scallions, fresh", "qty": 2.000},
    {"name": "Onions, yellow, fresh", "qty": 0.600},
    {"name": "Garlic, fresh", "qty": 0.800},
    {"name": "Ginger, fresh", "qty": 0.300},
    {"name": "Scotch Bonnet Pepper, fresh", "qty": 0.400},
    {"name": "Thyme, fresh", "qty": 0.300},
    {"name": "Kikkoman Soy Sauce 20L", "qty": 1.200},
    {"name": "Rapeseed Oil", "qty": 0.900},
    {"name": "Apple Cider Vinegar", "qty": 0.600},
    {"name": "Lager beer", "qty": 1.200},
    {"name": "Browning sauce (Grace)", "qty": 0.150},
    {"name": "Orange Juice, fresh", "qty": 0.600},
    {"name": "Lime Juice, fresh", "qty": 0.300},
]

# ----------------------------------------------------------------------------
# WORK ORDER OPERATIONS
# ----------------------------------------------------------------------------

DRY_MIX_OPERATIONS = [
    {
        "name": "Toast whole spices",
        "time_cycle_manual": 8,
        "note": """<h3>Toast whole spices</h3>
<ul>
  <li><b>Action:</b> Combine 2.500 kg pimento berries, 0.250 kg whole cloves, 0.400 kg black peppercorns into dry stainless pan over medium heat.</li>
  <li><b>Action:</b> Stir continuously for 3-4 minutes. Toast in batches if pan capacity is small.</li>
  <li><b>Visual marker:</b> Pull from heat the moment you smell strong aromatic bloom. Do not let them smoke.</li>
  <li><b>Tip:</b> Overshooting by 30 seconds turns the spices bitter and ruins the batch. Pull early if in doubt.</li>
  <li><b>Action:</b> Transfer to a sheet tray, spread thin, cool to room temperature (5-10 min).</li>
</ul>""",
    },
    {
        "name": "Grind toasted spices",
        "time_cycle_manual": 5,
        "note": """<h3>Grind toasted spices to medium-fine</h3>
<ul>
  <li><b>Action:</b> Transfer cooled toasted spices to spice grinder.</li>
  <li><b>Action:</b> Grind in 30-second pulses until medium-fine consistency.</li>
  <li><b>Visual marker:</b> Uniform texture like coarse coffee grounds. Not powder, not coarse fragments.</li>
  <li><b>Action:</b> Pass through fine-mesh sieve. Re-grind any large fragments.</li>
  <li><b>Tip:</b> Clean grinder thoroughly between batches - residual oils go rancid.</li>
</ul>""",
    },
    {
        "name": "Grate nutmeg fresh",
        "time_cycle_manual": 6,
        "note": """<h3>Grate whole nutmeg fresh</h3>
<ul>
  <li><b>Action:</b> Grate 0.250 kg whole nutmeg on fine microplane.</li>
  <li><b>Visual marker:</b> Fluffy, fragrant, light-brown powder. Should smell intensely of nutmeg.</li>
  <li><b>Tip:</b> Always grate fresh - pre-ground nutmeg loses 60% of volatile oils within weeks.</li>
</ul>""",
    },
    {
        "name": "Blend dry mix",
        "time_cycle_manual": 4,
        "note": """<h3>Combine all dry components</h3>
<ul>
  <li><b>Action:</b> In large stainless mixing bowl combine: ground toasted spices (~3.150 kg), grated nutmeg (0.250 kg), 3.000 kg brown sugar, 3.600 kg salt.</li>
  <li><b>Mix:</b> Whisk thoroughly for 2 minutes until colour is uniform throughout.</li>
  <li><b>Visual marker:</b> Uniform medium-brown colour with visible darker spice flecks. No streaks of white salt or brown sugar lumps.</li>
  <li><b>Tip:</b> Break up hardened brown sugar before adding. Lumpy sugar prevents even distribution into wet paste.</li>
</ul>""",
    },
    {
        "name": "Pack and label",
        "time_cycle_manual": 8,
        "note": """<h3>Vacuum-pack into production portions</h3>
<ul>
  <li><b>Action:</b> Portion into 2.030 kg vacuum bags (one bag = one wet paste batch). 5 bags total per 10 kg dry mix run.</li>
  <li><b>Action:</b> Vacuum-seal at high vacuum.</li>
  <li><b>Action:</b> Label each bag: WAJ Commercial Jerk Dry Mix v1.0, batch date, expiry date (production date + 8 weeks), operator initials.</li>
  <li><b>Tip:</b> Store in chiller at 2-4 degrees C. Can be frozen for 6 months for longer storage.</li>
</ul>""",
    },
]

WET_PASTE_OPERATIONS = [
    {
        "name": "Aromatic prep",
        "time_cycle_manual": 25,
        "note": """<h3>Prepare fresh aromatics</h3>
<ul>
  <li><b>Action:</b> Trim root ends from 2.000 kg scallions. Use both white and green parts. Rough chop into 5cm pieces.</li>
  <li><b>Action:</b> Peel and rough chop 0.600 kg yellow onion.</li>
  <li><b>Action:</b> Peel 0.800 kg garlic cloves.</li>
  <li><b>Action:</b> Peel and rough chop 0.300 kg ginger.</li>
  <li><b>Action:</b> Stem 0.400 kg scotch bonnet peppers. Leave seeds in for full heat. <b>Mandatory:</b> nitrile gloves, no contact with face or eyes for 4 hours after handling.</li>
  <li><b>Action:</b> Strip leaves from 0.300 kg fresh thyme stems. Discard stems.</li>
  <li><b>Visual marker:</b> All ingredients prepped before any blending begins. Mise en place is critical.</li>
</ul>""",
    },
    {
        "name": "Blend solids with dry mix",
        "time_cycle_manual": 5,
        "note": """<h3>Blend solids with dry mix</h3>
<ul>
  <li><b>Action:</b> Into industrial blender combine: all prepped aromatics (scallion, onion, garlic, ginger, scotch bonnet, thyme leaves) plus 2.030 kg WAJ Commercial Jerk Dry Mix.</li>
  <li><b>Mix:</b> Pulse 5-6 times to break down solids before adding liquids.</li>
  <li><b>Visual marker:</b> Coarse, chunky green-brown mixture. Solids reduced but not yet pasty.</li>
  <li><b>Tip:</b> Adding dry mix at this stage lets the salt start drawing moisture from aromatics, improving blending.</li>
</ul>""",
    },
    {
        "name": "Final blend with liquids",
        "time_cycle_manual": 5,
        "note": """<h3>Add liquids and blend to paste</h3>
<ul>
  <li><b>Action:</b> Add to blender in order: 1.200 kg soy sauce, 0.900 kg rapeseed oil, 0.600 kg apple cider vinegar, 1.200 kg lager beer, 0.150 kg browning sauce, 0.600 kg orange juice, 0.300 kg lime juice.</li>
  <li><b>Mix:</b> Run on medium-high for 60-90 seconds.</li>
  <li><b>Visual marker:</b> Thick, coarse paste with visible spice/herb flecks. Pours slowly off a spoon. <b>Deep mahogany colour</b> from browning sauce (this is the visual difference vs Boston Bay style).</li>
  <li><b>Tip:</b> Do not over-blend to fully smooth. Some texture is correct. If too thick, pulse in additional 100g lager. If too thin, pulse in additional 50g rapeseed oil.</li>
</ul>""",
    },
    {
        "name": "Portion, pack, chill",
        "time_cycle_manual": 12,
        "note": """<h3>Portion, vacuum-pack, label, chill</h3>
<ul>
  <li><b>Action:</b> Portion finished paste into vacuum bags. Suggested portions: 5x 2.000 kg bags + 1x 1.380 kg bag.</li>
  <li><b>Action:</b> Vacuum-seal at high vacuum.</li>
  <li><b>Action:</b> Label each bag: WAJ Commercial Jerk Paste v1.0, batch date, expiry date (production date + 7 days), operator initials.</li>
  <li><b>Action:</b> Transfer to chiller at 2-4 degrees C. Hold minimum 4 hours before first use, ideally overnight.</li>
  <li><b>Tip:</b> The 4-hour minimum chill is non-negotiable. The salt fully dissolves, raw garlic/onion harshness mellows, flavours marry.</li>
</ul>""",
    },
]

# ----------------------------------------------------------------------------
# PRODUCTS
# ----------------------------------------------------------------------------

DRY_MIX_PRODUCT = {
    "name": "WAJ - Commercial Jerk Dry Mix",
    "type": "consu", "is_storable": True,
    "company_id": WAJ_COMPANY_ID,
    "sale_ok": False, "purchase_ok": False,
    "tracking": "lot",
    "description": (
        "Sub-assembly for WAJ Commercial Jerk Paste production (Feed & Tech / "
        "Walkerswood-style commercial recipe). Pre-blended toasted/ground dry mix "
        "with cloves and nutmeg. Yields ~5 wet paste batches per 10 kg dry mix run. "
        "Shelf life: 8 weeks vacuum-sealed in chiller (2-4 C); 6 months frozen. "
        "Coexists with WAJ - Boston Bay Jerk Dry Mix (v2.0 traditional recipe) "
        "for side-by-side production testing."
    ),
}

WET_PASTE_PRODUCT = {
    "name": "WAJ - Commercial Jerk Paste",
    "type": "consu", "is_storable": True,
    "company_id": WAJ_COMPANY_ID,
    "sale_ok": False, "purchase_ok": False,
    "tracking": "lot",
    "description": (
        "Finished commercial-style jerk paste for WAJ chicken marination. "
        "Modern Walkerswood/Eaton's-style profile with soy sauce, cloves, nutmeg, "
        "browning sauce, lager beer, orange juice. Includes yellow onion. "
        "Application: 220 g paste per 1 kg chicken (tumble or vacuum-bag method). "
        "Yield: ~52 kg chicken per 11.4 kg paste batch. "
        "Shelf life: 7 days vacuum-sealed chiller (2-4 C); 90 days frozen. "
        "Coexists with WAJ - Boston Bay Jerk Paste (v2.0 traditional recipe) "
        "for side-by-side production testing."
    ),
}

# ----------------------------------------------------------------------------
# ODOO CLIENT
# ----------------------------------------------------------------------------


class OdooClient:
    def __init__(self, url, db, user, password):
        self.url, self.db, self.user, self.password = url, db, user, password
        common = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/common")
        self.uid = common.authenticate(db, user, password, {})
        if not self.uid:
            raise RuntimeError("Auth failed")
        self.models = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/object")
        print(f"Connected to {url} as uid={self.uid}")

    def execute(self, model, method, *args, **kwargs):
        return self.models.execute_kw(self.db, self.uid, self.password, model, method, list(args), kwargs)

    def search_read(self, model, domain, fields, limit=0):
        return self.execute(model, "search_read", domain, fields=fields, limit=limit)

    def find_product(self, name):
        results = self.search_read("product.product", [("name", "=ilike", name)], ["id", "name"], limit=1)
        return results[0] if results else None

    def find_uom_kg(self):
        results = self.search_read("uom.uom", [("name", "=", "kg")], ["id"], limit=1)
        if not results:
            raise RuntimeError("UoM 'kg' not found")
        return results[0]["id"]

    def find_or_create_workcenter(self, name):
        results = self.search_read("mrp.workcenter",
            [("name", "=", name), ("company_id", "=", WAJ_COMPANY_ID)],
            ["id"], limit=1)
        if results:
            return results[0]["id"]
        # Multi-company resource calendar fix (same as v2.0 deploy)
        cals = self.search_read("resource.calendar",
            [("company_id", "=", WAJ_COMPANY_ID)], ["id"], limit=1)
        cal_id = cals[0]["id"] if cals else False
        return self.execute("mrp.workcenter", "create",
            {"name": name, "company_id": WAJ_COMPANY_ID, "time_efficiency": 100.0,
             "resource_calendar_id": cal_id})


# ----------------------------------------------------------------------------
# DEPLOY
# ----------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()

    print("=" * 70)
    print("WAJ Commercial Jerk Paste BOM Deployment v1.0")
    print(f"Mode: {'LIVE' if args.execute else 'DRY-RUN'}")
    print("=" * 70)

    c = OdooClient(ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD)

    print("\n=== PREFLIGHT ===\n")
    uom_kg_id = c.find_uom_kg()
    print(f"[OK] UoM kg id={uom_kg_id}")

    print("\nDry mix components:")
    dry_resolved, dry_missing = [], []
    for comp in DRY_MIX_COMPONENTS:
        p = c.find_product(comp["name"])
        if p:
            print(f"  [OK]      {comp['name']:50} -> id={p['id']}")
            dry_resolved.append({**comp, "product_id": p["id"]})
        else:
            print(f"  [MISSING] {comp['name']:50}")
            dry_missing.append(comp)

    print("\nWet paste components:")
    wet_resolved, wet_missing = [], []
    for comp in WET_PASTE_COMPONENTS:
        if comp.get("is_subassembly"):
            print(f"  [DEFER]   {comp['name']:50} (created by this script)")
            wet_resolved.append(comp)
            continue
        p = c.find_product(comp["name"])
        if p:
            print(f"  [OK]      {comp['name']:50} -> id={p['id']}")
            wet_resolved.append({**comp, "product_id": p["id"]})
        else:
            print(f"  [MISSING] {comp['name']:50}")
            wet_missing.append(comp)

    if dry_missing or wet_missing:
        print("\n*** MISSING COMPONENTS - HALTING ***")
        for m in dry_missing + wet_missing:
            print(f"  - {m['name']}")
        sys.exit(1)

    print(f"\n=== DEPLOYMENT ({'LIVE' if args.execute else 'DRY-RUN'}) ===\n")

    if not args.execute:
        print("[DRY] Would create work centre, 2 products, 2 BOMs.")
        print(f"[DRY] Dry mix: 10 kg yield, {len(dry_resolved)} components, {len(DRY_MIX_OPERATIONS)} ops")
        print(f"[DRY] Wet paste: 11.39 kg yield, {len(wet_resolved)} components, {len(WET_PASTE_OPERATIONS)} ops")
        print("\nDry-run complete. Run with --execute to deploy.")
        return

    wc_id = c.find_or_create_workcenter("WAJ Central Kitchen Production")
    print(f"[OK] Work centre id={wc_id}")

    # Dry mix product
    existing = c.find_product(DRY_MIX_PRODUCT["name"])
    if existing:
        dry_mix_id = existing["id"]
        print(f"[OK] Dry Mix product already exists id={dry_mix_id}")
    else:
        dry_mix_id = c.execute("product.product", "create",
            {**DRY_MIX_PRODUCT, "uom_id": uom_kg_id, "uom_po_id": uom_kg_id})
        print(f"[OK] Created Dry Mix product id={dry_mix_id}")

    # Wet paste product
    existing = c.find_product(WET_PASTE_PRODUCT["name"])
    if existing:
        wet_paste_id = existing["id"]
        print(f"[OK] Wet Paste product already exists id={wet_paste_id}")
    else:
        wet_paste_id = c.execute("product.product", "create",
            {**WET_PASTE_PRODUCT, "uom_id": uom_kg_id, "uom_po_id": uom_kg_id})
        print(f"[OK] Created Wet Paste product id={wet_paste_id}")

    # BOM 1: Dry Mix
    print("\n--- BOM 1: Commercial Jerk Dry Mix ---")
    lines = [(0, 0, {"product_id": comp["product_id"], "product_qty": comp["qty"], "product_uom_id": uom_kg_id})
             for comp in dry_resolved]
    ops = [(0, 0, {"name": op["name"], "workcenter_id": wc_id,
                   "time_cycle_manual": op["time_cycle_manual"], "note": op["note"]})
           for op in DRY_MIX_OPERATIONS]
    tmpl_id = c.search_read("product.product", [("id", "=", dry_mix_id)], ["product_tmpl_id"])[0]["product_tmpl_id"][0]
    bom1 = c.execute("mrp.bom", "create", {
        "product_tmpl_id": tmpl_id, "product_id": dry_mix_id,
        "product_qty": 10.0, "product_uom_id": uom_kg_id,
        "type": "normal", "company_id": WAJ_COMPANY_ID,
        "code": "WAJ-COMM-DRY-MIX-v1.0",
        "bom_line_ids": lines, "operation_ids": ops,
    })
    print(f"[OK] Created Commercial Dry Mix BOM id={bom1} ({len(lines)} components, {len(ops)} ops)")

    # BOM 2: Wet Paste
    print("\n--- BOM 2: Commercial Jerk Paste ---")
    for comp in wet_resolved:
        if comp.get("is_subassembly"):
            comp["product_id"] = dry_mix_id
    lines = [(0, 0, {"product_id": comp["product_id"], "product_qty": comp["qty"], "product_uom_id": uom_kg_id})
             for comp in wet_resolved]
    ops = [(0, 0, {"name": op["name"], "workcenter_id": wc_id,
                   "time_cycle_manual": op["time_cycle_manual"], "note": op["note"]})
           for op in WET_PASTE_OPERATIONS]
    tmpl_id = c.search_read("product.product", [("id", "=", wet_paste_id)], ["product_tmpl_id"])[0]["product_tmpl_id"][0]
    bom2 = c.execute("mrp.bom", "create", {
        "product_tmpl_id": tmpl_id, "product_id": wet_paste_id,
        "product_qty": 11.39, "product_uom_id": uom_kg_id,
        "type": "normal", "company_id": WAJ_COMPANY_ID,
        "code": "WAJ-COMM-JERK-PASTE-v1.0",
        "bom_line_ids": lines, "operation_ids": ops,
    })
    print(f"[OK] Created Commercial Wet Paste BOM id={bom2} ({len(lines)} components, {len(ops)} ops)")

    print("\n=== DEPLOYMENT COMPLETE ===")


if __name__ == "__main__":
    main()
