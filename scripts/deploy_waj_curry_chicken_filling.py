#!/usr/bin/env python3
"""
Deploy WAJ Curry Chicken Patty Filling product + BOM to Odoo 18 EE staging.

Target: test18ee.krawings.de
Database: krawings
User: biz@krawings.de
Company: What a Jerk (id=5)

Source recipe: https://www.youtube.com/watch?v=a8W6b8Xuafk

Creates:
1. Product: WAJ - Curry Chicken Patty Filling (storable, kg, company=WAJ)
2. BOM: 17-line ingredient list, batch yield = 1.120 kg
3. Operations: 4 work-order steps with HTML notes embedded

Method:
- Brown curry powder in oil (Jamaican curry technique)
- Caramelize aromatics
- Add carrot + potato, then chicken
- Coconut milk simmer, finish with cornstarch slurry

Usage:
    # Dry-run mode (default) - reports what would be created, writes nothing
    python3 deploy_waj_curry_chicken_filling.py

    # Live mode - actually writes to staging
    python3 deploy_waj_curry_chicken_filling.py --execute
"""

import argparse
import sys
import xmlrpc.client
from typing import List, Optional

# ----------------------------------------------------------------------------
# CONFIG
# ----------------------------------------------------------------------------

ODOO_URL = "https://test18ee.krawings.de"
ODOO_DB = "krawings"
ODOO_USER = "biz@krawings.de"
ODOO_PASSWORD = "exEV3M<v3."

WAJ_COMPANY_ID = 5

# ----------------------------------------------------------------------------
# RECIPE - Curry Chicken Patty Filling (1.120 kg batch)
# ----------------------------------------------------------------------------

# Each entry maps the recipe ingredient name to candidate Odoo product names
# to look up. Search uses "=ilike" so case is irrelevant; aliases let us
# match products that may already exist under slightly different names.
COMPONENTS = [
    {"name": "Chicken thigh, deboned",       "qty": 0.220, "aliases": ["Chicken thigh, deboned", "Chicken Thigh Deboned", "Chicken thigh deboned"]},
    {"name": "Chicken leg, deboned",         "qty": 0.200, "aliases": ["Chicken leg, deboned", "Chicken Leg Deboned", "Chicken leg deboned"]},
    {"name": "Scotch Bonnet Pepper, fresh",  "qty": 0.005, "aliases": ["Scotch Bonnet Pepper, fresh", "Scotch bonnet pepper", "Scotch Bonnet"]},
    {"name": "Red onion",                    "qty": 0.075, "aliases": ["Red onion", "Onion, red", "Red Onion"]},
    {"name": "Bell pepper, green",           "qty": 0.075, "aliases": ["Bell pepper, green", "Green bell pepper", "Green Bell Pepper", "Pepper, green bell"]},
    {"name": "Scallions, fresh",             "qty": 0.022, "aliases": ["Scallions, fresh", "Scallion", "Scallions", "Spring onion"]},
    {"name": "Thyme, fresh",                 "qty": 0.002, "aliases": ["Thyme, fresh", "Fresh thyme", "Thyme fresh"]},
    {"name": "Garlic, fresh",                "qty": 0.014, "aliases": ["Garlic, fresh", "Fresh garlic", "Garlic"]},
    {"name": "Carrot",                       "qty": 0.080, "aliases": ["Carrot", "Carrots", "Carrot, fresh"]},
    {"name": "Potato",                       "qty": 0.150, "aliases": ["Potato", "Potatoes", "Irish potato"]},
    {"name": "All spice (Pimento), whole",   "qty": 0.006, "aliases": ["All spice (Pimento), whole", "Pimento, ground", "Allspice, ground", "Pimento ground", "Allspice"]},
    {"name": "Coriander powder",             "qty": 0.005, "aliases": ["Coriander powder", "Coriander, ground", "Ground coriander"]},
    {"name": "Salt, fine",                   "qty": 0.005, "aliases": ["Salt, fine", "Salt", "Fine salt"]},
    {"name": "Black pepper, ground",         "qty": 0.002, "aliases": ["Black pepper, ground", "Black pepper", "Ground black pepper"]},
    {"name": "Curry powder",                 "qty": 0.003, "aliases": ["Curry powder", "Curry powder, Jamaican", "Jamaican curry powder"]},
    {"name": "Coconut milk",                 "qty": 0.240, "aliases": ["Coconut milk", "Coconut Milk"]},
    {"name": "Cornstarch",                   "qty": 0.016, "aliases": ["Cornstarch", "Corn starch", "Maize starch"]},
]

