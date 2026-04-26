# Scripts

Operational scripts for the Krawings Portal and Odoo 18 EE staging.

## Credentials

**Never commit credentials.** Scripts that connect to Odoo read from a
`.env.local` file in the same directory (gitignored via `.env*.local`),
or from environment variables.

Example `scripts/.env.local`:

```
ODOO_URL=https://test18ee.krawings.de
ODOO_DB=krawings
ODOO_USER=biz@krawings.de
ODOO_PASSWORD=your-password-here
```

For production go-live, change `ODOO_URL` to `http://128.140.12.188:15069`.

## WAJ Boston Bay Jerk BOM deployment

`deploy_waj_boston_bay_boms.py`

Creates two BOMs in Odoo 18 EE under company id=5 (What a Jerk):

| BOM | Code | Yield | Components |
|---|---|---|---|
| Dry Mix sub-assembly | `WAJ-BB-DRY-MIX-v2.0` | 10 kg | 4 |
| Wet Paste (finished) | `WAJ-BB-JERK-PASTE-v2.0` | 10.69 kg | 10 |

Both have HTML-formatted work order operations following the Krawings
standard (h3, ul/li, b on Action / Mix / Visual marker / Tip).

### Recipe lineage

Boston Bay-style traditional Jamaican jerk paste. Scallion-dominant,
vinegar-based, no soy/cloves/nutmeg/browning/lager/OJ. Sources:

- Chris Aguilar / Jamaica-No-Problem (Maroon-lineage tradition)
- Stush Kitchen (authentic Jamaican-born, Boston Jerk Fest regular)

Coexists with v1.0 "commercial-style" BOMs (different product names) for
side-by-side production testing.

### Salt math

Dry mix is 57% salt by weight. Combined into wet paste at 1.300 kg dry
mix per 10.69 kg paste batch yields 6.9% salt in the final paste. At
220 g paste per kg chicken (vacuum-tumble or vacuum-bag application)
this delivers 15.2 g salt per kg chicken — within the 15-18 g target
range for properly seasoned tumbled meat.

### Usage

```bash
cd scripts/
# First time: create .env.local with your password
echo "ODOO_PASSWORD=your-password" > .env.local

# Dry-run (default, writes nothing)
python3 deploy_waj_boston_bay_boms.py

# Live deploy (only after dry-run looks clean)
python3 deploy_waj_boston_bay_boms.py --execute
```

### First deploy

2026-04-26: deployed to staging. Created records:
- Work centre id 18 (WAJ Central Kitchen Production)
- Product id 1571 (Dry Mix)
- Product id 1572 (Wet Paste)
- BOM id 166 (Dry Mix)
- BOM id 167 (Wet Paste)
- Plus 4 raw material products: 1567 (Pimento berries), 1568 (Black
  peppercorns), 1569 (Brown sugar), 1570 (Water)

### Known issue (fixed)

In Odoo 18 EE multi-company setups, creating a work centre without
specifying `resource_calendar_id` causes Odoo to default to a calendar
belonging to a different company, raising:

> Incompatible companies on records

The script handles this by looking up the WAJ-specific resource calendar
(id=8 on staging) and assigning it explicitly during work centre creation.

### Re-running the script

The script is idempotent on **products** (won't duplicate if a product
with the same name already exists) but **not idempotent on BOMs**. If
you re-run after a successful deploy, you'll get duplicate BOMs.

To revise a recipe:

1. Archive the existing BOM in Odoo UI (Manufacturing > Bills of Materials,
   open the BOM, click the gear icon, "Archive")
2. Update the recipe constants in the script, bump the version (e.g.
   `WAJ-BB-DRY-MIX-v2.1`)
3. Re-run with `--execute`

## Other scripts in this directory

See individual file headers for purpose and usage. Most follow a similar
pattern of connecting to Odoo via JSON-RPC and performing batch operations.
