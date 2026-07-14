#!/usr/bin/env python3
"""
Migrate contract data from Odoo 19 CE (krawings_utilities_manager)
to Odoo 18 EE (krawings_contract) unified model.

Run AFTER installing krawings_contract module on 18 EE staging.

Usage (on staging server 89.167.124.0):
  python3 migrate_contracts_19_to_18.py
"""

import json
import urllib.request

# -- Config --
O18_URL = "http://127.0.0.1:15069/jsonrpc"  # localhost on staging server
O18_DB = "krawings"
O18_UID = 2
O18_PW = "exEV3M<v3."


def jsonrpc(url, service, method, args):
    payload = json.dumps({
        "jsonrpc": "2.0",
        "method": "call",
        "params": {"service": service, "method": method, "args": args},
        "id": 1,
    }).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read().decode())
    if "error" in result:
        raise Exception(f"JSON-RPC error: {result['error']}")
    return result["result"]


def call(model, method, args, kwargs=None):
    return jsonrpc(O18_URL, "object", "execute_kw",
                   [O18_DB, O18_UID, O18_PW, model, method, args, kwargs or {}])


def find_or_create_partner(name):
    ids = call("res.partner", "search", [[["name", "ilike", name]]])
    if ids:
        return ids[0]
    print(f"  Creating partner: {name}")
    return call("res.partner", "create", [{"name": name, "is_company": True}])


def get_location_map():
    recs = call("krawings.contract.location", "search_read", [[]], {"fields": ["id", "name", "code"]})
    loc_map = {}
    for r in recs:
        loc_map[r["name"].lower()] = r["id"]
        if r.get("code"):
            loc_map[r["code"].lower()] = r["id"]
    return loc_map


def resolve_location(loc_name, loc_map):
    name = loc_name.lower()
    if name in loc_map:
        return loc_map[name]
    for key, lid in loc_map.items():
        if key in name or name in key:
            return lid
    print(f"  WARNING: Could not match location '{loc_name}'")
    return False


def create_contract(vals):
    clean = {k: v for k, v in vals.items() if v is not None and v is not False}
    try:
        cid = call("krawings.contract", "create", [clean])
        print(f"  Created contract id={cid}: {clean.get('name', '?')}")
        return cid
    except Exception as e:
        print(f"  ERROR creating '{clean.get('name', '?')}': {e}")
        return False