# ----------------------------------------------------------------------------
# WORK ORDER OPERATIONS
# ----------------------------------------------------------------------------

OPERATIONS = [
    {
        "name": "Mise en place",
        "time_cycle_manual": 12,
        "note": """<h3>Wash, prep, and portion all ingredients</h3>
<ul>
  <li><b>Sanitation:</b> Wash and sanitize all utensils, knives, and containers. Wear gloves.</li>
  <li><b>Vegetables:</b> Wash all vegetables.</li>
  <li><b>Scotch bonnet:</b> Deseed and remove inner membrane. Dice fine. Nitrile gloves mandatory.</li>
  <li><b>Vegetables:</b> Dice red onion, green bell pepper, carrot, potato. Slice scallion (whites and greens).</li>
  <li><b>Aromatics:</b> Roughly chop garlic. Strip thyme leaves from stems.</li>
  <li><b>Chicken:</b> Dice chicken thigh and leg into small pieces. Season with salt and pepper.</li>
  <li><b>Spices:</b> Grind pimento and any whole spices. Combine pimento, coriander powder, curry powder into one dry blend.</li>
</ul>""",
    },
    {
        "name": "Brown the curry",
        "time_cycle_manual": 3,
        "note": """<h3>Bloom curry powder in hot oil (Jamaican technique)</h3>
<ul>
  <li><b>Action:</b> Heat oil in pan over medium-high.</li>
  <li><b>Action:</b> Add the dry spice blend (pimento, coriander, curry powder).</li>
  <li><b>Visual marker:</b> Stir 1-2 minutes until fragrant and the curry darkens. Do not let it burn.</li>
  <li><b>Tip:</b> This step is the foundation of Jamaican curry flavour. Skipping it produces a raw, dusty taste.</li>
</ul>""",
    },
    {
        "name": "Caramelize aromatics, add chicken",
        "time_cycle_manual": 10,
        "note": """<h3>Build the base, then sear chicken</h3>
<ul>
  <li><b>Action:</b> Add red onion, green bell pepper, scallion, garlic, thyme, and scotch bonnet to the bloomed curry.</li>
  <li><b>Visual marker:</b> Cook until aromatics are caramelized.</li>
  <li><b>Action:</b> Add diced carrot and potato. Stir to coat in curry.</li>
  <li><b>Action:</b> Add seasoned chicken thigh and leg. Sear until browned on all sides.</li>
</ul>""",
    },
    {
        "name": "Simmer with coconut milk and finish",
        "time_cycle_manual": 20,
        "note": """<h3>Simmer in coconut milk, thicken with cornstarch slurry, chill</h3>
<ul>
  <li><b>Action:</b> Pour in coconut milk. Bring to a simmer.</li>
  <li><b>Visual marker:</b> Simmer until chicken is cooked through and potato/carrot are tender.</li>
  <li><b>Action:</b> Make a cornstarch slurry with cold water. Stir into the pan.</li>
  <li><b>Visual marker:</b> Cook 1-2 minutes until thickened.</li>
  <li><b>Cool:</b> Cool to <= 4 C before patty assembly. Hold chilled.</li>
</ul>""",
    },
]

# ----------------------------------------------------------------------------
# PRODUCT DEFINITION
# ----------------------------------------------------------------------------

FILLING_PRODUCT = {
    "name": "WAJ - Curry Chicken Patty Filling",
    "type": "consu",
    "is_storable": True,
    "company_id": WAJ_COMPANY_ID,
    "sale_ok": False,
    "purchase_ok": False,
    "tracking": "lot",
    "description": (
        "Filling component for the WAJ Curry Chicken Patty. "
        "Jamaican-style curry chicken with bloomed curry, caramelized aromatics, "
        "scotch bonnet, and coconut milk. Batch yield 1.120 kg. "
        "Source: youtube.com/watch?v=a8W6b8Xuafk. "
        "Cool to <=4 C before patty assembly."
    ),
}

