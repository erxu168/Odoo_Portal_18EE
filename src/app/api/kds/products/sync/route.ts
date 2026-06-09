import { NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { getKdsSettings, upsertSyncedProducts } from '@/lib/kds-db';
import { KDS_LOCATION_ID } from '@/types/kds';

export const dynamic = 'force-dynamic';

/**
 * Pull the product list visible to the configured POS and seed kds_product_config.
 * Manager hits this once after pointing KDS at a real POS — afterwards the
 * frontend looks up station/prep type per actual POS product name.
 */
export async function POST() {
  try {
    const settings = getKdsSettings(KDS_LOCATION_ID);
    if (!settings.posConfigId) {
      return NextResponse.json({ error: 'Set POS Config ID first' }, { status: 400 });
    }

    const odoo = getOdoo();

    const configs = await odoo.searchRead(
      'pos.config',
      [['id', '=', settings.posConfigId]],
      ['limit_categories', 'iface_available_categ_ids'],
      { limit: 1 }
    );

    let productDomain: unknown[] = [['available_in_pos', '=', true], ['sale_ok', '=', true]];

    if (configs.length && configs[0].limit_categories && Array.isArray(configs[0].iface_available_categ_ids) && configs[0].iface_available_categ_ids.length) {
      productDomain = [
        ['available_in_pos', '=', true],
        ['pos_categ_ids', 'in', configs[0].iface_available_categ_ids],
      ];
    }

    const products = await odoo.searchRead(
      'product.product',
      productDomain,
      ['id', 'display_name'],
      { limit: 500, order: 'display_name ASC' }
    );

    const synced = products.map((p: { id: number; display_name: string }) => ({
      odooProductId: p.id,
      productName: p.display_name,
    }));

    const count = upsertSyncedProducts(KDS_LOCATION_ID, synced);
    return NextResponse.json({ ok: true, count });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[KDS] product sync error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
