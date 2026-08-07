import { NextRequest, NextResponse } from 'next/server';
import { getOdoo } from '@/lib/odoo';
import { getKdsSettings } from '@/lib/kds-db';
import { KDS_LOCATION_ID } from '@/types/kds';

export const dynamic = 'force-dynamic';

/**
 * Menu categories available on the connected register, for the KDS Settings
 * "Show in kitchen" list. Mirrors the category scoping used by the product sync
 * (src/app/api/kds/products/sync/route.ts): when the register limits itself to
 * specific categories we list exactly those, otherwise every POS category.
 *
 * READ-ONLY against Odoo.
 */
export async function GET(req: NextRequest) {
  try {
    const settings = getKdsSettings(KDS_LOCATION_ID);
    const configId = Number(req.nextUrl.searchParams.get('configId')) || settings.posConfigId;
    if (!configId) {
      return NextResponse.json({ categories: [] });
    }

    const odoo = getOdoo();
    const configs = await odoo.searchRead(
      'pos.config',
      [['id', '=', configId]],
      ['limit_categories', 'iface_available_categ_ids'],
      { limit: 1 },
    );

    const cfg = configs[0] as { limit_categories?: boolean; iface_available_categ_ids?: number[] } | undefined;
    const limited = Boolean(cfg?.limit_categories)
      && Array.isArray(cfg?.iface_available_categ_ids)
      && cfg!.iface_available_categ_ids!.length > 0;

    const domain = limited ? [['id', 'in', cfg!.iface_available_categ_ids]] : [];

    const rows = await odoo.searchRead(
      'pos.category',
      domain,
      ['id', 'name'],
      { order: 'name ASC', limit: 200 },
    );

    const categories = (rows as { id: number; name: string }[]).map(c => ({ id: c.id, name: c.name }));
    return NextResponse.json({ categories });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Could not load menu categories';
    console.error('[KDS] pos-categories fetch error:', msg);
    return NextResponse.json({ categories: [], error: msg });
  }
}
