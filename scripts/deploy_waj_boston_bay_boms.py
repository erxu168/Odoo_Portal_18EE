#!/usr/bin/env python3
"""
Deploy WAJ Boston Bay Jerk Dry Mix and Jerk Paste BOMs to Odoo 18 EE staging.

Target: test18ee.krawings.de
Database: krawings
User: biz@krawings.de (uid=2)
Company: What a Jerk (id=5)

Creates v2.0 Boston Bay style recipes alongside (not replacing) v1.0:
1. Product: WAJ - Boston Bay Jerk Dry Mix (sub-assembly)
2. Product: WAJ - Boston Bay Jerk Paste (finished good)
3. BOM 1: Boston Bay Jerk Dry Mix (10 kg output, 4 operations with HTML notes)
4. BOM 2: Boston Bay Jerk Paste (~10.69 kg output, 4 operations, consumes Dry Mix)

Differences vs v1.0 (commercial style):
- Removed: cloves, nutmeg, soy sauce, browning sauce, lager beer, orange juice
- Removed: yellow onion (scallion-dominant only)
- Increased: scallion, scotch bonnet, thyme proportions
- Salt level recalculated: dry mix 57% salt, paste 6.9% salt
- Application target: 220g paste/kg chicken = 15.2g salt/kg chicken

Sources:
- Chris Aguilar / Jamaica-No-Problem traditional Maroon-lineage recipe
- Stush Kitchen authentic Jamaican-born Boston Jerk Fest recipe

Credentials:
This script reads ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD from environment
variables OR from a .env.local file in the same directory. NEVER commit
credentials to git.

Example .env.local (put in same directory as this script, gitignored):
    ODOO_URL=https://test18ee.krawings.de
    ODOO_DB=krawings
    ODOO_USER=biz@krawings.de
    ODOO_PASSWORD=your-password-here

Usage:
    # Dry-run mode (default) - reports what would be created, writes nothing
    python3 deploy_waj_boston_bay_boms.py

    # Live mode - actually writes to staging
    python3 deploy_waj_boston_bay_boms.py --execute

Deploy history:
- 2026-04-26: First deployed to staging. BOM ids 166, 167.
  Products: 1571 (Dry Mix), 1572 (Wet Paste). Work centre id 18.
"""

import argparse
import os
import sys
import xmlrpc.client
from pathlib import Path
from typing import Optional

# ----------------------------------------------------------------------------
# CONFIG - loaded from environment or .env.local
# ----------------------------------------------------------------------------


def load_env_local():
    """Load .env.local from script directory into os.environ if present."""
    env_path = Path(__file__).parent / ".env.local"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # Don't overwrite if already set in real environment
        if key not in os.environ:
            os.environ[key] = value


load_env_local()

ODOO_URL = os.environ.get("ODOO_URL", "https://test18ee.krawings.de")
ODOO_DB = os.environ.get("ODOO_DB", "krawings")
ODOO_USER = os.environ.get("ODOO_USER", "biz@krawings.de")
ODOO_PASSWORD = os.environ.get("ODOO_PASSWORD")

if not ODOO_PASSWORD:
    print("ERROR: ODOO_PASSWORD not set in environment or .env.local")
    print("Create a .env.local file in the script directory with:")
    print("  ODOO_PASSWORD=your-password-here")
    print("Or export it: export ODOO_PASSWORD=...")
    sys.exit(1)

WAJ_COMPANY_ID = 5

# ----------------------------------------------------------------------------
# COMPONENT INVENTORY - Boston Bay v2.0
# ----------------------------------------------------------------------------

DRY_MIX_COMPONENTS = [
    {"name": "Pimento berries (allspice), whole", "qty": 1.500, "uom": "kg"},
    {"name": "Black peppercorns, whole", "qty": 0.300, "uom": "kg"},
    {"name": "Brown sugar", "qty": 2.500, "uom": "kg"},
    {"name": "Salt, fine", "qty": 5.700, "uom": "kg"},
]

