/**
 * POST /api/purchase/seed
 * One-time setup: seeds initial suppliers and sample order guide items.
 * Admin only. Safe to run multiple times (checks for existing data).
 */
import { NextResponse } from 'next/server';
import { requireAuth, hasRole } from '@/lib/auth';
import { listSuppliers, createSupplier, getGuide, createGuide, addGuideItem } from '@/lib/purchase-db';
import { getOdoo } from '@/lib/odoo';

const FOOD_SUPPLIERS = [
  { odoo_id: 67,  name: 'Feddersen Gastro GmbH',      email: 'info@feddersen24.de',    phone: '+490303973880',       days: '["mon","thu"]', lead: 1 },
  { odoo_id: 157, name: 'Fresco GmbH',                email: 'info@fresco-berlin.de',  phone: '03020097140',         days: '["tue","fri"]', lead: 1 },
  { odoo_id: 108, name: 'AC Euro Gida GmbH',           email: '',                       phone: '',                    days: '[]', lead: 2 },
  { odoo_id: 557, name: 'Frucht & Feld UG',            email: '',                       phone: '030 91 69 22 24',     days: '["mon","wed","fri"]', lead: 0 },
  { odoo_id: 370, name: 'CNB Enterprises BV',           email: 'info@cnboriental.com',   phone: '+31 72 561 76 35',    days: '[]', lead: 3 },
  { odoo_id: 86,  name: 'EDEKA Markt Brehm',            email: '',                       phone: '',                    days: '[]', lead: 0 },
  { odoo_id: 93,  name: 'Frobart im Frischetal GmbH',   email: 'info@frichetal.de',      phone: '030/3980 75 01/02',   days: '["tue","thu"]', lead: 1 },
];

export async function POST(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(user, 'admin')) return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const existing = listSuppliers();
  if (existing.length > 0) {
    return NextResponse.json({ message: `Already seeded (${existing.length} suppliers exist). Delete manually to re-seed.` });
  }

  const results: string[] = [];

  // Create suppliers (available for both locations)
  for (const s of FOOD_SUPPLIERS) {
    const id = createSupplier({
      odoo_partner_id: s.odoo_id,
      name: s.name,
      email: s.email,
      phone: s.phone,
      send_method: 'email',
      order_days: s.days,
      lead_time_days: s.lead,
      location_id: 0, // 0 = available for all locations
    });
    results.push(`Created supplier: ${s.name} (id=${id})`);
  }

  // Fetch food products from Odoo and create sample guide for Feddersen @ SSAM
  try {
    const odoo = getOdoo();
    const products = await odoo.searchRead('product.product',
      [['categ_id.name', 'ilike', 'food']],
      ['id', 'name', 'uom_id', 'categ_id', 'list_price'],
      { limit: 40, order: 'categ_id, name' }
    );

    if (products && products.length > 0) {
      // Get the Feddersen supplier id (first one created)
      const allSuppliers = listSuppliers();
      const feddersen = allSuppliers.find(s => s.name.includes('Feddersen'));
      const fresco = allSuppliers.find(s => s.name.includes('Fresco'));
      const frucht = allSuppliers.find(s => s.name.includes('Frucht'));

      // Create guides for SSAM (location_id=32)
      if (feddersen) {
        const guideId = createGuide(feddersen.id, 32, 'Feddersen - SSAM');
        // Add first 15 food products
        const fedProducts = products.slice(0, 15);
        for (const p of fedProducts) {
          addGuideItem(guideId, {
            product_id: p.id,
            product_name: p.name,
            product_uom: p.uom_id?.[1] || 'Units',
            price: p.list_price || 0,
            price_source: 'odoo',
            category_name: p.categ_id?.[1]?.split(' / ').pop() || 'Other',
          });
        }
        results.push(`Created guide for Feddersen @ SSAM with ${fedProducts.length} products`);
      }

      if (fresco) {
        const guideId = createGuide(fresco.id, 32, 'Fresco - SSAM');
        const frescoProducts = products.slice(10, 22);
        for (const p of frescoProducts) {
          addGuideItem(guideId, {
            product_id: p.id,
            product_name: p.name,
            product_uom: p.uom_id?.[1] || 'Units',
            price: p.list_price || 0,
            price_source: 'odoo',
            category_name: p.categ_id?.[1]?.split(' / ').pop() || 'Other',
          });
        }
        results.push(`Created guide for Fresco @ SSAM with ${frescoProducts.length} products`);
      }

      if (frucht) {
        const guideId = createGuide(frucht.id, 32, 'Frucht & Feld - SSAM');
        const fruchtProducts = products.slice(20, 30);
        for (const p of fruchtProducts) {
          addGuideItem(guideId, {
            product_id: p.id,
            product_name: p.name,
            product_uom: p.uom_id?.[1] || 'Units',
            price: p.list_price || 0,
            price_source: 'odoo',
            category_name: p.categ_id?.[1]?.split(' / ').pop() || 'Other',
          });
        }
        results.push(`Created guide for Frucht & Feld @ SSAM with ${fruchtProducts.length} products`);
      }
    }
  } catch (e: any) {
    results.push(`Failed to fetch Odoo products: ${e.message}`);
  }

  return NextResponse.json({ message: 'Seed complete', results }, { status: 201 });
}