def main():
    print("=" * 60)
    print("Contract Migration: Odoo 19 CE -> Odoo 18 EE")
    print("=" * 60)

    print("\n[1/4] Checking module...")
    try:
        locs = call("krawings.contract.location", "search_count", [[]])
        print(f"  Module installed. {locs} locations found.")
    except Exception as e:
        print(f"  ERROR: Module not installed! {e}")
        return

    print("\n[2/4] Loading locations...")
    loc_map = get_location_map()
    for name, lid in loc_map.items():
        print(f"  {name} -> id={lid}")

    print("\n[3/4] Ensuring providers exist...")
    providers = {
        "Familie Renner": find_or_create_partner("Familie Renner"),
        "Heimstaden Germany GmbH": find_or_create_partner("Heimstaden Germany GmbH"),
        "Vodafone GmbH": find_or_create_partner("Vodafone GmbH"),
        "Maingau Energie": find_or_create_partner("Maingau Energie"),
        "ALBA Berlin GmbH": find_or_create_partner("ALBA Berlin GmbH"),
    }
    for name, pid in providers.items():
        print(f"  {name} -> partner_id={pid}")

    print("\n[4/4] Creating contracts...")

    # RENT 1: Familie Renner / CK
    create_contract({
        "name": "Mietvertrag CK - Familie Renner",
        "contract_type": "rent",
        "location_id": resolve_location("CK", loc_map),
        "provider_id": providers["Familie Renner"],
        "landlord_id": providers["Familie Renner"],
        "start_date": "2025-12-01",
        "end_date": "2028-03-31",
        "monthly_rent": 1.0,
        "maintenance_fee": 1.0,
        "premium_amount": 2.0,
        "premium_frequency": "monthly",
        "auto_renewal": False,
        "notes": "This will be the end of the contract and there is no extension possible nor wanted!",
    })

    # RENT 2: Heimstaden / GBM38
    create_contract({
        "name": "Mietvertrag GBM38 - Heimstaden",
        "contract_type": "rent",
        "location_id": resolve_location("GBM38", loc_map),
        "provider_id": providers["Heimstaden Germany GmbH"],
        "landlord_id": providers["Heimstaden Germany GmbH"],
        "start_date": "2025-08-01",
        "end_date": "2030-07-31",
        "monthly_rent": 0.0,
        "maintenance_fee": 0.0,
        "premium_amount": 0.0,
        "premium_frequency": "monthly",
        "auto_renewal": True,
        "renewal_period_months": 60,
        "kuendigungsfrist_value": 6,
        "kuendigungsfrist_unit": "months",
        "portal_login": "biz@krawings.de",
        "notes": "5 Years, exercise on 1.2.2029",
    })

    # INSURANCE: Vodafone / Burgherrenstrasse
    create_contract({
        "name": "PROD001 - Business Liability",
        "contract_type": "insurance",
        "location_id": resolve_location("Burgherrenstrasse", loc_map),
        "provider_id": providers["Vodafone GmbH"],
        "insurance_type": "Business Liability",
        "insurance_id_number": "ISR001",
        "start_date": "2025-01-01",
        "end_date": "2026-01-06",
        "premium_amount": 1000.0,
        "premium_frequency": "annually",
        "notes": "Test notes",
    })

    # GAS: Maingau Energie / CK
    create_contract({
        "name": "MAINGAU GasKomfort - CK",
        "contract_type": "gas",
        "location_id": resolve_location("CK", loc_map),
        "provider_id": providers["Maingau Energie"],
        "customer_id": "231.131.079-1",
        "meter_id": "7GMT0009171935",
        "kw_unit_cost": 7.26,
        "monthly_fee": 14.99,
        "monthly_installment": 166.0,
        "start_date": "2026-01-01",
        "end_date": "2027-01-01",
        "premium_amount": 166.0,
        "premium_frequency": "monthly",
        "kuendigungsfrist_value": 1,
        "kuendigungsfrist_unit": "months",
        "notes": "12 Month Contract, based on 25.000kWh annually",
    })

    # TELECOM 1: Vodafone / Burgherrenstrasse
    create_contract({
        "name": "Vodafone Business Internet DSL 250 - Burgherrenstr.",
        "contract_type": "telecom",
        "location_id": resolve_location("Burgherrenstrasse", loc_map),
        "provider_id": providers["Vodafone GmbH"],
        "customer_id": "001963675666",
        "start_date": "2026-01-21",
        "end_date": "2028-01-21",
        "premium_amount": 49.95,
        "premium_frequency": "monthly",
        "kuendigungsfrist_value": 3,
        "kuendigungsfrist_unit": "months",
        "verification_pin": "ASQCE8PZ",
        "auto_renewal": True,
        "renewal_period_months": 1,
        "phone_numbers": False,
        "notes": "One-time connection fee 57.39 EUR; first 6 months: 29.95 EUR; thereafter: 49.95 EUR. 24 months contract; thereafter month-to-month. Free rental of Fritz!Box 7530 AX router (must return after contract ends!). Auftragsnummer: ARC8795218390, Modem Installationscode: 71515032499075727522",
    })

    # TELECOM 2: Vodafone / Landsberger Allee
    create_contract({
        "name": "Vodafone Business Internet DSL 250 - Landsberger Allee",
        "contract_type": "telecom",
        "location_id": resolve_location("Landsberger Allee", loc_map),
        "provider_id": providers["Vodafone GmbH"],
        "customer_id": "001963674208",
        "start_date": "2026-01-07",
        "end_date": "2028-01-07",
        "premium_amount": 49.95,
        "premium_frequency": "monthly",
        "kuendigungsfrist_value": 3,
        "kuendigungsfrist_unit": "months",
        "verification_pin": "NE63H3B6",
        "auto_renewal": True,
        "renewal_period_months": 1,
        "phone_numbers": False,
        "notes": "First six months 29.95 EUR, Initial Setup fee: 59.95 EUR, free FritzBox 7530 AX Router (must return after service period is over), Modem-Installationscode: 56712 46604 73187 85751",
    })

    # GARBAGE: Alba / SSK96
    create_contract({
        "name": "ALBA Commercial Waste - SSK96",
        "contract_type": "garbage",
        "location_id": resolve_location("SSK96", loc_map),
        "provider_id": providers["ALBA Berlin GmbH"],
        "service_type": "Commercial Waste (Black Containers)",
        "start_date": "2025-12-29",
        "end_date": "2026-01-31",
        "premium_amount": 0.0,
        "premium_frequency": "monthly",
    })

    # Summary
    print("\n" + "=" * 60)
    total = call("krawings.contract", "search_count", [[]])
    print(f"Migration complete! {total} contracts in krawings.contract.")
    print("=" * 60)


if __name__ == "__main__":
    main()