WET_PASTE_COMPONENTS = [
    # Sub-assembly
    {"name": "WAJ - Boston Bay Jerk Dry Mix", "qty": 1.300, "uom": "kg", "is_subassembly": True},
    # Fresh produce (scallion-dominant, no yellow onion)
    {"name": "Scallions, fresh", "qty": 4.200, "uom": "kg"},
    {"name": "Garlic, fresh", "qty": 0.850, "uom": "kg"},
    {"name": "Ginger, fresh", "qty": 0.500, "uom": "kg"},
    {"name": "Scotch Bonnet Pepper, fresh", "qty": 0.670, "uom": "kg"},
    {"name": "Thyme, fresh", "qty": 0.670, "uom": "kg"},
    # Liquids (vinegar-based, no soy/lager/OJ/browning)
    {"name": "Apple Cider Vinegar", "qty": 1.000, "uom": "kg"},
    {"name": "Rapeseed Oil", "qty": 0.670, "uom": "kg"},
    {"name": "Lime Juice, fresh", "qty": 0.500, "uom": "kg"},
    {"name": "Water", "qty": 0.330, "uom": "kg"},
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
  <li><b>Action:</b> Combine 1.500 kg pimento berries and 0.300 kg whole black peppercorns into a dry stainless pan over medium heat.</li>
  <li><b>Action:</b> Toast separately if pan capacity is small - pimento first, then peppercorns. Stir continuously for 3-4 minutes per batch.</li>
  <li><b>Visual marker:</b> Pull from heat the moment you smell strong aromatic bloom and the berries darken slightly. Do not let them smoke.</li>
  <li><b>Tip:</b> Overshooting by 30 seconds turns the spices bitter and ruins the batch. If in doubt, pull early - under-toasted is recoverable, over-toasted is not.</li>
  <li><b>Action:</b> Transfer to a sheet tray, spread thin, cool to room temperature (5-10 min).</li>
</ul>""",
    },
    {
        "name": "Grind toasted spices",
        "time_cycle_manual": 5,
        "note": """<h3>Grind toasted spices to medium-fine</h3>
<ul>
  <li><b>Action:</b> Transfer cooled toasted pimento and peppercorns to spice grinder or dedicated dry blender.</li>
  <li><b>Action:</b> Grind in 30-second pulses until medium-fine consistency.</li>
  <li><b>Visual marker:</b> Texture should be uniform, like coarse coffee grounds. Not powder, not coarse fragments.</li>
  <li><b>Action:</b> Pass through fine-mesh sieve. Re-grind any large fragments retained on sieve.</li>
  <li><b>Tip:</b> Clean grinder thoroughly between batches - residual oils go rancid and contaminate next batch.</li>
</ul>""",
    },
    {
        "name": "Blend dry mix",
        "time_cycle_manual": 4,
        "note": """<h3>Combine all dry components</h3>
<ul>
  <li><b>Action:</b> In large stainless mixing bowl combine: ground toasted spices (~1.800 kg), 2.500 kg brown sugar, 5.700 kg fine salt.</li>
  <li><b>Mix:</b> Whisk thoroughly for 2 minutes until colour is uniform throughout. Brown sugar should be evenly distributed with no clumps.</li>
  <li><b>Visual marker:</b> Uniform light-brown colour with visible darker flecks of ground spice. No streaks of white salt or brown sugar lumps.</li>
  <li><b>Tip:</b> If brown sugar has hardened in storage, break up by hand or pass through coarse sieve before adding. Lumpy sugar prevents even distribution into wet paste.</li>
</ul>""",
    },
    {
        "name": "Pack and label",
        "time_cycle_manual": 8,
        "note": """<h3>Vacuum-pack into production portions</h3>
<ul>
  <li><b>Action:</b> Portion into 1.300 kg vacuum bags (one bag = one wet paste batch). ~7-8 bags total per 10 kg dry mix run.</li>
  <li><b>Action:</b> Vacuum-seal at high vacuum.</li>
  <li><b>Action:</b> Label each bag: WAJ Boston Bay Jerk Dry Mix v2.0, batch date, expiry date (production date + 8 weeks), operator initials.</li>
  <li><b>Tip:</b> Store in chiller at 2-4 degrees C. Can be frozen for 6 months if longer storage needed.</li>
</ul>""",
    },
]

WET_PASTE_OPERATIONS = [
    {
        "name": "Aromatic prep",
        "time_cycle_manual": 30,
        "note": """<h3>Prepare fresh aromatics</h3>
<ul>
  <li><b>Action:</b> Trim root ends from 4.200 kg scallions. Use both white and green parts. Rough chop into 5cm pieces.</li>
  <li><b>Action:</b> Peel 0.850 kg garlic cloves.</li>
  <li><b>Action:</b> Peel and rough chop 0.500 kg ginger.</li>
  <li><b>Action:</b> Stem 0.670 kg scotch bonnet peppers. Leave seeds in for full heat. <b>Mandatory:</b> nitrile gloves, no contact with face or eyes for 4 hours after handling.</li>
  <li><b>Action:</b> Strip leaves from 0.670 kg fresh thyme stems. Discard stems.</li>
  <li><b>Visual marker:</b> All ingredients prepped before any blending begins. Mise en place is critical - once blending starts, do not stop to prep.</li>
  <li><b>Tip:</b> Boston Bay style is scallion-dominant - no yellow onion. The clean scallion-thyme-pimento triangle is the signature flavour profile.</li>
</ul>""",
    },
    {
        "name": "Blend solids with dry mix",
        "time_cycle_manual": 5,
        "note": """<h3>Blend solids with dry mix</h3>
<ul>
  <li><b>Action:</b> Into industrial blender combine: all prepped aromatics (scallion, garlic, ginger, scotch bonnet, thyme leaves) plus 1.300 kg WAJ Boston Bay Jerk Dry Mix.</li>
  <li><b>Mix:</b> Pulse 5-6 times to break down solids before adding liquids.</li>
  <li><b>Visual marker:</b> Coarse, chunky green mixture. Solids should be reduced but not yet pasty.</li>
  <li><b>Tip:</b> Adding dry mix at this stage lets the salt start drawing moisture from aromatics, which improves blending.</li>
</ul>""",
    },
    {
        "name": "Final blend with liquids",
        "time_cycle_manual": 5,
        "note": """<h3>Add liquids and blend to paste</h3>
<ul>
  <li><b>Action:</b> Add to blender in order: 1.000 kg apple cider vinegar, 0.670 kg rapeseed oil, 0.500 kg fresh lime juice, 0.330 kg water.</li>
  <li><b>Mix:</b> Run on medium-high for 60-90 seconds.</li>
  <li><b>Visual marker:</b> Thick, coarse paste with visible flecks of spice and herb. Pours slowly off a spoon. Bright green-brown colour (not dark mahogany - this is Boston Bay style, no browning sauce). Should look like coarse pesto, not smooth puree.</li>
  <li><b>Tip:</b> Do not over-blend to fully smooth. Some texture is correct and traditional. If too thick to pour, pulse in additional 100 g water. If too thin, pulse in additional 50 g rapeseed oil.</li>
</ul>""",
    },
    {
        "name": "Portion, pack, chill",
        "time_cycle_manual": 12,
        "note": """<h3>Portion, vacuum-pack, label, chill</h3>
<ul>
  <li><b>Action:</b> Portion finished paste into vacuum bags. Suggested portions: 5x 2.000 kg bags + 1x 0.690 kg bag (for partial-batch use).</li>
  <li><b>Action:</b> Vacuum-seal each bag at high vacuum.</li>
  <li><b>Action:</b> Label each bag: WAJ Boston Bay Jerk Paste v2.0, batch date, expiry date (production date + 7 days), operator initials.</li>
  <li><b>Action:</b> Transfer to chiller at 2-4 degrees C. Hold minimum 4 hours before first use, ideally overnight.</li>
  <li><b>Visual marker:</b> Bags should be tightly vacuum-sealed with no air pockets. Paste should look uniform through the bag.</li>
  <li><b>Tip:</b> The 4-hour minimum chill is non-negotiable. The salt fully dissolves, raw garlic harshness mellows, and flavours marry. Paste used immediately tastes raw and one-dimensional.</li>
</ul>""",
    },
]

# ----------------------------------------------------------------------------
# PRODUCT DEFINITIONS
# ----------------------------------------------------------------------------

DRY_MIX_PRODUCT = {
    "name": "WAJ - Boston Bay Jerk Dry Mix",
    "type": "consu",
    "is_storable": True,
    "company_id": WAJ_COMPANY_ID,
    "sale_ok": False,
    "purchase_ok": False,
    "tracking": "lot",
    "description": (
        "Sub-assembly for WAJ Boston Bay Jerk Paste production. "
        "Pre-blended, toasted, ground dry mix - traditional Maroon-lineage recipe. "
        "Yields ~7-8 wet paste batches per 10 kg dry mix run. "
        "Shelf life: 8 weeks vacuum-sealed in chiller (2-4 C); 6 months frozen."
    ),
}

WET_PASTE_PRODUCT = {
    "name": "WAJ - Boston Bay Jerk Paste",
    "type": "consu",
    "is_storable": True,
    "company_id": WAJ_COMPANY_ID,
    "sale_ok": False,
    "purchase_ok": False,
    "tracking": "lot",
    "description": (
        "Finished Boston Bay style jerk paste for WAJ chicken marination. "
        "Traditional Jamaican Maroon-lineage recipe - scallion-dominant, "
        "vinegar-based, no soy/cloves/nutmeg/browning/lager/OJ. "
        "Application: 220 g paste per 1 kg chicken (tumble or vacuum-bag method). "
        "Yield: ~47 kg chicken per 10.69 kg paste batch. "
        "Shelf life: 7 days vacuum-sealed chiller (2-4 C); 90 days frozen. "
        "Minimum 4-hour chill rest before use."
    ),
}

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

    def find_product(self, name: str) -> Optional[dict]:
        results = self.search_read(
            "product.product",
            [("name", "=ilike", name)],
            ["id", "name", "uom_id", "company_id"],
            limit=1,
        )
        return results[0] if results else None

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
        # Find resource calendar for WAJ company (required for multi-company setups).
        # Without this, Odoo 18 EE defaults to a calendar belonging to another company,
        # causing: "Incompatible companies on records" error.
        calendars = self.search_read(
            "resource.calendar",
            [("company_id", "=", WAJ_COMPANY_ID)],
            ["id"],
            limit=1,
        )
        calendar_id = calendars[0]["id"] if calendars else False
        return self.execute(
            "mrp.workcenter",
            "create",
            {
                "name": name,
                "company_id": WAJ_COMPANY_ID,
                "time_efficiency": 100.0,
                "resource_calendar_id": calendar_id,
            },
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

    print("\nDry mix components:")
    dry_mix_resolved = []
    dry_mix_missing = []
    for comp in DRY_MIX_COMPONENTS:
        product = client.find_product(comp["name"])
        if product:
            print(f"  [OK]      {comp['name']:50} -> id={product['id']}")
            dry_mix_resolved.append({**comp, "product_id": product["id"]})
        else:
            print(f"  [MISSING] {comp['name']:50}")
            dry_mix_missing.append(comp)

    print("\nWet paste components:")
    wet_paste_resolved = []
    wet_paste_missing = []
    for comp in WET_PASTE_COMPONENTS:
        if comp.get("is_subassembly"):
            print(f"  [DEFER]   {comp['name']:50} (will be created by this script)")
            wet_paste_resolved.append(comp)
            continue
        product = client.find_product(comp["name"])
        if product:
            print(f"  [OK]      {comp['name']:50} -> id={product['id']}")
            wet_paste_resolved.append({**comp, "product_id": product["id"]})
        else:
            print(f"  [MISSING] {comp['name']:50}")
            wet_paste_missing.append(comp)

    return {
        "uom_kg_id": uom_kg_id,
        "dry_mix_resolved": dry_mix_resolved,
        "dry_mix_missing": dry_mix_missing,
        "wet_paste_resolved": wet_paste_resolved,
        "wet_paste_missing": wet_paste_missing,
    }


def deploy(client: OdooClient, ctx: dict, execute: bool):
    """Create products, BOMs, and operations. If execute=False, dry-run only."""
    if ctx["dry_mix_missing"] or ctx["wet_paste_missing"]:
        print("\n*** MISSING COMPONENTS DETECTED ***")
        print("These products do not exist in Odoo and must be created manually:")
        for comp in ctx["dry_mix_missing"]:
            print(f"  - {comp['name']} (needed for: dry mix)")
        for comp in ctx["wet_paste_missing"]:
            print(f"  - {comp['name']} (needed for: wet paste)")
        print("\nSuggested approach:")
        print("  1. Create the missing products in Odoo: Inventory > Products > Create")
        print("  2. Set Type=Storable Product, UoM=kg, Company=What a Jerk")
        print("  3. Re-run this script\n")
        if not execute:
            print("(Dry-run mode: would have stopped here)")
        else:
            print("(Live mode: HALTING - fix missing components and re-run)")
            sys.exit(1)

    print(f"\n=== DEPLOYMENT ({'LIVE' if execute else 'DRY-RUN'}) ===\n")

    if execute:
        wc_id = client.find_or_create_workcenter("WAJ Central Kitchen Production")
        print(f"[OK] Work center: WAJ Central Kitchen Production (id={wc_id})")
    else:
        wc_id = "<would-create>"
        print("[DRY] Would create/find work center 'WAJ Central Kitchen Production'")

    if execute:
        existing = client.find_product(DRY_MIX_PRODUCT["name"])
        if existing:
            dry_mix_id = existing["id"]
            print(f"[OK] Dry Mix product already exists (id={dry_mix_id})")
        else:
            dry_mix_id = client.execute(
                "product.product",
                "create",
                {**DRY_MIX_PRODUCT, "uom_id": ctx["uom_kg_id"], "uom_po_id": ctx["uom_kg_id"]},
            )
            print(f"[OK] Created Dry Mix product (id={dry_mix_id})")
    else:
        dry_mix_id = "<would-create>"
        print(f"[DRY] Would create product: {DRY_MIX_PRODUCT['name']}")

    if execute:
        existing = client.find_product(WET_PASTE_PRODUCT["name"])
        if existing:
            wet_paste_id = existing["id"]
            print(f"[OK] Wet Paste product already exists (id={wet_paste_id})")
        else:
            wet_paste_id = client.execute(
                "product.product",
                "create",
                {**WET_PASTE_PRODUCT, "uom_id": ctx["uom_kg_id"], "uom_po_id": ctx["uom_kg_id"]},
            )
            print(f"[OK] Created Wet Paste product (id={wet_paste_id})")
    else:
        wet_paste_id = "<would-create>"
        print(f"[DRY] Would create product: {WET_PASTE_PRODUCT['name']}")

    print("\n--- BOM 1: Boston Bay Jerk Dry Mix ---")
    if execute:
        bom_lines = []
        for comp in ctx["dry_mix_resolved"]:
            bom_lines.append(
                (0, 0, {
                    "product_id": comp["product_id"],
                    "product_qty": comp["qty"],
                    "product_uom_id": ctx["uom_kg_id"],
                })
            )
        operations = []
        for op in DRY_MIX_OPERATIONS:
            operations.append(
                (0, 0, {
                    "name": op["name"],
                    "workcenter_id": wc_id,
                    "time_cycle_manual": op["time_cycle_manual"],
                    "note": op["note"],
                })
            )
        bom1_id = client.execute(
            "mrp.bom",
            "create",
            {
                "product_tmpl_id": client.search_read(
                    "product.product", [("id", "=", dry_mix_id)], ["product_tmpl_id"]
                )[0]["product_tmpl_id"][0],
                "product_id": dry_mix_id,
                "product_qty": 10.0,
                "product_uom_id": ctx["uom_kg_id"],
                "type": "normal",
                "company_id": WAJ_COMPANY_ID,
                "code": "WAJ-BB-DRY-MIX-v2.0",
                "bom_line_ids": bom_lines,
                "operation_ids": operations,
            },
        )
        print(f"[OK] Created Boston Bay Dry Mix BOM (id={bom1_id}) with {len(bom_lines)} components and {len(operations)} operations")
    else:
        print(f"[DRY] Would create BOM: 10 kg yield, {len(DRY_MIX_COMPONENTS)} components, {len(DRY_MIX_OPERATIONS)} operations")
        for comp in ctx["dry_mix_resolved"]:
            print(f"        - {comp['qty']:6.3f} kg  {comp['name']}")

    print("\n--- BOM 2: Boston Bay Jerk Paste ---")
    if execute:
        for comp in ctx["wet_paste_resolved"]:
            if comp.get("is_subassembly"):
                comp["product_id"] = dry_mix_id
        bom_lines = []
        for comp in ctx["wet_paste_resolved"]:
            bom_lines.append(
                (0, 0, {
                    "product_id": comp["product_id"],
                    "product_qty": comp["qty"],
                    "product_uom_id": ctx["uom_kg_id"],
                })
            )
        operations = []
        for op in WET_PASTE_OPERATIONS:
            operations.append(
                (0, 0, {
                    "name": op["name"],
                    "workcenter_id": wc_id,
                    "time_cycle_manual": op["time_cycle_manual"],
                    "note": op["note"],
                })
            )
        bom2_id = client.execute(
            "mrp.bom",
            "create",
            {
                "product_tmpl_id": client.search_read(
                    "product.product", [("id", "=", wet_paste_id)], ["product_tmpl_id"]
                )[0]["product_tmpl_id"][0],
                "product_id": wet_paste_id,
                "product_qty": 10.69,
                "product_uom_id": ctx["uom_kg_id"],
                "type": "normal",
                "company_id": WAJ_COMPANY_ID,
                "code": "WAJ-BB-JERK-PASTE-v2.0",
                "bom_line_ids": bom_lines,
                "operation_ids": operations,
            },
        )
        print(f"[OK] Created Boston Bay Wet Paste BOM (id={bom2_id}) with {len(bom_lines)} components and {len(operations)} operations")
    else:
        print(f"[DRY] Would create BOM: 10.69 kg yield, {len(WET_PASTE_COMPONENTS)} components, {len(WET_PASTE_OPERATIONS)} operations")
        for comp in ctx["wet_paste_resolved"]:
            marker = " (SUB)" if comp.get("is_subassembly") else ""
            print(f"        - {comp['qty']:6.3f} kg  {comp['name']}{marker}")

    print("\n=== DEPLOYMENT COMPLETE ===")
    if not execute:
        print("\nThis was a DRY-RUN. To actually deploy, run with --execute")


def main():
    parser = argparse.ArgumentParser(
        description="Deploy WAJ Boston Bay Jerk BOMs to Odoo 18 EE staging"
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Actually write to staging. Without this flag, runs in dry-run mode.",
    )
    args = parser.parse_args()

    print("=" * 70)
    print("WAJ Boston Bay Jerk Paste BOM Deployment v2.0")
    print(f"Target: {ODOO_URL}")
    print(f"Database: {ODOO_DB}")
    print(f"Company: What a Jerk (id={WAJ_COMPANY_ID})")
    print(f"Mode: {'LIVE EXECUTE' if args.execute else 'DRY-RUN (read-only)'}")
    print("=" * 70)

    client = OdooClient(ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD)
    ctx = preflight_checks(client)
    deploy(client, ctx, execute=args.execute)


if __name__ == "__main__":
    main()