BOM_NAME = "WAJ - Curry Chicken Patty Filling"
BOM_QTY = 1.120  # kg, sum of all 17 ingredient lines


# ----------------------------------------------------------------------------
# ODOO HELPERS
# ----------------------------------------------------------------------------


class OdooClient:
    def __init__(self, url: str, db: str, user: str, password: str):
        self.url = url
        self.db = db
        self.user = user
        self.password = password
        self.uid = None
        self.models = None
        self._connect()

    def _connect(self):
        common = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/common")
        self.uid = common.authenticate(self.db, self.user, self.password, {})
        if not self.uid:
            raise RuntimeError("Authentication failed")
        self.models = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/object")
        print(f"Connected to {self.url} as uid={self.uid}")

    def execute(self, model: str, method: str, *args, **kwargs):
        return self.models.execute_kw(
            self.db, self.uid, self.password, model, method, list(args), kwargs
        )

    def search_read(self, model: str, domain: list, fields: list, limit: int = 0):
        return self.execute(model, "search_read", domain, fields=fields, limit=limit)

    def find_product_any(self, aliases: List[str]) -> Optional[dict]:
        for alias in aliases:
            results = self.search_read(
                "product.product",
                [("name", "=ilike", alias)],
                ["id", "name", "uom_id", "company_id"],
                limit=1,
            )
            if results:
                return results[0]
        return None

    def find_uom_kg(self) -> int:
        results = self.search_read(
            "uom.uom", [("name", "=", "kg")], ["id"], limit=1
        )
        if not results:
            raise RuntimeError("UoM 'kg' not found in Odoo")
        return results[0]["id"]

    def find_or_create_workcenter(self, name: str) -> int:
        results = self.search_read(
            "mrp.workcenter",
            [("name", "=", name), ("company_id", "=", WAJ_COMPANY_ID)],
            ["id"],
            limit=1,
        )
        if results:
            return results[0]["id"]
        return self.execute(
            "mrp.workcenter",
            "create",
            {"name": name, "company_id": WAJ_COMPANY_ID, "time_efficiency": 100.0},
        )


# ----------------------------------------------------------------------------
# MAIN DEPLOYMENT LOGIC
# ----------------------------------------------------------------------------


def preflight_checks(client: OdooClient) -> dict:
    """Run all read-only checks. Returns a context dict for the deployment."""
    print("\n=== PREFLIGHT CHECKS ===\n")

    company = client.search_read(
        "res.company", [("id", "=", WAJ_COMPANY_ID)], ["id", "name"], limit=1
    )
    if not company:
        raise RuntimeError(f"Company id={WAJ_COMPANY_ID} (What a Jerk) not found")
    print(f"[OK] Company: {company[0]['name']} (id={company[0]['id']})")

    uom_kg_id = client.find_uom_kg()
    print(f"[OK] UoM 'kg' found (id={uom_kg_id})")

    print("\nIngredient lookup:")
    resolved = []
    missing = []
    for comp in COMPONENTS:
        product = client.find_product_any(comp["aliases"])
        if product:
            print(f"  [OK]      {comp['name']:35} -> id={product['id']:<6} {product['name']}")
            resolved.append({**comp, "product_id": product["id"]})
        else:
            print(f"  [MISSING] {comp['name']:35}")
            missing.append(comp)

    print(f"\nFound: {len(resolved)}/{len(COMPONENTS)}  Missing: {len(missing)}")

    # Check whether the filling product itself already exists
    existing_filling = client.find_product_any([FILLING_PRODUCT["name"]])
    if existing_filling:
        print(f"\n[NOTE] Filling product already exists (id={existing_filling['id']}). "
              "Will reuse rather than create.")
    else:
        print(f"\n[NOTE] Filling product does not exist yet. Will create.")

    return {
        "uom_kg_id": uom_kg_id,
        "resolved": resolved,
        "missing": missing,
        "existing_filling": existing_filling,
    }


