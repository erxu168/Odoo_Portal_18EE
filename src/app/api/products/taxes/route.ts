/**
 * GET /api/products/taxes?company_id=N — the tax rates this restaurant can use.
 *
 * Two lists, because Odoo keeps two and they are not interchangeable:
 *   sale     → taxes_id           what you charge a customer
 *   purchase → supplier_taxes_id  what a supplier charges you
 *
 * For an ingredient you buy and never sell, only the purchase list matters. For
 * a menu item, only the sales list. Offering one box labelled "tax rate" would
 * mean guessing which, and guessing wrong puts a number in the accounts.
 *
 * Scoped hard to the requested restaurant: a tax belongs to exactly one company,
 * and offering another company's would let it be attached to the wrong one.
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { roleCan } from '@/lib/permissions';
import { getPermissionOverrides } from '@/lib/db';
import { isUnrestrictedAdmin, canAccessCompany } from '@/lib/inventory-access';
import { getOdoo } from '@/lib/odoo';
import type { TaxOption } from '@/lib/product-tax';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const user = requireAuth();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!roleCan(user.role, 'inventory.productsettings.manage', getPermissionOverrides())) {
    return NextResponse.json({ error: 'Manager access required' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('company_id');
  const companyId = raw && /^\d+$/.test(raw) ? parseInt(raw, 10) : NaN;
  if (!Number.isInteger(companyId) || companyId <= 0) {
    return NextResponse.json({ error: 'A restaurant is required' }, { status: 400 });
  }
  // isUnrestrictedAdmin, not "admin with an empty list": parseCompanyIds returns
  // [] for malformed JSON too, so the naive check would read a corrupted
  // restriction as no restriction.
  if (!isUnrestrictedAdmin(user) && !canAccessCompany(user, companyId)) {
    return NextResponse.json({ error: 'That restaurant is not yours' }, { status: 403 });
  }

  try {
    const odoo = getOdoo();
    // Retired taxes are read too, but never offered. 92 products in this
    // database still carry a WAJ sales tax that has since been archived; the
    // caller needs to recognise that state and say so, rather than showing an
    // empty box that reads as "nobody ever set this".
    const rows = await odoo.searchRead(
      'account.tax',
      [['company_id', '=', companyId], ['type_tax_use', 'in', ['sale', 'purchase']]],
      ['id', 'name', 'amount', 'price_include', 'type_tax_use', 'company_id', 'active'],
      { limit: 200, order: 'type_tax_use, amount desc, name', context: { active_test: false } },
    );

    const shape = (r: Record<string, unknown>): TaxOption => ({
      id: r.id as number,
      name: String(r.name ?? ''),
      // The REAL percentage travels with the name on purpose. WAJ has a tax
      // called "19% Vorsteuer" configured at 0% and another called
      // "Umsatzsteuer 7%" also at 0%; a picker showing only names would read as
      // correct while charging nothing.
      amount: Number(r.amount ?? 0),
      included: !!r.price_include,
      company_id: Array.isArray(r.company_id) ? (r.company_id[0] as number) : companyId,
    });

    const live = rows.filter((r: any) => r.active);
    return NextResponse.json({
      sale: live.filter((r: any) => r.type_tax_use === 'sale').map(shape),
      purchase: live.filter((r: any) => r.type_tax_use === 'purchase').map(shape),
      // Not selectable — only so a screen can tell "never set" apart from "set
      // to a rate that has since been retired". Those need different words.
      retired: rows.filter((r: any) => !r.active).map((r: any) => r.id as number),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Could not load tax rates';
    console.error('[products/taxes]', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