def deploy(client: OdooClient, ctx: dict, execute: bool):
    """Create product, BOM, and operations. If execute=False, dry-run only."""
    if ctx["missing"]:
        print("\n*** MISSING INGREDIENT PRODUCTS ***")
        print("These products do not exist in Odoo and must be created first:")
        for comp in ctx["missing"]:
            print(f"  - {comp['name']}  (qty {comp['qty']:.3f} kg)")
        print("\nSuggested approach:")
        print("  1. Create each missing product in Odoo: Inventory > Products > Create")
        print("  2. Set Type=Storable, UoM=kg, Company=What a Jerk")
        print("  3. Re-run this script")
        if not execute:
            print("\n(Dry-run mode: would have stopped here)")
        else:
            print("\n(Live mode: HALTING — fix missing components and re-run)")
            sys.exit(1)
        return

    print(f"\n=== DEPLOYMENT ({'LIVE' if execute else 'DRY-RUN'}) ===\n")

    # 1. Work center
    if execute:
        wc_id = client.find_or_create_workcenter("WAJ Central Kitchen Production")
        print(f"[OK] Work center: WAJ Central Kitchen Production (id={wc_id})")
    else:
        wc_id = "<would-create>"
        print("[DRY] Would find/create work center 'WAJ Central Kitchen Production'")

    # 2. Filling product
    if ctx["existing_filling"]:
        filling_id = ctx["existing_filling"]["id"]
        print(f"[OK] Reusing existing filling product (id={filling_id})")
    elif execute:
        filling_id = client.execute(
            "product.product",
            "create",
            {**FILLING_PRODUCT, "uom_id": ctx["uom_kg_id"], "uom_po_id": ctx["uom_kg_id"]},
        )
        print(f"[OK] Created filling product (id={filling_id})")
    else:
        filling_id = "<would-create>"
        print(f"[DRY] Would create product '{FILLING_PRODUCT['name']}'")

    # 3. BOM
    bom_lines = [
        (0, 0, {
            "product_id": comp["product_id"],
            "product_qty": comp["qty"],
            "product_uom_id": ctx["uom_kg_id"],
        })
        for comp in ctx["resolved"]
    ]
    bom_operations = []
    for op in OPERATIONS:
        bom_operations.append((0, 0, {
            "name": op["name"],
            "workcenter_id": wc_id if execute else 1,
            "time_cycle_manual": op["time_cycle_manual"],
            "note": op["note"],
        }))

    if execute:
        # In Odoo 18 we need to look up the product.template id from the variant.
        prod = client.search_read(
            "product.product", [("id", "=", filling_id)],
            ["product_tmpl_id"], limit=1,
        )[0]
        tmpl_id = prod["product_tmpl_id"][0]

        bom_id = client.execute(
            "mrp.bom",
            "create",
            {
                "product_tmpl_id": tmpl_id,
                "product_id": filling_id,
                "product_qty": BOM_QTY,
                "product_uom_id": ctx["uom_kg_id"],
                "type": "normal",
                "company_id": WAJ_COMPANY_ID,
                "code": BOM_NAME,
                "bom_line_ids": bom_lines,
                "operation_ids": bom_operations,
            },
        )
        print(f"[OK] Created BOM '{BOM_NAME}' (id={bom_id}) "
              f"with {len(bom_lines)} lines and {len(bom_operations)} operations")
    else:
        print(f"[DRY] Would create BOM '{BOM_NAME}':")
        print(f"      product_qty = {BOM_QTY} kg")
        print(f"      {len(bom_lines)} ingredient lines")
        print(f"      {len(bom_operations)} operations")
        for comp in ctx["resolved"]:
            print(f"        - {comp['name']:35} {comp['qty']:.3f} kg  (product_id={comp['product_id']})")

    print("\n=== DONE ===")


# ----------------------------------------------------------------------------
# ENTRY
# ----------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--execute", action="store_true",
                        help="Actually write to staging (default: dry-run)")
    args = parser.parse_args()

    client = OdooClient(ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD)
    ctx = preflight_checks(client)
    deploy(client, ctx, execute=args.execute)


if __name__ == "__main__":
    main()
